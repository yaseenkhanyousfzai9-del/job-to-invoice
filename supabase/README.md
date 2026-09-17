# Database migrations

All PostgreSQL schema changes for Job to Invoice must live in this directory as source-controlled migrations.

Rules:

- Do not create tables only in the Supabase dashboard.
- Migrations are the source of truth and must be reproducible on a clean database.
- Commercial tables will live in a private schema with RLS. The mobile app and public portal must not mutate them through Supabase REST.
- Customer, job, and remaining product schemas are **not** created in CUST-FOUNDATION-01.
