# Modules

Each module lists its screens (sidebar order matches the specification), the rules enforced in the database, and the main tables/functions.

## 01 Dashboard
HR overview (`dashboard_summary`: headcount, today’s attendance, approvals, claims, payroll, department headcount, 14‑day attendance trend, 6‑month leave trend, celebrations, recent activity), Employee dashboard (self‑service home, `my_home`), Attendance/Leave/Claims overviews, Workforce overview (team today, upcoming leave, goal progress, pending approvals), Management analytics (12‑month headcount/joiners/exits, attrition, payroll cost, claims mix). All figures are queried from live records and scoped by RLS — HR sees the organisation, managers their reporting line.

## 02 Employee Management
Directory (table/cards, filters), 11‑tab profile (overview, personal, employment, attendance, leave, payroll, claims, performance, learning, documents, activity), departments, designations, organisation structure tree, reporting hierarchy, documents with verification, lifecycle board, transfers (`transfer_employee` blocks circular reporting), employment history. Employee IDs are generated (`EMP1001…`). Employees cannot be deleted — deactivate instead. Personal data (DOB, address, personal phone) is visible only to self, reporting line and HR; everyone sees the safe `employee_directory` view.

## 03 Time & Attendance
Clock in/out with face + liveness, optional site and GPS, offline queue. Rules (`recompute_attendance_day`): shift from schedule › employee shift › default shift › company reporting time; **grace period (default 10 min)** then *Late*; early departure; full/half‑day thresholds; overtime above the minimum; approved permissions excuse late/early; approved leave and holidays/weekly offs set status. Day close (`process_daily_attendance`) marks absences and **missing check‑outs** (policy: flag / half day / absent) and notifies the employee. Daily and monthly registers, calendar, late/early/missing reports, overtime approval (paid in payroll), regularisation and permission requests (approval engine), manual attendance and absence confirmation (HR, audited), shifts, work schedules, holidays, biometric devices (API keys + user mapping), face enrolment admin. Geofence results only *flag* — GPS problems never block attendance.

## 04 Leave Management
Apply (balance, overlap, notice, gender restriction, half‑day, max consecutive days, document requirement — all validated in `apply_leave`), approvals (engine; default manager → HR), types, effective‑dated policies (entitlement, accrual monthly/quarterly/annual, carry forward, encashment), balances (ledger view), accrual (idempotent per month, scheduled), year close (carry forward + lapse), encashment (approval → payroll adjustment), calendar, holiday management. Balances change only on final approval, and are restored when approved future leave is cancelled.

## 05 Payroll Management
Salary structures with % of gross / % of basic / fixed / balancing components and live preview; effective‑dated employee assignments; allowances and deductions; statutory rules (PF with wage ceiling, ESI with threshold, gratuity rule, PT slabs by state, recurring deductions such as TDS) — all data, effective‑dated, never hard‑coded. `calculate_payroll_run` prorates by paid days using approved unpaid leave and confirmed absences (configurable basis: calendar / working / 30 days), adds approved overtime, bonuses/incentives/encashment, PF/ESI/PT, recurring deductions and loan EMIs. Flow: open run → calculate → review line by line → submit (approval engine) → lock & publish payslips (PDF). Locked runs are protected by a trigger; reopening needs `payroll.manage`, a reason, reverses loan recoveries and is audited. Salary revisions (approval → new assignment + history). Full & final settlement (final‑month salary, leave encashment, gratuity, notice shortfall, loans).

## 06 Expense & Claims
Submit with receipts (SHA‑256 stored for duplicate‑receipt detection), draft/resubmit, my claims, all claims, categories (receipt threshold), policies (per‑claim/monthly limits by designation, submission window, exceed with justification or block), approval (default manager → finance), reimbursement batches (notifies employees), receipt gallery with signed‑URL preview, reports.

## 07 Performance Appraisal
Cycles (annual/half‑yearly/quarterly) with configurable rating scales; KPI library; weighted goals with progress; launch creates self/manager/HR review stages and notifies; review forms show earlier stages’ ratings; weighted score computed in the database; HR submission sends the final result through the approval engine; feedback (private or manager‑visible); development plans; history timeline; reports.

## 08 Employee Engagement
Announcements, company news, internal communication (department/location audiences), company policies with versioned acknowledgement and tracking; scheduling, publishing (notifies audience), archiving, read/ack counts; recognition wall; feedback & suggestions (anonymous option stores no identity) with responses; surveys (rating/choice/yes‑no/text, anonymous responses, double‑vote prevention, results); events with RSVP; notification centre.

## 09 Field Staff Tracking
Field dashboard map, live location (last known position, ageing colours), site attendance (GPS status, distance, geofence result), site assignments, site management with map picker and approval of employee‑entered sites, GPS tracking settings + consent register, geofence rules (flag/record/off, tolerance, accuracy), visits (start/end with location; position shared every 2 minutes only while a visit runs and within the tracking window), location history route.

## 10 Employee Onboarding
Registration (employee record + generated ID) → start onboarding (checklist from template: information, documents, verification, department/manager/shift assignment, account, assets, face enrolment, policy acknowledgement, HR approval) → progress tracking → HR sign‑off via approval engine (status becomes active/probation). Asset allocation, document verification and policy acknowledgement tracking are dedicated screens.

## 11 Employee Offboarding
Resignation (self or HR‑recorded separation) → approval → exit checklist and department clearances generated → knowledge handover, asset return, dues, exit interview → F&F settlement → `complete_offboarding` (blocked until all clearances, mandatory tasks and asset returns are done) marks the employee exited, deactivates the login and removes roles. History is kept.

## 12 Learning (LMS)
Library and enrolment, categories, programs (course builder with modules and text/video/PDF/presentation/link lessons), direct enrolment, assignments to everyone/department/designation/person (fan‑out + notifications), training calendar (sessions), assessments and quizzes (answer key hidden by column privilege; graded on the server; attempt limits), automatic completion and certificate issue with PDF, progress tracking, My Learning, course player.

## 13 Reports & Analytics
Report engine over security‑invoker views (the caller’s RLS applies): employees, attendance register, late arrivals, missing check‑outs, overtime, leave utilisation and balances, payroll register/salary statement, claims & reimbursements, appraisal summary, training completion, field activity, onboarding, offboarding, department distribution. Each has date/department/designation/status filters, search, sort, pagination, summary strip, chart, Excel and PDF export. Custom reports (choose dataset + columns, save layouts), export centre.

## 14 Administration
Users (people list with invite via edge function, roles, deactivate/reactivate, password reset; access requests from self sign‑up with approve/reject; sign‑up settings — company code, rotate, on/off switch, allowed email domains), roles & permissions matrix, organisation settings (locations, document types), company information (on payslips), attendance rules, leave configuration, payroll configuration, approval configuration (steps, approver types, parallel any/all, amount thresholds, escalation, delegations), notification settings (templates + personal preferences), email settings (sender + outbox), integration settings (face provider & thresholds, device/email health), security settings (idle timeout, MFA flag, sign‑in activity), audit logs (before/after diff), data backup (Excel/JSON export within your permissions).
