# Decisions

Authority: PRD. This log records engineering decisions where the PRD already supplies direction or where an additive contract is required to implement a listed screen without changing product behaviour.

SOP §15: escalate only ambiguities that materially affect business model, pricing, legal requirements, fundamental UX, security, architecture, or irreversible implementation. The seven items below are not product-owner blockers.

Do not treat this file as permission to invent unrelated product scope.

Date format: ISO date. Status values: ACCEPTED.

---

## DEC-CUST-001

**ID:** DEC-CUST-001  
**Date:** 2026-09-17  
**Question:** The PRD endpoint inventory lists `GET /customers` (list) but not `GET /customers/{id}`. How does S19 Customer Detail load a single record?  
**Decision:** Add `GET /v1/customers/{id}` as a narrow owner read. Authenticated owner only. Workspace-scoped. Unknown or cross-tenant id returns generic 404. Response is the Customer resource (including `archived_at` and `version`). Do not expose unrestricted table CRUD and do not embed the full jobs collection on this resource.  
**PRD evidence:** Section 22: the inventory is “the minimum implementation contract, not permission to expose raw CRUD on immutable tables.” S19 requires search/list, create, and customer detail with jobs. AUTHZ01 generic 404.  
**Reason:** Paginated list payloads cannot be the only correct way to open detail (cursors, archived-hidden defaults, stale pages). An additive owner GET is the smallest safe read. Jobs are loaded separately (DEC-CUST-006) so the Customer resource stays a contact record.  
**Requirements affected:** S19, AUTHZ01, QA03, CUST-API-03, CUST-UI-03  
**Reversible:** Yes (could later collapse into a list filter; behaviour must remain owner-scoped 404).  
**Migration/API implication:** OpenAPI path `GET /v1/customers/{id}`. No schema change.  
**Status:** ACCEPTED

---

## DEC-CUST-002

**ID:** DEC-CUST-002  
**Date:** 2026-09-17  
**Question:** How is CUS01 duplicate normalized-email warning plus confirmed second contact enforced?  
**Decision:** Server-enforced confirmation, not UI-only. `POST /v1/customers` and email-changing `PATCH /v1/customers/{id}` accept `confirm_duplicate_email` (default false). If a same-workspace `normalized_email` match exists and the flag is not true, return 409 `DUPLICATE_CUSTOMER_EMAIL` with safe same-workspace metadata (`duplicates: [{ id, name }]` only). After explicit UI confirmation, the client retries with a **new** Idempotency-Key and `confirm_duplicate_email: true`. The server rechecks, then inserts or updates. No unique database constraint on `(workspace_id, normalized_email)`. Index that pair for lookup only. No cross-workspace metadata.  
**PRD evidence:** CUS01; DB03 “index normalized customer email by workspace” (not unique); API01 idempotency mismatch if the same key is reused with a different body; API02 409 for state conflict.  
**Reason:** A unique constraint would violate CUS01. A UI-only warning would allow API clients to skip the warning. 409 (not 422) matches “state conflict requiring a deliberate retry.” A new Idempotency-Key is required because the confirmed body differs.  
**Requirements affected:** CUS01, S07, VAL01, DB03, POST/PATCH `/customers`, R-CUS-02  
**Reversible:** Yes (error code/metadata shape), not the confirmation requirement.  
**Migration/API implication:** Non-unique index only. Additive request field and error code.  
**Status:** ACCEPTED

---

## DEC-CUST-003

**ID:** DEC-CUST-003  
**Date:** 2026-09-17  
**Question:** If a supplied phone cannot be parsed to E.164, may it be stored raw after a warning?  
**Decision:** No. Phone is optional. If omitted or null, save proceeds. If supplied, parse to E.164 where valid. If it cannot be parsed without guessing country (including assuming `+1`), block save with 422 `VALIDATION_FAILED` on `phone` until the value is corrected or removed. Do not add a raw-phone override.  
**PRD evidence:** VAL01: “Phone optional, E.164 where parsable, otherwise show validation rather than guessing country.”  
**Reason:** This is a stated validation rule, not a product-owner gap. Guessing US country code would violate VAL01 even though v1 is a US storefront.  
**Requirements affected:** VAL01, S07, CUST-DOMAIN-01, POST/PATCH `/customers`  
**Reversible:** No without a PRD change.  
**Migration/API implication:** `customers.phone` stores E.164 or null only.  
**Status:** ACCEPTED

---

## DEC-CUST-004

**ID:** DEC-CUST-004  
**Date:** 2026-09-17  
**Question:** CUS02 says offer archive and export when a referenced customer cannot be deleted. Is a customer-scoped export required?  
**Decision:** Do not invent a Customer-scoped export. `DELETE /v1/customers/{id}` returns 409 `CUSTOMER_REFERENCED`. UI offers Archive Customer. Workspace export is EXP01 (`POST /exports`) from Settings when that feature exists. Until EXP01 is implemented, Archive is available; Export must not be shown as a working Customer action (development may label it unavailable). No new endpoint.  
**PRD evidence:** CUS02; section 22 has no customer export route; EXP01 is workspace ZIP including `customers.csv`; S24 is Settings export.  
**Reason:** Expanding scope with a new export would contradict the inventory and Settings-owned export flow. Archive already preserves referenced history.  
**Requirements affected:** CUS02, S19, CUST-API-06, CUST-UI-06, EXP01 (dependency)  
**Reversible:** Yes if product later specifies a customer-scoped export.  
**Migration/API implication:** 409 code only. No export tables for Customer.  
**Status:** ACCEPTED

---

## DEC-CUST-005

**ID:** DEC-CUST-005  
**Date:** 2026-09-17  
**Question:** Does `POST /customers/{id}/archive` require `If-Match`?  
**Decision:** Require `Idempotency-Key` (API01). Do not require `If-Match` on archive/restore. The command re-reads the row inside the transaction, applies `archived` boolean, and is idempotent when the desired state already holds. When `archived_at` actually changes, increment `version` so a concurrent `PATCH` with a stale If-Match receives 409 `VERSION_CONFLICT`.  
**PRD evidence:** API01: Idempotency-Key on state-changing commands; If-Match called out for draft PATCH. Inventory: PATCH customers uses If-Match; archive is POST with `archived` boolean. SYNC03 versions mutable rows and requires If-Match on PATCH.  
**Reason:** Inventing mandatory If-Match on a POST command is not in the inventory. Lost updates on contact fields remain protected because archive bumps `version`. Two devices toggling archive serialize on the row.  
**Requirements affected:** CUS02, SYNC03, `POST /customers/{id}/archive`, CUST-API-05  
**Reversible:** Yes; If-Match could be added later if two-device archive races prove harmful.  
**Migration/API implication:** No If-Match header on archive. Version column still incremented on change.  
**Status:** ACCEPTED

---

## DEC-CUST-006

**ID:** DEC-CUST-006  
**Date:** 2026-09-17  
**Question:** How does S19 load jobs associated with a customer?  
**Decision:** Do not embed all jobs in the Customer record. Use `GET /v1/customers/{id}` for the contact, and `GET /v1/jobs?customer_id={customer_id}` as a workspace-scoped filter on the existing jobs list contract. If `customer_id` is not in the caller’s workspace, return generic 404 (not an empty list). Jobs remain in the `jobs` table with composite FK to `customers`. No Customer-owned jobs datastore.  
**PRD evidence:** S19 “customer detail with jobs”; `GET /jobs` “Search, state, archive filter, page”; API03 common query `cursor?,limit?,search?,state?` (filters may be extended); jobs schema `customer_id`; AUTHZ01.  
**Reason:** Embedding unbounded jobs on the customer resource breaks pagination and mixes aggregates. A list filter is the smallest extension of `GET /jobs`. 404 on foreign `customer_id` avoids an existence oracle.  
**Requirements affected:** S19, GET /jobs, CUST-API-03, CUST-UI-03, CUST-JOB-01  
**Reversible:** Yes (cursor field names), not the “jobs live on jobs table” rule.  
**Migration/API implication:** Index `(workspace_id, customer_id, updated_at DESC, id DESC)`. Additive query parameter.  
**Status:** ACCEPTED

---

## DEC-CUST-007

**ID:** DEC-CUST-007  
**Date:** 2026-09-17  
**Question:** Does editing a Customer rewrite unpublished draft `customer_snapshot` values? When is “Apply current contact details to draft” shown?  
**Decision:** Customer editing updates the `customers` master row only. It must not mutate published `documents` snapshots and must not silently rewrite `document_drafts.payload_json.customer_snapshot`. The explicit apply action belongs to the Quote/draft publication workflow (S11). Defer that UI until Quote implementation. Not a blocker for Customer CRUD. Customer QA cannot mark the apply-action clause VERIFIED until Quote exists.  
**PRD evidence:** CUS01: edits affect future drafts only; published snapshots retain original details; before publication explicitly select Apply current contact details to draft if the draft contains an older snapshot. Draft payload schema: `customer_snapshot` copy. INV02/INV05 immutability.  
**Reason:** Auto-updating an existing draft would hide the older snapshot the owner may still intend to send. The PRD already places the apply control at publication, not on S07.  
**Requirements affected:** CUS01, S07, S11, CUST-API-04, CUST-QA-01, Quote feature  
**Reversible:** No without a PRD change to auto-merge drafts.  
**Migration/API implication:** No Customer trigger on `document_drafts`. Quote feature adds the apply command later.  
**Status:** ACCEPTED

---

## DEC-FOUND-001

**ID:** DEC-FOUND-001  
**Date:** 2026-09-17  
**Question:** Which package manager should the monorepo use?  
**Decision:** npm workspaces. Root `package.json` is private with `workspaces: ["apps/*", "packages/*"]`. Do not introduce pnpm, yarn, or bun unless a later numbered decision records a migration that preserves installs and CI.  
**PRD evidence:** ARC01 TypeScript monorepo; ARC05 pin lockfile. The PRD does not require a specific Node package manager.  
**Reason:** No package manager was previously recorded. npm is the default Node toolchain and matches `package-lock.json`.  
**Requirements affected:** CUST-FOUNDATION-01, DEL01, ARC05  
**Reversible:** Yes, with lockfile and CI changes.  
**Migration/API implication:** Commit `package-lock.json`. All installs use `npm install`.  
**Status:** ACCEPTED
