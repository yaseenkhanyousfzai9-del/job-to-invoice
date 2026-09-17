# Job to Invoice

iPhone-first operator app and customer approval website for solo service businesses.

This repository is a TypeScript monorepo. **No customer, quote, invoice, approval, or billing features are implemented yet.** The current runtime is the application foundation only.

## Authority

- Product: [`docs/PRD.md`](docs/PRD.md) (authoritative)
- Process: [`docs/SOP.md`](docs/SOP.md)
- Engineering rules: [`ENGINEERING_CONTRACT.md`](ENGINEERING_CONTRACT.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Monorepo

| Path | Role |
|---|---|
| `apps/mobile` | Expo / React Native owner app (iPhone-first) |
| `apps/portal` | Next.js customer portal (placeholder) |
| `apps/admin` | Next.js staff console (placeholder) |
| `apps/api` | Fastify domain API (`GET /health` only so far) |
| `apps/worker` | Background worker process (no jobs yet) |
| `packages/domain` | Shared domain primitives |
| `supabase/migrations` | Database migrations (none for product tables yet) |

Commercial data will go through the Fastify API, not mobile/portal Supabase REST.

## Prerequisites

- Node.js 20.19+ (Node 24 is fine)
- npm 11+ (npm workspaces)
- Git

## Commands

```bash
npm install
npm run typecheck
npm run lint
npm test
```

Optional genuine compile:

```bash
npm run build
```

### Run locally

```bash
npm run dev:api       # http://localhost:3001/health
npm run dev:worker
npm run dev:portal    # http://localhost:3000
npm run dev:admin     # http://localhost:3002
npm run dev:mobile    # Expo dev server (development builds; Expo Go is not release)
```

## Environment

Copy `.env.example` to `.env` for local names only. App-specific examples:

- `apps/api/.env.example` — server secrets (never ship in mobile)
- `apps/mobile/.env.example` — public `EXPO_PUBLIC_*` values only

Never commit real API keys, database passwords, or tokens. Production secrets stay in a managed secret store.

## Git

- `main` — releasable line
- `build/v1` — current development branch (push here; do not merge casually)

## No-secrets policy

Source control must not contain service-role keys, database URLs with credentials, RevenueCat secrets, email API keys, or real customer data.
