# Tests

Workspace packages own their automated tests:

- `packages/domain` — unit tests (`tsx --test`)
- `apps/api` — Fastify inject tests, including `GET /health`

Root command:

```bash
npm test
```

End-to-end Maestro coverage is not part of CUST-FOUNDATION-01.
