# Team A overlap notes

Purpose: Document work Team A delivered **outside** frozen Customer ownership (S07 / S19 / Customer DB–API–CRUD), so another team can integrate without treating that code as Customer-owned product surface.

**Status:** Reference / historical handoff only.  
**Related:** `docs/CUSTOMER_MODULE_CONTRACT.md` → Customer Module Dependency Boundary.

## DO NOT EXTEND — integration / reference only

Team A ownership is **frozen** to Customer module concerns. Do **not** extend the items below under Customer ownership. Do **not** delete this code while another team cannot access it yet. Do **not** claim Customer-team ownership of these features.

---

## AUTH

**Classification:** SHARED / FINAL MERGE RECONCILIATION REQUIRED  
**INTEGRATION / REFERENCE ONLY — DO NOT EXTEND BY TEAM A.**

### Files involved (illustrative on `build/v1`)

- `apps/mobile/src/providers/AuthProvider.tsx` (and related auth lib under `apps/mobile/src/lib/`)
- `apps/api/src/auth/*` (JWT verifier, owner auth plugin, context)
- OTP / session bootstrap helpers and tests under `apps/mobile/src/lib/*auth*` / `*otp*`

### Why Team A touched them

Customer screens and `/v1/customers*` require a working authenticated session, workspace bootstrap (`GET /v1/me`), and consistent 401 → sign-out behavior.

### Customer integration behavior that must be preserved

- Bearer access token available to Customer controllers
- Genuine `UNAUTHENTICATED` / HTTP 401 triggers existing sign-out policy
- Workspace membership remains **server-derived** (never client `workspace_id` as auth)

### What Team B may replace later

Auth product UX, OTP provider wiring, SecureStore details, and session bootstrap internals — provided the shared token + membership + 401 policy contracts remain for Customer.

---

## S05 — Jobs list (API + Android UI)

**Classification:** TEMPORARY OVERLAP / TEAM-B-OWNED AREA  
**DO NOT EXTEND BY TEAM A — INTEGRATION / REFERENCE ONLY.**  
Final ownership to be reconciled with Team B at the end.

### Files involved (illustrative)

- API: `apps/api/src/routes/jobs.ts` (list + bucket filters), `packages/domain/src/job.ts` / `job-list-cursor.ts`
- Mobile: `apps/mobile/app/(app)/jobs/index.tsx`, Jobs list feature modules under `apps/mobile/src/features/jobs/`
- Commits (illustrative): `3f2423b` Jobs list API; `b507ad7` Jobs list UI

### Why Team A touched them

Needed a customer-scoped jobs read path for Customer Detail associated Jobs (S19) and a general Jobs list for operator shell.

### Customer integration behavior that must be preserved

- `GET /v1/jobs?customer_id={customerId}` returns public Job summaries for that Customer
- Composite FK / referenced-delete protection for Customers remains intact
- Customer Detail must **not** require S05 bucket UI, Jobs list session/controller, or Job Detail routes

### What Team B may replace later

S05 Jobs list UI, bucket presentation, and general list controller/session. Replace freely if the customer-scoped summary contract (and Job public DTO fields Customer Detail shows) stay stable or are versioned with an agreed migration.

---

## S06 — Create Job + Customer picker

**Classification:** TEMPORARY OVERLAP / TEAM-B-OWNED AREA  
**DO NOT EXTEND BY TEAM A — INTEGRATION / REFERENCE ONLY.**  
Final ownership to be reconciled with Team B at the end.

### Files involved (illustrative)

- API: `POST /v1/jobs` in `apps/api/src/routes/jobs.ts`
- Mobile: `apps/mobile/app/(app)/jobs/new.tsx`
- Overlap helper: `apps/mobile/src/features/jobs/customerPicker.ts` (**not** Customer-owned)
- Navigation: `apps/mobile/src/features/jobs/jobRoutes.ts` (overlap); Create Job return selection contract lives in Customer-owned `customerRoutes` (`createJobReturnHrefWithSelectedCustomer`)
- Commits (illustrative): `207b805` create job customer picker; `c1739bc` Android create job verify

### Why Team A touched them

Create Job must bind `customer_id` to an active Customer; picker consumes the Customer active-list contract.

### Customer integration behavior that must be preserved

- Provider contract: `GET /v1/customers?state=active` (+ `Customer.id` / `Customer.name`)
- Archived Customers excluded from new Job binding (`CUSTOMER_ARCHIVED` on create)
- Identity is `customer_id` UUID — never name/email
- Optional return params after create-from-picker: `selectedCustomerId` / `selectedCustomerName`

### What Team B may replace later

Create Job screen, site-address/mode UX, and the `customerPicker` controller under `features/jobs`. Do **not** change the frozen Customer list/create contracts to compensate.

---

## How future teams should treat this

1. Integrate with **Customers** via `docs/CUSTOMER_MODULE_CONTRACT.md`.
2. Treat S05 / S06 / Auth as **existing platform / overlap code** owned elsewhere for product evolution.
3. Do not open PRs that “finish Jobs” or “add Job Detail” under a Customer hardening charter.
4. Customer release gate (`npm run verify:customer`) stays independent of S05/S06 UI tests except minimal shared-contract coverage (active list + customer-scoped jobs + FK delete).
