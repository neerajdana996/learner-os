# learner-os-extension

WXT + React Chrome extension (Manifest V3). Build only — not served by compose.

Part of **learnos** — see the umbrella repo `learner-os` for `docs/` and `docker-compose.yml`.
`src/shared/` is a **synced copy** of `backend/src/shared` — never edit it here.

```bash
cp .env.example .env
pnpm install   # runs `wxt prepare` (generates .wxt/ types)
pnpm dev       # opens Chrome with the extension loaded
pnpm lint      # tsc --noEmit
pnpm test      # vitest with WxtVitest (fake browser APIs)
pnpm build     # → .output/chrome-mv3
pnpm zip       # → .output/*.zip
```

Or from the umbrella repo: `docker compose run --rm extension` → `extension/dist/`.
