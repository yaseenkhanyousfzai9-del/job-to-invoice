# Development Supabase / Postgres

This directory is the source of truth for PostgreSQL schema. Do not create tables only in the dashboard.

Current migrations:

- `0001_auth_workspace.sql` — `app` schema, `app_users`, `workspaces`, `memberships`, `job_allowances`, `idempotency_records`, FORCE RLS, `app_api` privilege role
- `0002_app_api_login.sql` — `app_api_login` runtime LOGIN role (no password in git)

Customer, job, quote, and invoice tables are **not** created here.

CLI: `supabase@2.117.0` (repository `devDependency`). Run `npx supabase` so the pinned version is used.

## What this slice cannot do automatically

Creating a hosted Supabase project requires organization selection, a database password, and billing/account authorization. Agents must not create that project.

Create a **development-only** project named:

**Job to Invoice — Development**

Do **not** create or use a production project for this work.

## Account-owner steps (required)

1. In the Supabase dashboard, create project **Job to Invoice — Development** in your development organization. Choose a US region consistent with later production. Set a unique database password and store it in your password manager. This is `APP_ENV=development` only.
2. Copy `.env.example` to **`.env.development.local`** at the repo root (gitignored). Copy `apps/api/.env.example` to `apps/api/.env.development.local` and `apps/mobile/.env.example` to `apps/mobile/.env.development.local`. Fill placeholders only for this development project.
3. From **Project Settings → API**:
   - Project URL → `AUTH_PROJECT_URL` and `EXPO_PUBLIC_AUTH_PROJECT_URL`
   - Publishable / anon key → `EXPO_PUBLIC_AUTH_PUBLISHABLE_KEY` and `AUTH_PUBLISHABLE_KEY`
   - Do **not** put the service-role key in mobile or any `EXPO_PUBLIC_*` variable
4. Derive server JWT settings (do not invent a second issuer):
   - `AUTH_ISSUER=<AUTH_PROJECT_URL>/auth/v1`
   - `AUTH_AUDIENCE=authenticated`
   - `AUTH_JWKS_URL=<AUTH_PROJECT_URL>/auth/v1/.well-known/jwks.json`
5. From **Project Settings → Database**, copy:
   - Migration URI as the **postgres / migration** role → `DATABASE_URL_MIGRATIONS` (server-only)
   - After step 8, a **separate** URI as `app_api_login` → `DATABASE_URL_API` (server-only)
6. Auth dashboard (development email only, not production Resend):
   - Authentication → Providers → Email: enable email OTP
   - Set **Email OTP expiration** to **600 seconds** (hosted default is 3600; PRD ACC01 is 10 minutes)
   - Magic Link / OTP template must include `{{ .Token }}` (six-digit code)
   - Resend cooldown is provider-enforced at ~60 seconds per user (PRD ACC01). Do not disable it
   - Confirm Confirmations are compatible with `signInWithOtp({ shouldCreateUser: true })`
7. Login and link this repository to the development project only:

   ```bash
   npx supabase login
   npx supabase link --project-ref <DEVELOPMENT_PROJECT_REF>
   ```

   Do not link staging or production.
8. Apply source-controlled migrations:

   ```bash
   npm run db:push:dev
   ```

   `APP_ENV` must be `development`. Then, as the migration role, set a unique development password (do not commit it):

   ```sql
   ALTER ROLE app_api_login WITH PASSWORD '<development-only secret>';
   ```

   Point `DATABASE_URL_API` at `app_api_login`. Never point the runtime API at `postgres`, a superuser, or a `BYPASSRLS` role.
9. Provide a fictional developer mailbox for OTP (not a customer or production inbox). Re-run live QA01/QA02 after that mailbox works.

## Roles

| Role | Git | Use |
|---|---|---|
| Migration (`postgres` on hosted) | `DATABASE_URL_MIGRATIONS` | Schema apply only |
| `app_api` | created in `0001` | NOLOGIN privilege group; RLS policies target this role |
| `app_api_login` | created in `0002`; password **not** in git | Runtime `DATABASE_URL_API` |
| `anon` / `authenticated` | Supabase Auth | No GRANT on `app.*` |

## Provider limits vs PRD ACC01

| ACC01 rule | Provider capability |
|---|---|
| Six-digit code | Yes (`otp_length = 6`; hosted email OTP is six digits) |
| ~10 minute expiry | Hosted default **3600s**. Set dashboard Email OTP expiration to **600** |
| ~60s resend | Yes (default 60s per user) |
| At most five verification failures per challenge | **Not a hosted per-challenge setting.** Hosted `/auth/v1/verify` is rate-limited per IP (documented as 360/hour with burst). Local CLI `token_verifications` is per IP per 5 minutes. The app maps all verify failures to generic copy and does not enumerate accounts. Do not invent a second OTP store to count attempts. |

## Local CLI stack (optional)

`npx supabase start` can run a local Auth/Postgres stack for later machine-local work. It is **not** a substitute for the hosted development project required by OPS01. Do not treat local Docker keys as production or staging.

## Safety

- Never commit `.env.development.local`, service-role keys, database URLs with passwords, or access tokens
- Never apply these migrations to staging or production from this workflow
- Never create Customer tables in this directory until CUST-DB-01
