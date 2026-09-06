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

## Connecting it to an account

The extension authenticates with a **bearer token**, not a cookie: an MV3
service worker is a cross-origin caller with no reliable cookie jar.

1. Load the unpacked build (`.output/chrome-mv3`) or run `pnpm dev`.
2. Mint a token for yourself:
   `curl -X POST http://localhost:3001/auth/extension-token -H "x-user-id: <dev user id>"`
   (`pnpm seed` in the backend prints one ready to paste.) The web app's own
   "Connect extension" screen is T-034.
3. Open the extension's options page — the popup's **Connect** button goes
   straight there — and paste it.

The token is checked against `GET /me` **before** it is stored, so a mis-paste
says so immediately instead of turning into an extension that silently never
pops. It lives in `chrome.storage.local`, never `sync`: `sync` would push a
credential to every browser signed into the same Google account.

`WXT_API_URL` sets both the runtime origin and the manifest's single host
permission, so the two cannot drift. Changing it needs a rebuild.
