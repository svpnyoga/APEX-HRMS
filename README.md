# Apex HRMS

A complete human resource management system: employee records, face‑verified attendance, leave, internal payroll, expense claims, appraisals, engagement, field staff tracking, onboarding/offboarding, learning, reports and administration — with role‑based access enforced in the database.

Built with React + TypeScript + Vite + Tailwind on the frontend and Supabase (PostgreSQL, Auth, Storage, Edge Functions) on the backend.

> Excluded by design: CRM, sales pipeline/quotations/invoicing, outsourced payroll services and applicant tracking/recruitment.

---

## Quick start (local)

Requirements: Node 20+, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install                      # also copies the face models into public/models
supabase start                   # local Postgres, Auth, Storage, Realtime
supabase db reset                # applies every migration (no demo accounts)
cp .env.example .env             # set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from `supabase status`
npm run dev                      # http://localhost:5173
```

### Accounts: sign up, no built‑in logins

There are **no fixed usernames or passwords**. Open the app and choose **Create an account**:

1. **The first person to sign up registers the company** and becomes its *super administrator* (with their own employee record).
2. Everyone else picks **Join my company**, enters the **company code** (shown to administrators in *Administration › User management › Sign‑up settings*), chooses the role they need — employee/worker, field employee, team leader, manager, HR, finance, management, administrator or kiosk — and confirms their email.
3. Their account can see **nothing** until an administrator approves it in *User management › Access requests*, where the administrator chooses the final roles (the requested role is only a suggestion) and links or creates the employee record. Rejections need a reason, which is emailed to the person.

Security: email confirmation is required; wrong company codes are rate‑limited (5 per hour); codes can be rotated and sign‑ups switched off or restricted to your email domains; only a super administrator can grant, remove or deactivate a super administrator, and the last one can never be removed; registering additional companies is closed after the first (the platform operator can reopen it). All of this is enforced in the database, not just the screens.

Locally, `supabase start` includes Inbucket at http://localhost:54324, where confirmation emails arrive.

Face attendance needs a real camera and an in‑person enrolment: sign in as an HR administrator → *Time & Attendance › Face Recognition* → **Enrol** the employee after recording their consent, then sign in as that employee and clock in.

## Tests

```bash
npm test          # 223 tests: database business rules + RLS (PGlite, no Docker needed) and frontend logic
npm run build     # type-check + production build
```

The database suite runs every migration and a test fixture (tests/db/fixtures) in an in‑process Postgres (PGlite + pgvector), then checks payroll maths, leave ledger, grace‑period lateness, idempotent offline sync, face matching/anti‑spoofing/kiosk identification, row‑level security isolation, and the sign‑up/approval rules. See [docs/TESTING.md](docs/TESTING.md).

## Documentation

| | |
|---|---|
| [Architecture & database plan](docs/ARCHITECTURE.md) | Design patterns, layers, schema relationships, security model |
| [Face recognition](docs/FACE_RECOGNITION.md) | Method, liveness, threat model, calibration, provider replacement |
| [Modules](docs/MODULES.md) | What each of the 14 modules does and where its rules live |
| [API & integrations](docs/API.md) | Database RPCs, edge functions, biometric device push, email |
| [Deployment](docs/DEPLOYMENT.md) | Supabase project setup, secrets, hosting the frontend |
| [Operations](docs/OPERATIONS.md) | Scheduled jobs, backups, retention, statutory updates |
| [Testing](docs/TESTING.md) | Automated suites and manual test cases |
| [Implementation checklist](docs/CHECKLIST.md) | What is complete, what is partial, what needs your configuration |

## Project layout

```
src/
  app/            routing, auth context, permission-aware navigation
  components/     ui primitives · layout shells · common (DataTable, pickers, calendar) · crud (config-driven CRUD)
  face/           FaceProvider interface, Human provider, quality gate, liveness challenge, scanner, offline queue
  modules/        one folder per module (pages + module logic)
  hooks/ lib/     data hooks, Supabase client, export (Excel/PDF), storage helpers
supabase/
  migrations/     12 ordered migrations: schema, RLS, business functions, approval engine, cron
  functions/      admin-users · biometric-push · process-email-outbox · scheduled-jobs
  seed.sql        demo data (never run in production)
tests/
  db/             PGlite-based database tests        unit/   frontend logic tests
```
