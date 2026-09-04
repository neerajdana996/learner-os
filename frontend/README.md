# learner-os-frontend

React 19 + Vite + Redux Toolkit / RTK Query + react-router. Port 3000 (nginx) / 5173 (dev).

Part of **learnos** — see the umbrella repo `learner-os` for `docs/` and `docker-compose.yml`.

- **All API calls** go through RTK Query in `src/store/api.ts` (feature files inject endpoints).
- **All client state** lives in Redux Toolkit slices under `src/store/`.
- `src/shared/` is a **synced copy** of `backend/src/shared` — never edit it here;
  run `scripts/sync-shared.sh` from the umbrella repo.

```bash
cp .env.example .env
pnpm install
pnpm dev     # http://localhost:5173, /api and /ws proxied to :3001
pnpm lint    # tsc --noEmit
pnpm test    # vitest + testing-library (jsdom)
pnpm build   # → dist/
```
