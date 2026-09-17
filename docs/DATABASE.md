# Database

Status: specification. No migrations have been applied.

Authority: PRD section 20 (DB01–DB05), CUS01, CUS02, AUTHZ01. Schema details for later financial tables remain in the PRD; this file specifies tables required for Customer and its minimum prerequisites.

Private schema: `app` (not `public`). Client GRANTs revoked. `FORCE ROW LEVEL SECURITY` on every tenant table.

## Common rules (all tenant tables)

- Primary identity: `id UUID` plus `workspace_id UUID NOT NULL`.
- `UNIQUE (workspace_id, id)`.
- `created_at timestamptz NOT NULL` default `now()`.
- `updated_at timestamptz NOT NULL` on mutable tables, maintained on write.
- Relationships between tenant tables: composite foreign keys `(workspace_id, referenced_id)` (DB01).
- No `ON DELETE CASCADE` of published financial records. Customer delete of an unreferenced row is ordinary CRUD; it must fail if a job still references the customer.
- Mutable rows: `version integer NOT NULL DEFAULT 1`.
- `created_by UUID NOT NULL` is an application actor (`app_users.id`, or a named service actor later).
- JSON columns validate against checked-in schemas on write and read (DB02).
- Enums: constrained text + migration-permitted values.
- List/pagination index on every list path: `(workspace_id, updated_at DESC, id DESC)` (DB03).

`app_users` is an identity table, not a tenant table. It has no `workspace_id`.

## Roles and RLS

See `docs/ARCHITECTURE.md`. Policies: API role may `SELECT/INSERT/UPDATE/DELETE` only when `workspace_id` equals the transaction-local workspace setting. Anon/authenticated roles: no access. Authorization tests must run as the API role, not as a superuser (DB04).

---

## app_users

**Purpose.** Map a Supabase Auth identity to a stable application user. Owner email changes do not change this UUID (ACC03).

**Classification.** Mutable identity row. Not a commercial Customer record.

| Field | Null | Default | Notes |
|---|---|---|---|
| `id` | NO | generated UUID | Primary key |
| `auth_user_id` | NO | | Unique. Provider subject. |
| `normalized_email` | NO | | Lookup normalization without provider-specific dot/plus rewriting |
| `display_email` | NO | | Original presentation |
| `status` | NO | `active` | `active` / `suspended` / `deleting` / `deleted` |
| `last_authenticated_at` | NO | | |
| `deletion_requested_at` | YES | | |
| `terms_version` | NO | | |
| `privacy_version` | NO | | |
| `created_at` | NO | `now()` | |
| `updated_at` | NO | `now()` | |

**Primary key.** `id`

**workspace_id.** None. Workspace association is `memberships`.

**Foreign keys.** None to commercial tables. `auth_user_id` references the Auth provider, not a tenant row.

**Indexes.** Unique `auth_user_id`. Unique `normalized_email` (one owner login identity; this is **not** the Customer email index).

**Version.** Not a Customer-versioned resource. Status transitions are restricted commands.

**RLS.** Not listed via Customer routes. API role reads the row for the verified JWT mapping only. Never expose one owner’s row to another.

---

## workspaces

**Purpose.** One business workspace per owner (DEC04).

**Classification.** Mutable. Business default edits affect future drafts only (`PATCH /workspace`).

| Field | Null | Default | Notes |
|---|---|---|---|
| `workspace_id` | NO | | Same as `id` physically: column name is `id`; tenant key is this row’s id. Other tables call it `workspace_id`. |
| `id` | NO | generated UUID | Primary key of the workspace |
| `owner_user_id` | NO | | Unique. FK to `app_users.id` |
| `business_name` | NO | | VAL01 2–100 |
| `legal_name` | NO | | VAL01 2–150 |
| `contact_name` | NO | | VAL01 2–100 |
| `contact_email` | NO | | |
| `contact_phone` | YES | | |
| `address_json` | NO | | VAL02 US business address |
| `timezone` | NO | | IANA. Confirmed at setup |
| `currency` | NO | `'USD'` | Cannot be edited |
| `trade` | NO | | `handyman` / `other` |
| `logo_asset_id` | YES | | Later |
| `default_tax_bp` | NO | `0` | |
| `default_due_days` | NO | `14` | |
| `default_terms` | NO | `''` | |
| `version` | NO | `1` | |
| `created_at` / `updated_at` | NO | `now()` | |
| `created_by` | NO | | |

Use standard tenant shape: `workspaces.id` is the workspace UUID. Child tables store that value as `workspace_id`. Do not add a second `workspace_id` column on `workspaces`.

**Primary key.** `id`

**workspace_id behavior.** This row **is** the workspace.

**Foreign keys.** `owner_user_id → app_users.id`

**Indexes.** Unique `owner_user_id`. PK on `id`.

**RLS.** API role: `id` equals transaction-local workspace.

---

## memberships

**Purpose.** Workspace membership. v1 exactly one active owner.

**Classification.** Mutable status; v1 has no staff invitations.

| Field | Null | Default | Notes |
|---|---|---|---|
| `workspace_id` | NO | | |
| `id` | NO | generated UUID | |
| `user_id` | NO | | FK `app_users.id` |
| `role` | NO | `'owner'` | `owner` only in v1 |
| `status` | NO | `'active'` | `active` |
| `created_at` / `updated_at` | NO | `now()` | |
| `created_by` | NO | | |
| `version` | NO | `1` | |

**Primary key.** `id` plus `UNIQUE (workspace_id, id)`

**workspace_id.** NOT NULL. Set by server from the workspace being created/joined, never from a client capability claim.

**Foreign keys.** Composite `(workspace_id) → workspaces(id)`. `user_id → app_users.id`. Unique `(workspace_id, user_id)`.

**Indexes.** Unique `(workspace_id, user_id)`. List index not required for v1 (one row).

**RLS.** API role: `workspace_id` equals transaction-local workspace.

**Authorization.** `GET /me` and command handlers load membership for the verified user. A body `workspace_id` cannot add the caller to another owner’s workspace.

---

## job_allowances

**Purpose.** Lifetime free-job and trial counters for the workspace (SUB02/SUB03). Created atomically with the workspace even though Customer CRUD does not consume slots.

**Classification.** Mutable counters. Slot consumption happens at first publication, not at Customer create.

| Field | Null | Default | Notes |
|---|---|---|---|
| `workspace_id` | NO | | |
| `id` | NO | generated UUID | |
| `free_jobs_consumed` | NO | `0` | |
| `trial_started_at` | YES | | |
| `trial_ends_at` | YES | | |
| `trial_jobs_consumed` | NO | `0` | |
| `retained_bytes` | NO | `0` | |
| `version` | NO | `1` | |
| `created_at` / `updated_at` | NO | `now()` | |
| `created_by` | NO | | |

**Primary key.** `id` plus `UNIQUE (workspace_id, id)`

**Additional uniqueness.** One row per workspace: `UNIQUE (workspace_id)`.

**Foreign keys.** `(workspace_id) → workspaces(id)`

**Indexes.** Unique `workspace_id`.

**RLS.** Same tenant GUC.

Customer commands must not increment these counters.

---

## customers

**Purpose.** Owner-managed contact records. A job chooses one customer as its approval/billing contact (CUS01).

**Classification.** Mutable master data. **Not** a commercial snapshot. Edits do not rewrite published documents.

| Field | Null | Default | Notes |
|---|---|---|---|
| `workspace_id` | NO | | From verified membership |
| `id` | NO | generated UUID | Client UUID allowed after tenant validation (SYNC04) |
| `created_at` | NO | `now()` | |
| `updated_at` | NO | `now()` | |
| `created_by` | NO | | `app_users.id` |
| `name` | NO | | VAL01 1–120, trimmed |
| `email` | YES | | Presentation form, max 254 |
| `normalized_email` | YES | | Lookup form; null iff `email` is null |
| `phone` | YES | | E.164 when supplied and parsable |
| `billing_address_json` | YES | | VAL02 object or null. Not a site address |
| `archived_at` | YES | | Null = active |
| `version` | NO | `1` | |

**Primary key.** `id` with `UNIQUE (workspace_id, id)`

**workspace_id.** NOT NULL. Server-assigned from membership. Client `workspace_id` in a body is ignored or rejected (API03 unknown/forbidden fields).

**Foreign keys.** `(workspace_id) → workspaces(id)`

**Indexes.**

| Index | Unique | Purpose |
|---|---|---|
| `(workspace_id, updated_at DESC, id DESC)` | no | S19 list/pagination (DB03) |
| `(workspace_id, normalized_email)` | **NO** | Duplicate-email detection (DB03, CUS01) |
| Partial `(workspace_id, updated_at DESC, id DESC) WHERE archived_at IS NULL` | no | Optional helper for default active lists |

**Do not create `UNIQUE (workspace_id, normalized_email)`.** CUS01 allows separate named contacts with the same normalized email after confirmation.

**Do not create `UNIQUE (workspace_id, name)`.** Identical names are allowed.

**Version.** Incremented on PATCH and on archive/restore.

**Mutable.** Name, email pair, phone, billing address, `archived_at`, `version`, `updated_at`.

**Immutable.** `id`, `workspace_id`, `created_at` (ordinary CRUD). Published document copies of this data live elsewhere (see snapshot section).

**RLS.** API role, GUC = `workspace_id`. Cross-tenant SELECT returns zero rows → HTTP 404.

**Delete detection.** `DELETE` is allowed only when no `jobs` row exists with the same `(workspace_id, customer_id)`. Prefer a pre-check that returns 409 `CUSTOMER_REFERENCED` rather than leaking a raw FK violation. The composite FK `jobs(workspace_id, customer_id) → customers(workspace_id, id)` is the database backstop (`ON DELETE RESTRICT` / no cascade).

When `document_drafts` / `documents` exist later, they also count as references if they still point at the customer id. Customer v1 launch uses `jobs` as the reference table.

---

## jobs

**Purpose.** One customer and one site (PRD domain). Required now so Customer picker, S19 associated jobs, and referenced-delete are real. Full quote/invoice columns are specified so the table is not a throwaway stub.

**Classification.** Mutable job header. Commercial snapshots are later child tables, not this row’s customer columns.

| Field | Null | Default | Notes |
|---|---|---|---|
| `workspace_id` | NO | | |
| `id` | NO | generated UUID | |
| `customer_id` | NO | | Same-workspace customer |
| `title` | NO | | VAL01 1–120 |
| `site_address_json` | YES | | Distinct from customer billing |
| `no_site` | NO | `false` | Explicit “no site address” |
| `lifecycle` | NO | `'draft'` | `draft` / `active` / `invoiced` / `finished` / `canceled` / `archived` |
| `archived_from_state` | YES | | |
| `current_quote_id` | YES | | Later documents |
| `active_invoice_id` | YES | | Later documents |
| `scope_version` | NO | `0` | |
| `first_published_at` | YES | | |
| `entitlement_origin` | YES | | `free` / `trial` / `paid` after publication |
| `completion_right` | NO | `false` | |
| `internal_notes` | NO | `''` | Never in customer PDFs |
| `related_job_id` | YES | | |
| `version` | NO | `1` | |
| `created_at` / `updated_at` | NO | `now()` | |
| `created_by` | NO | | |

**Primary key.** `id` plus `UNIQUE (workspace_id, id)`

**workspace_id.** NOT NULL, from membership, not from the client as authorization.

**Foreign keys.**

- `(workspace_id) → workspaces(id)`
- `(workspace_id, customer_id) → customers(workspace_id, id)` **RESTRICT**
- `related_job_id` if set: `(workspace_id, related_job_id) → jobs(workspace_id, id)`

Do not FK `customer_id` alone. A same-UUID customer in another workspace must not match.

**Indexes.**

- `(workspace_id, updated_at DESC, id DESC)` list/pagination
- `(workspace_id, lifecycle, updated_at)` (DB03)
- `(workspace_id, customer_id, updated_at DESC, id DESC)` S19 associated jobs / `GET /jobs?customer_id=`

**Version.** Mutable header. After first publication, `customer_id` / site cannot be reset (QA14, `PATCH /jobs/{id}`). Customer feature must not provide a “change customer on published job” path.

**RLS.** Same GUC. Listing jobs for `customer_id` must still be workspace-scoped.

**Customer interaction.**

- New-job picker uses active (`archived_at IS NULL`) customers.
- Archived customers remain on existing jobs.
- Presence of any job row blocks Customer DELETE.

---

## Later snapshots (do not create in CUST-DB-01)

These tables are **not** migrated in the Customer slice. They constrain Customer design now:

### document_drafts (future)

`payload_json` includes `customer_snapshot { name, email?, phone?, billing_address? }`. That object is copied at draft write/publish-preview time. `PATCH /customers/{id}` must not UPDATE `payload_json`.

Explicit “Apply current contact details to draft” (CUS01) copies the live customer into that snapshot via a Quote/draft command only (DEC-CUST-007).

### documents (future)

`snapshot_json` and `canonical_snapshot_bytes` are immutable after issue (INV02, DB04). Customer edits, archive, and delete must never UPDATE those columns. Historical customer details on a published quote/invoice come from the snapshot, not from a live join to `customers`.

### Supporting tables used by the API, not Customer domain

`idempotency_records` and `audit_events` are required by API01 / OPS03 when mutations exist. They are not Customer entities. Specify them at CUST-AUTH-01 / CUST-API-01 implementation time from PRD section 20. `safe_metadata_json` must not store raw emails.

---

## Pagination

Opaque cursors encode `(updated_at, id)` plus a hash of the filter set (search, state, `customer_id`). A cursor from another filter or tenant is 422 or 404 as specified in `docs/API.md` — never a cross-tenant scan.

Default page size 25, max 100 (API02).
