# Implementation checklist

Status legend: **Done** = implemented and covered by automated tests or verified build/screens · **Built** = implemented and type‑checked, not exercised against a live Supabase project in this delivery · **Needs config** = code in place, requires your credentials/hardware · **Not included** = deliberately out of scope or future work.

## Phase 1 — Foundation
| Item | Status |
|---|---|
| Project structure, design system (tokens, light/dark, components) | Done |
| Supabase Auth (email/password, reset, invites, idle sign‑out, sign‑in log) | Built (invites need the `admin-users` function deployed) |
| Self sign‑up with role request, email confirmation, company code, admin approval/rejection, domain restriction, rate limit, super‑admin protection; no built‑in accounts | Done (database rules tested; screens verified) |
| Relational schema, 13 migrations, organisation bootstrap | Done (tested) |
| RBAC: 9 default roles, 50 permissions, editable matrix, backend enforcement | Done (tested) |
| Permission‑aware sidebar with the exact 14‑module structure; no dead menus | Done (tested) |
| Admin/HR/Manager portal, Employee self‑service, mobile layout | Done (screens verified) |

## Phase 2 — Core HR
| Item | Status |
|---|---|
| Employee CRUD, generated IDs, 11‑tab profile, deactivate (no hard delete) | Done |
| Departments, designations, structure, hierarchy, transfers, history | Done |
| Documents (private storage, verification) | Built |

## Phase 3 — Attendance
| Item | Status |
|---|---|
| Attendance engine: grace, late, early, half/full day, overtime, missing check‑out, permissions, leave/holiday/weekly off | Done (tested) |
| Face recognition: on‑device detection, quality gate, active + passive liveness, multi‑sample enrolment, server matching, logs, consent, retention | Done (server logic tested; browser pipeline verified to load models and run) |
| Kiosk 1:N mode | Done (tested) |
| Sites, GPS (optional, never blocking), geofence flags, new‑site approval | Done (tested) |
| Offline queue (encrypted, idempotent sync) | Done (server idempotency tested) |
| Shifts, schedules, holidays, regularisation, manual attendance, overtime approval | Done |
| Biometric devices: API keys, user mapping, push endpoint | Needs config (device/middleware must POST to `biometric-push`) |

## Phase 4 — Leave
| Item | Status |
|---|---|
| Types, effective‑dated policies, accrual, carry forward/lapse, encashment, half day, documents, cancellation, ledger balances, calendar | Done (tested) |

## Phase 5 — Payroll & Claims
| Item | Status |
|---|---|
| Structures, components, assignments, statutory config (PF/ESI/PT/gratuity), LOP from approved data, OT, bonuses, loans, recurring deductions | Done (tested) |
| Run lifecycle with approval, lock protection, audited reopen, payslip PDF | Done (tested; PDF built) |
| Salary revisions, full & final settlement | Built |
| Income‑tax (TDS) computation | Not included — finance enters monthly TDS per employee |
| Claims: policies, receipts, duplicate detection, approval, reimbursement batches | Done (tested) |

## Phase 6 — Performance & Engagement
| Item | Status |
|---|---|
| Cycles, KPIs, weighted goals, self/manager/HR reviews, rating scales, final approval, feedback, development plans, history | Built |
| Announcements/news/communication/policies with audiences, scheduling, read & acknowledgement tracking | Built |
| Recognition, feedback & suggestions (anonymous), surveys (anonymous, results), events & RSVP | Built |

## Phase 7 — Workforce & lifecycle
| Item | Status |
|---|---|
| Field dashboard, live map, visits with consent‑gated pings, location history, geofencing | Built |
| Background tracking when the app is closed | Not included — browsers do not allow it; a native wrapper would be required |
| Onboarding templates, checklist, sign‑off approval, assets, policy acknowledgements | Built |
| Offboarding: resignation approval, checklist, clearances, asset return, exit interview, completion with access revocation | Done (blocking rules tested) |

## Phase 8 — Learning
| Item | Status |
|---|---|
| Courses, builder, lessons, assignments, enrolment, assessments (server graded, hidden key), certificates, calendar, My Learning | Done (grading & certificates tested) |

## Phase 9 — Reports & administration
| Item | Status |
|---|---|
| 15 report datasets with filters, charts, Excel/PDF export, custom reports, export centre | Built |
| Approval configuration (sequential, parallel any/all, thresholds, escalation, delegation) | Done (engine tested) |
| Notifications from business events, preferences, templates, email outbox | Built (delivery needs `RESEND_API_KEY`) |
| Push notifications | Not included |
| Audit logs, security settings, data export | Built |
| Scheduled jobs (pg_cron or `scheduled-jobs` function) | Needs config |

## Phase 10 — QA
| Item | Status |
|---|---|
| 223 automated tests (database rules, RLS, face matching, frontend logic, navigation) | Done — all passing |
| Type‑check + production build | Done |
| Visual check of key screens (desktop, mobile, dark) | Done (with recorded API responses) |
| End‑to‑end run against a live Supabase project and edge functions under Deno | Not performed in this delivery — follow the manual cases in TESTING.md after deployment |
