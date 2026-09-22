# Customer Module Contract

Status: **Stable for integration** (Team A Customer ownership freeze).  
Authority: `docs/PRD.md`, `docs/API.md`, `docs/DATABASE.md`, DEC-CUST-*.  
Branch evidence: `build/v1` (Customer CRUD / S07 / S19 VERIFIED).

This document is for another developer or team consuming Customers. Do **not** invent a second Customer model.

Related: `docs/TEAM_A_OVERLAP_NOTES.md` (S05/S06 are **not** Customer ownership).

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

Future teams must consume these contracts instead of creating a second Customer model or bypassing Fastify via Supabase REST for commercial Customer writes.
