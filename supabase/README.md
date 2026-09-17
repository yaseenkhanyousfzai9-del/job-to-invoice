# Database migrations

All PostgreSQL schema changes for Job to Invoice must live in this directory as source-controlled migrations.

Rules:

- Do not create tables only in the Supabase dashboard.
- Migrations are the source of truth and must be reproducible on a clean database.
- Commercial tables will live in a private schema with RLS. The mobile app and public portal must not mutate them through Supabase REST.
- CUST-AUTH-01 added `0001_auth_workspace.sql` (`app_users`, `workspaces`, `memberships`, `job_allowances`, `idempotency_records`).
- Customer, job, quote, and invoice schemas are **not** created in this slice.
- Apply migrations with the migration role, not the dashboard. The API role must not be superuser or `BYPASSRLS`.
