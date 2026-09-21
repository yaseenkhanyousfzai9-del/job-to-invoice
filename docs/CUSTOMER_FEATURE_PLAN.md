# Customer Feature Plan

Status: CUST-FOUNDATION-01, CUST-AUTH-01, and CUST-DOMAIN-01 are IMPLEMENTED, not VERIFIED. CUST-DB-01, CUST-API-01, CUST-API-02, **CUST-API-03**, **CUST-API-04**, CUST-UI-01, CUST-UI-02, and **CUST-UI-03** are VERIFIED. **CUST-UI-04** is **IMPLEMENTED / AWAITING PHYSICAL VERIFICATION**. Jobs table + composite customer FK (`R-CUS-31`) is VERIFIED (`0004_jobs.sql`, 2026-09-20). `R-CUS-PRE-05` DB half is live; Jobs HTTP create remains CUST-JOB-01 (list-by-customer read shipped in CUST-API-03). S19 is partially VERIFIED (list/search/create + read-only Customer Detail / associated jobs display + edit API; edit UI coded awaiting physical Android; archive/restore/delete / Create Job not VERIFIED). Runtime OTP mailbox remains unverified.

Authority: `docs/PRD.md`. Process: `docs/SOP.md` and `ENGINEERING_CONTRACT.md`. Architecture/data/API: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`. Recorded resolutions: `docs/DECISIONS.md`. Status: `docs/REQUIREMENTS_MATRIX.md`.

This plan covers the Customer feature and the minimum prerequisites required to make that feature production-correct. It does not authorize Quote, Approval, Invoice, Subscription, Export, or Portal implementation except the bounded job header needed for picker, associated jobs, and referenced-delete.

## Documents

| Document | Role |
|---|---|
| `ENGINEERING_CONTRACT.md` | Binding implementation rules |
| `docs/PRD.md` | Authoritative product specification |
| `docs/SOP.md` | Process baseline (overridden by PRD on stack/Android) |
| `docs/ARCHITECTURE.md` | Monorepo, Fastify boundary, tenant context |
| `docs/DATABASE.md` | Customer + prerequisite tables |
| `docs/API.md` | Customer and bootstrap HTTP contract |
| `docs/DECISIONS.md` | DEC-CUST-001 … DEC-CUST-007 |
| `docs/REQUIREMENTS_MATRIX.md` | Delivery status; Customer rows remain PENDING |
| `.cursor/rules/project.mdc` | Permanent agent checklist |

Full-product Screen Map / Analytics / Test Plan documents are still not required to start CUST-FOUNDATION-01.

## Planning constraints from SOP

- Do not remove a PRD requirement to simplify implementation.
- Do not call a slice complete because a screen, button, API, or table exists.
- Authorization must not live only in the UI.
- Every applicable slice must cover UI, logic, validation, persistence, authz, loading/empty/error/offline, accessibility, and tests.
- Statuses: PENDING, IN PROGRESS, IMPLEMENTED, VERIFIED, BLOCKED. Only VERIFIED counts as complete.
- UI hiding is not authorization. User A cannot access User B's private data.

## PRD stack that this feature must follow

SOP defaults (mobile talking to Supabase tables, Edge Functions as the API) do not override the PRD.

PRD ARC01–ARC03 require:

- TypeScript monorepo: `apps/mobile`, `apps/portal`, `apps/admin`, `apps/api` (Fastify), `apps/worker`, `packages/domain`
- Managed Supabase for Auth, PostgreSQL, private Storage
- Mobile and browsers call the domain API only; they do not write commercial records through Supabase REST
- Commercial tables in a private schema; client grants revoked
- API role is not owner/superuser/BYPASSRLS
- Per-transaction workspace context set only from verified auth
- FORCE ROW LEVEL SECURITY and composite tenant foreign keys

Customer implementation that writes `customers` from the iPhone client against Supabase REST would violate the PRD even if it looked like a working CRUD app.

## Customer requirements identified

### Core product

| ID | Requirement |
|---|---|
| CUS01 | Identical names allowed. Duplicate normalized email inside a workspace warns, then permits a separate named contact after confirmation. A job chooses one approval contact. Editing customer details affects future drafts only. Published snapshots retain original details. Before publication, owner must explicitly choose Apply current contact details to draft if the draft holds an older snapshot. |
| CUS02 | Archive removes the customer from new-job pickers. Existing jobs and documents remain accessible. Unreferenced customers may be deleted. Referenced customers are not destructively deleted; offer archive and export instead. Privacy requests follow the privacy process. Do not rewrite historical records on a contact deletion request. |

### Screens

| ID | Requirement |
|---|---|
| S06 | Create Job: customer selection, site, title, Quote or Direct invoice. Customer creation sheet. No forced contacts permission. |
| S07 | Customer form: name, email, optional phone, billing address. Duplicate warning. Archived customer restore option. |
| S19 | Customers tab: search/list, create, customer detail with associated jobs. Archive rather than destructive delete where referenced. |

### Validation

| ID | Customer-relevant rule |
|---|---|
| VAL01 | Customer display name 1–120. Trim outer whitespace. Reject control characters except newlines in multiline fields. Preserve Unicode names. Email max 254, normalize for lookup without provider-specific dot/plus rewriting, preserve original presentation. Customer email is mandatory for approval requests, optional for manually shared direct invoices. Phone optional; E.164 where parsable; otherwise show validation rather than guessing country. |
| VAL02 | US billing address when present: line 1 max 150, line 2 optional max 150, city max 80, state two-letter selection, ZIP five digits or ZIP+4. Billing and site addresses are distinct. |

### Authorization and tenant isolation

| ID | Requirement |
|---|---|
| AUTHZ01 | Every resource read and mutation derives workspace membership from verified server identity. A client-supplied `workspace_id` is never authorization. Cross-tenant object references return generic 404. Public approval sessions cannot become owner sessions. |
| DEC04 | One verified owner and one business workspace per account in v1. |
| ARC02 / ARC03 | JWT and membership verified; tenant context set inside the transaction; RLS forced; no leaked pooling context. |
| SEC02 | Every owner object belongs to the same workspace. A valid ID from another tenant is unusable. |
| API02 | Do not expose stack traces, SQL, provider tokens, or tenant existence. Cross-tenant is 404, not 403. |

### Database

| ID | Requirement |
|---|---|
| DB01 | UUID PKs, timestamptz UTC, `workspace_id` NOT NULL, `UNIQUE(workspace_id, id)`, composite tenant FKs, no cascade deletion of published financial records. |
| DB02 | `customers`: `name`, `email?`, `normalized_email?`, `phone?`, `billing_address_json?`, `archived_at?`, `version`. Common mutable fields include `created_at`, `updated_at`, `created_by`, `version` default 1. JSON validated against checked-in schemas. |
| DB03 | List index `(workspace_id, updated_at DESC, id DESC)`. Index normalized customer email by workspace. This is a lookup index, not a uniqueness constraint: CUS01 allows confirmed duplicate emails. |
| DB04 | Authorization tests must exercise database access paths, not only HTTP handlers. |

### API

See `docs/API.md`. Contract in force:

| Method | Access | Contract |
|---|---|---|
| `GET /v1/me` | Owner | Bootstrap/workspace. Prerequisite. |
| `POST /v1/workspace` | Owner | One workspace + membership + allowances. Prerequisite. |
| `GET /v1/customers` | Owner | Search/filter/page; default active. |
| `GET /v1/customers/{id}` | Owner | Additive S19 detail read (DEC-CUST-001). Generic 404. No embedded jobs. |
| `POST /v1/customers` | Owner | Versioned create. Idempotency-Key. Duplicate email → 409 `DUPLICATE_CUSTOMER_EMAIL` unless `confirm_duplicate_email` (DEC-CUST-002). |
| `PATCH /v1/customers/{id}` | Owner | Contact fields. Idempotency-Key + If-Match. |
| `POST /v1/customers/{id}/archive` | Owner | `archived` boolean. Idempotency-Key. No mandatory If-Match (DEC-CUST-005). |
| `DELETE /v1/customers/{id}` | Owner | Unreferenced only; else 409 `CUSTOMER_REFERENCED`. |
| `GET /v1/jobs?customer_id=` | Owner | S19 associated jobs (DEC-CUST-006). Foreign customer_id → 404. |
| `POST /v1/jobs` | Owner | Minimum bind for S06 picker (CUST-JOB-01). |

Supporting conventions: API01–API03. Cross-tenant object references: generic 404.

### Offline / sync

| ID | Customer-relevant rule |
|---|---|
| DEC10 | Offline draft editing and cached reading. Authoritative network commands require connectivity. |
| ACC02 | Offline owner may read cached records and edit drafts for up to seven days since last successful authentication. |
| SYNC01 | Encrypted per-owner SQLite. Plaintext fallback forbidden. |
| SYNC03 | Mutable resources have server `version` and `updated_at`. PATCH requires If-Match. Local operations have `operation_id`. 409 VERSION_CONFLICT preserves both copies. No last-write-wins for recipients. |
| SYNC04 | Sync dependency order: customer, then job, then drafts/lines/attachments. New local IDs are UUIDs accepted after owner/tenant validation. |
| SYNC05 | Delete/archive/restore are authoritative and must not auto-issue from an offline queue. |
| SYNC06 | Account switch locks and wipes previous cache after unsynced-work confirmation. No shared local DB between accounts. |
| UI04 | Every data screen: loading, empty, loaded, refresh failure, offline, access-expired. Cached content remains visible during refresh with a timestamp. |

### Related invariants this feature must not break

| ID | Relevance |
|---|---|
| INV02 / INV05 | Published commercial facts are immutable. Editing a customer cannot mutate issued snapshots. |
| INV08 | Archived data is hidden from default lists, not deleted. |
| JOB01 / jobs schema | A job groups one customer and one site. `jobs.customer_id` is the reference that blocks destructive delete. |
| QUO02A / draft payload | Drafts carry `customer_snapshot`. Live customer edits do not rewrite that snapshot unless the owner applies current details before publish. |
| QA03 | Two owners requesting each other's customer IDs get 404 and no leakage in API, storage, or logs. |
| QA14 | Resetting customer/site of a published job is blocked. |
| QA15 | Profile/catalogue edits do not change issued documents. Customer analogue of the same snapshot rule. |
| QA55 | Unicode names display correctly; CSV formula text is safe later in export. |
| NFR01 | VoiceOver labels, headings, error announcements, 44×44 pt targets, Dynamic Type, visible focus. |
| ANA01 | Never send customer names, emails, or addresses in analytics. No customer CRUD events are defined in the PRD allowlist. Do not invent them. |
| UI01–UI03 | Typography, navy `#17324D`, 48 pt primary actions, light appearance only in v1. |
| S06 contacts | Do not request device Contacts permission to pick or create a customer. |

## Prerequisite requirements

These are not the Customer feature, but Customer cannot be production-correct without them.

1. **Monorepo foundation** (ARC01, ARC05, DEL01): mobile, API, domain package, lockfiles, environment templates, CI lint/types.
2. **Owner authentication** (ACC01, ACC02, S02, S03): Supabase Auth email OTP, six-digit codes, ten-minute expiry, 60-second resend, five failures per challenge, generic responses, secure session storage.
3. **Workspace bootstrap** (ACC/DEC04, `GET /me`, `POST /workspace`, `memberships`, `workspaces`): exactly one workspace and one active owner membership, created atomically.
4. **Server authorization kernel** (AUTHZ01, ARC02, ARC03, API01): verify JWT signature/issuer/audience/expiry/account status; derive workspace from membership; set transaction-local tenant context; never trust body/route `workspace_id`.
5. **Database isolation kernel** (DB01, DB04, SREF07): private schema, FORCE RLS, composite FKs, API role without BYPASSRLS, isolation tests against the database.
6. **API envelope** (API01–API03): `/v1`, idempotency, error codes, pagination cursor rules.
7. **Owner app chrome** (section 07, UI01–UI04, S05/S19 tabs): four tabs including Customers; design tokens; shared Loading/Empty/Error/Offline components.
8. **Bounded job reference** (jobs table + `customer_id` composite FK): required to enforce CUS02 referenced-delete, S19 associated jobs, and S06 picker. Full job editor/publish is out of scope until a later feature, except the minimum create/list needed by CUST-JOB-01 and reference checks.
9. **Encrypted local store spike** (SYNC01): must be proven before customer rows are stored on device. Expo Go is not a release environment.

## Slice groups

### Prerequisite foundation (no Customer behaviour yet)

1. **CUST-FOUNDATION-01** — monorepo, Fastify, Expo app shell, domain package, tokens, CI
2. **CUST-AUTH-01** — owner OTP, JWT, `GET /me`, `POST /workspace`, tenant context, RLS kernel
3. **CUST-DOMAIN-01** — Customer field contracts
4. **SUPABASE-DEV-SETUP-01** — development Auth/Postgres project (account-owner provisioning)
5. **CUST-DB-01** — customers table (do not start until the development database exists)

### Customer implementation (after the development database exists)

6. CUST-API-01 → CUST-UI-01  
7. CUST-API-02 → CUST-UI-02  
8. CUST-API-03 → CUST-UI-03  
9. CUST-API-04 → CUST-UI-04  
10. CUST-API-05 → CUST-UI-05  
11. CUST-API-06 → CUST-UI-06  
12. CUST-JOB-01  
13. CUST-SYNC-01  
14. CUST-SEC-01  
15. CUST-QA-01  

Do not start a UI slice on mocks. Do not implement Quote/Approval/Invoice inside these slices.

CUS01 “Apply current contact details to draft” is **deferred to Quote** (DEC-CUST-007). Customer CRUD must still refuse silent draft/snapshot mutation. That clause stays PENDING and cannot become VERIFIED until Quote exists; it is not a blocker for CUST-FOUNDATION-01 or Customer CRUD.

---

## CUST-FOUNDATION-01

Minimum project/application foundation required for Customer feature

### PRD IDs

ARC01, ARC02, ARC05, UI01, UI02, UI03, UI04, DEL01, DEL04, OPS01 (dev environment only), NFR01 (shared a11y primitives)

### Purpose

Create the smallest real application skeleton that Customer code can live in: monorepo, typed domain package, Fastify API process, Expo development-build mobile app, shared UI state components, environment templates, and lint/typecheck. No Customer screens or tables yet.

### Prerequisites

None inside this plan. This is the first slice. Owner-supplied production brand/legal inputs from PRD section 34 are not required; use staging defaults.

### Files likely involved

- `package.json` / workspace lockfile
- `apps/api/` Fastify bootstrap and health route
- `apps/mobile/` Expo app, tab navigator shell, design tokens
- `packages/domain/` package entry
- `packages/ui/` or `apps/mobile/src/components/ui/` Button, Input, EmptyState, ErrorState, Skeleton
- environment templates with names only
- CI lint/typecheck config
- `README.md` local setup (not a substitute for missing ARCHITECTURE.md)

### UI work

App launches to a non-functional tab shell with Jobs, Customers, Items, Settings. Customers tab may show a non-data “not implemented” empty state that is not claimed as S19. Shared loading/empty/error primitives exist so later slices do not invent them.

### API work

Process boots. Health/readiness only. No `/customers`. No commercial schema access from the client.

### Database work

None for `customers`. May establish migration tooling and a private schema name, but no Customer table.

### Authorization

No owner resources yet. Do not add a fake authenticated bypass.

### Validation

None.

### Loading state

Shared skeleton/spinner component exists and does not shift primary actions.

### Empty state

Shared empty-state component exists.

### Error state

Shared inline/banner error with Retry only when retry is safe (UI04).

### Offline/network state

Shared offline banner component exists; not yet wired to Customer data.

### Accessibility

Tokens support Dynamic Type and 44×44 pt minimum targets (UI02). Light appearance only (UI03).

### Tests

- Workspace/package typecheck and lint run in CI.
- API health test.
- Mobile renders tab shell without crashing in the supported test renderer.

### Exit criteria

- Monorepo builds.
- API and mobile start locally.
- No Customer API, table, or form.
- PRD stack choices are visible in the repo (Fastify API, domain package, Expo app). Mobile has no Supabase service-role key.

### Evidence (CUST-FOUNDATION-01)

Recorded 2026-09-17:

- npm workspaces monorepo: `apps/mobile`, `apps/portal`, `apps/admin`, `apps/api`, `apps/worker`, `packages/domain`
- `npm run typecheck`, `npm run lint`, and `npm test` pass
- API `GET /health` automated test returns `{ status: "ok" }`
- Expo public config validates (SDK 53). No physical iPhone or production/TestFlight build
- Mobile shows a truthful foundation screen only (no fake Customers/Jobs/Login)
- No Customer routes, migrations, or auth
- Next: CUST-AUTH-01 is unblocked for implementation, not VERIFIED

Status of this slice: **IMPLEMENTED**, not VERIFIED (no device boot log, no production build).

---

## CUST-AUTH-01

Owner authentication and workspace bootstrap prerequisite

### PRD IDs

ACC01, ACC02, AUTHZ01, DEC04, S02, S03, S04 (minimum workspace create only), API01, `GET /me`, `POST /workspace`, QA01, QA02

### Purpose

A verified owner can obtain a server-side identity and exactly one workspace membership. Every later Customer call uses that identity. This slice does not build the full three-step business-setup UX beyond the fields required to persist a legal workspace row.

### Prerequisites

CUST-FOUNDATION-01

### Files likely involved

- `apps/mobile` sign-in/verify screens (S02, S03)
- `apps/api` JWT verification, membership loader, tenant-context helper
- `apps/api` `GET /v1/me`, `POST /v1/workspace`
- migrations: `app_users`, `workspaces`, `memberships`
- secure session storage on device
- tests for OTP generic responses and workspace uniqueness

### UI work

Email + code sign-in. Generic code-sent copy. Throttle and network failure. No Customer UI.

Minimum workspace create if `GET /me` reports no workspace: enough fields to satisfy `workspaces` NOT NULL columns. Full S04 polish is out of scope except as required for a real workspace row.

### API work

- Verify access tokens server-side (signature, issuer, audience, expiry, account status).
- `GET /me` returns user/workspace/bootstrap state.
- `POST /workspace` creates one workspace, owner membership, and allowances atomically.
- Reject a second workspace for the same owner.

### Database work

`app_users`, `workspaces`, `memberships` with `UNIQUE(workspace_id, id)`, `memberships` unique workspace/user, v1 exactly one active owner. FORCE RLS. Tenant context GUC or equivalent set only after verified auth.

### Authorization

AUTHZ01 kernel lands here. Route/body `workspace_id` is ignored as capability. Unauthenticated Customer-like routes (even if not shipped yet) would be 401.

### Validation

VAL01 for operator/business names if workspace create collects them. Email 254 chars, normalization for lookup without dot/plus rewriting.

### Loading state

Sending code, verifying code, creating workspace.

### Empty state

Not applicable beyond “no workspace yet, complete setup”.

### Error state

Wrong/expired code generic error, resend cooldown, network failure, 401 after expired refresh.

### Offline/network state

Sign-in and workspace create require connectivity. Cached-session offline read is not claimed until CUST-SYNC-01.

### Accessibility

Code field supports OS paste/autofill (S03). Labels and error announcements.

### Tests

- QA01: verified owner + one workspace; restart resumes correctly.
- QA02: wrong/expired code and resend flood; no account enumeration.
- Direct API call without token → 401.
- Membership is loaded from server identity, not from a client workspace header.

### Exit criteria

Owner can sign in and `GET /me` returns the workspace owned by that identity. Isolation kernel exists before any Customer row.

### Evidence required before VERIFIED

Staging OTP against real Supabase Auth (not a hardcoded code), JWT verification tests, SQL proving a second workspace is rejected, no account-enumeration difference in responses.

### Evidence (CUST-AUTH-01)

Recorded 2026-09-18:

- `GET /v1/me` and `POST /v1/workspace` implemented with Bearer JWT verification (`jose` JWKS; tests use a local RS256 key)
- Unauthenticated `/v1/me` and `/v1/workspace` → 401
- Workspace create is atomic in the store (workspace + owner membership + job_allowances); replay/idempotency and second workspace rejected
- Client `owner_user_id` / `workspace_id` cannot hijack another owner
- Suspended account cannot create a workspace
- Migration `supabase/migrations/0001_auth_workspace.sql` (no Customer tables)
- Mobile S01–S04, secure-session storage, sign-out, and routing exist
- Live OTP/provider and applied RLS are **not** VERIFIED (no development Supabase project in this environment)

Status of this slice: **IMPLEMENTED**, not VERIFIED. Provider-dependent QA01/QA02 remain unverified.

---

## CUST-DOMAIN-01

Customer types, validation and domain schemas

### PRD IDs

VAL01, VAL02, CUS01, CUS02, API03, DB02 (payload typing), ANA01 (negative: no PII in events)

### Purpose

Put Customer field contracts in `packages/domain` so mobile validation and API enforcement share one implementation. No persistence yet.

### Prerequisites

CUST-FOUNDATION-01. CUST-AUTH-01 not strictly required for pure domain tests, but this slice should not ship into API routes until AUTH exists.

### Files likely involved

- `packages/domain` customer schema, address schema, email normalizer, phone parser, duplicate-email helper
- shared error codes: `VALIDATION_FAILED`, `DUPLICATE_CUSTOMER_EMAIL` (DEC-CUST-002)
- OpenAPI fragment or schema module for Customer request/response (DEL02)

### UI work

None.

### API work

None exposed. Domain functions only.

### Database work

None.

### Authorization

None. Domain code must not accept `workspace_id` as a caller-supplied authorization input.

### Validation

- Display name: required, trim, 1–120, no control characters, Unicode preserved.
- Email: optional on the record; if present, max 254, store original presentation, compute `normalized_email` without provider-specific dot/plus rewriting.
- Duplicate detection operates on `(workspace_id, normalized_email)` and is a warning-plus-confirmation rule, not uniqueness.
- Phone: optional; if supplied, store E.164 only. If unparsable, fail validation; do not guess country and do not persist raw phone (DEC-CUST-003).
- Billing address: optional as a whole; if any address field is supplied, validate US rules (line1 ≤150, line2 ≤150 optional, city ≤80, state two-letter enum, ZIP `^\d{5}(-\d{4})?$`).
- Unknown fields rejected.
- Client cannot set `workspace_id`, `archived_at`, `version`, `created_at`, `id` (except client-generated UUID that the server still re-validates as owner-scoped).

### Loading / empty / error / offline

Not applicable (library).

### Accessibility

Not applicable.

### Tests

Property/unit tests: trim, Unicode names, identical names allowed, email normalization pairs, plus-alias not collapsed, invalid ZIP, missing state, phone non-guessing, empty email allowed, control characters rejected, extra fields rejected.

### Exit criteria

Domain package is the only place Customer field rules are defined. Mobile and API will import it in later slices.

### Evidence required before VERIFIED

Passing domain tests mapped to VAL01/VAL02/CUS01. No hardcoded US `+1` prefixing.

### Evidence (CUST-DOMAIN-01)

Recorded 2026-09-18:

- `packages/domain` Customer create/update/list/archive contracts and VAL01/VAL02 field validation
- Email lookup normalization documented as DEC-CUST-008 (no Gmail dot/plus rewriting)
- Phone: optional; supplied values must already be E.164; no country guessing
- Duplicate-email type is a 409 confirmation contract, not a uniqueness rule; identical names allowed
- Domain unit tests pass; no Customer SQL, HTTP routes, or screens

Status of this slice: **IMPLEMENTED**, not VERIFIED (no API/UI integration).

---

## SUPABASE-DEV-SETUP-01

Development Supabase / Postgres environment setup

### PRD IDs

OPS01, ACC01, ACC02, AUTHZ01, DB04, ARC02, ARC03, QA01, QA02

### Purpose

Establish a real **development** Auth + Postgres environment so later Customer migrations can be applied and RLS/JWT can be verified. No Customer tables.

### Prerequisites

CUST-AUTH-01, CUST-DOMAIN-01. Account-owner authorization to create a hosted development project.

### Evidence (SUPABASE-DEV-SETUP-01)

Recorded 2026-09-18:

- Supabase CLI pinned at `2.117.0`
- `supabase/config.toml` initialized (`project_id = job-to-invoice-development`)
- `0002_app_api_login.sql` adds `app_api_login` without a committed password
- Live hosted project, secrets, `db push`, OTP mailbox: **not present** — see `supabase/README.md`

Status of this slice: **IMPLEMENTED** for CLI/config. Hosted apply completed in SUPABASE-DEV-LINK-02.

---

## SUPABASE-DEV-LINK-02

Link approved US development project and apply 0001/0002

### Evidence (SUPABASE-DEV-LINK-02)

Recorded 2026-09-18:

- Linked **Job to Invoice - Development US**, ref `vlpjaamdjtmtqtpwbhzq`, region `us-east-1`
- Tokyo project (`ap-northeast-1`) remains unlinked / DO NOT USE
- Remote history: `0001` and `0002`
- Tables present: `app_users`, `workspaces`, `memberships`, `job_allowances`, `idempotency_records` (FORCE RLS)
- Roles: `app_api` (NOLOGIN, no BYPASSRLS), `app_api_login` (LOGIN, no superuser, no BYPASSRLS)
- Hosted `ALTER ROLE ... NOSUPERUSER` is not permitted; 0002 sets attributes only in `CREATE ROLE`
- Runtime password + `DATABASE_URL_API` completed in SUPABASE-DEV-RUNTIME-ROLE-03
- No Customer tables

Status of this slice: **IMPLEMENTED**. Runtime RLS verification is SUPABASE-DEV-RUNTIME-ROLE-03.

---

## SUPABASE-DEV-RUNTIME-ROLE-03

Verify restricted runtime database connection and live RLS

### Evidence (SUPABASE-DEV-RUNTIME-ROLE-03)

Recorded 2026-09-18:

- `DATABASE_URL_API` points at session pooler (`aws-0-us-east-1.pooler.supabase.com:5432`) as `app_api_login.vlpjaamdjtmtqtpwbhzq` with `sslmode=require` (URI not committed)
- Live `current_user = app_api_login`; `rolsuper = false`; `rolbypassrls = false`; member of `app_api`
- Negative privilege checks: cannot `SET ROLE postgres`, alter self to superuser/BYPASSRLS, create superuser, or disable FORCE RLS
- FORCE RLS on `app_users`, `workspaces`, `memberships`, `job_allowances`, `idempotency_records`
- No-context reads return zero tenant rows
- Fictional two-workspace fixtures: own memberships visible; foreign workspace inaccessible
- Tenant GUCs use `set_config(..., true)`; values do not survive transaction end or pooled reuse
- JWKS reachable; malformed bearer → 401
- Live OTP mailbox (QA01/QA02) still unverified
- No Customer tables

Status of this slice: **VERIFIED** for runtime role / RLS / JWKS (OTP excluded).

---

## CUST-DB-01

Customer database schema, indexes and tenant isolation

**Status: VERIFIED** (customers table + RLS). Jobs table + composite FK added later as `0004_jobs.sql` (**R-CUS-31 VERIFIED** 2026-09-20).

### Evidence (CUST-DB-01)

Recorded 2026-09-18:

- Migration `supabase/migrations/0003_customers.sql` applied to US development (`vlpjaamdjtmtqtpwbhzq`)
- `app.customers` columns align with domain `CustomerRecord` (including `created_by`, `normalized_email`)
- `UNIQUE (workspace_id, id)`; FK to `workspaces`; no unique on `normalized_email`
- Indexes: list, normalized-email lookup, partial active list
- FORCE RLS + `customers_tenant` policy on `app.workspace_id` GUC
- Live `apps/api/src/customers.security.test.ts` passed (isolation, duplicate email, archive, version, pool non-leak)

### Evidence (R-CUS-31 / jobs persistence prerequisite, 2026-09-20)

- Migration `supabase/migrations/0004_jobs.sql` applied to US development (`vlpjaamdjtmtqtpwbhzq`)
- `app.jobs` per `docs/DATABASE.md` header contract; `customer_id` NOT NULL; composite FK `(workspace_id, customer_id) → customers(workspace_id, id)` **ON DELETE RESTRICT**
- Indexes: list, lifecycle, associated-jobs `(workspace_id, customer_id, updated_at DESC, id DESC)`
- FORCE RLS + `jobs_tenant`; `anon`/`authenticated` revoked
- Live `apps/api/src/jobs.security.test.ts` passed (same-workspace FK, cross-workspace FK reject, RLS CRUD isolation, unreferenced delete allowed, referenced delete blocked)
- No Jobs HTTP create/UI in this slice; CUST-API-03 list-by-customer is separate; CUST-JOB-01 not started for POST

### Prerequisites

CUST-AUTH-01, CUST-DOMAIN-01, SUPABASE-DEV-SETUP-01 / LINK-02 / RUNTIME-ROLE-03

### Files

- `supabase/migrations/0003_customers.sql`
- `supabase/migrations/0004_jobs.sql`
- `apps/api/src/customers.security.test.ts`
- `apps/api/src/jobs.security.test.ts`

### Exit criteria

Migration reproducible. Isolation tests fail closed. No Customer HTTP routes in CUST-DB-01; no Jobs HTTP routes in the jobs FK prerequisite.

---

## CUST-API-01

Create Customer

**Status: VERIFIED** (2026-09-18)

### Evidence

- `POST /v1/customers` in `apps/api/src/routes/customers.ts`
- Memory suite: `apps/api/src/customers.create.test.ts`
- Live DB suite: `apps/api/src/customers.create.live.test.ts` against development `DATABASE_URL_API` / `app_api_login`
- Idempotency replay + mismatch; 409 `DUPLICATE_CUSTOMER_EMAIL` stored under Idempotency-Key; confirmed create with new key; cross-workspace same email does not warn; ownership fields rejected; server-derived `workspace_id` / `created_by` / `normalized_email`
- Docs: `docs/API.md` POST section updated

### PRD IDs

CUS01, VAL01, VAL02, AUTHZ01, API01, API02, API03, `POST /customers`, SYNC03 (`operation_id` / version), QA55 (Unicode)

### Purpose

Authenticated owner creates a versioned customer in their workspace.

### Prerequisites

CUST-AUTH-01, CUST-DOMAIN-01, CUST-DB-01

### Files likely involved

- `apps/api` `POST /v1/customers`
- OpenAPI path
- idempotency store
- audit event append (safe metadata only; no need to log email body text — OPS03 redaction)
- domain schema import

### UI work

None in this slice.

### API work

`POST /v1/customers`

- Bearer owner token
- Idempotency-Key UUID required
- Body: name, email?, phone?, billing_address?  Reject unknown fields.
- Server sets workspace from membership, generates id, sets version=1
- Duplicate normalized email: 409 `DUPLICATE_CUSTOMER_EMAIL` unless `confirm_duplicate_email` is true; confirmation retry uses a new Idempotency-Key (DEC-CUST-002). UI-only protection is insufficient.
- Identical names never warn at API uniqueness level.
- Invalid supplied phone → 422; no raw override (DEC-CUST-003).
- Response `{ data, meta: { request_id, server_time } }` including id, version, timestamps, archived_at null
- 401 unauthenticated, 422 validation, 409 duplicate-email / idempotency mismatch

### Database work

Insert only. No new tables.

### Authorization

Workspace from verified identity. Ignore any body `workspace_id`. Cross-tenant IDs are not relevant on create.

### Validation

Shared domain schema. Email optional. Phone optional with E.164-or-validate. Address optional-as-a-whole.

### Loading / empty / offline / accessibility

Not applicable (API). Callers must handle 15s read / 20s command timeouts (NFR06) later in UI.

### Error state

VALIDATION_FAILED with `field_errors`. No SQL or tenant hints.

### Tests

- Create with Unicode name succeeds.
- Create two customers with the same name succeeds.
- Duplicate email without confirmation → 409 `DUPLICATE_CUSTOMER_EMAIL` (same-workspace names/ids only).
- Duplicate email with confirmation and new Idempotency-Key → success and two rows.
- Missing name / too-long name / control characters → 422.
- Invalid ZIP → 422.
- Replay same Idempotency-Key and body → one row.
- Different body, same key → 409 IDEMPOTENCY_MISMATCH.
- Unauthenticated → 401.

### Exit criteria

Owner can create customers only in their workspace. Versioned record returned. Duplicate-email rule enforced server-side.

### Evidence required before VERIFIED

API tests against a real database. Proof that confirmation is required, not UI-only.

---

## CUST-UI-01

Customer Form

**Status: VERIFIED** (2026-09-20) — create-only S07 on physical Android (Expo Go). Archive restore remains CUST-UI-05 / `R-CUS-16`.

### Evidence

- Route: `/(app)/customers/new` (`apps/mobile/app/(app)/customers/new.tsx`)
- Owner shell entry: **Add customer** on `/(app)` (no fake list)
- Shared domain validation via `parseCreateCustomerInput`
- API: `createCustomer` → `POST /v1/customers` with Bearer + Idempotency-Key
- Duplicate 409 confirmation UI; confirm uses new Idempotency-Key + `confirm_duplicate_email: true`
- Automated: `apps/mobile/src/features/customers/createCustomerForm.test.ts`
- Physical Android (2026-09-20), Metro `exp://192.168.18.14:8081`, API `192.168.18.14:3001`:
  - form opens from owner shell
  - minimal Customer creation
  - Customer creation with email
  - duplicate email warning + confirmation create
  - required Name validation
  - invalid phone validation
  - partial address validation
  - full-address Customer creation
  - double-submit protection
  - keyboard/scroll usability
  - network/API failure: API stopped on :3001 while form open → Save Customer → no crash, stayed on New Customer, no create, retryable connection error; API restored → `{"status":"ok"}`

### PRD IDs

S07, VAL01, VAL02, CUS01, UI01–UI04, NFR01, S06 (creation sheet reuse)

### Purpose

Owner-facing create form: name, email, optional phone, US billing address, duplicate-email warning, inline validation that preserves entered values.

### Prerequisites

CUST-API-01. Shared form primitives from CUST-FOUNDATION-01.

### Files likely involved

- `apps/mobile` Customer form screen/sheet
- domain schema for client-side convenience validation
- API client types generated or checked against OpenAPI (DEL02)

### UI work

S07 fields. Primary full-width action. Numeric/email keyboards. State two-letter selector, not free text. ZIP keyboard. Duplicate-email confirmation copy before save. No Contacts permission prompt.

This slice is create-only. Archive restore control is disabled or omitted until CUST-UI-05.

### API work

Calls `POST /customers` only. No local mock success.

### Database work

None.

### Authorization

Uses owner session. Form cannot send `workspace_id` as authorization.

### Validation

Client uses the same domain package, then trusts server 422. Focus first invalid field. Preserve all entered values (UI04).

### Loading state

Submit disabled and labelled while in-flight. Prevent double submit.

### Empty state

New form with empty fields, not an error.

### Error state

Inline field errors, non-retryable validation, retryable network banner.

### Offline/network state

Create is a live command. If offline, do not claim Saved on server. CUST-SYNC-01 may later queue draft-quality creates; this slice must not pretend a queued create is authoritative if sync is not built. Show reconnect copy.

### Accessibility

Labels, error announcements, 48 pt primary action, Dynamic Type, VoiceOver on the duplicate warning and confirmation.

### Tests

Component tests for validation and duplicate-confirmation gating. Manual/Maestro later in CUST-QA-01: create a customer end-to-end.

### Exit criteria

Owner can create a real customer from the form and see server validation, not only client checks.

### Evidence required before VERIFIED

Device or representative runtime recording of create + duplicate warning + Unicode name. No Contacts permission in the flow.

**Satisfied** by the 2026-09-20 physical Android pass listed under Evidence (create, duplicate warn/confirm, validation, double-submit, network failure). Unicode name remains covered by domain/API tests; not a blocker for this create-form VERIFIED.

## CUST-API-02

Customer list/search/pagination

**Status: VERIFIED** (2026-09-20) — `GET /v1/customers` on US development project. CUST-UI-02 is VERIFIED (physical Android). S19 remains only partially VERIFIED (edit/archive/restore/delete still open; detail/jobs read path is VERIFIED via CUST-API-03 + CUST-UI-03).

### PRD IDs

S19, INV08, API02, API03, DB03, AUTHZ01, `GET /customers`

### Purpose

Owner lists own customers with search, archive filter, and cursor pagination.

### Prerequisites

CUST-API-01

### Files likely involved

- `apps/api` `GET /v1/customers`
- list query using `(workspace_id, updated_at DESC, id DESC)`
- cursor codec bound to filters

### UI work

None.

### API work

Query: `cursor?`, `limit?` default 25 max 100, `search?`, `state?` (planning assumption: `active` default, `archived`, `all`).

- Default hides archived (INV08).
- Search is case-insensitive against name and presentation email at minimum. Phone search is optional; do not require device Contacts.
- Remote search is a server operation (SYNC06).
- Returns `{ data: { items, next_cursor }, meta }`
- Never returns another workspace's rows.
- Invalid cursor → 422, not a scan of another tenant.

### Database work

Use existing indexes. Add a trigram/search index only if required by measured search; do not add speculative indexes.

### Authorization

Workspace from identity. Generic 404/empty for unauthorized is not needed on list: other tenants simply do not appear. Do not include total counts that leak other tenants.

### Validation

limit bounds, state enum, search length bound (reuse sensible text limits; do not invent a new product rule — keep search short enough to be a filter, not a blob).

### Loading / empty / offline / accessibility

Not applicable (API). Empty list is `items: []` with `next_cursor: null`, never an error (NFR05 / NFR copy: never display zero data as an error fallback).

### Error state

401, 422 invalid query, 5xx retryable.

### Tests

- Default excludes archived.
- `state=archived` returns only archived.
- Pagination stable across inserts at the cursor boundary.
- Search finds Unicode names.
- Owner B's list does not include owner A's customers.
- Limit 101 → 422.

### Exit criteria

Paginated owner-scoped list with default active filter.

### Evidence required before VERIFIED

Integration tests with two workspaces and mixed archived/active rows.

### Evidence (CUST-API-02)

- Memory suite `customers.list.test.ts`: 401, empty list, default active / archived / all, name+email case-insensitive search, no-match empty, workspace isolation, duplicate-email both appear, `(updated_at,id)` order, limit, cursor without duplicates, malformed cursor / invalid state / invalid limits → 422, no `workspace_id` / `normalized_email` leak.
- Live suite `customers.list.live.test.ts` against `DATABASE_URL_API`: authenticated list + `?search=Android`, two-tenant isolation (owner B cannot see owner A).
- Domain cursor codec tests (`customer-list-cursor.test.ts`).
- Ordering conflict resolved per docs/API.md: `(updated_at, id) DESC` (not `created_at`).

---

## CUST-UI-02

Customer List

**Status: VERIFIED** (2026-09-20) — physical Android Customers list/search. S19 edit, archive, restore, and delete are **not** claimed by this slice. Customer Detail / associated jobs read are CUST-UI-03 (VERIFIED 2026-09-21).

### PRD IDs

S19, UI04, UI01, UI02, NFR01, INV08, DEC10

### Purpose

Customers tab: search, list, create entry point, archive not shown by default.

### Prerequisites

CUST-API-02, CUST-UI-01 (create entry)

### Files likely involved

- `apps/mobile` Customers tab screen
- list item, search field, filter control for archived
- navigation to create form and later detail

### UI work

S19 search/list/create. Job default tab remains Jobs; this is the Customers tab. No floating control that obscures list content (section 07). Cached timestamp if a later sync slice supplies cache; until then, live list with pull-to-refresh.

### API work

`GET /customers` with cursor drain.

### Database work

None.

### Authorization

Session-based. Sign-out removes list.

### Validation

Search box only; no local authorization filtering as security.

### Loading state

Skeleton without shifting the New/create control dangerously (UI04). Cached content if any stays visible during refresh.

### Empty state

Explicit empty copy with create action. Zero customers is not an error.

### Error state

Refresh failure banner with Retry. Previous rows remain if any.

### Offline/network state

If no cache yet, show offline empty/error, not a fake list. Do not label local absence as server success. CUST-SYNC-01 upgrades this.

### Accessibility

List headings, item labels include name and not colour-only archive status, 44 pt rows.

### Tests

Empty, loaded, error, search, pagination end. Two-account fixture is API-level; UI test uses one owner.

### Exit criteria

Owner can find and open the create flow from a real list of server customers.

### Evidence required before VERIFIED

Screenshots/recordings of empty, populated, search, archived-hidden default. Proof archived customers are absent from the default list.

### Evidence (CUST-UI-02) — VERIFIED 2026-09-20

Automated:

- Route `/(app)/customers` with owner-shell **Customers** entry; **Add customer** preserved.
- `listCustomers` / `buildListCustomersPath` on existing mobile API client (no `workspace_id`).
- Controller tests: initial `state=active&limit=25`, loading vs empty, row fields, archived label, empty copies, debounced search + stale response guard, Active/Archived/All, filter resets cursor, Load more append + duplicate block, network error + Retry, transient errors do not require sign-out, refresh after create, filter page cache.

Physical Android (device):

- Customers route opens correctly.
- Active list loads; Archived and All filters work; default Active omits archived.
- Search works.
- First Archived load ~2s after list perf fix; switching back to previously visited Active is near-instant from client page cache.
- Add customer opens existing create form; successful create returns to Customers; new customer appears without app restart.
- API-off list/filter request shows retryable error (not empty success); app does not crash; user remains signed in.
- After API restart, Retry restores the list successfully.

Not covered / not VERIFIED by this slice: Customer Detail, associated jobs, edit, archive/restore UI, delete.

---

## CUST-API-03

Customer read/detail support

### PRD IDs

S19, AUTHZ01, API02, CUS02, `GET /customers` (listed), jobs association

### Purpose

Return one customer for S19 detail. Cross-tenant ids are generic 404. Associated jobs are loaded with `GET /v1/jobs?customer_id=`, not embedded.

### Prerequisites

CUST-API-02, jobs composite FK (`R-CUS-31` / `0004_jobs.sql`). `GET /v1/customers/{id}` plus `GET /v1/jobs?customer_id=` (DEC-CUST-001, DEC-CUST-006). **VERIFIED 2026-09-21** (memory + live US `vlpjaamdjtmtqtpwbhzq`). Customer Detail UI is CUST-UI-03 next.

### Files likely involved

- `apps/api` owner customer read
- job summary query by `(workspace_id, customer_id)`

### UI work

None.

### API work

`GET /v1/customers/{id}` returns the Customer resource only (DEC-CUST-001). Do not embed jobs.

Associated jobs: `GET /v1/jobs?customer_id={id}` (DEC-CUST-006). If that customer is not in the caller workspace, generic 404 — not an empty list.

Cross-tenant object reference: generic 404, same body as unknown UUID.

### Database work

Read path uses composite identity `(workspace_id, id)`. Associated jobs use composite FK; never join on `id` alone.

### Authorization

AUTHZ01. Client `workspace_id` ignored. Support/staff identities cannot use this owner route.

### Validation

UUID format 422 vs unknown id 404 — do not use 404 vs 422 to reveal other tenants' valid UUIDs if the id is well-formed. Well-formed foreign UUID → 404.

### Loading / empty / offline / accessibility

Not applicable (API). Unknown id is 404, not empty 200.

### Error state

401, 404 generic, 409 not used on GET.

### Tests

QA03: owner B requests owner A's customer id → 404, no name/email in body, logs, or error reports.

Associated jobs for A never include B's jobs even if UUID guessed.

### Exit criteria

Detail payload exists. Isolation proven. **Met.**

### Evidence required before VERIFIED

Automated QA03 against API, storage, and sanitized logs. Redacting middleware test (OPS03 / QA63 analogue for customer email).

**Evidence (2026-09-21):** `customers.detail.test.ts`, `jobs.list.test.ts`, live `customers.detail.live.test.ts` + `jobs.list.live.test.ts` on development US (`vlpjaamdjtmtqtpwbhzq`). Public Customer DTO; JobSummary `{id,title,lifecycle,updated_at,customer_id}`; unknown/cross-tenant identical 404; archived customer readable; jobs ordered `(updated_at,id) DESC` with opaque cursor. **CUST-API-03 = VERIFIED.** CUST-UI-03 is VERIFIED (physical Android 2026-09-21).

---

## CUST-UI-03

Customer Detail and associated Jobs

### PRD IDs

S19, CUS02, UI04, NFR01

### Purpose

Show one customer and their jobs. Existing jobs remain reachable for archived customers.

### Prerequisites

CUST-API-03, CUST-UI-02. Jobs may be empty until CUST-JOB-01.

### Files likely involved

- `apps/mobile` customer detail screen
- job row navigation target can be a stub route until Jobs feature, but the row must represent real job ids when present

### UI work

Name, email, phone, billing address, archive status, associated jobs list, actions for edit/archive/delete placed later. Destructive actions not shown as primary.

### API work

`GET /v1/customers/{id}` for the contact header. Separate `GET /v1/jobs?customer_id=` for the jobs list. Do not rely on an embedded jobs array.

### Database work

None.

### Authorization

404 from API shown as generic not-found, not “you cannot access this tenant”.

### Validation

Display-only; do not reformat stored email into a guessed local-part.

### Loading state

Skeleton for header and jobs.

### Empty state

Customer with zero jobs: explicit empty jobs copy, not an error. This is valid.

### Error state

Load failure Retry. Access-expired → sign-in (UI04).

### Offline/network state

If cached detail exists after CUST-SYNC-01, show cache + timestamp. In this slice, offline failure is honest.

### Accessibility

Heading structure, job list, archive status not colour-only.

### Tests

Detail with jobs empty. Detail with one job after CUST-JOB-01. Archived customer still opens from an existing job path later.

### Exit criteria

S19 detail renders server data. Archived customers are viewable from detail if reached, even when hidden from default picker/list.

### Evidence required before VERIFIED

Recording of detail + empty jobs. After CUST-JOB-01, recording of associated job list.

**Status: VERIFIED** (2026-09-21) — physical Android Customer Detail (Expo Go / LAN). Edit/archive/restore/delete and Job Detail navigation are **not** claimed by this slice.

**PHYSICALLY VERIFIED (2026-09-21):**
- Customers list → Customer Detail on one row tap; correct customer loads
- Name, email (when present), billing address render; missing email/address do not invent fake data
- Jobs section loads; zero jobs shows `No jobs for this customer yet.`
- Back returns to Customers; search/list-state preserved across Customers → Detail → Back
- API-off detail request: no crash, session kept (no OTP/sign-in), safe retryable error + Retry
- After API restart, Retry restored the same customer (email + empty jobs); no re-auth

**AUTOMATED VERIFIED ONLY (not physically exercised):**
- Archived badge rendering
- Populated Job rows, jobs ordering, jobs pagination / Load more, duplicate pagination protection
- Customer 404 state; isolated Jobs-section retry
- No navigation to nonexistent Job Detail

**Doc conflict note:** Feature plan allows a stub job-row navigation target until Jobs UI exists; authorized CUST-UI-03 scope excludes Jobs Detail UI, so rows are read-only summaries (real ids in a11y only, no navigation).

---

## CUST-API-04

Edit Customer

### PRD IDs

CUS01, VAL01, VAL02, API01, SYNC03, `PATCH /customers/{id}`, INV02 (must not rewrite snapshots)

### Purpose

Mutate contact fields on the live customer record with If-Match. Must not write document snapshots, jobs.site, or past approval recipients.

### Prerequisites

CUST-API-03, CUST-DOMAIN-01

### Files likely involved

- `apps/api` `PATCH /v1/customers/{id}`
- version increment
- idempotency

### UI work

None.

### API work

- If-Match numeric version required
- Mutable: name, email, phone, billing_address
- Not mutable: workspace_id, id, created_at, archived_at (archive is a separate command)
- Duplicate email confirmation rule applies on email change
- Stale version → 409 VERSION_CONFLICT with enough data for S23 later; for Customer, preserve server copy and reject the write. Do not last-write-wins.
- Cross-tenant id → 404
- Success increments version and `updated_at`

This slice does not implement “Apply current contact details to draft” (DEC-CUST-007). Tests must prove PATCH updates `customers` only and does not write draft or published snapshots.

### Database work

Update live `customers` row only. Triggers or grants must prevent this PATCH from touching `documents.snapshot_json`.

### Authorization

AUTHZ01. Suspended/deleting account cannot mutate (ACC02).

### Validation

Same as create. Clearing email to null is allowed on the record (VAL01 optional except at approval-request time).

### Error state

422, 409 VERSION_CONFLICT, 404 generic, 401.

### Loading / empty / offline / accessibility

Not applicable (API).

### Tests

- Happy path version 1 → 2
- If-Match missing → 422 or 409 per API01 (If-Match required)
- Stale If-Match → 409, row unchanged
- Cross-tenant PATCH → 404, row unchanged
- PATCH does not modify any `documents` row (even if table empty)
- Duplicate email without confirmation → 422

### Exit criteria

Live record updates; historical documents remain untouched by construction.

### Evidence required before VERIFIED

API tests plus a SQL assertion that snapshot tables are unmodified. Conflict test.

**Status: VERIFIED** (2026-09-21) — memory `customers.update.test.ts` + live US `customers.update.live.test.ts` (`vlpjaamdjtmtqtpwbhzq`).

**Contract recorded:**
- `If-Match`: required positive integer `customers.version` (missing/malformed → 422)
- Stale If-Match → 409 `VERSION_CONFLICT` with `error.details.server` public Customer; row unchanged
- Success always increments version N→N+1 (including same-value patches)
- Partial PATCH; explicit `null` clears `email` / `phone` / `billing_address`
- Duplicate email uses create protocol (`DUPLICATE_CUSTOMER_EMAIL` 409); self excluded; confirmation with new Idempotency-Key
- Archived customers remain editable (contact fields only)
- Idempotency-Key required; replay returns stored 200 without second version bump
- `app.documents` not present — PATCH cannot write snapshots by construction

**Doc conflict note:** Feature plan tests line once said duplicate without confirmation → 422; authoritative `docs/API.md` and create path use **409** `DUPLICATE_CUSTOMER_EMAIL`. Implementation follows API.md.

CUST-UI-04 (edit form) is **IMPLEMENTED / AWAITING PHYSICAL VERIFICATION** (2026-09-21).

---

## CUST-UI-04

Edit Customer Form

### PRD IDs

S07, CUS01, UI04, VAL01, VAL02

### Purpose

Edit the same S07 form from detail. Explain that changes apply to future drafts, not published documents.

### Prerequisites

CUST-API-04, CUST-UI-01, CUST-UI-03

### Files likely involved

- reuse S07 form in edit mode
- If-Match from loaded version

### UI work

Pre-filled form. Explicit copy: editing does not change issued quotes/invoices. Duplicate-email confirmation uses the 409 protocol. No “apply to draft” control on S07 (DEC-CUST-007).

### API work

`PATCH` with If-Match.

### Database work

None.

### Authorization

Same session. Expired session → sign-in, preserve local typed values if possible.

### Validation

Same as create.

### Loading state

Load existing record; submit in-flight.

### Empty state

Not applicable; missing customer is not-found error.

### Error state

Inline validation; VERSION_CONFLICT message pointing to review both copies. Until S23 exists, show both server and local field values and require a deliberate retry. Do not silently overwrite.

### Offline/network state

Edit is a live command in this slice. Offline blocks save with reconnect copy. Sync queue comes in CUST-SYNC-01.

### Accessibility

Copy about future-draft-only is readable by VoiceOver, not an icon-only hint.

### Tests

Edit name, conflict handling, duplicate email confirmation.

### Exit criteria

Owner edits a customer and a subsequent detail GET shows new values. No document snapshot writes.

### Evidence required before VERIFIED

Before/after GET plus a note that publish-snapshot tests wait for quote feature / CUST-QA-01 residual.

**Status (2026-09-21):** **IMPLEMENTED / AWAITING PHYSICAL VERIFICATION.** Route `/(app)/customers/[id]/edit`; Detail **Edit customer** for active and archived; prefilled form; minimal PATCH body with explicit null clears; If-Match + Idempotency-Key; duplicate Save anyway; VERSION_CONFLICT Reload latest from `details.server`; network Retry without sign-out; double-submit guard; success `router.back()` + list refresh; future-docs copy. Automated `editCustomerForm.test.ts` + route tests green. Physical Android still required for VERIFIED. Archive/restore/delete not in this slice.

---

## CUST-API-05

Archive/Restore Customer

### PRD IDs

CUS02, INV08, S07, S19, `POST /customers/{id}/archive`

### Purpose

Set or clear `archived_at` via `archived` boolean. Referenced jobs/documents remain. Archived customers disappear from default lists and new-job pickers.

### Prerequisites

CUST-API-04

### Files likely involved

- `apps/api` `POST /v1/customers/{id}/archive`
- list default filter already hides archived

### UI work

None.

### API work

Body `{ archived: boolean }`. Idempotency-Key required. If-Match is **not** required (DEC-CUST-005). Idempotent when the desired state already holds. When `archived_at` changes, increment `version` so a concurrent contact PATCH with stale If-Match gets `VERSION_CONFLICT`. Cross-tenant 404. Does not delete rows or alter jobs.

### Database work

Set/clear `archived_at`. Increment `version`. No cascade.

### Authorization

Owner only. AUTHZ01.

### Validation

Boolean required. Unknown fields rejected.

### Error state

404 generic, 409 `IDEMPOTENCY_MISMATCH`, 401. No If-Match 409 on this command.

### Loading / empty / offline / accessibility

Not applicable (API).

### Tests

- Archive → default GET list omits row; `state=archived` includes it
- Restore → default list includes it
- Jobs referencing the customer still GET (once jobs exist)
- Cross-tenant archive → 404
- Archive does not change customer name/email

### Exit criteria

Archive is visibility, not deletion.

### Evidence required before VERIFIED

API tests with a referenced job fixture (minimum job row).

---

## CUST-UI-05

Archive/Restore UI

### PRD IDs

S07, S19, CUS02, INV08, UI02 (destructive actions separated)

### Purpose

Archive and restore from list/detail/form. Restore option on S07 for archived customers.

### Prerequisites

CUST-API-05, CUST-UI-03, CUST-UI-02

### Files likely involved

- detail/list actions
- S07 restore control when `archived_at` is set

### UI work

Archive confirmation: removed from new jobs, history kept. Restore returns to pickers. Not a delete control.

### API work

Archive command.

### Database work

None.

### Authorization

Session.

### Validation

None beyond confirm dialog.

### Loading state

Action in-flight; prevent double tap.

### Empty state

After archive, default list empty state may appear; that is success, not error.

### Error state

Retry if network failed; do not show success on failure.

### Offline/network state

Authoritative command; blocked offline (SYNC05).

### Accessibility

Confirmation labels consequence. Status not colour-only.

### Tests

Archive then default list hides. Restore from S07. VoiceOver on confirmation.

### Exit criteria

Owner can archive/restore without losing the record.

### Evidence required before VERIFIED

UI recording + API list proof.

---

## CUST-API-06

Delete Customer

### PRD IDs

CUS02, `DELETE /customers/{id}`, AUTHZ01, API02, PRV02 (historical records remain until account deletion), INV02

### Purpose

Hard-delete only when unreferenced. Referenced customers return 409 and must not be deleted. No historical snapshot rewrite.

### Prerequisites

CUST-API-05, jobs FK from CUST-DB-01

### Files likely involved

- `apps/api` `DELETE /v1/customers/{id}`
- reference check: jobs (and later documents/drafts) in the same workspace
- idempotency for DELETE

### UI work

None.

### API work

- Unreferenced → 204/200 and row gone
- Referenced → 409 `CUSTOMER_REFERENCED`. UI offers Archive. Workspace export is EXP01 when built; do not invent a customer-scoped export (DEC-CUST-004).
- Cross-tenant → 404, including if the id exists in another workspace
- Repeat DELETE of unknown id → 404 (not a leak)

Reference definition for v1 Customer launch: a row in `jobs` with this `customer_id`. When drafts/documents exist in later features, they also count. Do not wait for those tables to implement the jobs check.

### Database work

Delete customer row only if no FK references. Prefer relying on FK plus a pre-check for a stable 409 code rather than a raw 23503 leak.

### Authorization

AUTHZ01. Account-deletion purge (PRV04) is a different privileged workflow and is out of scope.

### Validation

UUID path. No body fields.

### Error state

409 referenced, 404 generic, 401. Do not return the foreign workspace's customer name in the 409.

### Loading / empty / offline / accessibility

Not applicable (API).

### Tests

- Unreferenced delete succeeds
- Referenced delete 409 and row remains
- Cross-tenant delete 404 and row remains
- Archived-but-referenced still 409
- SQL as API role cannot bypass by DELETE

### Exit criteria

Destructive delete is impossible for referenced customers at API and database.

### Evidence required before VERIFIED

API + DB tests. 409 body has no cross-tenant PII.

---

## CUST-UI-06

Delete behavior

### PRD IDs

S19, CUS02, UI02, UI04

### Purpose

Delete is available for unreferenced customers. Referenced path offers archive (and points to export when Settings export exists) instead of a fake success.

### Prerequisites

CUST-API-06, CUST-UI-05

### Files likely involved

- detail destructive action, separated from archive
- confirmation copy

### UI work

Unreferenced: confirm delete, then list without the row. Referenced: cannot delete; offer Archive. Until EXP01 exists, do not show Export as a working action (DEC-CUST-004).

### API work

DELETE then fallback messaging from 409.

### Database work

None.

### Authorization

Session.

### Validation

Confirmation. No accidental swipe-delete without confirm.

### Loading state

In-flight disable.

### Empty state

List empty after deleting the last customer.

### Error state

409 referenced is not a generic crash. Network retry.

### Offline/network state

Blocked offline (SYNC05).

### Accessibility

Consequence-labelled confirm. Focus management after dismiss.

### Tests

Both paths. Rapid double-tap does not double-call without idempotency.

### Exit criteria

Owners cannot destructively delete referenced customers from UI or API.

### Evidence required before VERIFIED

UI recordings of both paths plus 409 fixture.

---

## CUST-JOB-01

Customer picker inside Create Job

### PRD IDs

S06, CUS01, CUS02, VAL01, JOB01 (job has one customer), `POST /jobs` (minimum), QA14 (do not allow later reset in this slice beyond documenting the rule), DEC10

### Purpose

Create Job selects one existing active customer or opens the S07 create sheet. Archived customers are absent from the picker. No Contacts permission.

### Prerequisites

CUST-UI-02, CUST-UI-01, CUST-API-05, minimum `POST /jobs` / job draft create sufficient to persist `customer_id`

### Files likely involved

- Create Job screen (S06) minimum fields: customer, title, mode stub
- customer picker using `GET /customers` default active
- `POST /jobs` with client UUID, customer, title, site/mode as required by PRD

This is the minimum Jobs surface needed for Customer correctness, not the full Jobs feature.

### UI work

Customer field, search, create sheet, selected customer shown by name. Archived customers not listed. After creating a customer in-sheet, it becomes the selection.

### API work

Active customer list + create customer + create job bound to that customer. Reject job create with another tenant's customer id (404/422 generic, SEC02).

### Database work

Insert job with composite FK to customer. Lifecycle `draft`.

### Authorization

AUTHZ01 on jobs and customers. Injected foreign `customer_id` fails.

### Validation

Job title 1–120 (VAL01) if collected. Customer required. Site address not part of Customer record.

### Loading state

Picker loading. Job submit in-flight.

### Empty state

No customers: prompt to create one, not a broken picker.

### Error state

Create job failure preserves customer selection.

### Offline/network state

Job/customer create live in this slice unless CUST-SYNC-01 already shipped. Honest offline.

### Accessibility

Picker is a list with headings, not colour-only selection.

### Tests

- Archived customer absent from picker, still visible on its existing job if one exists
- Foreign customer_id rejected
- Identical-name customers are distinct selectable rows
- No Contacts permission requested

### Exit criteria

A draft job can be created against an active customer. Archived customers cannot be chosen for new jobs.

### Evidence required before VERIFIED

E2E: create customer → appear in picker → create job → customer detail shows the job. Archived customer omitted from picker.

---

## CUST-SYNC-01

Customer offline/cache/network behavior

### PRD IDs

DEC10, ACC02, SYNC01–SYNC06, UI04, NFR05, NFR06, QA05, QA06, QA07, QA08

### Purpose

Cache customers in the encrypted per-owner local store. Allow cached reads offline. Queue non-authoritative customer creates/edits with versions. Never auto-run archive/delete/publish from the offline queue.

### Prerequisites

CUST-JOB-01, encrypted storage spike from CUST-FOUNDATION-01 / SYNC01. If SQLCipher/supported encryption is not proven, this slice is BLOCKED; plaintext is forbidden.

### Files likely involved

- mobile encrypted SQLite
- customer repository, operation queue, version/If-Match
- account-switch wipe
- Jobs/Settings unsynced count if customer ops are unsynced

### UI work

Saved on this device vs Synced timestamp. Offline list uses downloaded customers and states local search clearly if remote search is unavailable (SYNC06 analogue: “Searching downloaded …” not silent partial search). Access-expired after seven days since last successful auth.

### API work

Existing Customer endpoints plus operation_id replay (QA08). 409 VERSION_CONFLICT pauses that resource queue.

### Database work

No server schema change unless `idempotency_records` / operation uniqueness need tightening.

### Authorization

Cache is per-owner. Account switch wipes after unsynced confirmation. No shared DB.

### Validation

Local validation uses domain package; server remains authoritative.

### Loading state

Refresh leaves cached rows visible with timestamp.

### Empty state

Offline with empty cache is empty+offline, not a server error pretending zero customers.

### Error state

Conflict UI preserves both copies. Low disk: do not show Saved (QA62 analogue).

### Offline/network state

Reads: cache. Creates/edits: queued draft-quality sync. Archive/delete/restore: require connectivity and explicit tap.

### Accessibility

Sync status announced, not colour-only badges.

### Tests

QA05/QA06 for customer form if treated as local-draft. QA07 if two devices edit the same customer. QA08 replay create/edit 20 times → one row. Account switch wipe. Encryption at rest smoke test.

### Exit criteria

Airplane mode can show cached customers. Authoritative archive/delete cannot fire from a queue after reconnect without a live user action.

### Evidence required before VERIFIED

Development-build device evidence, not Expo Go. Proof of encryption module actually used. Conflict copies preserved.

---

## CUST-SEC-01

Customer tenant-isolation/security testing

### PRD IDs

AUTHZ01, SEC02, SEC04, SEC07, QA03, QA63, OPS02, OPS03, DB04, ARC02, ARC03

### Purpose

Hostile tests: attacker-controlled client, guessed UUIDs, injected workspace_id, logs, storage, RLS bypass, service-role absence on mobile.

### Prerequisites

CUST-SYNC-01 (or at least all Customer APIs). Isolation tests may start as soon as CUST-API-01 exists; this slice is the release gate for the family.

### Files likely involved

- API authorization suite
- DB role tests
- log redaction tests
- mobile bundle secret scan (no DATABASE_URL, no service role)

### UI work

None except confirming UI hiding is not the control.

### API work

Direct HTTP cases:

- No token
- Expired token
- Valid token, other tenant customer id on GET/PATCH/archive/DELETE
- Body `workspace_id` of another tenant on POST
- `customer_id` of another tenant on POST /jobs
- Cursor crafted for another tenant's timestamps

All reads/mutations fail closed with 401 or generic 404. No 200 with empty secrets that differ observably from unknown ids if avoidable.

### Database work

Connect as API role and as anon. Attempt cross-tenant SELECT. Must return zero rows. Superuser tests are not evidence of production security.

### Authorization

This slice is the authorization proof.

### Validation

Malformed UUID handling does not leak.

### Loading / empty / offline / accessibility

Not in scope except: offline cache must not retain previous owner's customers after switch.

### Tests

QA03 fully. Bundle/secret scan. Log fixtures containing email are redacted. RLS FORCE enabled. Connection pool does not reuse tenant GUC (ARC03).

### Exit criteria

No known cross-tenant disclosure path for Customer.

### Evidence required before VERIFIED

CI isolation suite, redaction test output, mobile config audit. Do not describe this as penetration testing (SEC07).

---

## CUST-QA-01

Final Customer PRD compliance audit

### PRD IDs

CUS01, CUS02, S06, S07, S19, VAL01, VAL02, AUTHZ01, DB02, DB03, GET/POST/PATCH/archive/DELETE customers, UI04, NFR01, QA03, QA14, QA15 (customer analogue), QA55, DEL04, SOP §42 compliance audit

### Purpose

Requirement-by-requirement audit of actual code and tests. Update `docs/REQUIREMENTS_MATRIX.md`. Nothing becomes VERIFIED without evidence.

### Prerequisites

All previous Customer slices implemented.

### Files likely involved

- `docs/REQUIREMENTS_MATRIX.md` status updates
- test evidence index
- residual open questions

### UI work

Manual pass of every S07/S19/S06 customer state: loading, empty, loaded, validation, server error, offline, access-expired, archived restore, duplicate email confirmation, referenced delete blocked.

### API work

Replay the endpoint inventory against OpenAPI and running API.

### Database work

Confirm indexes, RLS, non-unique email index, composite FKs.

### Authorization

Re-run CUST-SEC-01 suite.

### Validation

VAL01/VAL02 fixtures including Unicode and ZIP+4.

### Loading / empty / error / offline / accessibility

QA61-style VoiceOver/Dynamic Type on Customer screens.

### Tests

Map each matrix row to a test ID. Snapshot immutability after customer edit and “Apply current contact details to draft” (DEC-CUST-007) cannot be VERIFIED until Quote/publish exists; leave those rows PENDING (not VERIFIED). They are not blockers for Customer CRUD.

### Exit criteria

Every Customer MUST in the matrix is VERIFIED or still PENDING with a named Quote/export dependency. No IMPLEMENTED-without-evidence. Do not mark R-CUS-05/R-CUS-06 VERIFIED from Customer CRUD alone.

### Evidence required before VERIFIED

SOP §42: implementation exists and credible evidence demonstrates it works. Not: screen exists, function exists, comment claims support, mocked test.

---

## Out of scope for this feature

- Customer portal (S25–S27), approval OTP, customer accounts (deferred)
- Device Contacts integration
- Per-customer export ZIP
- Rewriting historical snapshots on privacy request
- Staff/support access to customer commercial records
- Android operator app
- Analytics events containing customer PII
- Full Jobs, Quotes, Invoices, Items, Settings, Subscriptions

## Resolved engineering decisions (not product-owner blockers)

See `docs/DECISIONS.md`.

| ID | Resolution |
|---|---|
| DEC-CUST-001 | Additive `GET /v1/customers/{id}`; generic 404; no embedded jobs |
| DEC-CUST-002 | Server 409 `DUPLICATE_CUSTOMER_EMAIL` + `confirm_duplicate_email`; new Idempotency-Key on retry |
| DEC-CUST-003 | Unparsable phone blocks save; no raw-phone override |
| DEC-CUST-004 | Referenced delete → archive; no customer-scoped export |
| DEC-CUST-005 | Archive: Idempotency-Key yes, If-Match not required; version increments on change |
| DEC-CUST-006 | `GET /v1/jobs?customer_id=`; jobs stay on `jobs` |
| DEC-CUST-007 | Master record only; apply-to-draft deferred to Quote |
| DEC-CUST-008 | `normalized_email` = trim + case-fold local and domain; no Gmail dot/plus rewrite |
| DEC-AUTH-003 | Hosted development project is account-owner created; `app_api_login` for `DATABASE_URL_API` |
| DEC-AUTH-004 | OTP: 6 digits; set hosted expiry to 600s; 5-failure cap is not a hosted per-challenge setting |

Non-critical assumptions (unchanged):

- Default customer list state is active-only.
- Search matches name and presentation email.
- Identical names never require confirmation.
- Customer email may be empty until an approval request is sent.
- Billing address may be omitted as a whole.
- Separate named contacts means separate `customers` rows.
- PRD Fastify/private-schema architecture wins over SOP mobile-direct Supabase CRUD.
- v1 operator app is iPhone only (DEC01). Android is not a Customer or v1 requirement.

## Blockers

**CUST-FOUNDATION-01:** IMPLEMENTED (typecheck, lint, tests). Not VERIFIED on a physical iPhone or production build.

**CUST-AUTH-01:** IMPLEMENTED. Hosted 0001 applied on the US development project. Live OTP mailbox still unverified.

**CUST-DOMAIN-01:** IMPLEMENTED (domain unit tests for VAL01/VAL02 create/update/list/archive contracts). Not VERIFIED via API/UI.

**SUPABASE-DEV-SETUP-01 / LINK-02 / RUNTIME-ROLE-03:** IMPLEMENTED/VERIFIED for US `us-east-1` project, applied 0001/0002, and live `app_api_login` RLS/JWKS. Tokyo project is DO NOT USE. Live OTP mailbox still unverified.

**Still true before Customer behaviour is production-correct:**

1. Live owner OTP (QA01/QA02) needs a fictional developer mailbox and the publishable key in the ignored mobile env file.
2. CUST-API-01 is **VERIFIED**. CUST-UI-01 is **VERIFIED** (physical Android create form, 2026-09-20). CUST-API-02 (list/search API) is **VERIFIED** (2026-09-20). CUST-UI-02 is **VERIFIED** (physical Android Customers list/search, 2026-09-20). **R-CUS-31** jobs↔customer FK is **VERIFIED** (`0004_jobs.sql`, 2026-09-20). **CUST-API-03** (customer detail + jobs-by-customer read) is **VERIFIED** (2026-09-21). **CUST-UI-03** is **VERIFIED** (physical Android Customer Detail 2026-09-21; populated jobs/pagination/404/archived badge automated only). **CUST-API-04** (PATCH edit) is **VERIFIED** (memory + live US 2026-09-21). **CUST-UI-04** is **IMPLEMENTED / AWAITING PHYSICAL VERIFICATION** (2026-09-21). S19 remains partially complete: edit UI physical verification + archive / restore / delete / Create Job remain open.
3. Jobs HTTP create (`R-CUS-PRE-05` remainder / CUST-JOB-01) still required before S06 picker bind; list-by-customer read is CUST-API-03 VERIFIED.
4. SYNC01 encrypted SQLite must be proven before CUST-SYNC-01 stores production records.
5. CUS01 apply-to-draft and published-snapshot evidence need Quote/document slices for VERIFIED.
6. CUS02 export offer needs Settings EXP01 for a truthful export path; Archive is sufficient for referenced-delete UX until then.

Do not start Customer archive/delete until authorized. CUST-UI-04 awaits physical Android verification before VERIFIED.
