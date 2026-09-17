# Engineering Contract

This contract binds every implementer (human or agent) working in this repository.

`docs/PRD.md` is the authoritative product specification.

`docs/SOP.md` is the process baseline (vertical slices, requirement statuses, isolation testing, definition of done). The PRD overrides generic SOP defaults when they conflict. In particular:

- The operator product is iPhone-first (PRD DEC01). Android is deferred. Do not add Android as a v1 requirement because the SOP timetable mentions it.
- Commercial writes go through the Fastify domain API, not mobile/portal Supabase REST (PRD ARC02). Do not follow the SOP default of client-side table CRUD.
- Release quality is the PRD’s production bar (offline recovery, tenant isolation, immutable money), not a 2–3 day prototype.

## Authority order

1. Approved PRD (`docs/PRD.md`)
2. This contract
3. `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`
4. `docs/DECISIONS.md` for recorded engineering decisions
5. `docs/REQUIREMENTS_MATRIX.md` for delivery status
6. Existing codebase conventions
7. Developer judgment
8. AI recommendation

If an agent suggestion conflicts with the PRD, the PRD wins unless a numbered decision records why the requirement is technically impossible, unsafe, or contradictory. Never silently modify requirements because implementation would be easier.

## Mandatory rules

- Never remove or weaken a PRD requirement for implementation convenience.
- Never claim mocked functionality is complete.
- Never hard-code secrets.
- Never expose server/private API keys in mobile or public browser code. No Supabase service role, database URL, RevenueCat secret, email API key, or signing key in a client bundle.
- Never disable security merely to simplify development (no RLS off, no shared bypass tokens, no `BYPASSRLS` API role).
- Never implement authorization only in UI. UI hiding is not authorization.
- Never silently trust `workspace_id`, `customer_id`, or any other object id supplied by a client. Workspace membership is derived from verified server identity (AUTHZ01). Cross-tenant object references return generic 404.
- Never suppress TypeScript errors merely to obtain a build.
- Never ignore relevant failing tests.
- Never rewrite unrelated code unnecessarily.
- Reuse existing components and domain logic where practical.
- Inspect existing code before editing.
- Implement the smallest correct solution.
- Run typecheck, lint, and relevant tests after implementation.
- Update `docs/REQUIREMENTS_MATRIX.md` after substantial work.
- Report unresolved/unverified behavior explicitly.
- Only **VERIFIED** counts as complete. PENDING, IN PROGRESS, IMPLEMENTED, and BLOCKED do not.

## Feature completion

A feature is not complete because a screen, button, API, or table exists.

Where applicable, completion means:

- UI
- business logic
- validation
- persistence
- authentication/authorization
- loading states
- empty states
- error states
- offline/network behavior
- accessibility
- analytics (only PRD-allowlisted events; never customer names, emails, or addresses)
- tests

Evidence is required before VERIFIED: implementation exists and credible tests demonstrate that it works.

## Before modifying code

1. Read this contract.
2. Read the relevant PRD section.
3. Read the relevant architecture, database, and API documents.
4. Inspect existing code.
5. Identify reusable components.
6. Plan the smallest correct change.

## After modifying code

1. Typecheck.
2. Lint.
3. Run applicable automated tests.
4. Test the affected user flow.
5. Inspect the diff.
6. Update requirement status.
7. Report unresolved issues.

Production quality takes precedence over shortcuts.
