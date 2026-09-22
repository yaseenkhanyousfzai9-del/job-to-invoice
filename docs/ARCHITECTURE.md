# Architecture

Status: CUST-AUTH-01 owner authentication kernel exists in code (JWT verification, GET /v1/me, POST /v1/workspace, S01–S04). SUPABASE-DEV-SETUP-01 pinned the CLI and API login-role migration; a hosted development project is **not** linked yet. Live OTP and applied hosted migrations are not VERIFIED. Customer commercial tables are not implemented.

Authority: PRD section 19 (ARC01–ARC05), plus AUTHZ01, ACC01–ACC02, SYNC01–SYNC06, DEC01, DEC04, DEC10. SOP process applies; SOP default stack does not override this document.

Vendor substitution requires a numbered decision that preserves behaviour and acceptance tests (ARC01).

## System shape

TypeScript monorepo:

| Path | Role |
|---|---|
| `apps/mobile` | Owner iPhone app. React Native, Expo development builds, Expo Router. Expo Go is not a release environment (SYNC01). |
| `apps/portal` | Next.js customer approval/review website. No customer app and no persistent customer account (DEC02). |
| `apps/admin` | Restricted support/admin interface. Separate staff identities, MFA (SEC05). |
| `apps/api` | Fastify REST API. Owner, portal, and admin HTTP surface. Base path `/v1`. |
| `apps/worker` | Background processing: PDF, email, export, billing reconciliation. Claims PostgreSQL outbox rows. |
| `packages/domain` | Shared schemas, validation, financial logic, state rules, canonical snapshot rules. Mobile may use it for convenience preview; the server remains authoritative (INV01). |

v1 operator platform is iPhone, iOS 17+ (DEC01). Android operator app is deferred. Do not treat a React Native codebase as an Android release.

## Infrastructure

| Concern | Choice |
|---|---|
| Auth | Supabase Auth (owner email OTP). Public Auth endpoints only. |
| PostgreSQL | Supabase-managed. Commercial tables in a private schema. |
| Storage | Private buckets. Object keys use random IDs and tenant namespace, never customer names (DOC05). |
| API / portal / worker host | Same US region; default Render paid services (ARC01). |
| Email | Resend transactional. |
| Subscriptions | RevenueCat + Apple. Not used by Customer CRUD. |
| Errors | Sanitized Sentry. No session replay/screenshots. No PII in events. |
| Analytics | First-party `analytics_events` table. Allowlisted events only (ANA01). |
| Outbox | PostgreSQL transactional outbox (ARC04). No in-memory queue as source of truth. |

## Trust boundary (mandatory)

```
Mobile / Portal
        |
        v
Fastify Domain API
        |
        v
Verified identity + workspace membership
        |
        v
Transaction-local tenant context
        |
        v
Protected PostgreSQL commercial tables
```

Commercial data must **not** be directly mutated through Supabase REST from the mobile app or public portal.

Supabase public Auth endpoints **are** allowed for owner authentication (send/verify OTP, refresh session).

Consequences:

- Mobile and portal hold only intended public keys (Auth publishable key, API base URL, RevenueCat public iOS key).
- Supabase service role, database URLs, and other secrets stay server-side (SEC04, ARC02).
- The API database role is not owner, superuser, or `BYPASSRLS`.
- Client grants on the commercial schema are revoked.
- RLS is `FORCE`d. Authorization tests must hit the database, not only HTTP handlers (DB04).

## Owner authentication flow

1. Owner enters email on S02. App calls Supabase Auth OTP (ACC01): six-digit code, ten-minute expiry, 60-second resend cooldown, at most five failures per challenge.
2. Account creation and sign-in share one flow. Responses do not reveal whether the email already exists (QA02).
3. Owner enters code on S03. OS paste/autofill is allowed. Tokens use the supported secure-session mechanism. Refresh tokens live in OS secure storage, never logs or analytics.
4. Subsequent owner API calls send `Authorization: Bearer <access_token>`.
5. `apps/api` verifies JWT signature, configured issuer/audience, expiry, and `app_users.status` (ACC02, SREF06). Expired access triggers one client refresh, then sign-in.
6. Device session revocation is honored on the next request. Backend suspension is checked on every mutation.

Offline: an already-authenticated owner may read cached records and edit drafts for up to seven days since last successful authentication. Publishing and other authoritative commands still require live server authorization (ACC02, DEC10).

Public portal sessions are a separate scoped cookie after request-token + email code. They cannot exchange into owner sessions (AUTHZ01). Portal is out of scope for Customer CRUD.

## Workspace / bootstrap flow

DEC04: one verified owner and one business workspace per account in v1.

1. `GET /v1/me` returns user, workspace (or setup-required), membership, and entitlement summary.
2. If no workspace, owner completes the minimum S04 fields and `POST /v1/workspace`.
3. That command creates, in one transaction: `workspaces` row, `memberships` row (`role=owner`, `status=active`), and `job_allowances` row.
4. A second workspace for the same owner is rejected.
5. `owner_user_id` is unique. Membership is unique per workspace/user. v1 exactly one active owner.

Client-supplied `workspace_id` is never evidence of authorization. The API loads membership from the verified user id.

## Tenant isolation

AUTHZ01: every resource read and mutation derives workspace membership from verified server identity.

Per request (ARC03):

1. Verify JWT and account status.
2. Load active owner membership. If none and the route is not bootstrap, 401/404 as specified for that route — never create a workspace implicitly on a Customer call.
3. Open a database transaction.
4. Set transaction-local workspace context from that membership.
5. Execute the authorized command (RLS + composite FKs + handler checks).
6. Context is transaction-local (`SET LOCAL` or equivalent) so pooled connections cannot leak tenant identity.

Cross-tenant object references (another owner’s `customer_id`, `job_id`, etc.) return **generic 404**. Same body as an unknown UUID. Do not use 403, and do not include names, emails, or “wrong workspace” copy.

SEC02: a valid id from another tenant is unusable as `customer_id` on `POST /jobs` or any other relation.

QA03 is a release test: two owners requesting each other’s customer/job IDs leak nothing in API, storage, or logs.

## RLS strategy

- Commercial tables live in a private schema (not `public`).
- `FORCE ROW LEVEL SECURITY` on every tenant table.
- Policies allow the API role only when the transaction-local workspace GUC matches `workspace_id`.
- Policies do not trust a session JWT `workspace` claim supplied by the client; the API sets the GUC after membership lookup.
- Anon and authenticated Supabase roles have no GRANT on commercial tables.
- Workers use narrowly scoped functions/roles for queued tasks, not unrestricted table writes.
- Staff have no commercial tenant access by default (SEC05).

## Database roles

| Role | Use |
|---|---|
| Migration | Deployment-only. Applies schema. Unavailable to mobile and runtime API. `DATABASE_URL_MIGRATIONS`. |
| API | `app_api_login` (inherits `app_api`). Restricted DML under RLS. Not superuser, not table owner, not `BYPASSRLS`. `DATABASE_URL_API`. |
| Worker | Outbox claim + artifact/status updates through scoped functions. |
| Auth (`anon` / `authenticated`) | Supabase Auth only. No commercial table access. |
| Privileged purge | Account-deletion workflow only (DB05). Not used for ordinary Customer DELETE. |

`DATABASE_URL_API` and `DATABASE_URL_MIGRATIONS` are distinct secrets (PRD section 33).

## Transaction-local workspace context

Transaction-local GUCs (CUST-AUTH-01): `app.auth_user_id` then `app.workspace_id`, set with `set_config(..., true)` inside the request transaction. Requirements:

- Set only after verified membership.
- `SET LOCAL` (or equivalent) inside the request transaction.
- Cleared by transaction end, not by a later request on the same pooled connection.
- Tests must prove pool reuse cannot read another tenant’s rows (ARC03, matrix R-CUS-46).

## Generic cross-tenant 404

Applies to Customer GET/PATCH/archive/DELETE by id, to `GET /jobs?customer_id=` when the customer is not in the caller’s workspace, and to `POST /jobs` with a foreign `customer_id`.

Error envelope is the standard API error with a generic not-found message. No tenant existence signal. Logs redact emails and names (OPS03).

## Local / offline data boundaries

| Allowed offline | Requires connectivity |
|---|---|
| Read cached customers/jobs | Sign-in, workspace create |
| Edit local drafts after they exist | Publish, approve, invoice, payments |
| Convenience validation | Archive, restore, delete (SYNC05: not auto-issued from the offline queue) |

- Per-owner encrypted SQLite (SYNC01). Plaintext fallback is forbidden.
- Sync order: customer → job → document draft → line items → completed attachments (SYNC04).
- Mutable resources carry server `version`. PATCH uses `If-Match`. Local operations have `operation_id`.
- 409 `VERSION_CONFLICT` preserves both copies. No last-write-wins on recipients or contact fields (SYNC03).
- Account switch locks and wipes the previous cache after unsynced-work confirmation (SYNC06).
- Remote search requires connectivity; local search must say it is searching downloaded records.

Customer create/edit may later be queued as draft-quality sync. Archive/delete/restore require a live user action while connected.

## Versioning

- Mutable rows (`customers`, `workspaces`, `jobs`, drafts) have integer `version` default 1.
- `PATCH /customers/{id}` requires `If-Match` equal to the current version (API inventory + SYNC03).
- Successful mutation increments `version` and `updated_at`.
- Archive/restore is `POST` (not PATCH). Idempotency-Key is required. If-Match is not mandatory on that command (DEC-CUST-005). The command still increments `version` so a concurrent contact PATCH with a stale If-Match fails.

## Idempotency

- Every state-changing owner command requires `Idempotency-Key` UUID (API01).
- Same key + same request hash: return the stored result.
- Same key + different body: 409 `IDEMPOTENCY_MISMATCH`.
- Duplicate-email confirmation retries **must** use a new Idempotency-Key because the body changes (`confirm_duplicate_email: true`) (DEC-CUST-002).
- Financial `operation_id` uniqueness is permanent; cached idempotent HTTP responses may expire at 30 days. Customer creates are not financial events but still use the idempotency table.

## Customer data lifecycle

```
Create (optional email/phone/address)
    → listed in S19 and S06 picker
Edit live master record
    → future drafts may copy new values
    → existing unpublished draft snapshots are NOT auto-updated (DEC-CUST-007)
    → published document snapshots NEVER updated (CUS01, INV02)
Archive
    → removed from new-job pickers and default lists
    → existing jobs/documents remain accessible
Restore
    → returned to pickers/default lists
Delete
    → only if unreferenced (no `jobs.customer_id` row; later also drafts/documents)
    → referenced: 409, offer archive; workspace export is EXP01 when built (DEC-CUST-004)
```

Identical names are allowed. Duplicate normalized email in the same workspace is a confirmed-create flow, not a unique constraint.

## Immutable document snapshots (compatibility)

Do not implement Quote/Invoice in the Customer feature. The Customer design must remain compatible:

- A job groups one customer and one site.
- Quote draft payload includes `customer_snapshot { name, email?, phone?, billing_address? }` (PRD section 21). That snapshot is a **copy**, not a live FK read at PDF time.
- On publish, `documents.snapshot_json` / `canonical_snapshot_bytes` freeze that copy. DB04 triggers will later reject UPDATE of commercial payload columns after publication.
- `PATCH /customers/{id}` updates only `customers`. It must not UPDATE `document_drafts.payload_json` or `documents.snapshot_json`.
- “Apply current contact details to draft” is an explicit Quote/draft action (S11), deferred (DEC-CUST-007).

## Environment separation

Development, staging, and production are separate Auth, database, storage, email, and RevenueCat projects (OPS01).

- Never copy production personal data into development. Seed fictional fixtures only.
- Staging watermarks generated documents TEST (when documents exist).
- Production secrets never live in git.
- Sandbox purchases never grant production entitlement.

## What this document does not implement

Quote hashing, approval tokens, ledger math, RevenueCat webhooks, PDF workers, and portal OTP are specified in the PRD and must remain possible. They are not part of CUST-FOUNDATION-01 or Customer CRUD. Foundation should create empty app packages so the monorepo matches ARC01 without building those domains.
