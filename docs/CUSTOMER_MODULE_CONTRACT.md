# Customer Module Contract

Status: **Stable for integration** (Team A Customer ownership freeze).  
Authority: `docs/PRD.md`, `docs/API.md`, `docs/DATABASE.md`, DEC-CUST-*.  
Branch evidence: `build/v1` (Customer CRUD / S07 / S19 VERIFIED).

This document is for another developer or team consuming Customers. Do **not** invent a second Customer model.

Related: `docs/TEAM_A_OVERLAP_NOTES.md` (S05/S06 are **not** Customer ownership).  
Final handoff: `docs/CUSTOMER_HANDOFF_CHECKLIST.md`, `docs/CUSTOMER_BASELINE_MANIFEST.md`.
---

## A. Customer identity

Canonical identity:

- `customer.id` (UUID)

Never identify a Customer by:

- name
- email
- phone

Other resources (Jobs, future Quotes) must reference:

- `customer_id` → `customers.id`

Workspace membership is **server-derived** from the Bearer identity. Clients must never send `workspace_id` as authorization.

---

## B. Public Customer DTO

Success payloads for create / list item / detail / patch / archive return this shape only:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID string | Canonical identity |
| `name` | string | 1–120 trimmed |
| `email` | string \| null | Presentation email |
| `phone` | string \| null | E.164 when present |
| `billing_address` | object \| null | `{ line1, line2, city, state, zip }` |
| `archived_at` | ISO timestamptz string \| null | null = active |
| `version` | positive integer | Optimistic concurrency |
| `created_at` | ISO timestamptz string | |
| `updated_at` | ISO timestamptz string | |

**Server-owned / internal — never rely on these in clients or cross-team contracts:**

- `workspace_id`
- `normalized_email`
- `created_by`

DELETE success is not a Customer DTO: `{ "deleted": true }`.

List envelope: `{ "items": Customer[], "next_cursor": string | null }`.

---

## C. Customer list contract

`GET /v1/customers`

| Query | Meaning |
|---|---|
| `search?` | Case-insensitive partial name / presentation email |
| `state?` | `active` (default) \| `archived` \| `all` |
| `limit?` | Default **25**, max **100** |
| `cursor?` | Opaque; bound to `state` + `search` |

**Default = `active`.** Archived Customers are excluded unless `state=archived` or `state=all`.

**Integration rule for New Job selection:** use active Customers only (`state=active` or equivalent). Archived Customers must **not** be offered for new Job binding (API also rejects Job create against archived with `CUSTOMER_ARCHIVED`).

Ordering: `(updated_at, id) DESC`.

---

## D. Create Customer

`POST /v1/customers`

- **Idempotency-Key** required
- Body: `name` (required), optional `email`, `phone`, `billing_address`, `confirm_duplicate_email` (default false)
- Rejects ownership / unknown fields (`workspace_id`, `id`, `version`, …) → 422 `VALIDATION_FAILED`

**Duplicate normalized email (same workspace, including archived):**

1. Without `confirm_duplicate_email: true` → **409** `DUPLICATE_CUSTOMER_EMAIL` with safe `details.duplicates: [{ id, name }]`
2. Owner confirms in UI → **new** Idempotency-Key + `confirm_duplicate_email: true` → insert

Identical names never require confirmation. Empty email skips duplicate check. Cross-workspace same email does not warn.

Success: **201** + public Customer (`version` 1, `archived_at` null).

---

## E. Customer detail

`GET /v1/customers/{id}`

- Returns public Customer (including archived)
- **Does not embed jobs** — use `GET /v1/jobs?customer_id={id}`
- Unknown or cross-tenant UUID → **identical generic 404** (no existence oracle)

---

## F. Edit Customer

`PATCH /v1/customers/{id}`

- **Idempotency-Key** required
- **If-Match** required = current numeric `version`
- Partial PATCH of contact fields; JSON `null` clears optional fields
- Stale If-Match → **409** `VERSION_CONFLICT` with `details.server` = current public Customer
- Duplicate email on edit: same 409 protocol; self-match does not conflict
- Mutates **only** the live `customers` row — never published document snapshots (none in this module yet)

---

## G. Archive / restore

`POST /v1/customers/{id}/archive`

Body:

```json
{ "archived": true }
```

or

```json
{ "archived": false }
```

- Archive is **not** delete
- Existing Jobs / history remain accessible
- Archived Customer remains readable via GET by id and `state=archived|all`
- Archived Customer must **not** appear in New Job picker / active list
- Idempotency-Key required; If-Match not required
- Already-desired state is a no-op without version bump

---

## H. Delete

`DELETE /v1/customers/{id}`

- Idempotency-Key required; If-Match not required

| Situation | Result |
|---|---|
| Unreferenced | **200** `{ deleted: true }` |
| Referenced by Job(s) | **409** `CUSTOMER_REFERENCED` — Customer and Jobs remain; UI should recommend Archive |
| Unknown / cross-tenant | identical generic **404** |

DB: Jobs FK `ON DELETE RESTRICT` enforces referenced delete.

---

## I. Customer → Job contract

Canonical relationship:

```
Customer.id  ←  Job.customer_id
```

Database invariant (`0004_jobs.sql`):

```sql
foreign key (workspace_id, customer_id)
  references app.customers (workspace_id, id)
  on delete restrict
```

Cross-workspace binding is invalid (FK + RLS). Server derives workspace from membership; client `workspace_id` is not authorization.

---

## J. Snapshot contract (future Quote team)

PRD **CUS01** — record only; **do not implement Quotes here**:

- Editing Customer contact details affects **future drafts** only
- Published document snapshots **MUST NOT** be rewritten when a Customer is edited
- If an existing draft holds older contact details, the future Quote UI must **explicitly** offer: **Apply current contact details**
- Do **not** silently replace recipient / contact snapshots

---

## K. Approval contact contract

Record only; **do not implement approvals here**:

- Customer `email` may be optional on the Customer record
- Approval publishing requires an eligible email
- Job / approval flow chooses **one** approval contact (one Customer record)
- The approval request owns its **recipient snapshot** (independent of later Customer edits)

---

## Inventory (Team A Customer ownership)

| Area | Location |
|---|---|
| Table | `app.customers` |
| Migrations | `0003_customers.sql`, FK in `0004_jobs.sql` |
| RLS | `customers_tenant` + FORCE RLS |
| Domain | `packages/domain/src/customer.ts`, `customer-list-cursor.ts` |
| API routes | `GET/POST /v1/customers`, `GET/PATCH/DELETE /v1/customers/{id}`, `POST /v1/customers/{id}/archive` |
| Mobile | `/(app)/customers`, `/new`, `/[id]`, `/[id]/edit` |
| Error codes | `DUPLICATE_CUSTOMER_EMAIL`, `CUSTOMER_REFERENCED`, `VERSION_CONFLICT`, `IDEMPOTENCY_MISMATCH`, `WORKSPACE_REQUIRED`, `VALIDATION_FAILED`, `UNAUTHENTICATED`, `NOT_FOUND` (+ Job create `CUSTOMER_ARCHIVED`) |

**S07** (create + edit forms): **VERIFIED**  
**S19** (list + detail + archive/restore + delete UI): **VERIFIED**

---

## Integration freeze

The following contracts are **stable for integration** unless a documented PRD defect or security issue requires change:

- Customer public DTO
- Customer list filters (`state`, `search`, cursor pagination)
- Customer CRUD paths
- Archive contract (`POST …/archive` + `{ archived }`)
- Delete conflict (`CUSTOMER_REFERENCED`)
- `customer_id` Job relation (composite FK)
- **Customer API error contract** (status codes, error codes, details shapes, idempotency)

Future teams must consume these contracts instead of creating a second Customer model or bypassing Fastify via Supabase REST for commercial Customer writes.

---

## Customer API Error Contract

Frozen public error shapes for Customer routes. Do **not** invent new Customer error codes without a PRD change. Authority also: `docs/API.md`.

### Inventory (implemented)

| Code | Typical HTTP | Customer use |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing/invalid Bearer on any Customer route |
| `VALIDATION_FAILED` | 422 | Invalid body, missing/malformed Idempotency-Key or If-Match, invalid list `state`/`limit`/`cursor` |
| `NOT_FOUND` | 404 | Unknown or cross-workspace Customer id (generic; identical shape) |
| `DUPLICATE_CUSTOMER_EMAIL` | 409 | Same-workspace normalized email collision without `confirm_duplicate_email` |
| `VERSION_CONFLICT` | 409 | Stale PATCH If-Match; `details.server` = current **public** Customer |
| `IDEMPOTENCY_MISMATCH` | 409 | Same Idempotency-Key, different logical request |
| `CUSTOMER_REFERENCED` | 409 | DELETE while Jobs reference the Customer |
| `WORKSPACE_REQUIRED` | 409 | Owner has no workspace (create path) |

Job create may also return `CUSTOMER_ARCHIVED` (422) — that is a **Job** create error, not a Customer CRUD public error.

### Idempotency-Key required

| Endpoint | Idempotency-Key | If-Match |
|---|---|---|
| `POST /v1/customers` | Required | No |
| `PATCH /v1/customers/{id}` | Required | Required (numeric version) |
| `POST /v1/customers/{id}/archive` | Required | **Not** required |
| `DELETE /v1/customers/{id}` | Required | **Not** required |
| `GET /v1/customers` | No | No |
| `GET /v1/customers/{id}` | No | No |

Replay rules: same key + same logical request → stored response (no second insert / no second version bump / delete success replay stays `{ deleted: true }`, not 404). Same key + different request → `IDEMPOTENCY_MISMATCH`.

### Matrix

| Endpoint | Scenario | HTTP | Error code | Retry safe? | User action | Idempotency notes |
|---|---|---|---|---|---|---|
| `POST /v1/customers` | Unauthenticated | 401 | `UNAUTHENTICATED` | No (fix auth) | Sign in | n/a |
| `POST /v1/customers` | Invalid body / ownership fields | 422 | `VALIDATION_FAILED` | No | Fix fields | Failed validation may or may not store key; do not assume create |
| `POST /v1/customers` | Duplicate email, no confirm | 409 | `DUPLICATE_CUSTOMER_EMAIL` | No | Confirm in UI → **new** key + `confirm_duplicate_email: true` | 409 stored; replay returns same warning |
| `POST /v1/customers` | Same key, different body | 409 | `IDEMPOTENCY_MISMATCH` | No | New key | — |
| `GET /v1/customers` | Unauthenticated | 401 | `UNAUTHENTICATED` | No | Sign in | — |
| `GET /v1/customers` | Invalid `state` / `limit` / `cursor` | 422 | `VALIDATION_FAILED` | No | Fix query | — |
| `GET /v1/customers/{id}` | Unknown UUID | 404 | `NOT_FOUND` | No | Stop / pick another | Identical to cross-tenant |
| `GET /v1/customers/{id}` | Cross-workspace UUID | 404 | `NOT_FOUND` | No | Stop | No existence oracle |
| `PATCH /v1/customers/{id}` | Missing If-Match | 422 | `VALIDATION_FAILED` | No | Send current version | — |
| `PATCH /v1/customers/{id}` | Malformed If-Match | 422 | `VALIDATION_FAILED` | No | Send integer version | — |
| `PATCH /v1/customers/{id}` | Stale If-Match | 409 | `VERSION_CONFLICT` | No | Reload `details.server`; explicit retry | No silent last-write-wins; row unchanged |
| `PATCH /v1/customers/{id}` | Duplicate email (other row) | 409 | `DUPLICATE_CUSTOMER_EMAIL` | No | Confirm + new key | Self-email does not conflict |
| `PATCH /v1/customers/{id}` | Same key, different body | 409 | `IDEMPOTENCY_MISMATCH` | No | New key | Success replay does not bump version again |
| `PATCH /v1/customers/{id}` | Unknown / cross-tenant | 404 | `NOT_FOUND` | No | Stop | Generic |
| `POST …/archive` | Unauthenticated | 401 | `UNAUTHENTICATED` | No | Sign in | — |
| `POST …/archive` | Unknown / cross-tenant | 404 | `NOT_FOUND` | No | Stop | Generic |
| `POST …/archive` | Same key, different body | 409 | `IDEMPOTENCY_MISMATCH` | No | New key | Desired-state no-op is success, not mismatch |
| `DELETE /v1/customers/{id}` | Unauthenticated | 401 | `UNAUTHENTICATED` | No | Sign in | — |
| `DELETE /v1/customers/{id}` | Referenced by Job(s) | 409 | `CUSTOMER_REFERENCED` | No | Archive instead | No auto-archive; no Job ids / FK text |
| `DELETE /v1/customers/{id}` | Unknown / cross-tenant | 404 | `NOT_FOUND` | No | Stop | Never `CUSTOMER_REFERENCED` for foreign |
| `DELETE /v1/customers/{id}` | Same key, different request | 409 | `IDEMPOTENCY_MISMATCH` | No | New key | Success + referenced 409 are replayable |

### Privacy / leak rules

Generic 404 responses for detail / PATCH / archive / DELETE must be externally indistinguishable for unknown vs cross-workspace ids (same status, code, message; no `details` that reveal workspace, archive state, version, or Jobs).

Error payloads must not expose: `workspace_id`, `normalized_email`, `created_by`, raw Postgres codes (`23503`), FK/constraint names, or lists of Job ids on `CUSTOMER_REFERENCED`.

`VERSION_CONFLICT.details.server` and `DUPLICATE_CUSTOMER_EMAIL.details.duplicates` are the only intentional Customer-related detail payloads; both use public-safe fields only (`duplicates`: `{ id, name }[]`).

### Transient client UX (mobile)

Customer create / edit / list / detail / archive / delete network or 5xx paths must stay signed in, show Retry where appropriate, preserve form/list state, and must not trigger OTP/verify or destroy the session. Covered by existing mobile Customer tests under `npm run test:customer -w @job-to-invoice/mobile`.

---

## Customer Module Release Gate

Deterministic Customer-only regression for Team B / final integration. Does **not** own Jobs list (S05) or Create Job (S06) product suites.

### Commands

Primary (memory API lifecycle + **error contract** + mobile S07/S19):

```bash
npm run verify:customer
```

Composes:

1. `npm run test:customer-release-gate -w @job-to-invoice/api` → `customers.release-gate.test.ts` + `customers.error-contract.test.ts` + `customers.fixture-cleanup.test.ts`
2. `npm run test:customer -w @job-to-invoice/mobile` → existing S07/S19 mobile regression

Optional live Development US smoke (requires `DATABASE_URL_API` for project `vlpjaamdjtmtqtpwbhzq`; skips otherwise):

```bash
npm run test:customer-release-gate:live -w @job-to-invoice/api
```

Runs lifecycle smoke + error-contract live smoke. Both use `CustomerFixtureScope` + `finalizeCustomerLiveScope` (jobs before customers; residual assert `RUN_CUSTOMERS_REMAINING=0` / `RUN_JOBS_REMAINING=0`).

Broader Customer API memory suite (security + per-route suites + contract + release gate + error contract + fixture cleanup):

```bash
npm run test:customer -w @job-to-invoice/api
```

### Expected pass criteria

- `verify:customer` exits **0** (safe to run repeatedly; memory path leaves no DB rows)
- Memory release gate covers create → detail → Active list → duplicate warn/confirm → edit / version conflict → archive / restore → Job FK → referenced delete 409 → unreferenced delete → deleted 404 → cross-tenant read/mutation 404 → cross-workspace Job bind reject → public DTO without `workspace_id` / `normalized_email` / `created_by`
- Memory **error contract** locks the matrix above (401/422/409/404 codes, generic 404 privacy, no DB/internal leaks)
- Memory **fixture cleanup** proves finally-on-failure + concurrent scope isolation
- Mobile suite covers S07 create/validation/duplicate and S19 list/search/detail/edit/archive/restore/delete/referenced-delete/network/retry/state preservation
- Live smoke (when env present): lifecycle CRUD smoke + error conflicts with disposable fixtures cleaned afterward; tracked residual customers/jobs = 0

### Known infrastructure flake

Long serialized live suites against Supabase Development US may hit `CONNECT_TIMEOUT` (connection-pool exhaustion) or intermittent JWKS fetch failures. That is **not** a Customer product failure.

- Do **not** change product code for timeouts alone
- Re-run only the affected live file with `--test-concurrency=1` (e.g. `test:customer-release-gate:live`)
- Distinguish infrastructure flake from assertion failures on contract behavior

Customer live files always use `--test-concurrency=1` via package scripts.

### Post-merge requirement

After Team A + Team B final merge, run `npm run verify:customer` (and live smoke when Development US credentials are available) before treating the Customer module as still green.

---

## Customer Test Fixture Safety

Rules for Team A Customer live/memory tests. **Development US only** (`vlpjaamdjtmtqtpwbhzq`). Never production. Never Tokyo.

### Ownership

- Disposable owners use unique `auth_user_id` / run suffix (`CustomerFixtureScope.runId`)
- Authoritative cleanup identity: **exact created row IDs** tracked by the test scope and/or disposable owner auth subject
- Diagnostics labels may include the run suffix in names/emails; they are **not** cleanup keys

### Cleanup

- Always `try` / `finally` (or equivalent) so failed assertions still clean
- Order: **Jobs → Customers → allowances → memberships → workspace → idempotency → app_user**
- Shared helper: `apps/api/src/test-helpers/customerLiveFixtures.ts`
  - `cleanupDisposableOwnerByAuth`
  - `finalizeCustomerLiveScope` (cleans tracked auths, then asserts residuals)
  - `CustomerFixtureScope` / `MemoryCustomerFixtureRegistry` for ownership checks
- Cleanup errors are **not** swallowed (`AggregateError` / rethrow)
- Scope **refuses** untracked / foreign-owned IDs

### Forbidden

- `DELETE … WHERE name LIKE …`
- `DELETE … WHERE email LIKE …`
- Cleanup by display name or Job title alone
- Broad deletes of pre-existing workspace data outside the disposable owner

### Serialization / flakes

- All Customer live scripts run with `--test-concurrency=1`
- `CONNECT_TIMEOUT` / JWKS reachability flakes → retry that file only; do not weaken product RLS or pool settings for green CI

### Repeated `verify:customer`

Memory `verify:customer` leaves no commercial DB rows and is safe to run repeatedly. Live `test:customer-release-gate:live` must end with:

```
RUN_CUSTOMERS_REMAINING=0
RUN_JOBS_REMAINING=0
```

for IDs tracked in that run.

---

## Customer Module Dependency Boundary

Status: audited on Team A `build/v1`. Customer remains **COMPLETE / FROZEN / INTEGRATION-READY**.

### TEAM A OWNS

- Customer persistence (`app.customers`, migrations)
- Customer validation / domain parsers (`packages/domain` Customer types)
- Customer APIs (`/v1/customers*`)
- Customer UI (`/(app)/customers*`)
- Customer security (workspace isolation, RLS assumptions, generic 404 privacy)
- Customer public DTO (nine fields — see section B)

### SHARED CONTRACTS

- Authenticated access token (Bearer) + server-derived workspace membership
- `Customer.id` → `Job.customer_id` (UUID identity only)
- Customer-scoped Job summary read: `GET /v1/jobs?customer_id={customerId}` returning public `JobSummary`
- Active Customer picker provider contract: `GET /v1/customers?state=active` exposing at least `Customer.id` + `Customer.name` (full public DTO is fine)
- Optional Create Job return params after in-flow Customer create: `selectedCustomerId` + `selectedCustomerName` on `/(app)/jobs/new` (documented in `customerRoutes`; not a Jobs UI import)

### TEAM A DOES NOT OWN

- Jobs list (S05)
- Create Job screen (S06)
- Job Detail
- Quotes
- Invoices
- Ledger
- Approvals
- Settings

### Merge guidance

Team B may replace or reconcile overlapping S05/S06 (and Auth) implementation later **without** changing the frozen Customer contract above. Customer Detail’s associated Jobs section must keep working against the shared `customer_id` jobs list contract even if Team A’s S05 list UI/controller is removed.

Auth implementation files are **SHARED / FINAL MERGE RECONCILIATION REQUIRED** — Customer consumes session/token + 401 sign-out policy only; it does not own Auth product behavior.
