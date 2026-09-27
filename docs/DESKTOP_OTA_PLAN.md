# Desktop OTA — plan

Status: **plan, not built** (2026-09-27; decisions settled the same day — see *Decisions*). Companion to `DESKTOP_SHELL.md`.

## The problem

Phones get crew-app changes through EAS Update. The desktop shell cannot: expo-updates
does not run on web, and the shell serves a Metro web export that is baked in at build
time (`desktop/export.js` → `desktop/web-build`). Today every change to the crew app
means a new desktop installer.

## The idea — split the app the way the phones are split

| Layer | What it is | How it updates | How often |
|---|---|---|---|
| **Shell** | Electron main + preload: printing, HTTP bridge, secure store | Full installer (`electron-updater`), needs code signing | Rarely |
| **Bundle** | The Metro web export — every screen, all app logic | **Desktop OTA (this plan)** | Every release, alongside the phone OTA |

This mirrors phones exactly: the APK is the shell, the EAS update is the bundle.

## Why it is a small change to the shell

`main.js` already serves every file from one directory:

```js
const WEB_DIST = process.env.QUINCKLE_WEB_DIST || path.join(__dirname, 'web-build');
protocol.handle('app', serve);   // serve() reads from WEB_DIST
```

Desktop OTA only has to decide **which directory** `WEB_DIST` is at launch:

```
userData/bundles/
  <bundleId-A>/        ← previous (kept for rollback)
  <bundleId-B>/        ← current
  state.json           ← { current, previous, pending, bad: [...] }
built-in web-build/    ← shipped with the installer; the last-resort fallback
```

The page origin stays `app://local`, the preload bridge is unchanged, and nothing moves
in the crew app's code except one "I booted" call (below).

## Components

### 1. Bundle
- `desktop/publish.js` runs the existing export, then packs `web-build/` into a
  `.tar.gz` named by its SHA-256 (`bundles/<sha256>.tar.gz`). Content-addressed, so a
  file is never overwritten and a republish of the same code is a no-op.
- Hosted on a **dedicated Cloudflare R2 bucket, `quinckle-crew-desktop`**, served at
  `updates.quinckle.com` — NOT the media bucket (see *Decisions* §2).

### 2. Manifest (one small JSON per channel)
```json
{
  "channel": "production",
  "bundleId": "<sha256>",
  "url": "https://updates.quinckle.com/bundles/<sha256>.tar.gz",
  "size": 4812345,
  "commit": "075a197",
  "message": "Edit quantities on the table screen…",
  "minBridge": 3,
  "publishedAt": "2026-09-27T06:30:00Z",
  "signature": "<ed25519 over everything above>"
}
```
- **Phase 1:** static file at `updates.quinckle.com/<channel>/manifest.json` (`staging` or
  `production`).
- **Phase 2:** `GET /api/crew/desktop/manifest` on the backend, so a rollout can target one
  venue first (Maniqueen) before everyone — it knows the till's restaurant from the login.

### 3. Signing (non-negotiable)
The bundle runs with the printer bridge and the staff login token. Whoever can write to
the bucket must NOT thereby be able to run code on every till. So:
- The manifest is signed with an **Ed25519 private key** kept in the publisher's **macOS
  Keychain** — never a file, never in a repo (see *Decisions* §1).
- **Two public keys are compiled into the shell:** the everyday key and an offline backup
  key. A manifest signed by either is accepted. If the everyday key is lost or leaks, the
  backup publishes the next release (and the one after ships a shell without the bad key);
  without it, a lost key would mean a new installer on every till.
- The shell verifies the manifest signature, then the downloaded file's SHA-256 against
  `bundleId`. Either failing → the bundle is discarded and the current one keeps running.

### 4. Shell ↔ bundle compatibility — the desktop "fingerprint"
The phone lesson (the reanimated / expo-camera OTA incidents): an update that calls native code the installed binary
lacks breaks the app. Desktop equivalent: a bundle that calls a preload API the installed
shell does not expose.
- The preload exposes `window.quinckle.bridgeVersion` (integer; bump whenever the bridge
  surface changes — new printer call, new IPC channel).
- Every manifest carries `minBridge`. The shell **refuses** a bundle whose `minBridge` is
  above its own `bridgeVersion` and keeps what it has. It never half-applies.
- `publish.js` reads `minBridge` from a constant in the crew app
  (`constants/desktopBridge.ts`), so it is set by the code, not typed by hand.

### 5. Download, apply, and boot safety
- **Check:** at launch and every 30 min. Download in the background into
  `bundles/<id>.partial/`, verify, then rename — a crash mid-download never leaves a
  half bundle.
- **Apply:** on the **next launch**, like expo-updates. A till runs all service long, so
  also: when the floor screen is idle (no sheet open, no table open) for 2 min, show a
  small "Update ready — restart" pill. Never auto-restart mid-service.
- **Boot check (the important part):** the new bundle is `pending` until the app calls
  `window.quinckle.bootOk()` after the floor renders. If that has not happened within
  20 s, or the renderer crashes, the shell marks the bundle `bad`, reverts to `previous`
  and reloads. The 2026-09-16 crew OTA hooks crash (every table screen) would have
  healed itself on desktop instead of taking tills down.
- **Keep two** bundles on disk (current + previous) plus the built-in one. Delete older.

### 6. Channels, promotion and rollback
- Every publish goes to **`staging`** (your own till) first.
  `node desktop/publish.js` → staging.
- **Promote** repoints `production` at the exact bundle staging ran — no rebuild, so what
  was tested is byte-for-byte what venues get.
  `node desktop/publish.js --promote <bundleId>`
- **Rollback** repoints a channel at a previous `bundleId`.
  `node desktop/publish.js --rollback <bundleId> --channel production`
  Tills pick it up on the next check.
- **Till-side:** automatic via the boot check above.

### 7. One release, both platforms
`desktop/release.js` (or a documented two-step) publishes the EAS update **and** the
desktop bundle from the same clean worktree at the same commit, with the same message. The
commit hash goes in both, so "what is this till running?" has one answer. A small
"About" row in Settings shows `shell x.y · bundle <commit>`.

## What this does NOT cover
- **Shell updates** (new printer transport, new IPC, Electron upgrades) — still need an
  installer. `electron-updater` + **Windows code signing** (1–3 week procurement, the long
  pole already noted in `DESKTOP_SHELL.md`). Unsigned installs work but trigger SmartScreen.
- Phones — unchanged, still EAS.

## Phases

| Phase | Scope | Notes |
|---|---|---|
| **1** | `publish.js` (export → tar → sha → R2 → signed static manifest); shell: fetch, verify, stage, apply on next launch, boot check + auto-revert, `bridgeVersion`/`minBridge`, keep-two cleanup | Enough for real OTA. No backend change. |
| **2** | Backend manifest endpoint with per-venue targeting; "Update ready" pill; About row | Rollout becomes staging (you) → Maniqueen → everyone. |
| **3** | `electron-updater` for the shell, once code signing lands | Independent of 1–2. |

## Decisions (settled 2026-09-27)
1. **Signing key: publisher's machine only, plus an offline backup.** Crew OTAs are
   published from a laptop today and there is no CI for them, so a CI copy would add a
   place to leak with no benefit. Everyday key in the macOS Keychain; backup key offline in
   a password manager, its public half baked into the shell (see §3). Revisit if releases
   are ever automated.
2. **Hosting: a separate R2 bucket** (`quinckle-crew-desktop`, `updates.quinckle.com`).
   Signing already stops a bucket writer from running code; separation is about the rest —
   the media bucket's write keys live on the Render backend and serve partner uploads, so
   anything holding them could DELETE bundles (tills unable to update), and a media-cleanup
   script could remove them by mistake. R2 has no egress fees; bundles are a few MB. Write
   credentials on the publisher's machine only; public read.
3. **Channels: `staging` + `production`.** Staging is your own till; every publish lands
   there and is opened once before promotion. Phase 2's per-venue targeting then puts
   Maniqueen between staging and everyone.

## Worth doing for phones too
Every phone EAS update currently goes straight to all devices — the 2026-09-16 hooks crash
reached every table screen that way. EAS supports a `staging` branch + channel natively, so
the same staging → production promotion is a small change there.

## Guardrails carried over from the phone OTA
- Publish only from a **clean worktree at the target commit** — never the working tree
  (EAS ships whatever is on disk, uncommitted or not).
- The baseline is **what tills run**, not `main` — publishing from an older base is a
  regression, not a subset.
- Desktop scripts stay in `desktop/package.json`, never the app's — the app's
  `package.json` and `app.json` are fingerprinted (see `export.js`).
