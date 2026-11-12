# Testing

## Automated (`npm test`)

**Database — `tests/db/business.test.ts`** (runs all 13 migrations + the test fixture `tests/db/fixtures/demo_seed.sql` in PGlite with pgvector; RLS is exercised by switching to the `authenticated` role with a JWT subject):

| Area | Checks |
|---|---|
| Seed workflow | attendance history with late/absent, payroll calculated → approved (2 steps) → locked with payslips, sick leave approved through ledger |
| Payroll | net = gross − deductions; deduction lines sum to total; PF uses wage ceiling (12% × 15,000); ESI only under threshold; locked run cannot be edited; reopen needs `payroll.manage` + reason, is audited and reverses loan recovery |
| Leave | overlap rejected; insufficient balance rejected; gender‑restricted type rejected; document required for long sick leave; employee has no task for own request; reject without reason refused; manager → HR two‑step approval debits once; cancelling approved future leave credits back; accrual idempotent |
| Attendance | 9 min after start = on time, 11 min = late with 11 late minutes; online sequence rules; offline replay idempotent; GPS outside geofence flags but does not block; GPS denied still records; stale offline punch rejected; face required when configured |
| Face | enrolment only by HR and only with minimum samples; templates unreadable even by HR; wrong face → `no_match`; low anti‑spoof → `spoof_suspected`; missing challenge → `liveness_failed`; correct face → punch; every attempt logged; kiosk 1:N identifies the right person; non‑kiosk cannot identify; withdrawing consent deletes templates |
| RLS | employee sees only own salary/payslips/bank, no payroll runs; manager sees team attendance but not team salary; employee cannot read other employees’ personal rows but sees the directory; direct inserts/updates and internal functions are denied; answer keys unreadable; audit logs restricted |
| Claims / learning / offboarding / dashboard | duplicate detection, receipt enforcement; quiz grading, completion and certificate; exit blocked while assets/clearances pending; dashboard scoping |

**Database — `tests/db/signup.test.ts`** (fresh database, no fixture): anonymous visitors can call only `signup_options`; unconfirmed email refused; first sign‑up creates the company, becomes super administrator and gets an employee record; second company refused until the operator allows it; wrong company code refused and rate‑limited after five attempts; a pending account sees no rows; admins notified; reject requires a reason and the person can resubmit; approval creates profile, roles and employee; HR cannot grant super administrator (via RPC or direct insert), remove or deactivate one, or add full‑access permissions; last super administrator cannot be removed; email‑domain restriction and sign‑up switch; rotating the code invalidates the old one; tenants are isolated.

**Frontend — `tests/unit`**: quality gate, liveness challenge (blink, both‑way turn, static photo, eyes closed too long, multiple faces), EAR maths, client/server similarity parity, every sidebar item resolves to a route, all 14 modules present, no excluded modules.

## Manual test cases (with a live Supabase project)

| # | Scenario | Expected |
|---|---|---|
| M1 | Employee without enrolment opens Clock In | “Face not enrolled” message; no punch possible when face is required |
| M2 | HR enrols with consent, employee clocks in at 09:38 (shift 09:30) | Punch recorded, status present, not late |
| M3 | Same at 09:45 | Late badge, 15 late minutes |
| M4 | Hold a printed photo / phone screen to the camera | Anti‑spoof message or challenge cannot complete; attempt logged |
| M5 | Airplane mode, clock in, reconnect | “Saved offline”, then “1 offline punch synced”; record flagged *offline punch* |
| M6 | Field employee selects a customer site 2 km away | Punch accepted, flagged “x m outside site” |
| M7 | Apply leave → manager approves → HR approves | Balance decreases only after HR; notifications at each step |
| M8 | Reject without a comment | Button disabled / server refuses |
| M9 | Run payroll, open an entry | Line‑by‑line basis shown (proration, PF base, PT slab) |
| M10 | Lock payroll, employee downloads payslip | PDF with earnings, deductions, net in words |
| M11 | Submit same claim twice | Second flagged “possible duplicate” |
| M12 | Employee tries `/payroll` | “You don’t have access”; API returns no rows |
| M13 | Resign → approve → complete exit with laptop issued | Blocked until asset returned and clearances done; then login disabled |
| M14 | Mobile (390 px) self‑service | Bottom tab bar, clock card first, tables scroll horizontally |
| M15 | Kiosk account at `/kiosk` | Full‑screen scanner; recognised name and punch shown, resets after 3.5 s |
| M9 | Sign up on a fresh project with *Register a company* | Confirmation email; after confirming, you land in the app as super administrator |
| M10 | Second person signs up with the company code as *Employee / worker* | “Waiting for approval”; nothing else is visible; administrator gets a notification |
| M11 | Administrator approves with roles Employee + Field employee | Person is emailed, signs in and sees self‑service; new employee ID generated |
| M12 | HR administrator tries to approve someone as Administrator | Super administrator chip disabled; server refuses if forced |
| M13 | Enter a wrong company code five times | Locked out of requesting for an hour |
