# learner-os-backend

Express 5 + `ws` + Drizzle (Postgres) + BullMQ (Redis). Port 3001.

Part of **learnos** — see the umbrella repo `learner-os` for `docs/`, `docker-compose.yml`
and the shared-code sync script. `src/shared/` here is the **source of truth** for the
Zod schemas/types used by the frontend and extension.

```bash
cp .env.example .env
pnpm install
pnpm dev          # tsx watch, http://localhost:3001/health, ws://localhost:3001/ws
pnpm lint         # tsc --noEmit
pnpm test         # vitest (needs postgres+redis from compose for DB tests)
pnpm db:push      # drizzle-kit push → learnos
pnpm db:test:push # drizzle-kit push → learnos_test
```
