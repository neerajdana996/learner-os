# The Chrome extension — build it, load it, hand it to ten people

> The extension is where most of the retrieval is supposed to happen. Between
> sessions the web app is somewhere a learner has to decide to go; the extension
> is a twenty-second question at a desk they are already sitting at. It is not
> in the Chrome Web Store and will not be during the pilot, so every install is
> an unpacked folder and someone following instructions.
>
> Two audiences here. **[Building it](#building-it)** is for us.
> **[Installing it](#installing-it--the-pilot-participants-copy)** is the text a
> participant reads — written to be copied into an email, not summarised.

---

## What it does, in one paragraph

An MV3 service worker wakes on a five-minute alarm, asks the backend whether
anything is due, and — if the learner is at the keyboard, inside one of their
own active windows, under their daily cap, and not backed off — stores one item
and posts a notification. Clicking the notification opens the popup, which
renders whatever is waiting. Answers go to `POST /reviews` with an idempotency
key, and any that cannot be sent sit in a local queue until they can. It reads
nothing from the pages the learner is browsing and asks for exactly one host
permission: the backend's own origin.

---

## Building it

From the repo root, once: `pnpm install`.

```bash
pnpm --filter learner-os-extension dev     # Chrome opens with it loaded, HMR on :3002
pnpm --filter learner-os-extension build   # → extension/.output/chrome-mv3/
pnpm --filter learner-os-extension zip     # → extension/.output/learner-os-extension-<version>-chrome.zip
```

Or in Docker, which is how you get a zip built by something other than your own
laptop:

```bash
docker compose run --rm extension          # → extension/dist/
```

Three things worth knowing before the first build:

- **The dev server is on :3002, not :3000.** WXT defaults to 3000, which is the
  web app's port under compose. Both bind successfully because they take
  different stacks — Docker gets `*:3000` and WXT gets `[::1]:3000` — and macOS
  resolves `localhost` to `::1` first, so `http://localhost:3000` silently
  serves WXT's 404 while the frontend container looks broken. Pinned in
  `wxt.config.ts` (T-127); don't move it back.
- **`WXT_API_URL` is baked in at build time.** It sets both the runtime origin
  (`lib/api.ts`) and the manifest's single `host_permissions` entry, from one
  value so the two cannot drift. Changing it needs a rebuild, as any manifest
  change does. Default `http://localhost:3001`; `extension/.env.example` is the
  template.
- **`pnpm lint` never compiles SCSS.** It is `tsc --noEmit`. If you touched a
  stylesheet, run the build — a broken `@use` path passes lint and fails at
  build (T-090).

### Loading it unpacked (developer path)

1. `chrome://extensions` → **Developer mode** on (top right).
2. **Load unpacked** → pick `extension/.output/chrome-mv3`.
3. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to
   learnos. Unpinned, the popup can only be reached through a menu nobody finds.

After a rebuild, press the reload arrow on the extension's card. `pnpm dev`
reloads on its own; a `build` output does not.

### Connecting it, without a browser

The extension authenticates with `Authorization: Bearer`, never a cookie: an
MV3 worker is a cross-origin caller with no reliable cookie jar. `pnpm seed`
prints a ready-to-paste token as its last line. Otherwise:

```bash
curl -XPOST -b cookies.txt localhost:3001/auth/extension-token
# -> 201 {"token":"...","expiresAt":"..."}
```

Paste it into the options page (the popup's **Connect** button goes straight
there). It is checked against `GET /me` **before** it is stored, so a mis-paste
says so immediately rather than becoming an extension that silently never pops.

### Seeing a card without waiting for one

The most common "the extension is broken" report is a correctly working
extension with an empty queue. After a session, FSRS schedules the first review
hours or days out. Move the cards rather than the clock (T-128):

```bash
curl -XPOST -b cookies.txt localhost:3001/dev/due-now \
  -H 'content-type: application/json' -d '{"count":5}'
# -> {"due": 5}
```

Then **open the popup deliberately** — it asks `/due` itself rather than
rendering only what the worker left behind (T-129), and it ignores the cap,
the windows and the backoff on purpose: those exist to decide when it is
acceptable to *interrupt* someone, and none of them is a reason to refuse a
person who just asked for a question. To watch the worker instead, wait out one
five-minute alarm, or inspect it live from `chrome://extensions` →
**service worker** → its console. `/dev/*` routes do not exist under
`NODE_ENV=production`.

---

## Installing it — the pilot participant's copy

> Everything from here down is written to be sent to someone. It assumes
> desktop Chrome, no developer tools, and no interest in any of the above.

### Screenshots to capture before sending this

Not captured yet — take these on a clean profile at the moment the zip is
built, and drop them in `docs/images/extension/`. A screenshot of a *different*
build is worse than none, because it teaches people to look for a button that
moved.

| File | The shot |
| --- | --- |
| `01-unzip.png` | The unzipped folder in Finder/Explorer, showing `manifest.json` inside it |
| `02-devmode.png` | `chrome://extensions` with **Developer mode** toggled on, top right, circled |
| `03-load-unpacked.png` | The same page with **Load unpacked** circled, and the folder-picker open |
| `04-pin.png` | The puzzle-piece menu with the pin beside learnos circled |
| `05-connect-web.png` | The web app's **Connect the extension** page after clicking *Create a token* |
| `06-paste.png` | The options page with a token in the field and **Connect** ready |
| `07-connected.png` | The options page reading *Connected as …* |
| `08-card.png` | A real question card in the popup, with the answer field and buttons |

### Setting it up (five minutes, once)

**You will need:** desktop Chrome, and the zip we emailed you.

**1. Unzip it, and keep the folder.**
Put it somewhere permanent — Documents is fine, Downloads is not. Chrome loads
the extension *from this folder every time it starts*, so if you delete it or
move it, the extension stops working.

> 📷 `01-unzip.png`

**2. Open Chrome's extensions page.**
Type `chrome://extensions` in the address bar and press Enter. Turn on
**Developer mode** with the switch in the top right.

> 📷 `02-devmode.png`

**3. Load it.**
Click **Load unpacked**, then choose the folder you unzipped. A card that says
**learnos** appears.

> 📷 `03-load-unpacked.png`

This is normal, and it is the only way to install something that isn't in the
Chrome Web Store yet. Chrome may warn you about developer-mode extensions each
time it starts — you can dismiss it.

**4. Pin it to the toolbar.**
Click the puzzle-piece icon to the right of the address bar, find learnos, and
click the pin. You want the icon visible; that is what you'll click to answer.

> 📷 `04-pin.png`

**5. Get your token.**
Open the web app, sign in, and go to **Connect the extension**. Click
**Create a token**, then **Copy**.

> 📷 `05-connect-web.png`

This token is a key to your account. Don't share it, and don't paste it
anywhere except step 6. It is shown once — if you lose it, just create another;
that doesn't break anything.

**6. Paste it in.**
Click the learnos icon in the toolbar, click **Connect**, paste the token, and
click **Connect** again.

> 📷 `06-paste.png`

You should see **Connected as you@example.com**. That's the whole setup.

> 📷 `07-connected.png`

### What happens next

- During the hours you chose at sign-up, a notification will occasionally
  appear: *One question. Twenty seconds. Click to answer.* Click it and answer.

  > 📷 `08-card.png`

- It will never ask more than the daily limit you set, and never twice within
  twenty minutes.
- It won't ask while you're away from the keyboard.
- If you wave three questions away in a row, it stops for the rest of the day.
  That is deliberate — you told it something, and it believed you.
- Answering offline is fine. Your answer is kept and sent when you're back.
- Once a day the card also asks how you're feeling. One tap, and it doesn't ask
  again until tomorrow.
- **After your seventh day the extension goes quiet, on purpose.** Nothing is
  broken. The silence is the experiment; we'll email you when it's over.

You can click the icon any time to pull up a question yourself, even outside
your hours.

### What it can and can't see

- It reads **one** thing: our own server. The permission list shows a single
  address, and there is no permission to read the pages you browse — check it
  yourself on the extension's card under **Details**.
- Your token is stored on this computer only. It is deliberately not synced to
  your Google account, so it never reaches your other browsers.
- To disconnect: click the icon → gear/**Options** → **Disconnect**. To remove
  it entirely: `chrome://extensions` → **Remove**.

---

## When it isn't working

| What you see | What it usually is |
| --- | --- |
| *"That token was not accepted"* | The token was already replaced by a newer one, or the paste picked up a stray character. Create a fresh one and paste again. |
| *"Could not reach http://localhost:3001"* | The backend isn't running (dev), or the build has the wrong `WXT_API_URL` baked in. The options page prints the origin it is talking to at the bottom. |
| *"Nothing due right now"* forever | Nothing is actually due — the normal state between reviews and the only state after day 7. In dev, `POST /dev/due-now`. |
| No notifications at all, but the popup works | macOS or Windows notification permission for Chrome, or the learner is outside their active windows, capped, or backed off. The service-worker console names the reason. |
| The extension card shows an error after a rebuild | Press the reload arrow on `chrome://extensions`. A `build` output does not hot-reload. |
| Extension gone after a restart | The unzipped folder was moved or deleted. Chrome loads unpacked extensions from their original path. |
| A fetch blocked by the manifest | `WXT_API_URL` changed without a rebuild. It generates the host permission; they cannot drift, but only within one build (T-122). |

For anything else, the service worker's own console is the place to look:
`chrome://extensions` → learnos → **service worker**. It logs why a tick
decided not to pop, and what the answer queue did.
