# Requirements Matrix

Authority: `docs/PRD.md`. Process: `docs/SOP.md` section 14.

Statuses:

| Status | Meaning |
|---|---|
| PENDING | Not implemented. Default for every Customer row in this file. |
| IN PROGRESS | Actively being built. |
| IMPLEMENTED | Code exists but evidence is incomplete. |
| VERIFIED | Implementation exists and credible tests/evidence prove it works. |
| BLOCKED | Cannot complete until a named dependency or product-owner decision lands. |

Only **VERIFIED** counts as complete.

This matrix currently contains the **Customer** implementation family, its prerequisites, and a governance section for planning documents.

Customer behaviour rows remain mostly **PENDING**. CUST-FOUNDATION-01, CUST-AUTH-01, and CUST-DOMAIN-01 are IMPLEMENTED. SUPABASE-DEV-RUNTIME-ROLE-03 verified `app_api_login` on the US development project. CUST-DB-01, **CUST-API-01**–**CUST-API-06**, and **CUST-UI-01**–**CUST-UI-06** are VERIFIED. **R-CUS-31** (jobs↔customer composite FK) is **VERIFIED** on development US (`0004_jobs.sql`). **R-CUS-PRE-05** jobs table/FK is in place; Jobs HTTP create remains CUST-JOB-01 / S06 (**IMPLEMENTED** for DB only; list-by-customer read is in CUST-API-03). **S19** (Customers tab: search/list, create, detail with jobs, archive rather than destructive delete where referenced) is **VERIFIED** (2026-09-21). Create Job is **not** part of S19 — it is S06 / CUST-JOB-01 and remains **PENDING**. S07 create + edit + archive/restore Detail paths are VERIFIED. Live owner OTP (QA01/QA02) remains unverified. CUS01, CUS02 (picker half), and S06 are not complete overall.

Analytics: PRD ANA01 does not define customer CRUD events and forbids customer names/emails/addresses in telemetry. The Analytics column is `none (PRD allowlist)` unless a listed event applies.

---

## Governance (documentation only)

These rows record that planning artifacts exist. They are **not** Customer product VERIFIED.

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-GOV-01 | SOP §8, this pass | `ENGINEERING_CONTRACT.md` exists and names PRD as authority | n/a | n/a | n/a | Document review | VERIFIED |
| R-GOV-02 | ARC01–ARC05 | `docs/ARCHITECTURE.md` records Fastify boundary and tenant context | n/a | n/a | n/a | Document review | VERIFIED |
| R-GOV-03 | DB01–DB03 CUS01 | `docs/DATABASE.md` specifies customers without unique email | n/a | n/a | n/a | Document review | VERIFIED |
| R-GOV-04 | API01–API03 S19 | `docs/API.md` specifies Customer routes including additive GET by id | n/a | n/a | n/a | Document review | VERIFIED |
| R-GOV-05 | SOP §15 | `docs/DECISIONS.md` DEC-CUST-001…008 | n/a | n/a | n/a | Document review | VERIFIED |

---

## Customer

### Core product

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-01 | CUS01 | Identical customer names are allowed inside a workspace | S07, S19, S06 | `customers.name` has no uniqueness constraint | none (PRD allowlist) | Domain + API: two rows, same name | VERIFIED |
| R-CUS-02 | CUS01 DEC-CUST-002 | Duplicate normalized email inside a workspace warns and requires confirmation before creating a separate named contact | S07 | `POST/PATCH /customers`; 409 `DUPLICATE_CUSTOMER_EMAIL`; `confirm_duplicate_email`; non-unique index | none (PRD allowlist) | 409 without confirmation; success with confirmation + new Idempotency-Key; two rows | VERIFIED |
| R-CUS-03 | CUS01 | A job chooses one approval contact (one customer record) | S06 | `jobs.customer_id` composite FK | `job_created` later, no PII | Job create binds one `customer_id` | PENDING |
| R-CUS-04 | CUS01 | Editing customer details affects future drafts only | S07 edit | `PATCH /customers/{id}` updates live row only | none (PRD allowlist) | PATCH updates `customers` only; `app.documents` absent (no snapshot write possible) — memory + live US 2026-09-21; physical Android edit 2026-09-21 (CUST-UI-04) mutates live detail only | VERIFIED |
| R-CUS-05 | CUS01 | Published snapshots retain original customer details | Quote publish / document snapshot | Immutable `documents` / draft `customer_snapshot` | none (PRD allowlist) | Edit customer after publish; snapshot unchanged. Depends on Quote feature | PENDING |
| R-CUS-06 | CUS01 DEC-CUST-007 | Before publication, owner must explicitly Apply current contact details to draft if the draft snapshot is older | S11 (Quote), not S07 | Quote/draft command later. Customer PATCH must not auto-rewrite drafts | none (PRD allowlist) | Deferred to Quote. Customer tests: PATCH does not mutate draft payload | PENDING |
| R-CUS-07 | CUS02 | Archive removes customer from new-job pickers | S06 picker, S19 | `POST /customers/{id}/archive` `{archived:true}`; `archived_at` set | none (PRD allowlist) | Memory + live US 2026-09-21; physical Android Detail Archive 2026-09-21 (Active omits / Archived includes). Picker UX still CUST-JOB-01 | IMPLEMENTED |
| R-CUS-08 | CUS02 | Archived customer's existing jobs and documents remain accessible | S19 detail, S08 | Archive does not cascade or hide jobs | none (PRD allowlist) | Memory + live US 2026-09-21; physical Android 2026-09-21: Jobs section remains visible after Archive (CUST-UI-05) | VERIFIED |
| R-CUS-09 | CUS02 | Unreferenced customers may be deleted | S19 | `DELETE /customers/{id}` | none (PRD allowlist) | Memory + live US 2026-09-21 (CUST-API-06). **PHYSICALLY VERIFIED** Android 2026-09-21 (CUST-UI-06): active `Android Delete Test` and archived `Android Archived Delete Test` deleted; returned to Customers; rows gone | VERIFIED |
| R-CUS-10 | CUS02 DEC-CUST-004 | Referenced customers are not destructively deleted; offer archive; workspace export is EXP01 when built (no customer-scoped export) | S19 | `DELETE` → 409 `CUSTOMER_REFERENCED`; FK prevents DB delete | none (PRD allowlist) | API VERIFIED 2026-09-21 (CUST-API-06). **PHYSICALLY VERIFIED** Android 2026-09-21 (CUST-UI-06): referenced Delete blocked; Customer+Job remain; Archive guidance shown; no auto-archive | VERIFIED |
| R-CUS-11 | CUS02 | Privacy/contact deletion requests do not rewrite historical commercial records | Privacy process; not S19 delete | No historical UPDATE on snapshots | none (PRD allowlist) | Delete/archive path does not mutate issued snapshots | PENDING |

### Screens

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-12 | S06 | Create Job selects a customer; can open customer creation sheet | S06 | `GET /customers`, `POST /customers`, `POST /jobs` | `job_created` when job exists; no customer PII | Picker + in-sheet create + job bind | PENDING |
| R-CUS-13 | S06 | Do not force device Contacts permission | S06, S07 | none | none (PRD allowlist) | Permission not requested in customer flows | VERIFIED |
| R-CUS-14 | S07 | Customer form fields: name, email, optional phone, billing address | S07 | `POST/PATCH /customers` | none (PRD allowlist) | Field contract + validation; physical Android create 2026-09-20; physical Android edit 2026-09-21 (prefill, name-only save, clear email→null) | VERIFIED |
| R-CUS-15 | S07 CUS01 DEC-CUST-002 | Duplicate email warning on the form from server 409, not UI-only | S07 | Duplicate-email API confirmation | none (PRD allowlist) | Warning + confirm; retry with new Idempotency-Key; physical Android create 2026-09-20; physical Android edit Save anyway 2026-09-21 | VERIFIED |
| R-CUS-16 | S07 | Archived customer restore option on the form | S07 | `POST /customers/{id}/archive` `{archived:false}` | none (PRD allowlist) | Restore API VERIFIED 2026-09-21; physical Android Detail Restore 2026-09-21 (CUST-UI-05): badge clears, returns to Active list | VERIFIED |
| R-CUS-17 | S19 | Customers tab: search, list, create | S19 | `GET /customers` search/page | none (PRD allowlist) | Physical Android 2026-09-20: route, Active/Archived/All, search, create. Edit CUST-UI-04; archive/restore CUST-UI-05; delete CUST-UI-06 all VERIFIED 2026-09-21. S19 screen scope complete; Create Job is S06/CUST-JOB-01 (not S19) | VERIFIED |
| R-CUS-18 | S19 DEC-CUST-001 DEC-CUST-006 | Customer detail shows associated jobs via customer GET plus jobs filter | S19 detail | `GET /v1/customers/{id}` and `GET /v1/jobs?customer_id=` | none (PRD allowlist) | API VERIFIED 2026-09-21; physical Android detail 2026-09-21; edit CUST-UI-04; archive/restore Detail + Jobs remain after Archive physical Android 2026-09-21 (CUST-UI-05); populated jobs/pagination/404 automated only | VERIFIED |
| R-CUS-19 | S19 | Archive rather than destructive delete where referenced | S19 | Archive command + DELETE 409 | none (PRD allowlist) | **PHYSICALLY VERIFIED** Android 2026-09-21 (CUST-UI-06): referenced delete blocked on Detail; Job remains; Archive guidance; no auto-delete/archive. **AUTOMATED ONLY:** active Archive CTA / archived no redundant Archive; network/Retry/idempotency/double-submit/404/cache | VERIFIED |
| R-CUS-20 | UI04 | Customer list/detail/form have loading, empty, loaded, refresh failure, offline, access-expired | S07, S19, S06 | API errors 401/5xx; cache later | none (PRD allowlist) | List VERIFIED 2026-09-20; Detail empty-jobs + network failure + Retry physical Android 2026-09-21; Edit form API-off Save + Retry (session kept) physical Android 2026-09-21; offline-cache / access-expired matrix still open | IMPLEMENTED |
| R-CUS-21 | UI01 UI02 UI03 NFR01 | Customer UI uses specified tokens, 44×44 targets, Dynamic Type, VoiceOver labels, light appearance | S07, S19, S06 | none | none (PRD allowlist) | QA61 analogue on Customer screens | PENDING |

### Validation

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-22 | VAL01 | Customer display name 1–120; trim outer whitespace; reject control characters; preserve Unicode | S07 | Shared domain schema + API 422 | none (PRD allowlist) | Unit + API; physical Android required-name block | VERIFIED |
| R-CUS-23 | VAL01 | Email max 254; normalize for lookup without provider-specific dot/plus rewriting; preserve original presentation | S07 | `email` + `normalized_email` | none (PRD allowlist) | `a.b+c@gmail.com` not collapsed to gmail-provider rules | VERIFIED |
| R-CUS-24 | VAL01 | Customer email optional on the record; mandatory later for approval requests; optional for manually shared direct invoices | S07, later S11 | Nullable `email` | none (PRD allowlist) | Create without email succeeds; physical Android minimal create | VERIFIED |
| R-CUS-25 | VAL01 DEC-CUST-003 | Phone optional; E.164 where parsable; unparsable supplied phone blocks save; no country guessing; no raw override | S07 | Domain phone parser | none (PRD allowlist) | No auto `+1`; invalid 422; physical Android invalid-phone block | VERIFIED |
| R-CUS-26 | VAL02 | When billing address is present: US line1 ≤150, line2 optional ≤150, city ≤80, two-letter state, ZIP 5 or ZIP+4 | S07 | `billing_address_json` schema | none (PRD allowlist) | Invalid state/ZIP 422; physical Android partial-address + full-address create | VERIFIED |
| R-CUS-27 | VAL02 | Billing address is distinct from job site address | S06, S07 | Separate `billing_address_json` vs `jobs.site_address_json` | none (PRD allowlist) | Changing billing does not change site | PENDING |
| R-CUS-28 | VAL04 / API03 | Constraints enforced client-side for convenience and server-side for enforcement; unknown fields rejected | S07 | API03 reject extra properties | none (PRD allowlist) | Extra field 422; client validation can be bypassed and server still rejects | IMPLEMENTED |

### Database

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-29 | DB01 DB02 | `customers` table with UUID id, `workspace_id` NOT NULL, `UNIQUE(workspace_id,id)`, timestamps, `created_by`, `version` default 1 | n/a | Migration | none (PRD allowlist) | `0003_customers.sql` + live schema verify | VERIFIED |
| R-CUS-30 | DB02 | Columns: `name`, `email?`, `normalized_email?`, `phone?`, `billing_address_json?`, `archived_at?`, `version` | n/a | Migration + JSON schema validation | none (PRD allowlist) | Live columns; address JSON validated in domain | VERIFIED |
| R-CUS-31 | DB01 | Composite FK from jobs `(workspace_id, customer_id)` to customers; no cascade delete of published financial records | S19 delete | FK without CASCADE | none (PRD allowlist) | Live `0004_jobs.sql` + `jobs.security.test.ts`: cross-workspace FK fail; referenced customer DELETE blocked | VERIFIED |
| R-CUS-32 | DB03 | List index `(workspace_id, updated_at DESC, id DESC)` | S19 | Index | none (PRD allowlist) | Index present on development DB | VERIFIED |
| R-CUS-33 | DB03 CUS01 | Index normalized customer email by workspace; not unique | S07 duplicate warn | Non-unique index | none (PRD allowlist) | Duplicate emails insert; unique constraint absent | VERIFIED |
| R-CUS-34 | DB04 ARC02 | FORCE RLS; API role not owner/superuser/BYPASSRLS; client grants revoked on commercial schema | n/a | RLS + grants | none (PRD allowlist) | `customers.security.test.ts` tenant isolation | VERIFIED |

### API

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-35 | GET /customers API02 API03 | Owner search/filter/page; own records only; cursor pagination default 25 max 100; descending `(updated_at,id)` | S19 | `GET /v1/customers` | none (PRD allowlist) | Pagination, filter, two-tenant isolation | VERIFIED |
| R-CUS-35A | S19 DEC-CUST-001 | Additive owner `GET /v1/customers/{id}`; generic 404; no unrestricted CRUD; no embedded jobs | S19 detail | `GET /v1/customers/{id}` | none (PRD allowlist) | Memory + live US 2026-09-21: 200 public DTO; archived readable; unknown/cross-tenant identical 404; no jobs embed | VERIFIED |
| R-CUS-35B | S19 DEC-CUST-006 | Associated jobs via `GET /v1/jobs?customer_id=`; foreign customer 404 | S19 detail | `GET /v1/jobs` filter | none (PRD allowlist) | Memory + live US 2026-09-21: own empty `items:[]`; foreign/unknown identical 404; cursor pagination; no internal fields | VERIFIED |
| R-CUS-36 | INV08 API03 | Default list hides archived; `state` filter can show archived | S19 | `state=active\|archived\|all` | none (PRD allowlist) | Default omits archived | VERIFIED |
| R-CUS-37 | POST /customers API01 | Create versioned customer; Idempotency-Key required | S07 | `POST /v1/customers` | none (PRD allowlist) | Replay once; mismatch 409 | VERIFIED |
| R-CUS-38 | PATCH /customers/{id} SYNC03 | Mutable contact fields with If-Match; increment version | S07 edit | `PATCH /v1/customers/{id}` | none (PRD allowlist) | Memory + live US 2026-09-21: If-Match required 422; stale 409 VERSION_CONFLICT; version N→N+1; idempotent replay | VERIFIED |
| R-CUS-39 | POST /customers/{id}/archive DEC-CUST-005 | `archived` boolean; referenced records preserved; Idempotency-Key; If-Match not required; version increments on change | S07, S19 | `POST /v1/customers/{id}/archive` | none (PRD allowlist) | Memory + live US 2026-09-21: archive/restore; jobs remain; no If-Match; already-desired-state no version bump; replay; IDEMPOTENCY_MISMATCH; cross-tenant 404 | VERIFIED |
| R-CUS-40 | DELETE /customers/{id} | Unreferenced only; otherwise 409 | S19 | `DELETE /v1/customers/{id}` | none (PRD allowlist) | Memory + live US 2026-09-21: 200 unreferenced; 409 referenced; identical 404 unknown/cross-tenant; Idempotency-Key required; If-Match not required (CUST-API-06) | VERIFIED |
| R-CUS-41 | API01 API02 | JSON envelope `{data,meta}`; errors `{error,meta}`; 401/404/409/422/429 as specified; no stack/SQL/tenant existence | all Customer API | Fastify handlers | none (PRD allowlist) | Error-shape tests | IMPLEMENTED |
| R-CUS-42 | API01 | HTTPS `/v1`; Bearer owner token; client cannot set tenant ownership or `archived_at` via POST/PATCH fields | all Customer API | Schema + AUTHZ | none (PRD allowlist) | Extra ownership fields rejected | IMPLEMENTED |

### Authorization and isolation

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-43 | AUTHZ01 | Every Customer read/mutation derives workspace membership from verified server identity | all Customer API | JWT + memberships + tx tenant context | none (PRD allowlist) | Handler tests with forged workspace_id | IMPLEMENTED |
| R-CUS-44 | AUTHZ01 | Client-provided `workspace_id` is not authorization | POST/PATCH bodies | Ignored/rejected; membership wins | none (PRD allowlist) | Body workspace of tenant B cannot insert into B | IMPLEMENTED |
| R-CUS-45 | AUTHZ01 SEC02 QA03 | Cross-tenant customer object references return generic 404; no data in API, storage, or logs | GET/PATCH/archive/DELETE, job bind | 404 generic | none (PRD allowlist) | GET customer + jobs filter: QA03 proven 2026-09-21 (CUST-API-03). PATCH cross-tenant identical 404 proven 2026-09-21 (CUST-API-04). Archive/restore cross-tenant identical 404 proven 2026-09-21 (CUST-API-05). DELETE cross-tenant identical 404 (never CUSTOMER_REFERENCED) proven 2026-09-21 (CUST-API-06) | VERIFIED |
| R-CUS-46 | ARC03 | Tenant context is transaction-local and cannot leak across pooled connections | API | Context set/clear per tx | none (PRD allowlist) | Pool reuse test | PENDING |
| R-CUS-47 | ACC02 | Suspended/deleting owner cannot mutate customers | API | Account status on every mutation | none (PRD allowlist) | Suspended PATCH 401/403 per account-status rules | PENDING |
| R-CUS-48 | Roles | Only business owner manages customers; recipient/support cannot use owner Customer routes | API | Owner authz | none (PRD allowlist) | Recipient token cannot GET /customers | PENDING |

### Offline, sync, cache

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-49 | SYNC01 | Encrypted per-owner SQLite before storing customer records on device; no plaintext fallback | S19/S07 cache | n/a local | none (PRD allowlist) | Encryption spike evidence | PENDING |
| R-CUS-50 | SYNC04 | Sync order includes customer before job | Create job offline/online | operation queue | none (PRD allowlist) | Job sync waits on customer id | PENDING |
| R-CUS-51 | SYNC03 QA08 | Customer mutations use version + operation_id; replay is idempotent; no last-write-wins on contact fields | S07, S23 later | If-Match, idempotency_records | `sync_conflict` if conflict, `resource_kind` only | Replay 20×; conflict preserves both copies | PENDING |
| R-CUS-52 | SYNC05 DEC10 | Archive/delete/restore are not auto-issued from the offline queue | S19 | Live command | none (PRD allowlist) | Reconnect does not fire queued delete | PENDING |
| R-CUS-53 | ACC02 UI04 | Offline cached read for up to seven days since last successful auth; access-expired thereafter | S19 | Cached rows + auth timestamp | none (PRD allowlist) | Expired cache requires sign-in | PENDING |
| R-CUS-54 | SYNC06 | Account switch locks/wipes previous customer cache after unsynced confirmation | Settings sign-out / switch | Local DB | none (PRD allowlist) | Owner B cannot see Owner A cache | PENDING |
| R-CUS-55 | NFR05 QA06 | Never show zero customers as a successful server result when the database/API is unavailable | S19 | Error vs empty distinction | none (PRD allowlist) | Physical Android 2026-09-20: API-off filter → retryable error (not empty success); session kept; Retry restores list | VERIFIED |

### Security / QA involving customers

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-56 | QA03 | Two owners request each other's customer IDs: 404, no leakage | API | AUTHZ01 | none (PRD allowlist) | QA03 automated | PENDING |
| R-CUS-57 | QA14 | Cannot reset customer of a published job; new job required | S06/S08 later | `PATCH /jobs/{id}` customer only before publication | none (PRD allowlist) | Depends on publish; Customer picker must not rewrite published jobs | PENDING |
| R-CUS-58 | QA15 INV05 | Issued documents unchanged when customer live record changes | Documents | Snapshots immutable | none (PRD allowlist) | Depends on publish feature | PENDING |
| R-CUS-59 | QA55 | Unicode customer names display correctly | S07 S19 | UTF-8 JSON | none (PRD allowlist) | Unicode round-trip | PENDING |
| R-CUS-60 | SEC04 ANA01 OPS03 QA63 | No real customer samples in source; no names/emails in analytics, logs, or error reports | telemetry/logs | redaction | none (PRD allowlist) | Secret/PII scan; log fixtures | PENDING |
| R-CUS-61 | SEC07 OPS02 | Database isolation tests and API authorization tests run in CI | CI | isolation suite | none (PRD allowlist) | CI gate | PENDING |

---

## Prerequisites for Customer (not Customer UI)

These are required for Customer to be production-correct. They are not a complete Auth or Jobs matrix. Only **VERIFIED** counts as complete.

| ID | PRD | Requirement | Screen/Flow | Backend | Analytics | Tests | Status |
|---|---|---|---|---|---|---|---|
| R-CUS-PRE-01 | ARC01 ARC05 DEL01 | TypeScript monorepo with `apps/mobile`, `apps/api` Fastify, `packages/domain`; mobile does not write commercial rows via Supabase REST | n/a | API process | none | Boot/typecheck | IMPLEMENTED |
| R-CUS-PRE-02 | ACC01 S02 S03 QA01 QA02 | Owner email OTP auth; generic responses; secure session | S02 S03 | Supabase Auth + `GET /me` | `signup_verified` when bootstrap exists | QA01 QA02 | IMPLEMENTED |
| R-CUS-PRE-03 | DEC04 POST /workspace | Exactly one workspace and active owner membership, created atomically | S04 minimum | `workspaces`, `memberships` | `onboarding_completed` later | Second workspace rejected | IMPLEMENTED |
| R-CUS-PRE-04 | AUTHZ01 ARC02 ARC03 | JWT verified; tenant context from membership; FORCE RLS | API kernel | private schema | none | Live FORCE RLS + tx-local GUC + forged workspace_id ignored (auth/workspace only) | IMPLEMENTED |
| R-CUS-PRE-05 | POST /jobs DB02 jobs | Minimum jobs table and create/list so Customer picker, associated jobs, and referenced-delete are real | S06, S19 | `jobs.customer_id` | `job_created` | Table+FK+RLS live (`0004_jobs.sql`, `jobs.security.test.ts`); Jobs HTTP create/list deferred to CUST-JOB-01 | IMPLEMENTED |
| R-CUS-PRE-06 | OPS01 ACC01 ACC02 DB04 DEC-AUTH-003 | Hosted development Supabase project; CLI 2.117.0; applied 0001/0002; `app_api_login`; live JWKS/OTP | n/a | development project only | none | Live `dev-db.security.test.ts` (role/RLS/GUC/JWKS); OTP mailbox still unverified | VERIFIED |

---

## Trace to vertical slices

See `docs/CUSTOMER_FEATURE_PLAN.md`.

| Slice | Matrix IDs (primary) |
|---|---|
| CUST-FOUNDATION-01 | R-CUS-PRE-01, R-CUS-20 (shared primitives), R-CUS-21 (tokens) |
| CUST-AUTH-01 | R-CUS-PRE-02, R-CUS-PRE-03, R-CUS-PRE-04, R-CUS-43, R-CUS-47 |
| CUST-DOMAIN-01 | R-CUS-01, R-CUS-02, R-CUS-22–R-CUS-28 |
| SUPABASE-DEV-SETUP-01 | R-CUS-PRE-06 |
| SUPABASE-DEV-LINK-02 | R-CUS-PRE-06 |
| SUPABASE-DEV-RUNTIME-ROLE-03 | R-CUS-PRE-06, R-CUS-PRE-04 (infra) |
| CUST-DB-01 | R-CUS-29–R-CUS-34, R-CUS-PRE-05 (table) |
| CUST-API-01 | R-CUS-37, R-CUS-01, R-CUS-02, R-CUS-41, R-CUS-42 |
| CUST-UI-01 | R-CUS-14, R-CUS-15, R-CUS-22–R-CUS-26 |
| CUST-API-02 | R-CUS-35, R-CUS-36 |
| CUST-UI-02 | R-CUS-17, R-CUS-20 |
| CUST-API-03 | R-CUS-18, R-CUS-35A, R-CUS-35B, R-CUS-45 |
| CUST-UI-03 | R-CUS-18, R-CUS-08 |
| CUST-API-04 | R-CUS-04, R-CUS-38 |
| CUST-UI-04 | R-CUS-04, R-CUS-14 |
| CUST-API-05 | R-CUS-07, R-CUS-39 |
| CUST-UI-05 | R-CUS-16, R-CUS-07 |
| CUST-API-06 | R-CUS-09, R-CUS-10, R-CUS-40 |
| CUST-UI-06 | R-CUS-10, R-CUS-19 |
| CUST-JOB-01 | R-CUS-03, R-CUS-12, R-CUS-13, R-CUS-PRE-05 |
| CUST-SYNC-01 | R-CUS-49–R-CUS-55, R-CUS-51 |
| CUST-SEC-01 | R-CUS-43–R-CUS-48, R-CUS-56, R-CUS-60, R-CUS-61 |
| CUST-QA-01 | Entire Customer section; R-CUS-05, R-CUS-06, R-CUS-57, R-CUS-58 stay PENDING until Quote/publish exists |
