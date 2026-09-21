# API

Status: CUST-AUTH-01 implements `GET /v1/me` and `POST /v1/workspace` with Bearer JWT verification. Customer and Jobs routes are not implemented.

Authority: PRD sections 21–22 (API01–API03, endpoint inventory). Additive Customer Detail read: DEC-CUST-001. Duplicate-email protocol: DEC-CUST-002. Jobs filter: DEC-CUST-006.

Base path: `/v1`. JSON UTF-8. HTTPS only in deployed environments.

This file specifies Customer routes and the minimum owner bootstrap plus the narrow Jobs list/create needed for S19 and S06. It is not the full Jobs/Quote API.

## Conventions

### Authentication

Owner routes: `Authorization: Bearer <access_token>`. API verifies signature, issuer, audience, expiry, and `app_users.status`.

Workspace is loaded from membership for that user. Client `workspace_id` is not authorization (AUTHZ01).

### Success envelope

```json
{
  "data": {},
  "meta": { "request_id": "uuid", "server_time": "2026-09-17T00:00:00.000Z" }
}
```

List `data`: `{ "items": [], "next_cursor": null }`. Default `limit` 25, max 100. Descending `(updated_at, id)`. Opaque cursor bound to filters.

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "human-safe message",
    "field_errors": { "name": ["..."] },
    "retryable": false
  },
  "meta": { "request_id": "uuid" }
}
```

No stack traces, SQL, provider tokens, or tenant existence (API02).

### Status mapping

| HTTP | Use |
|---|---|
| 401 | Missing/invalid/expired owner session |
| 403 | Permission/entitlement (not used to signal another tenant’s object) |
| 404 | Unknown id **or** cross-tenant object. Generic body |
| 409 | State conflict (duplicate email confirmation, version, idempotency mismatch, referenced delete) |
| 422 | Schema/validation |
| 429 | Rate limit with `Retry-After` |
| 5xx | Retryable possible; resolve operation before replay |

### Headers

| Header | Required on |
|---|---|
| `Idempotency-Key` (UUID) | Every state-changing owner command |
| `If-Match` (integer version) | `PATCH /customers/{id}` (and later draft PATCH) |
| `X-Request-Id` | Unique request id per API01; generate if absent |

Reused Idempotency-Key with a different body: 409 `IDEMPOTENCY_MISMATCH`.

Unknown JSON fields: 422 (API03). Client cannot set `workspace_id`, `archived_at` (except via archive command), `version`, calculated totals, or tenant ownership.

### Customer resource (response)

```json
{
  "id": "uuid",
  "name": "string",
  "email": "string | null",
  "phone": "string | null",
  "billing_address": {
    "line1": "string",
    "line2": "string | null",
    "city": "string",
    "state": "XX",
    "zip": "12345"
  } | null,
  "archived_at": "timestamptz | null",
  "version": 1,
  "created_at": "timestamptz",
  "updated_at": "timestamptz"
}
```

Do not return `workspace_id` as a client-writable capability. Do not return `normalized_email` unless needed internally; the client displays `email`.

`normalized_email` is never unique.

---

## GET /v1/me

| | |
|---|---|
| Method / path | `GET /v1/me` |
| Authentication | Owner Bearer |
| Authorization | Verified user. Workspace from membership if it exists |
| Idempotency-Key | No (read) |
| If-Match | No |
| Entities | `app_users`, `memberships`, `workspaces`, `job_allowances`, later entitlement snapshot |
| Tenant isolation | Returns only this user’s row and, if present, their single workspace |

**Request.** Empty body. No query required.

**Response `data`.** User id, display email, account status, bootstrap state (`needs_workspace` | `ready`), workspace summary or null, entitlement summary placeholder (zeros/nulls until billing exists).

**Errors.** 401.

**Tests.** Authenticated owner with workspace; authenticated owner without workspace; no token 401; user A does not see user B workspace.

---

## POST /v1/workspace

| | |
|---|---|
| Method / path | `POST /v1/workspace` |
| Authentication | Owner Bearer |
| Authorization | Verified user with **no** existing workspace. Second create rejected |
| Idempotency-Key | Required |
| If-Match | No |
| Entities | `workspaces`, `memberships`, `job_allowances` (one transaction) |
| Tenant isolation | Cannot attach to another owner’s workspace |

**Request schema (minimum S04 fields).**

```json
{
  "business_name": "string",
  "legal_name": "string",
  "contact_name": "string",
  "contact_email": "string",
  "contact_phone": "string | null",
  "address": { "line1": "", "line2": null, "city": "", "state": "XX", "zip": "" },
  "timezone": "IANA",
  "trade": "handyman | other",
  "default_tax_bp": 0,
  "default_due_days": 14,
  "default_terms": "string"
}
```

Currency is server-set `USD`. Logo optional later.

**Response `data`.** Workspace resource + membership + allowances, `version` 1.

**Errors.** 401; 422 validation; 409 workspace already exists; 409 `IDEMPOTENCY_MISMATCH`.

**Tests.** Atomic create of three rows; replay same key; second workspace for same user rejected; VAL01/VAL02 on names/address; no client `id` takeover of another workspace.

---

## GET /v1/customers

| | |
|---|---|
| Method / path | `GET /v1/customers` |
| Authentication | Owner Bearer |
| Authorization | Active owner membership. Own records only |
| Idempotency-Key | No |
| If-Match | No |
| Entities | `customers` |
| Tenant isolation | Other workspaces never appear. No total counts that leak other tenants |

**Query.** `cursor?`, `limit?` (default 25, max 100), `search?` (name and presentation email, case-insensitive), `state?` (`active` default, `archived`, `all`).

**Response `data`.** `{ items: Customer[], next_cursor: string | null }`.

**Errors.** 401; 422 invalid query/cursor/limit.

**Tests.** Default hides archived (INV08); `state=archived`; Unicode search; pagination stability; owner B omits owner A; limit 101 → 422.

---

## GET /v1/customers/{id}

Additive read required by S19. PRD inventory is a minimum contract, not a ceiling (DEC-CUST-001). Not generic database CRUD: owner Customer resource only.

| | |
|---|---|
| Method / path | `GET /v1/customers/{id}` |
| Authentication | Owner Bearer |
| Authorization | Membership workspace must own the row |
| Idempotency-Key | No |
| If-Match | No |
| Entities | `customers` |
| Tenant isolation | Unknown or other-tenant UUID → generic 404, identical body |

**Request.** Path UUID. No body.

**Response `data`.** Customer resource. **Do not embed the jobs collection** (DEC-CUST-006). Include `archived_at` and `version` so the client can edit/archive.

**Errors.** 401; 404 generic; 422 only for malformed path if distinguished without leaking tenant validity — prefer 404 for any well-formed UUID that is not in this workspace.

**Tests.** QA03; archived customer still readable; no jobs array in payload. **Evidence (CUST-API-03, 2026-09-21):** `customers.detail.test.ts` + live `customers.detail.live.test.ts` on development US (`vlpjaamdjtmtqtpwbhzq`).

Associated jobs: `GET /v1/jobs?customer_id={id}` (below). If that customer is not in-workspace, the jobs call also 404s.

---

## POST /v1/customers

| | |
|---|---|
| Method / path | `POST /v1/customers` |
| Authentication | Owner Bearer |
| Authorization | Active owner. Workspace from identity |
| Idempotency-Key | Required |
| If-Match | No |
| Entities | `customers` insert; `idempotency_records`; optional `audit_events` |
| Tenant isolation | Row is written with server workspace_id only |

**Request schema.**

```json
{
  "name": "string",
  "email": "string | null",
  "phone": "string | null",
  "billing_address": { "line1": "", "line2": null, "city": "", "state": "XX", "zip": "" } | null,
  "confirm_duplicate_email": false
}
```

`confirm_duplicate_email` defaults false if omitted.

Client must not send `id`, `workspace_id`, `normalized_email`, `archived_at`, `version`, `created_at`, `updated_at`, or `created_by`. Unknown or ownership fields → 422 `VALIDATION_FAILED`.

**Duplicate email (DEC-CUST-002, CUS01).** If `email` is present and another customer in **this** workspace has the same `normalized_email` (including archived rows), and `confirm_duplicate_email` is not true:

- HTTP 409
- `error.code`: `DUPLICATE_CUSTOMER_EMAIL`
- `retryable`: false
- Safe same-workspace metadata only, e.g. `{ "duplicates": [{ "id": "uuid", "name": "string" }] }` under `error.details`
- No emails, no other-workspace ids, no existence of other tenants

The 409 response is stored under the request's Idempotency-Key so replay returns the same warning and does not create a row. After the owner confirms in UI, client retries with a **new** Idempotency-Key and `confirm_duplicate_email: true`. Server rechecks, then inserts. Identical names never require this flag.

Empty email: no duplicate check.

**Invalid phone (DEC-CUST-003).** Optional. If supplied and not parsable to E.164 without guessing country → 422 `VALIDATION_FAILED` on `phone`. No raw-phone persist.

**Success.** HTTP `201 Created`. Response `data` is the Customer resource (`id`, `name`, `email`, `phone`, `billing_address`, `archived_at`, `version`, `created_at`, `updated_at`). `version` is 1. `archived_at` is null. Server-derived `workspace_id`, `normalized_email`, and `created_by` are not returned on the resource.

**Errors.** 401 `UNAUTHENTICATED`; 422 `VALIDATION_FAILED`; 409 `DUPLICATE_CUSTOMER_EMAIL`; 409 `IDEMPOTENCY_MISMATCH`; 409 `WORKSPACE_REQUIRED` when the owner has no workspace; 429.

**Tests.** Unicode name; same name twice; duplicate email without confirm → 409; with confirm + new key → two rows; archived same-email still warns; cross-workspace same email does not warn; invalid phone 422; invalid ZIP 422; ownership fields 422; replay; unauthenticated 401; live DB persistence under `app_api_login`.

---

## PATCH /v1/customers/{id}

| | |
|---|---|
| Method / path | `PATCH /v1/customers/{id}` |
| Authentication | Owner Bearer |
| Authorization | Owner of the workspace that owns the row |
| Idempotency-Key | Required |
| If-Match | **Required.** Numeric `customers.version` |
| Entities | `customers` only. Never `document_drafts` or `documents` |
| Tenant isolation | Foreign id → 404. Row unchanged |

**Request schema.** Mutable contact fields only (all optional but at least one required):

```json
{
  "name": "string",
  "email": "string | null",
  "phone": "string | null",
  "billing_address": {} | null,
  "confirm_duplicate_email": false
}
```

Cannot set `archived_at` here. Duplicate-email protocol applies when the new normalized email collides with a **different** customer in the same workspace.

**Response `data`.** Updated Customer, incremented `version`. Successful updates always increment `version` (including same-value contact patches). Clearing optional fields is supported with explicit `null` for `email`, `phone`, and `billing_address`. Archived customers remain editable (contact fields only; `archived_at` is not mutable here).

**Errors.** 401; 404 generic; 422 (including missing/malformed If-Match or Idempotency-Key); 409 `VERSION_CONFLICT` (stale If-Match; `error.details.server` is the current public Customer); 409 `DUPLICATE_CUSTOMER_EMAIL` (same protocol as create; self excluded); 409 `IDEMPOTENCY_MISMATCH`.

**Idempotency.** Replay of the same key + same body + same If-Match returns the stored success without a second version increment (even when the original If-Match is now stale relative to the live row).

**Tests.** 1→2 version; missing If-Match 422; stale If-Match 409 and no write; PATCH does not change any snapshot table (even if empty / not yet created); cross-tenant 404; live US development verification 2026-09-21.

---

## POST /v1/customers/{id}/archive

| | |
|---|---|
| Method / path | `POST /v1/customers/{id}/archive` |
| Authentication | Owner Bearer |
| Authorization | Owner workspace |
| Idempotency-Key | Required |
| If-Match | **Not required** (DEC-CUST-005). Command is POST, not PATCH |
| Entities | `customers.archived_at`, `version` |
| Tenant isolation | Foreign id → 404 |

**Request.** `{ "archived": true | false }`

**Behavior.** `archived: true` sets `archived_at` if null. `archived: false` clears it. Desired state already current → success (idempotent). Increments `version` when state changes so in-flight contact PATCH with old If-Match gets `VERSION_CONFLICT`. Does not delete jobs or rewrite snapshots.

**Errors.** 401; 404; 422; 409 `IDEMPOTENCY_MISMATCH`.

**Tests.** Archive hides from default list; restore; jobs remain; cross-tenant 404; name/email unchanged.

**Evidence (CUST-API-05, 2026-09-21):** Memory `customers.archive.test.ts` + live `customers.archive.live.test.ts` on development US (`vlpjaamdjtmtqtpwbhzq`). Restore is the same route with `{ archived: false }` (no separate `/restore`). If-Match not required (DEC-CUST-005). Desired state already current → 200, no version bump / no `archived_at` rewrite. State change → version N→N+1. Idempotent replay returns stored response without a second write. Customer-with-jobs archive/restore preserves jobs. Unknown/cross-tenant identical generic 404.

---

## DELETE /v1/customers/{id}

| | |
|---|---|
| Method / path | `DELETE /v1/customers/{id}` |
| Authentication | Owner Bearer |
| Authorization | Owner workspace |
| Idempotency-Key | Required |
| If-Match | Not required |
| Entities | `customers` delete if unreferenced; `jobs` existence check |
| Tenant isolation | Foreign or unknown id → generic 404. Do not 409 a foreign referenced customer |

**Request.** Empty body.

**Unreferenced.** Delete row. **200** with `{ "data": { "deleted": true } }` (API02 envelope). Chosen over 204 for consistency with other owner commands.

**Referenced** (any `jobs` row with this `customer_id` in this workspace). 409 `CUSTOMER_REFERENCED`. Row remains. Message instructs Archive. Do not invent a customer-scoped export (DEC-CUST-004). No auto-archive on failed delete. Active or archived unreferenced customers may be deleted (no archive-first prerequisite). If-Match is **not** required.

**Errors.** 401; 404; 422 (missing/malformed Idempotency-Key or non-empty body); 409 `CUSTOMER_REFERENCED`; 409 `IDEMPOTENCY_MISMATCH`.

**Idempotency.** Required. Empty-body hash. Success (200) and referenced conflict (409) are stored and replayed. Replay of a successful delete returns the stored 200 `{deleted:true}` (does not become 404). Cross-tenant / unknown never returns `CUSTOMER_REFERENCED`.

**Evidence (CUST-API-06, 2026-09-21):** Memory `customers.delete.test.ts` + live `customers.delete.live.test.ts` on development US (`vlpjaamdjtmtqtpwbhzq`). Unreferenced active/archived delete → 200; detail/list absent. Referenced (one/multiple/archived-referenced) → 409 `CUSTOMER_REFERENCED`; customer + jobs remain; no DB leak (`23503`/FK text absent). Unknown/cross-tenant identical generic 404 (cross-tenant referenced still 404, not 409). Idempotent success replay + `IDEMPOTENCY_MISMATCH` + referenced 409 replay. FK `ON DELETE RESTRICT` remains defense-in-depth (pre-check + 23503 → same API conflict).

**Tests.** Unreferenced delete; referenced 409; archived-but-referenced 409; cross-tenant 404; API role cannot DELETE another tenant’s row via SQL.

---

## GET /v1/jobs

PRD: search, state, archive filter, page. Additive filter `customer_id` for S19 (DEC-CUST-006). This is not a second jobs datastore.

| | |
|---|---|
| Method / path | `GET /v1/jobs` |
| Authentication | Owner Bearer |
| Authorization | Owner workspace. If `customer_id` is present, that customer must belong to the same workspace or the call is generic 404 |
| Idempotency-Key | No |
| If-Match | No |
| Entities | `jobs` (and existence check on `customers` when filtered) |
| Tenant isolation | Never return another workspace’s jobs. Foreign `customer_id` is 404, not an empty list (avoids existence oracle vs GET customer) |

**Query.** `customer_id` (required for CUST-API-03 / S19 associated jobs), `cursor?`, `limit?` (default 25, max 100), `search?`, `state?` (`all` default, `active`, `archived`, or a lifecycle). Broader unfiltered workspace job list remains deferred with POST /jobs (CUST-JOB-01).

**Ordering.** `(updated_at, id) DESC` (matches `jobs_workspace_customer_updated_id_idx`).

**Response `data`.** `{ items, next_cursor }` with job summary fields sufficient for S19: `id`, `title`, `lifecycle`, `updated_at`, `customer_id`. Do not include `workspace_id`, `created_by`, `internal_notes`, entitlement, or version fields. Do not include internal notes on a Customer screen if avoidable; S19 needs associated jobs, not a full job editor.

**Errors.** 401; 404 if `customer_id` not in workspace (unknown and cross-tenant identical); 422 query (including missing/malformed `customer_id`).

**Tests.** Filter returns only that customer’s jobs; other owner’s customer_id 404; empty jobs for a valid own customer is `items: []`, not 404. **Evidence (CUST-API-03, 2026-09-21):** `jobs.list.test.ts` + live `jobs.list.live.test.ts` on `vlpjaamdjtmtqtpwbhzq`.

Full Jobs feature (lifecycle actions, documents, unfiltered list, POST) is out of scope except as needed for this filter; POST below remains CUST-JOB-01.

---

## POST /v1/jobs (minimum for CUST-JOB-01)

PRD: client UUID, customer, title, site, mode; create draft.

| | |
|---|---|
| Method / path | `POST /v1/jobs` |
| Authentication | Owner Bearer |
| Authorization | `customer_id` must be an **active** (not archived) customer in this workspace. Foreign or archived customer → 404 generic or 422 `VALIDATION_FAILED` on `customer_id` without tenant leak — use 404 for unknown/foreign, 422 `CUSTOMER_ARCHIVED` or field error for own archived customer (picker should not offer them) |
| Idempotency-Key | Required |
| If-Match | No |
| Entities | `jobs` insert, `customers` read |
| Tenant isolation | Injected foreign `customer_id` fails (SEC02) |

**Request (minimum).** `{ "id": "uuid", "customer_id": "uuid", "title": "string", "site_address": object | null, "no_site": boolean, "mode": "quote" | "direct_invoice" }`

**Site / no_site (PRD VAL02).** `no_site: true` → `site_address` must be null/absent. `no_site: false` → `site_address` required (US address VAL02). Billing address is not accepted here.

**Server defaults.** `lifecycle=draft`, `version=1`, `scope_version=0`. Client cannot set workspace/lifecycle/version/scope/entitlement/internal fields. `mode` is accepted for the create contract (future `job_created` analytics); document draft rows are not created in this slice.

**Response `data`.** Created job: JobSummary fields (`id`, `title`, `lifecycle`, `updated_at`, `customer_id`) plus `version`, `scope_version`, `no_site`, `site_address`, `mode`. Do not include `workspace_id`, `created_by`, `internal_notes`, or entitlement fields.

Do not implement quote editor here. Creating the draft document row may wait for Quote; a job header is enough for Customer reference tests if domain requires a draft — if `document_drafts` is not migrated yet, persist the job only.

**Tests.** Bind active customer; archived customer rejected; foreign customer_id 404; job appears on `GET /jobs?customer_id=`.

**Evidence (CUST-JOB-01 API, 2026-09-21):** Memory `jobs.create.test.ts` + live `jobs.create.live.test.ts` on development US (`vlpjaamdjtmtqtpwbhzq`). Active create → 201 draft/version=1/scope_version=0; list-by-customer includes row; idempotent replay; `IDEMPOTENCY_MISMATCH`; unknown/cross-tenant identical 404; archived → 422 `CUSTOMER_ARCHIVED`. S06 mobile Create Job / Customer picker UI remains PENDING.
---

## Tenant-isolation tests (all Customer routes)

- No token → 401
- Valid token, other tenant’s id on GET/PATCH/archive/DELETE → 404
- Body `workspace_id` of another tenant on POST → ignored/422, no write into that tenant
- `POST /jobs` with another tenant’s `customer_id` → 404
- Logs/analytics contain no customer email/name (ANA01, OPS03)

## Analytics

No Customer create/update events in the PRD allowlist. Do not add them. `job_created` may fire later on `POST /jobs` with `mode` only.
