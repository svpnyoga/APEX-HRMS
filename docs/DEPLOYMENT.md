# Deployment

## 1. Supabase project

1. Create a project at supabase.com (region close to your users, e.g. Mumbai `ap-south-1`).
2. Link and push the schema:
   ```bash
   supabase login
   supabase link --project-ref <ref>
   supabase db push            # applies supabase/migrations in order
   ```
   There is no seed data and there are no built‑in accounts.
3. Create your company by signing up: open the deployed app, choose **Create an account › Register a company**, confirm your email, and you become the company's super administrator (the bootstrap trigger creates default roles, settings, workflows, rating scale and onboarding/offboarding templates). **Do this straight after deploying** — until the first company exists, the first person to sign up becomes its administrator.
   After that, registering further companies is closed. To host several companies on one project, the operator runs (SQL editor, as `postgres`):
   ```sql
   update public.platform_settings set allow_new_organisations = true;   -- false again to close
   ```
   Staff then sign up with the company code from *Administration › User management › Sign‑up settings* and wait for approval in *Access requests*. You can still invite people directly from the *People* tab.
4. Extensions: `vector` and `pgcrypto` are enabled by the first migration. Enable `pg_cron` (Database › Extensions) **before** pushing to have jobs scheduled automatically; otherwise see Operations.
5. Auth settings (*Authentication › Providers › Email* and *URL Configuration*):
   * **Allow new users to sign up: on** — a new login has no access until an administrator approves it.
   * **Confirm email: on** (required — requests are refused until the address is confirmed).
   * Site URL `https://<your-domain>`; redirect URLs `https://<your-domain>/` and `https://<your-domain>/reset-password`.
   * Minimum password length 10, *lowercase, uppercase letters and digits*.
   * Configure custom SMTP so confirmation emails are delivered reliably, and enable **CAPTCHA** (Turnstile or hCaptcha) under *Attack Protection* to stop bot sign‑ups.
   * Optionally enable TOTP MFA.

## 2. Edge functions

```bash
supabase secrets set SITE_URL=https://hr.yourcompany.com CRON_SECRET=$(openssl rand -hex 24) \
  RESEND_API_KEY=re_xxx DEFAULT_FROM_EMAIL=hr@yourcompany.com ALLOWED_ORIGIN=https://hr.yourcompany.com
supabase functions deploy admin-users
supabase functions deploy biometric-push --no-verify-jwt
supabase functions deploy process-email-outbox --no-verify-jwt
supabase functions deploy scheduled-jobs --no-verify-jwt
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

## 3. Frontend

```bash
cp .env.example .env.production   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (anon key only!)
npm ci && npm run build           # outputs dist/
```
Host `dist/` on any static host (Vercel, Netlify, Cloudflare Pages, S3 + CloudFront, Nginx). Configure SPA fallback (all routes → `index.html`). **HTTPS is required** for camera and geolocation.

Nginx example:
```nginx
location / { try_files $uri /index.html; }
location /models/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
add_header Permissions-Policy "camera=(self), geolocation=(self)";
```

## 4. Go‑live checklist

- [ ] Company information, locations, departments, designations, shifts, holidays
- [ ] Attendance rules (reporting time, grace, weekly offs, missing check‑out policy)
- [ ] Leave types and policies; opening balances (*Leave Balances › Adjust*)
- [ ] Salary components/structures; **verify statutory rates and PT slabs** against current notifications
- [ ] Approval workflows reviewed; HR and finance roles assigned
- [ ] Face recognition thresholds calibrated with *Test match* (see FACE_RECOGNITION.md)
- [ ] Email delivery tested (outbox shows *sent*)
- [ ] Scheduled jobs running (Operations)
- [ ] Privacy notices reviewed by your legal advisor (biometric & location consent text in `src/modules/self/consent.tsx`)
