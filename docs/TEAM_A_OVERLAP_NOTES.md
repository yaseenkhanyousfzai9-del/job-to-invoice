# Team A overlap notes

Purpose: Document work Team A delivered **outside** frozen Customer ownership (S07 / S19 / Customer DB–API–CRUD), so another team can integrate without treating that code as Customer-owned product surface.

**Status:** Reference / historical handoff only.

## DO NOT EXTEND — integration / reference only

Team A ownership is **frozen** to Customer module concerns. Do **not** extend the items below under Customer ownership. Do **not** delete this code while another team cannot access it yet. Do **not** claim Customer-team ownership of these features.

---

## Auth / session fixes (supporting Customers)

**INTEGRATION / REFERENCE ONLY — DO NOT EXTEND BY TEAM A.**

Delivered earlier so Customer screens could authenticate and recover safely (OTP, session bootstrap, 401 handling). These remain shared platform concerns — not Customer feature ownership. Final ownership to be reconciled with Team B at the end.

Examples on `build/v1`: session / OTP verify gates, mobile auth error mapping, SecureStore session helpers.

---

## S05 Jobs list (API + Android UI)

**DO NOT EXTEND BY TEAM A — INTEGRATION / REFERENCE ONLY.**  
Final ownership to be reconciled with Team B at the end.

| Slice | Commit (illustrative) | Status |
|---|---|---|
| Jobs list API (`GET /v1/jobs`, `bucket`, search, customer summary DTO) | `3f2423b` `feat: add jobs list API` | API **VERIFIED** |
| Jobs list Android UI | `b507ad7` `feat: add jobs list UI` | UI **IMPLEMENTED** (awaiting physical) |

Consume via documented Jobs / DEC-JOB-001 contracts if needed for Customer Detail associated jobs only (`GET /v1/jobs?customer_id=`).

---

## S06 Create Job + Customer picker

**DO NOT EXTEND BY TEAM A — INTEGRATION / REFERENCE ONLY.**  
Final ownership to be reconciled with Team B at the end.

| Slice | Notes | Status |
|---|---|---|
| Create Job API `POST /v1/jobs` | Customer FK binding; archived Customer blocked | **VERIFIED** |
| Android Create Job + active Customer picker | Route `/(app)/jobs/new` | **VERIFIED** physical |

Customer module only guarantees:

- active list for picker
- archive excludes from picker
- `customer_id` identity
- referenced delete / archive rules

Job create UX, site address, quote vs direct invoice modes are **not** Customer-owned.

---

## How future teams should treat this

1. Integrate with **Customers** via `docs/CUSTOMER_MODULE_CONTRACT.md`.
2. Treat S05 / S06 / auth as **existing platform code** owned elsewhere for product evolution.
3. Do not open PRs that “finish Jobs” or “add Job Detail” under a Customer hardening charter.
