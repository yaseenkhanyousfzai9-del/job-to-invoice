# Customer Handoff Checklist

Status: **FINAL Team A Customer handoff**  
Branch: `build/v1`  
Authority: `docs/PRD.md`, `docs/API.md`, `docs/DATABASE.md`, `docs/CUSTOMER_MODULE_CONTRACT.md`  
Related: `docs/CUSTOMER_BASELINE_MANIFEST.md`, `docs/TEAM_A_OVERLAP_NOTES.md`

Use this checklist during the final Team A + Team B merge to prove the Customer module survived integration **unchanged**.

---

## A. TEAM A OWNERSHIP

Team A owns and freezes:

| Area | Notes |
|---|---|
| **S07 Customer Form** | Create / edit forms; duplicate-email confirm; validation UX |
| **S19 Customers** | List, search, filters (Active / Archived / All), detail, archive, delete |
| **Customer DB/schema** | `app.customers` (`0003_customers.sql`) |
| **Customer RLS** | `ENABLE` + `FORCE ROW LEVEL SECURITY`; tenant policy on `app.workspace_id` GUC |
| **Customer validation** | Domain parsers in `packages/domain` (`customer.ts`, address/email/phone) |
| **Customer CRUD** | List / create / detail / patch |
| **Customer edit/versioning** | `PATCH` + required `If-Match` / `version`; `VERSION_CONFLICT` |
| **Customer archive/restore** | `POST …/archive` with `{ archived: true \| false }` |
| **Customer safe delete** | Unreferenced delete; referenced → `CUSTOMER_REFERENCED` |
| **Customer public DTO** | Nine public fields only (section D) |
| **Customer→Job contract** | `Customer.id` → `Job.customer_id`; composite FK; customer-scoped jobs read |

---

## B. TEAM A NON-OWNERSHIP

Team A does **NOT** own the final implementation of:

- **Auth** (shared / final merge reconciliation required)
- **S05 Jobs** list
- **S06 Create Job**
- **S08+** (Job Detail and later Job slices)
- **Quotes**
- **Invoices**
- **Ledger**
- **Settings**
- **Approval portal**

See `docs/TEAM_A_OVERLAP_NOTES.md` for overlap files and what must be preserved vs replaceable.

---

## C. FINAL CUSTOMER API CONTRACT

| Method | Path |
|---|---|
| `GET` | `/v1/customers` |
| `POST` | `/v1/customers` |
| `GET` | `/v1/customers/{id}` |
| `PATCH` | `/v1/customers/{id}` |
| `POST` | `/v1/customers/{id}/archive` |
| `DELETE` | `/v1/customers/{id}` |

Full request/response rules: `docs/CUSTOMER_MODULE_CONTRACT.md`, `docs/API.md`.

Associated jobs are **not** embedded on Customer detail. Consumers use:

`GET /v1/jobs?customer_id={customerId}`

(shared Job summary contract; not Customer route ownership).

---

## D. FINAL CUSTOMER DTO

### Public fields (must appear on success resources)

| Field |
|---|
| `id` |
| `name` |
| `email` |
| `phone` |
| `billing_address` |
| `archived_at` |
| `version` |
| `created_at` |
| `updated_at` |

### Internal fields (MUST NOT appear on public Customer responses)

| Field |
|---|
| `workspace_id` |
| `normalized_email` |
| `created_by` |

`DELETE` success payload is `{ "deleted": true }` (not a Customer DTO).  
List envelope: `{ "items": Customer[], "next_cursor": string | null }`.

---

## E. FINAL CUSTOMER ERROR CONTRACT

| Code | Typical HTTP | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing/invalid Bearer |
| `VALIDATION_FAILED` | 422 | Bad body/query/headers (incl. missing Idempotency-Key / If-Match where required) |
| `NOT_FOUND` | 404 | Unknown or cross-tenant Customer (generic; no existence oracle) |
| `DUPLICATE_CUSTOMER_EMAIL` | 409 | Same-workspace normalized email collision without confirmation |
| `VERSION_CONFLICT` | 409 | Stale `If-Match` on PATCH; `details.server` = current public Customer |
| `IDEMPOTENCY_MISMATCH` | 409 | Same Idempotency-Key, different payload |
| `CUSTOMER_REFERENCED` | 409 | DELETE while any Job references the Customer |

Also documented on the frozen contract (not Customer CRUD UI-primary): `WORKSPACE_REQUIRED` (409) when create runs without a workspace. Job create may return `CUSTOMER_ARCHIVED` — that is a **Job** error, not a Customer CRUD public error.

---

## F. CUSTOMER→JOB CONTRACT

Identity:

- `Customer.id` (UUID)
- → `Job.customer_id` (UUID)

Never identify a Customer by name or email for Job binding.

Composite FK (defense in depth + API pre-check):

```text
(workspace_id, customer_id) → customers(workspace_id, id)
ON DELETE RESTRICT
```

Defined in `supabase/migrations/0004_jobs.sql` (`jobs_customer_same_workspace`).

Customer Detail associated Jobs:

- `GET /v1/jobs?customer_id={id}` → public `JobSummary` rows
- Must not require S05 Jobs list UI/controller or Job Detail routes

---

## G. ARCHIVE / DELETE RULES

### Archive

- Hidden from **Active** list (`state=active` default)
- Excluded from New Job picker (`state=active` only; Job create rejects archived with `CUSTOMER_ARCHIVED`)
- Still readable by id (`GET /v1/customers/{id}`)
- Existing Jobs remain accessible / preserved (no cascade)

Restore: same archive route with `{ archived: false }`.

### Delete

- **Unreferenced** → allowed (`200` + `{ deleted: true }`)
- **Referenced** (any Job in workspace) → `409 CUSTOMER_REFERENCED`; row and Jobs remain
- **No auto-delete** of Jobs or commercial history
- **No auto-archive** on failed delete
- UI guidance: offer **Archive** when referenced

---

## FINAL MERGE ACCEPTANCE CHECKS

The future integration must prove:

1. Customer create still works  
2. Customer duplicate warning still works  
3. Customer list/search still works  
4. Active/Archived/All still work  
5. Customer detail still works  
6. Customer edit still works  
7. `VERSION_CONFLICT` still works  
8. Archive still works  
9. Restore still works  
10. Unreferenced delete still works  
11. Referenced delete still blocks  
12. Cross-tenant read remains generic 404  
13. Cross-tenant mutation remains generic 404  
14. Customer→Job FK remains valid  
15. Archived Customer not offered in Create Job  
16. Customer Detail jobs still load  
17. Customer public DTO has no internal fields  
18. Customer release gate passes  

**Command:**

```bash
npm run verify:customer
```

Optional live smoke (Development US only, never production):

```bash
npm run test:customer-release-gate:live -w @job-to-invoice/api
```

Expect serialized `--test-concurrency=1`. Treat `CONNECT_TIMEOUT` / JWKS reachability failures as infrastructure flakes (retry that file only), not Customer product failures.

---

## TEAM A FREEZE NOTICE

**Team A Customer feature development is complete.**

Until final merge:

### Allowed

- Customer bug fixes  
- Customer security fixes  
- Customer test fixes  
- Customer documentation fixes  

### Not allowed

- New Customer product features  
- S05 / S06 expansion under Customer ownership  
- Quote / Invoice / Ledger / Approvals / Settings work under this charter  
- Integration merge work (`integration/v1`, merging Team B, modifying `main`)  

Any Customer **contract** change must be explicitly justified by:

- a PRD defect, or  
- a security defect, or  
- a proven Customer bug  

Module status remains: **COMPLETE / FROZEN / INTEGRATION-READY**.
