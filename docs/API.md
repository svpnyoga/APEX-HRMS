# API & integrations

The frontend talks to Supabase directly. Reads go through PostgREST with RLS; anything with business rules is an RPC (`supabase.rpc(name, args)`). Internal helper functions have `EXECUTE` revoked from client roles.

## Public RPCs

| Function | Permission / caller | Purpose |
|---|---|---|
| `get_my_access()` | any signed‑in user | Roles, permissions, employee id, manager flag (`organisation_id` is null until approved) |
| **Sign‑up & access** | | |
| `signup_options()` | anyone (the only anonymous RPC) | `{ can_create_organisation }` |
| `my_signup_status()` | signed‑in user | Email confirmed?, profile?, latest access request |
| `create_organisation_account(p_company_name, p_full_name, p_mobile, p_city, p_state)` | confirmed user, only while company registration is open | Creates the company; caller becomes super administrator |
| `request_access(p_join_code, p_full_name, p_requested_role, p_mobile, p_job_title, p_message)` | confirmed user without access | Returns `{ok:false, error}` for a wrong code (5 per hour) |
| `decide_access_request(p_request, p_approve, p_roles, p_employee_id, p_create_employee, p_note)` | `admin.users` (super administrator to grant `super_admin`) | Approve (roles + employee link) or reject (reason required) |
| `rotate_join_code()` | `admin.users` | New company code; the old one stops working |
| `my_home()` | employee | Self‑service dashboard data |
| `dashboard_summary(p_date)` | `dashboard.view` or team view | HR / manager dashboard (scoped) |
| `attendance_range_summary(p_from, p_to)` | scoped | Attendance totals for a range |
| `upcoming_celebrations(p_days)` | any | Birthdays & anniversaries (month‑day only) |
| **Attendance** | | |
| `face_clock(p_embedding, p_model, p_antispoof, p_liveness, p_challenge_passed, p_quality, p_event_type, p_site_id, p_new_site_name, p_lat, p_lng, p_accuracy, p_gps_status, p_client_event_id, p_occurred_at, p_offline)` | `attendance.clock` | 1:1 face verification + punch |
| `clock_event(...)` | `attendance.clock` | Punch without face (only when the org does not require face) |
| `kiosk_identify_clock(p_embedding, p_model, p_antispoof, p_liveness, p_challenge_passed, p_quality, p_site_id, p_device_id)` | `attendance.kiosk` | 1:N identification on a shared device |
| `face_enrol(p_employee, p_model, p_embeddings jsonb, p_qualities jsonb)` | `attendance.face_enrol` | Store templates (needs consent, min samples) |
| `face_test_match(p_employee, p_embedding, p_model)` | `attendance.face_enrol` | Calibration score, no punch |
| `face_revoke_enrolment(p_employee, p_reason)` | HR or self | Delete templates |
| `record_consent(p_type, p_granted, p_policy_version, p_user_agent, p_employee)` | self, or HR on behalf | Biometric / location consent |
| `manual_attendance(p_employee, p_date, p_in, p_out, p_reason)` | `attendance.manage` | HR correction (audited) |
| `confirm_absence(p_record, p_remarks)` | `attendance.manage` | |
| `request_regularisation(p_date, p_in, p_out, p_type, p_reason)` | employee | → approval |
| `request_attendance_permission(p_date, p_from, p_to, p_type, p_reason)` | employee | → approval |
| `decide_overtime(p_id, p_approve, p_minutes)` | manager / HR | |
| `record_location_ping(p_lat, p_lng, p_accuracy, p_recorded_at, p_source, p_speed, p_battery)` | employee with location consent | Dropped outside tracking window |
| **Leave** | | |
| `apply_leave(p_leave_type, p_start, p_end, p_half, p_session, p_reason, p_document_path)` | `leave.apply` | Validated application → approval |
| `cancel_leave(p_id, p_reason)` | owner / `leave.manage` | Withdraw or reverse |
| `adjust_leave_balance(p_employee, p_type, p_year, p_days, p_remarks)` | `leave.manage` | Ledger adjustment |
| `run_leave_accrual(p_org, p_as_of)` / `close_leave_year(p_org, p_year)` | `leave.manage` (or cron) | |
| `request_leave_encashment(p_type, p_days)` | employee | → approval → payroll |
| `count_leave_days`, `leave_available` | helpers | |
| **Payroll** | | |
| `create_payroll_run(p_month)`, `calculate_payroll_run(p_run)`, `submit_payroll_run(p_run)` | `payroll.process` | |
| `lock_payroll_run(p_run)` | `payroll.approve` | Publish payslips |
| `reopen_payroll_run(p_run, p_reason)` | `payroll.manage` | Audited reopen |
| `request_salary_revision(...)`, `compute_fnf(...)` | `payroll.manage` | |
| `salary_breakdown(p_employee, p_date)` | `payroll.view` / self | Full‑month component breakdown |
| **Claims** | | |
| `submit_claim(p_claim)` | owner | Policy, receipt, duplicate checks → approval |
| `reimburse_claims(p_claims, p_reference, p_mode, p_paid_on)` | `claims.reimburse` | |
| **Approvals** | | |
| `act_on_approval(p_task, p_action 'approve'|'reject', p_comment)` | assigned approver | Reject requires a reason |
| `cancel_approval(p_entity_type, p_entity_id)` | requester / admin | |
| view `my_approval_tasks` | approver | Inbox |
| **Performance / engagement / lifecycle / learning** | | |
| `launch_appraisal_reviews`, `submit_appraisal_review` | HR / reviewer | |
| `publish_announcement`, `mark_announcement`, `submit_survey` | | |
| `start_onboarding`, `submit_onboarding_completion`, `complete_lifecycle_task`, `submit_resignation`, `update_clearance`, `complete_offboarding` | | |
| `enrol_in_course`, `complete_lesson`, `submit_assessment`, `apply_course_assignment`, `assessment_answer_key` | | |
| `transfer_employee(...)` | `employees.manage` | |

Every RPC raises a readable error (`raise exception '…'`) that the UI shows as a toast; permission failures use SQLSTATE `42501`.

## Edge functions

| Function | Auth | Body |
|---|---|---|
| `admin-users` | User JWT; caller must have `admin.users` | `{ action: 'invite', email, full_name, employee_id?, roles[] }` · `{ action: 'activate' | 'deactivate', user_id }` |
| `biometric-push` | Header `x-device-key: <device-id>.<secret>` (secret issued in *Biometric Devices*, stored as SHA‑256) | `{ punches: [{ user_code, timestamp (ISO 8601), type?: 'in'|'out'|'auto', id?: vendor log id }] }` → per‑punch result; duplicates are ignored |
| `process-email-outbox` | Header `x-cron-secret` | — Sends queued notification emails through Resend (`RESEND_API_KEY`). Without a key it returns `not_configured` and leaves mail queued. |
| `scheduled-jobs` | Header `x-cron-secret` | `{ job: 'close_attendance_day' | 'leave_accrual' | 'escalate_approvals' | 'announcements' | 'daily_reminders' | 'retention_purge' }` — for projects without pg_cron |

### Connecting a biometric device

Most fingerprint/face terminals (ZKTeco, eSSL, Matrix, etc.) either push logs over HTTP or are polled by vendor middleware. Point the push (or a small middleware script) at:

```
POST https://<project>.supabase.co/functions/v1/biometric-push
x-device-key: 3f2c…(device id).9a7b…(secret)
content-type: application/json

{"punches":[{"user_code":"1023","timestamp":"2026-11-05T09:31:12+05:30","id":"log-88213"}]}
```

Map each device user code to an employee in *Device user mappings*. Vendor‑specific protocol adapters (e.g. ZKTeco ADMS/push SDK) are not bundled; they only need to translate to this JSON.

### Email

Notifications are created from business events by `notify()` (respects each user’s preferences and the templates in *Notification Settings*) and queued in `email_outbox`. Configure `RESEND_API_KEY` (or swap the provider inside `process-email-outbox`) and schedule it every 5 minutes.

### Maps

Leaflet with OpenStreetMap tiles by default (`VITE_MAP_TILE_URL`). For production volume use your own tile provider as OSM’s tile policy requires.

### Push notifications

Not implemented. The notification centre (with Realtime) and email cover all events; web push can be added by subscribing service workers and sending from an edge function.
