# Architecture

## Patterns chosen and why

| Concern | Pattern | Where |
|---|---|---|
| Business rules | **Thin client, rules in the database.** Every state change with rules (clocking in, applying leave, approving, calculating payroll) is a `SECURITY DEFINER` Postgres function that checks permissions and validates input. The browser cannot bypass it. | `supabase/migrations/*` |
| Data protection | **Row‑level security everywhere** + column privileges (assessment answer keys) + tables with no client policies at all (face templates). | every migration's RLS section |
| Approvals | **One reusable approval engine** (workflow → steps → requests → tasks) with module *hooks* (`approval_hook_<entity>`) invoked on completion. | `0003_workflow_notifications.sql` |
| Balances | **Ledger / event sourcing** for leave: balances move only through immutable `leave_transactions`. | `0005_leave.sql` |
| Face recognition | **Strategy pattern**: `FaceProvider` interface; Postgres `face_similarity(model, a, b)` keyed by model id. | `src/face/*`, `0004_attendance.sql` |
| Frontend structure | **Feature modules** (one folder per HR module) over a shared design system; **repository‑style data hooks** (TanStack Query); **config‑driven CRUD** for master data so 30+ settings screens share one tested implementation. | `src/modules`, `src/components/crud` |
| Integrations | **Adapters behind edge functions** (device push, email delivery, scheduled jobs). Each reports real status; nothing claims success without a provider. | `supabase/functions` |
| Offline | **Outbox pattern** on the device: encrypted IndexedDB queue + server‑side idempotency (`unique(employee_id, client_event_id)`). | `src/face/offline-queue.ts` |

## Runtime view

```
Browser (React)                         Supabase
 ├─ Admin / HR / Manager portal ──┐      ├─ PostgREST  ── RLS ── tables & views
 ├─ Employee self-service (/me) ──┼────▶ ├─ RPC  ── SECURITY DEFINER functions (rules, approvals, payroll, face matching)
 ├─ Kiosk (/kiosk)               ─┘      ├─ Auth (email/password, invites, MFA)
 │   on-device face analysis              ├─ Storage (private buckets, signed URLs)
 │   (Human: detection, mesh,             ├─ Realtime (notification bell)
 │    descriptor, anti-spoof, liveness)   └─ Edge Functions (service role only)
 └─ IndexedDB encrypted punch queue           admin-users · biometric-push · process-email-outbox · scheduled-jobs
```

All three experiences (admin, self‑service, mobile/field) share one backend, one database and one set of rules. Self‑service is responsive and installable (web manifest), with a bottom tab bar on phones.

## Database relationship plan

```
organisations ─┬─ company_settings (1:1, typed columns)
               ├─ locations, departments (self parent, head → employees), designations
               ├─ roles ─ role_permissions ─ permissions
               ├─ user_profiles (= auth.users) ─ user_roles
               └─ employees ─┬─ employee_contacts, employee_bank_details (1:1), employee_documents ─ document_types
                             ├─ employee_employment_history (from/to dept, designation, manager, location, status)
                             ├─ reporting_manager_id → employees (hierarchy), reporting_relationships (dotted lines)
                             ├─ employee_assets
                             ├─ ATTENDANCE: attendance_events → attendance_records (1/day) ← shifts / attendance_schedules / holidays
                             │              attendance_regularisation, attendance_permissions, overtime_records
                             │              face_enrolments, face_templates (vector), face_recognition_attempts, data_consents
                             │              work_sites ─ employee_site_assignments, geofence_settings, attendance_devices ─ device_user_mappings
                             │              field_location_records, field_visits
                             ├─ LEAVE: leave_types ─ leave_policies;  leave_applications;  leave_transactions → leave_balances;  leave_encashments
                             ├─ PAYROLL: salary_components ─ salary_structure_components ─ salary_structures;  employee_salary_assignments
                             │           statutory_configs, professional_tax_slabs, employee_recurring_deductions, employee_loans, payroll_adjustments
                             │           payroll_periods ─ payroll_runs ─ payroll_entries ─ payroll_entry_lines, loan_recoveries, payslips
                             │           salary_revisions, fnf_settlements ─ fnf_lines
                             ├─ CLAIMS: claim_categories ─ expense_policies;  expense_claims ─ claim_attachments;  reimbursements
                             ├─ PERFORMANCE: rating_scales ─ levels; appraisal_cycles ─ performance_goals (─ performance_kpis), appraisal_reviews ─ appraisal_ratings, appraisal_finals; performance_feedback; development_plans
                             ├─ ENGAGEMENT: announcements ─ announcement_recipients; employee_feedback; employee_recognition; surveys ─ questions/participation/responses/answers; company_events ─ event_rsvps
                             ├─ LIFECYCLE: onboarding_templates; onboarding_cases ─ onboarding_tasks; policy_acknowledgements; offboarding_cases ─ offboarding_tasks, clearance_records, exit_interviews
                             └─ LEARNING: course_categories ─ courses ─ course_modules ─ course_lessons; course_assignments → course_enrolments ─ lesson_progress, assessment_results, certificates; assessments ─ questions ─ options; training_sessions
APPROVALS: approval_workflows ─ approval_workflow_steps;  approval_requests (entity_type, entity_id) ─ approval_tasks;  approval_delegations
NOTIFICATIONS: notification_templates, notifications, notification_preferences, email_outbox
AUDIT: audit_logs (trigger + explicit log_action), user_sessions, saved_reports
```

Conventions: UUID primary keys, foreign keys everywhere, `created_at`/`updated_at` with triggers, status columns with `CHECK` constraints, soft deletion (`deleted_at` / `is_active` / `archived`) for anything referenced historically, and organisation scoping on every top‑level table (`organisation_id = current_org_id()` in RLS). Employees cannot be hard‑deleted (trigger).

## Access model

* **Permissions** are codes like `leave.approve`, grouped by module and action (view, create, edit, delete, approve, reject, export, manage). Roles are per organisation and editable in *Administration › Roles and Permissions*.
* **Scope** comes from three helpers used by RLS: `current_employee_id()`, `is_subordinate(emp, manager)` (recursive reporting chain), and `can_view_employee(emp, module)` — self, *module*`.view` (organisation), or *module*`.view_team` (reporting line).
* **Salary is deliberately not visible to managers** (`payroll.view` only). Bank/statutory details need `employees.sensitive`.
* Internal functions (approval plumbing, punch insertion, notifications) have `EXECUTE` revoked from client roles; only the public RPCs listed in [API.md](API.md) are callable.
* The sidebar is permission‑aware, but hiding a button is never the control — the database is.

## Security & privacy

* Face templates: RLS enabled with **no policies** (no client can select them). Matching runs inside `_face_evaluate`. Withdrawing consent deletes templates; templates of exited employees are purged after the retention period.
* Location: accepted only with consent and within the configured tracking window; retention purge job.
* Files: private buckets, paths namespaced `<org>/<employee>/…`, storage RLS, 5‑minute signed URLs.
* Audit: triggers on employees, bank details, documents, salary assignments, payroll runs, settings, role/permission changes; explicit `log_action` for domain events (manual attendance, payroll reopen, face enrolment, exits). Audit rows have no client write policies.
* Sign‑up: anyone can create a login, but a login without a `user_profiles` row matches no RLS policy. Profiles are created only by `create_organisation_account` (first company) or `decide_access_request` (admin approval). Triggers on `user_roles`, `user_profiles` and `role_permissions` stop non‑super‑administrators from granting/removing super administrator, deactivating one, removing the last one, or adding full access.
* Sessions: idle sign‑out from `company_settings.session_timeout_minutes`; sign‑in/out log; MFA can be enforced in Supabase Auth.
* Service‑role key only inside edge functions. `.env.example` warns never to place it in a `VITE_` variable.
