# Customer Baseline Manifest

Canonical Team A Customer baseline for later merge comparison against an integrated tree.

**Do not treat this as authorization to change Customer product behavior.**

---

## Branch / commits

| Item | Value |
|---|---|
| **TEAM A BRANCH** | `build/v1` |
| **PRE-TASK HEAD** | `8ad1d3e` — `test: harden customer module boundaries` |
| **HANDOFF COMMIT** | `docs: finalize customer module handoff` (tip of `build/v1` after this handoff lands) |

Confirm tip after pull:

```bash
git rev-parse --short HEAD
git log -3 --oneline
```

---

## Authoritative documents

| Role | Path |
|---|---|
| **CUSTOMER CONTRACT DOC** | `docs/CUSTOMER_MODULE_CONTRACT.md` |
| **OVERLAP NOTES** | `docs/TEAM_A_OVERLAP_NOTES.md` |
| **HANDOFF CHECKLIST** | `docs/CUSTOMER_HANDOFF_CHECKLIST.md` |
| **THIS MANIFEST** | `docs/CUSTOMER_BASELINE_MANIFEST.md` |
| Product / API / DB | `docs/PRD.md`, `docs/API.md`, `docs/DATABASE.md` |
| Requirements | `docs/REQUIREMENTS_MATRIX.md` |
| Feature plan | `docs/CUSTOMER_FEATURE_PLAN.md` |

---

## RELEASE COMMAND

```bash
npm run verify:customer
```

Composition (root `package.json`):

1. `npm run test:customer-release-gate -w @job-to-invoice/api`  
   - `customers.release-gate.test.ts`  
   - `customers.error-contract.test.ts`  
   - `customers.fixture-cleanup.test.ts`  
   - `customers.boundary.test.ts`  
2. `npm run test:customer -w @job-to-invoice/mobile`  
   - Customer feature unit/regression tests under `apps/mobile/src/features/customers/`

Broader Customer API suite (not required for the release gate, but Customer-owned):

```bash
npm run test:customer -w @job-to-invoice/api
```

### Live tests (Development US only)

Project: **Job to Invoice - Development US**  
Project ref: `vlpjaamdjtmtqtpwbhzq`  
Never production. Never Tokyo.

```bash
npm run test:customer-release-gate:live -w @job-to-invoice/api
```

- Serialized: `--test-concurrency=1`
- Fixture cleanup: exact IDs / disposable owner auth (`customerLiveFixtures.ts`)
- Infra flakes: `CONNECT_TIMEOUT`, JWKS reachability → retry **that file only**; do not weaken RLS/pool settings

Do **not** store secrets, JWTs, or connection strings in this document.

---

## Customer-owned migrations

| Migration | Responsibility |
|---|---|
| `supabase/migrations/0003_customers.sql` | `app.customers` table, indexes, RLS ENABLE + FORCE, `customers_tenant` policy, grants to `app_api`, revoke from `anon`/`authenticated` |
| `supabase/migrations/0004_jobs.sql` | **Dependency used by Customer module:** composite FK `jobs_customer_same_workspace` — `(workspace_id, customer_id) → customers(workspace_id, id) ON DELETE RESTRICT`; jobs RLS ENABLE + FORCE |

Prerequisite platform migrations (not Customer feature ownership, but required baseline):

- `0001_auth_workspace.sql` — workspaces / membership / app users  
- `0002_app_api_login.sql` — `app_api_login` role  

**Do not renumber migrations. Do not invent new Customer migrations for handoff.**

### RLS invariants (Customer)

- `ALTER TABLE app.customers ENABLE ROW LEVEL SECURITY`
- `ALTER TABLE app.customers FORCE ROW LEVEL SECURITY`
- Policy `customers_tenant`: `workspace_id::text = current_setting('app.workspace_id', true)`
- Server sets workspace GUC from verified membership — clients never authorize via `workspace_id`

---

## Domain files (Customer-owned)

| Path | Notes |
|---|---|
| `packages/domain/src/customer.ts` | Public DTO types, parsers, Customer error helpers |
| `packages/domain/src/customer-list-cursor.ts` | Opaque list cursor |
| `packages/domain/src/customer.test.ts` | Domain unit tests |
| `packages/domain/src/customer-list-cursor.test.ts` | Cursor unit tests |
| Shared used by Customer (not exclusively owned) | `address.ts`, `email.ts`, `phone.ts`, `errors.ts`, `text.ts`, `ids.ts` |

Job-owned types Customer **consumes** only: `packages/domain/src/job.ts` (`JobSummary`, `customer_id` binding rules).

---

## API route / data-access baseline

| Concern | Location |
|---|---|
| **Route registration** | `apps/api/src/app.ts` → `registerCustomersRoute` |
| **Route file** | `apps/api/src/routes/customers.ts` |
| **Store interface** | `apps/api/src/store/types.ts` (`createCustomer`, `updateCustomer`, `archiveCustomer`, `deleteCustomer`, `listCustomers`, …) |
| **Memory store** | `apps/api/src/store/memory.ts` |
| **Postgres store** | `apps/api/src/store/postgres.ts` |
| **Domain validation** | `packages/domain/src/customer.ts` (+ address/email/phone) |
| **Error codes** | Domain helpers (`DUPLICATE_CUSTOMER_EMAIL`, `CUSTOMER_REFERENCED`, …) + `apps/api/src/errors.ts` / envelope |
| **Auth plugin (shared)** | `apps/api/src/auth/plugin.ts`, `apps/api/src/auth/jwt.ts`, `apps/api/src/auth/context.ts` |

Customer routes must remain independently registered from Quote/Invoice routes. Jobs routes are separate; Customer Detail depends only on the shared `customer_id` list contract.

---

## Mobile route baseline (Customer-owned)

| Route | File | Responsibility | Owned by Customer? |
|---|---|---|---|
| `/(app)/customers` | `apps/mobile/app/(app)/customers/index.tsx` | List / search / Active·Archived·All | **Yes** |
| `/(app)/customers/new` | `apps/mobile/app/(app)/customers/new.tsx` | Create Customer | **Yes** |
| `/(app)/customers/[id]` | `apps/mobile/app/(app)/customers/[id]/index.tsx` | Detail + associated Jobs summaries | **Yes** |
| `/(app)/customers/[id]/edit` | `apps/mobile/app/(app)/customers/[id]/edit.tsx` | Edit Customer | **Yes** |

Layouts:

- `apps/mobile/app/(app)/customers/_layout.tsx`
- `apps/mobile/app/(app)/customers/[id]/_layout.tsx`

Feature modules: `apps/mobile/src/features/customers/*`  
Navigation helpers: `customerRoutes.ts` (includes documented Create Job **return** param contract only — not S06 ownership).

**Not Customer-owned:** `/(app)/jobs`, `/(app)/jobs/new`, Job Detail, Quotes, Invoices.

---

## Test suites (Customer-owned / release-relevant)

### API

- `customers.create|list|detail|update|archive|delete` (+ `.live`)  
- `customers.security.test.ts`  
- `customers.contract.test.ts`  
- `customers.release-gate(.live).test.ts`  
- `customers.error-contract(.live).test.ts`  
- `customers.fixture-cleanup.test.ts`  
- `customers.boundary.test.ts`  
- Helpers: `test-helpers/customerFixtures.ts`, `test-helpers/customerLiveFixtures.ts`

### Mobile

- `apps/mobile/src/features/customers/*.test.ts` (including `customerBoundary.test.ts`)
- Script: `npm run test:customer -w @job-to-invoice/mobile`

---

## Final security baseline

| Invariant | Required |
|---|---|
| RLS enabled on `app.customers` | Yes |
| FORCE RLS on `app.customers` | Yes |
| Server-derived workspace authority (Bearer → membership) | Yes |
| Generic cross-tenant 404 (read + mutate) | Yes |
| Composite Customer→Job FK + `ON DELETE RESTRICT` | Yes |
| No internal DTO fields on public Customer responses | Yes |
| No UNIQUE on `normalized_email` | Yes (CUS01) |

No new security behavior is introduced by this handoff documentation.

---

## Merge comparison tip

When integrating Team B:

1. Diff Customer-owned paths listed above against this baseline.  
2. Run `npm run verify:customer`.  
3. Walk `docs/CUSTOMER_HANDOFF_CHECKLIST.md` → FINAL MERGE ACCEPTANCE CHECKS.  
4. Treat Auth / S05 / S06 diffs as overlap reconciliation — not Customer contract changes — per `docs/TEAM_A_OVERLAP_NOTES.md`.
