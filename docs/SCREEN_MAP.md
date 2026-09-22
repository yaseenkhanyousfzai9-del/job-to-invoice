# Screen map (operator mobile)

Status note: this file tracks implemented Expo Router screens. It is not a full PRD replacement.

## Implemented

| PRD | Screen | Route | Status |
|---|---|---|---|
| S05 (partial) | Owner shell | `/(app)` | IMPLEMENTED — Jobs / Create job / Customers / Add customer / Sign out |
| S05 Jobs list API | General `GET /v1/jobs` + `bucket` | n/a (API) | VERIFIED — DEC-JOB-001 (2026-09-22) |
| S05 Jobs list UI | Jobs tab list/search/filters | `/(app)/jobs` | IMPLEMENTED — awaiting physical Android verification (2026-09-22). List-only; no Job Detail |
| S06 | Create job + active Customer picker | `/(app)/jobs/new` | VERIFIED — physical Android 2026-09-22 |
| S07 | New Customer | `/(app)/customers/new` | VERIFIED — also supports `returnTo=create-job` from S06 |
| S07 | Edit Customer | `/(app)/customers/[id]/edit` | VERIFIED |
| S19 | Customers list/search | `/(app)/customers` | VERIFIED |
| S19 | Customer detail (+ associated jobs) | `/(app)/customers/[id]` | VERIFIED — Create Job success lands here with `jobCreated=1` |

## Not implemented (do not invent)

| PRD | Screen | Notes |
|---|---|---|
| S08 | Job overview / detail | Deferred — Jobs cards are read-only; Create Job does not navigate here |
| S09+ | Quote/invoice editors | Deferred |

## S06 success destination

CUST-JOB-01 evidence: after create, Customer Detail shows the new job. Route:

`/(app)/customers/[id]` with `{ id, jobCreated: "1" }`

Job Detail (S08) is intentionally not built in this slice.
