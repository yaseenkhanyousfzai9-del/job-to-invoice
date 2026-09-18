# Decisions

Authority: PRD. This log records engineering decisions where the PRD already supplies direction or where an additive contract is required to implement a listed screen without changing product behaviour.

SOP §15: escalate only ambiguities that materially affect business model, pricing, legal requirements, fundamental UX, security, architecture, or irreversible implementation. The seven items below are not product-owner blockers.

Do not treat this file as permission to invent unrelated product scope.

Date format: ISO date. Status values: ACCEPTED.

---

## DEC-CUST-001

**ID:** DEC-CUST-001  
**Date:** 2026-09-17  
**Question:** The PRD endpoint inventory lists `GET /customers` (list) but not `GET /customers/{id}`. How does S19 Customer Detail load a single record?  
**Decision:** Add `GET /v1/customers/{id}` as a narrow owner read. Authenticated owner only. Workspace-scoped. Unknown or cross-tenant id returns generic 404. Response is the Customer resource (including `archived_at` and `version`). Do not expose unrestricted table CRUD and do not embed the full jobs collection on this resource.  
**PRD evidence:** Section 22: the inventory is “the minimum implementation contract, not permission to expose raw CRUD on immutable tables.” S19 requires search/list, create, and customer detail with jobs. AUTHZ01 generic 404.  
**Reason:** Paginated list payloads cannot be the only correct way to open detail (cursors, archived-hidden defaults, stale pages). An additive owner GET is the smallest safe read. Jobs are loaded separately (DEC-CUST-006) so the Customer resource stays a contact record.  
**Requirements affected:** S19, AUTHZ01, QA03, CUST-API-03, CUST-UI-03  
**Reversible:** Yes (could later collapse into a list filter; behaviour must remain owner-scoped 404).  
**Migration/API implication:** OpenAPI path `GET /v1/customers/{id}`. No schema change.  
**Status:** ACCEPTED

---

## DEC-CUST-002

**ID:** DEC-CUST-002  
**Date:** 2026-09-17  
**Question:** How is CUS01 duplicate normalized-email warning plus confirmed second contact enforced?  
**Decision:** Server-enforced confirmation, not UI-only. `POST /v1/customers` and email-changing `PATCH /v1/customers/{id}` accept `confirm_duplicate_email` (default false). If a same-workspace `normalized_email` match exists and the flag is not true, return 409 `DUPLICATE_CUSTOMER_EMAIL` with safe same-workspace metadata (`duplicates: [{ id, name }]` only). After explicit UI confirmation, the client retries with a **new** Idempotency-Key and `confirm_duplicate_email: true`. The server rechecks, then inserts or updates. No unique database constraint on `(workspace_id, normalized_email)`. Index that pair for lookup only. No cross-workspace metadata.  
**PRD evidence:** CUS01; DB03 “index normalized customer email by workspace” (not unique); API01 idempotency mismatch if the same key is reused with a different body; API02 409 for state conflict.  
**Reason:** A unique constraint would violate CUS01. A UI-only warning would allow API clients to skip the warning. 409 (not 422) matches “state conflict requiring a deliberate retry.” A new Idempotency-Key is required because the confirmed body differs.  
**Requirements affected:** CUS01, S07, VAL01, DB03, POST/PATCH `/customers`, R-CUS-02  
**Reversible:** Yes (error code/metadata shape), not the confirmation requirement.  
**Migration/API implication:** Non-unique index only. Additive request field and error code.  
**Status:** ACCEPTED

---

## DEC-CUST-003

**ID:** DEC-CUST-003  
**Date:** 2026-09-17  
**Question:** If a supplied phone cannot be parsed to E.164, may it be stored raw after a warning?  
**Decision:** No. Phone is optional. If omitted or null, save proceeds. If supplied, parse to E.164 where valid. If it cannot be parsed without guessing country (including assuming `+1`), block save with 422 `VALIDATION_FAILED` on `phone` until the value is corrected or removed. Do not add a raw-phone override.  
**PRD evidence:** VAL01: “Phone optional, E.164 where parsable, otherwise show validation rather than guessing country.”  
**Reason:** This is a stated validation rule, not a product-owner gap. Guessing US country code would violate VAL01 even though v1 is a US storefront.  
**Requirements affected:** VAL01, S07, CUST-DOMAIN-01, POST/PATCH `/customers`  
**Reversible:** No without a PRD change.  
**Migration/API implication:** `customers.phone` stores E.164 or null only.  
**Status:** ACCEPTED

---

## DEC-CUST-004

**ID:** DEC-CUST-004  
**Date:** 2026-09-17  
**Question:** CUS02 says offer archive and export when a referenced customer cannot be deleted. Is a customer-scoped export required?  
**Decision:** Do not invent a Customer-scoped export. `DELETE /v1/customers/{id}` returns 409 `CUSTOMER_REFERENCED`. UI offers Archive Customer. Workspace export is EXP01 (`POST /exports`) from Settings when that feature exists. Until EXP01 is implemented, Archive is available; Export must not be shown as a working Customer action (development may label it unavailable). No new endpoint.  
**PRD evidence:** CUS02; section 22 has no customer export route; EXP01 is workspace ZIP including `customers.csv`; S24 is Settings export.  
**Reason:** Expanding scope with a new export would contradict the inventory and Settings-owned export flow. Archive already preserves referenced history.  
**Requirements affected:** CUS02, S19, CUST-API-06, CUST-UI-06, EXP01 (dependency)  
**Reversible:** Yes if product later specifies a customer-scoped export.  
**Migration/API implication:** 409 code only. No export tables for Customer.  
**Status:** ACCEPTED

---

## DEC-CUST-005

**ID:** DEC-CUST-005  
**Date:** 2026-09-17  
**Question:** Does `POST /customers/{id}/archive` require `If-Match`?  
**Decision:** Require `Idempotency-Key` (API01). Do not require `If-Match` on archive/restore. The command re-reads the row inside the transaction, applies `archived` boolean, and is idempotent when the desired state already holds. When `archived_at` actually changes, increment `version` so a concurrent `PATCH` with a stale If-Match receives 409 `VERSION_CONFLICT`.  
**PRD evidence:** API01: Idempotency-Key on state-changing commands; If-Match called out for draft PATCH. Inventory: PATCH customers uses If-Match; archive is POST with `archived` boolean. SYNC03 versions mutable rows and requires If-Match on PATCH.  
**Reason:** Inventing mandatory If-Match on a POST command is not in the inventory. Lost updates on contact fields remain protected because archive bumps `version`. Two devices toggling archive serialize on the row.  
**Requirements affected:** CUS02, SYNC03, `POST /customers/{id}/archive`, CUST-API-05  
**Reversible:** Yes; If-Match could be added later if two-device archive races prove harmful.  
**Migration/API implication:** No If-Match header on archive. Version column still incremented on change.  
**Status:** ACCEPTED

---

## DEC-CUST-006

**ID:** DEC-CUST-006  
**Date:** 2026-09-17  
**Question:** How does S19 load jobs associated with a customer?  
**Decision:** Do not embed all jobs in the Customer record. Use `GET /v1/customers/{id}` for the contact, and `GET /v1/jobs?customer_id={customer_id}` as a workspace-scoped filter on the existing jobs list contract. If `customer_id` is not in the caller’s workspace, return generic 404 (not an empty list). Jobs remain in the `jobs` table with composite FK to `customers`. No Customer-owned jobs datastore.  
**PRD evidence:** S19 “customer detail with jobs”; `GET /jobs` “Search, state, archive filter, page”; API03 common query `cursor?,limit?,search?,state?` (filters may be extended); jobs schema `customer_id`; AUTHZ01.  
**Reason:** Embedding unbounded jobs on the customer resource breaks pagination and mixes aggregates. A list filter is the smallest extension of `GET /jobs`. 404 on foreign `customer_id` avoids an existence oracle.  
**Requirements affected:** S19, GET /jobs, CUST-API-03, CUST-UI-03, CUST-JOB-01  
**Reversible:** Yes (cursor field names), not the “jobs live on jobs table” rule.  
**Migration/API implication:** Index `(workspace_id, customer_id, updated_at DESC, id DESC)`. Additive query parameter.  
**Status:** ACCEPTED

---

## DEC-CUST-007

**ID:** DEC-CUST-007  
**Date:** 2026-09-17  
**Question:** Does editing a Customer rewrite unpublished draft `customer_snapshot` values? When is “Apply current contact details to draft” shown?  
**Decision:** Customer editing updates the `customers` master row only. It must not mutate published `documents` snapshots and must not silently rewrite `document_drafts.payload_json.customer_snapshot`. The explicit apply action belongs to the Quote/draft publication workflow (S11). Defer that UI until Quote implementation. Not a blocker for Customer CRUD. Customer QA cannot mark the apply-action clause VERIFIED until Quote exists.  
**PRD evidence:** CUS01: edits affect future drafts only; published snapshots retain original details; before publication explicitly select Apply current contact details to draft if the draft contains an older snapshot. Draft payload schema: `customer_snapshot` copy. INV02/INV05 immutability.  
**Reason:** Auto-updating an existing draft would hide the older snapshot the owner may still intend to send. The PRD already places the apply control at publication, not on S07.  
**Requirements affected:** CUS01, S07, S11, CUST-API-04, CUST-QA-01, Quote feature  
**Reversible:** No without a PRD change to auto-merge drafts.  
**Migration/API implication:** No Customer trigger on `document_drafts`. Quote feature adds the apply command later.  
**Status:** ACCEPTED

---

## DEC-FOUND-001

**ID:** DEC-FOUND-001  
**Date:** 2026-09-17  
**Question:** Which package manager should the monorepo use?  
**Decision:** npm workspaces. Root `package.json` is private with `workspaces: ["apps/*", "packages/*"]`. Do not introduce pnpm, yarn, or bun unless a later numbered decision records a migration that preserves installs and CI.  
**PRD evidence:** ARC01 TypeScript monorepo; ARC05 pin lockfile. The PRD does not require a specific Node package manager.  
**Reason:** No package manager was previously recorded. npm is the default Node toolchain and matches `package-lock.json`.  
**Requirements affected:** CUST-FOUNDATION-01, DEL01, ARC05  
**Reversible:** Yes, with lockfile and CI changes.  
**Migration/API implication:** Commit `package-lock.json`. All installs use `npm install`.  
**Status:** ACCEPTED

---

## DEC-AUTH-001

**ID:** DEC-AUTH-001  
**Date:** 2026-09-18  
**Question:** How does the API cryptographically verify Supabase owner access tokens?  
**Decision:** Use `jose` with a remote JWKS. Configure `AUTH_ISSUER`, `AUTH_AUDIENCE` (Supabase default `authenticated`), and `AUTH_JWKS_URL` (or derive JWKS from `AUTH_ISSUER` / `AUTH_PROJECT_URL`). Verify signature, issuer, audience, and expiry. Map `sub` to `app_users.auth_user_id`. Do not decode tokens without verification. Do not put the JWT secret or JWKS in the mobile app. Automated tests inject a local RS256 key pair.  
**PRD evidence:** ACC02, AUTHZ01, SREF06, ARC02.  
**Reason:** Current Supabase Auth access tokens are JWKS-verifiable. HS256 shared secrets are not required for this slice and would expand the secret surface.  
**Requirements affected:** ACC02, AUTHZ01, CUST-AUTH-01, R-CUS-PRE-04  
**Reversible:** Yes, if a later provider change requires a different supported verification API, with a new decision.  
**Migration/API implication:** Server-only env vars. No schema change.  
**Status:** ACCEPTED

---

## DEC-AUTH-002

**ID:** DEC-AUTH-002  
**Date:** 2026-09-18  
**Question:** How are auth/workspace tests run without a live Postgres or Supabase project?  
**Decision:** API integration tests use an in-memory store that enforces the same uniqueness rules (one workspace per owner, idempotency replay/mismatch). Development may use that store only when `DATABASE_URL_API` is unset. Staging/production require `DATABASE_URL_API`. Live OTP, JWKS against a real project, and applied RLS are not claimed VERIFIED until a development Supabase project is configured.  
**PRD evidence:** ACC01 must use Supabase Auth, not a custom OTP store. OPS01 separate environments.  
**Reason:** Foundation tests must not require production credentials. Faking a successful OTP is forbidden.  
**Requirements affected:** QA01, QA02, CUST-AUTH-01  
**Reversible:** Yes once a durable test database is available.  
**Migration/API implication:** `0001_auth_workspace.sql` remains the production schema source.  
**Status:** ACCEPTED

---

## DEC-AUTH-003

**ID:** DEC-AUTH-003  
**Date:** 2026-09-18  
**Question:** How is the development Supabase/Postgres environment created, and how does the runtime API connect?  
**Decision:** The account owner creates a hosted project named **Job to Invoice — Development**. Agents do not auto-provision it (organization, database password, and billing are required). The repository pins Supabase CLI `2.117.0`. Schema apply uses `npx supabase db push` against the linked development project only (`npm run db:push:dev` refuses non-development `APP_ENV`). Runtime `DATABASE_URL_API` uses `app_api_login` (LOGIN, INHERIT, NOSUPERUSER, NOBYPASSRLS) which inherits `app_api`. The password is set with `ALTER ROLE` after apply and is never committed. `DATABASE_URL_MIGRATIONS` remains the migration role. JWT verification stays JWKS (`AUTH_ISSUER`, `AUTH_AUDIENCE=authenticated`, `AUTH_JWKS_URL`).  
**PRD evidence:** OPS01 separate environments; ARC02 restricted API role; ACC02 JWKS; PRD configuration table `DATABASE_URL_API` vs `DATABASE_URL_MIGRATIONS`.  
**Reason:** Creating a cloud project is an account-owner action. A NOLOGIN group role cannot be a connection string user.  
**Requirements affected:** ACC01, ACC02, AUTHZ01, DB04, OPS01, SUPABASE-DEV-SETUP-01  
**Reversible:** Yes for CLI patch versions; not for mixing development and production projects.  
**Migration/API implication:** `0002_app_api_login.sql`. Hosted migration role cannot `ALTER ROLE ... NOSUPERUSER` after create; attributes are set only in `CREATE ROLE`. Password remains out of band. No Customer tables.  
**Status:** ACCEPTED

---

## DEC-AUTH-004

**ID:** DEC-AUTH-004  
**Date:** 2026-09-18  
**Question:** Which ACC01 OTP rules does hosted Supabase Auth actually configure?  
**Decision:** Six-digit email OTP is the provider default (`otp_length = 6` in local `config.toml`). Set hosted **Email OTP expiration** to **600 seconds**; the hosted default is 3600 seconds and is not ACC01. Per-user resend cooldown defaults to about 60 seconds. **At most five verification failures per challenge is not a hosted per-challenge control.** Hosted `/auth/v1/verify` is IP rate-limited (documented 360/hour with burst). The mobile app keeps generic verify errors and a 60-second client cooldown. Do not add a second plaintext OTP table to count failures. Development email uses the project's development mailer, not production Resend.  
**PRD evidence:** ACC01; QA02 generic errors and no account enumeration.  
**Reason:** Documenting provider limits prevents pretending a dashboard setting exists.  
**Requirements affected:** ACC01, QA01, QA02, SUPABASE-DEV-SETUP-01  
**Reversible:** Yes if the provider later exposes a per-challenge failure cap.  
**Migration/API implication:** Dashboard Auth setting only; no schema.  
**Status:** ACCEPTED

---

## DEC-CUST-008

**ID:** DEC-CUST-008  
**Date:** 2026-09-18  
**Question:** What is the exact Customer `normalized_email` algorithm?  
**Decision:** Trim outer whitespace. Split on the last `@`. Unicode-case-fold the local part and the domain with `toLowerCase`. Concatenate as `local@domain`. Do **not** remove Gmail dots, strip plus-tags, or apply any other provider-specific alias rewriting. The stored `email` is the trimmed original presentation. `normalized_email` is null iff `email` is null. Duplicate detection later compares `normalized_email` inside a workspace and is not a uniqueness constraint (DEC-CUST-002).  
**PRD evidence:** VAL01 “normalized for lookup without provider-specific dot/plus rewriting; preserve original presentation.”  
**Reason:** Lowercasing the domain (and local part for consistent comparison) is conservative lookup behavior. Removing dots or plus-tags would collapse distinct mailboxes.  
**Requirements affected:** VAL01, CUS01, CUST-DOMAIN-01, R-CUS-23  
**Reversible:** Yes for additional Unicode case-folding details; not for the no-Gmail-rewrite rule.  
**Migration/API implication:** `customers.normalized_email` stores this lookup form only.  
**Status:** ACCEPTED
