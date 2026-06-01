# Quinckle Crew App — Pre-Production Audit

> Full review of infra (`api.ts`, `realtime.ts`, `AuthContext`, `printer.ts`, `pushNotifications.ts`, `_layout`), the staff & cook dashboards, table detail, and the money screens (cash-collection, payment-collect). Includes `tsc --noEmit`.
>
> **Headline:** the app **type-checks clean (0 errors)** — much healthier than the partner app. But the **printer lifecycle is never initialized**, which silently breaks KOT printing after any app restart (critical for a kitchen device), and the HTTP client crashes on Render cold-starts. Money/idempotency paths look correct.

Generated: 2026-06-01 · Stack: Expo SDK 54, RN 0.81, single backend (`quinckle-user-app-backend`).

---

## ✅ Master checklist — RESOLVED (2026-06-01)

> `npx tsc --noEmit` passes with **0 errors** after the changes.

### 🔴 Critical
- [x] **CR1** — `initPrinter()` now called on launch in `app/_layout.tsx` → printer config restored, printing + cook drain work after restart
- [x] **CR4** — `request()` now guards content-type and wraps `res.json()` in a catch → friendly "warming up" message instead of a JSON-parse crash

### 🟠 High / functional — RECLASSIFIED (no action needed)
- [x] **CR2 / CR3** — **Superseded.** Deeper inspection shows the cook dashboard's `drainPendingPrintJobs` (`app/(cook)/index.tsx:166-172`) already pulls backend-pending prints on mount, every 15s, and on foreground — that is the live retry mechanism, gated on `getStatus()==='connected'` (now fixed by CR1). The standalone `enqueue`/`flushQueue`/`retryUnprintedOnLaunch` in `printer.ts` are legacy/dead code; wiring them would double-print. Left as-is (harmless); optional future cleanup: remove the dead local-queue path. Minor: `enqueue()` still appends to `pendingPrintQueue` on failure and nothing drains it, so that AsyncStorage key can grow stale — low impact since backend-pending reprints cover failed jobs.

### 🟡 Medium / low
- [x] **CR5** — ported the partner app's 2s close-grace into `realtime.ts` (`closeTimers`) → no more connection churn on remounts/tab switches
- [ ] **CR6** — `expo-av` (`Audio`) deprecated; removed in SDK 55 — migrate to `expo-audio` **before the next SDK bump** (not a current breakage)
- [ ] **CR7** — `_layout.tsx` + `pushNotifications.ts` import `expo-notifications` at module top-level (throws only in Expo Go; fine for your dev-client/standalone builds) — optional hardening

### 🟢 Housekeeping
- [x] **CR8** — removed `app/(staff)/.index.tsx.swp`; added `*.swp` to `.gitignore`
- [x] **CR9** — updated `CLAUDE.md` (auth persistence, real ops backend + realtime + printing; removed the "mocked, no API" claims)

---

## 🔴 CRITICAL

### CR1 — Printer never initialized on launch → KOT printing dies after restart
- **File:** `services/printer.ts:55` (`initPrinter`) — defined but **never called** anywhere (`_layout.tsx`, contexts, screens).
- **Why it's critical:** every print path is gated on `getStatus() === 'connected'`:
  - Cook auto-print: `app/(cook)/index.tsx:89,199,231` (`if (getPrinterStatus() !== 'connected') return;`)
  - Staff auto-print: `app/(staff)/index.tsx:560,650`
  - Bill print: `app/(staff)/[tableId].tsx:623`
  - Reprint: `app/(cook)/index.tsx:372`
  `getStatus()` returns `_config ? _status : 'unpaired'`, and `_config` is only ever loaded by `initPrinter()`. Since it's never called, after the app is closed & reopened `_config` is `null` → `getStatus()` is `'unpaired'` → **every print is silently skipped** (and `printRaw` would throw `PRINTER_NOT_PAIRED`) until the user manually re-pairs. On the kitchen/cook device this means KOTs stop printing after every restart with no error shown.
- **Fix:** call `initPrinter()` once on launch in `app/_layout.tsx` (a `useEffect`). Then `getStatus()` recovers the paired config from AsyncStorage.
- **Verify:** pair → kill app → reopen → place an order → KOT prints without re-pairing.

### CR4 — HTTP client crashes on non-JSON responses (Render cold-start)
- **File:** `services/api.ts:54` — `const json = await res.json();` runs **before** any content-type check and with **no `.catch()`**.
- **Problem:** the backend is on Render, which serves an HTML splash/error page during cold-start or 502/503. `res.json()` then throws `JSON Parse error: Unexpected character: <`, the 401/`!ok` handling never runs, and the user sees a cryptic error. Hits the **OTP login** path and every screen after the backend has been idle. (The partner app explicitly guards this; the crew app does not.)
- **Fix:** mirror the partner app — check `content-type` includes `application/json` and wrap `res.json()` in a `.catch()`, throwing a friendly "Server is warming up — please try again in a moment."
- **Verify:** point at a cold/parked backend → login shows the warming-up message instead of a JSON parse crash.

---

## 🟠 HIGH / FUNCTIONAL

### CR2 — Failed-print retry queue never replays
- **File:** `services/printer.ts:242` (`flushQueue`) — defined, populated by `enqueue()` on every failed print, but **never called**.
- **Impact:** the entire offline-resilience feature is dead — failed KOTs pile up in AsyncStorage (`pendingPrintQueue`) and never reprint automatically.
- **Fix:** call `flushQueue()` after `initPrinter()` on launch, and ideally when connectivity/printer status recovers.

### CR3 — Unprinted-on-launch retry never wired
- **File:** `services/printer.ts:269` (`retryUnprintedOnLaunch`) — exported, never called.
- **Impact:** orders that went unprinted while the app was closed aren't retried on next launch.
- **Fix:** call it on launch with a fetcher backed by `printerApi.getPending()` (maps pending → `KotOrder[]`). Coordinate with CR1/CR2 so it runs after `initPrinter()`.

---

## 🟡 MEDIUM / LOW

### CR5 — Realtime connections churn on remount (no close grace period)
- **File:** `services/realtime.ts:132` (`releaseEntry`) closes the Ably client immediately when `refCount` hits 0.
- **Impact:** on fast remounts / tab switches (and React strict-mode), the connection is torn down and rebuilt repeatedly — brief realtime gaps + extra Ably connections. The **partner app already solved this** with a 2-second close-timer grace period; port that logic here.

### CR6 — `expo-av` is deprecated
- **Files:** `app/(staff)/index.tsx:23`, `app/(cook)/index.tsx:12` — `import { Audio } from 'expo-av'` (alert sounds).
- **Impact:** `expo-av` is deprecated in SDK 54 and **removed in SDK 55** — works today, breaks on the next SDK upgrade. Plan migration to `expo-audio`.

### CR7 — `expo-notifications` imported at module top level
- **Files:** `app/_layout.tsx:3` (+ `setNotificationHandler` at module scope), `services/pushNotifications.ts:3`.
- **Impact:** throws on import in Expo Go (SDK 53+). Fine for dev-client/standalone builds (what you ship), so low priority — but the partner app lazy-loads it defensively. Optional hardening.

---

## 🟢 HOUSEKEEPING

### CR8 — stray editor swap file in routes dir
- `app/(staff)/.index.tsx.swp` (vim swap) sits inside the Expo Router routes folder. Delete it and add `*.swp` to `.gitignore`. (Not tracked by git, but clutters the routes dir.)

### CR9 — `CLAUDE.md` is stale
- It states data is "static/mocked in-memory — no API or database" and auth is "front-end only — no real auth backend yet." All false now (real ops backend, OTP auth, realtime, printing). Update so future work isn't misled.

---

## ✅ Things that are correct (verified, no action)
- **`tsc --noEmit` passes with 0 errors.**
- **Payment idempotency** — `collectPayment` keys are deterministic (`crew-collect:<orderId>:<method:amount|...>`) in both `payment-collect.tsx` and `cash-collection.tsx`, so retries won't double-collect.
- **Auth/token** — crew uses long-lived OTP tokens; there is no refresh endpoint, so `401 → logout` is the correct model here (unlike the partner app, which had an unused refresh endpoint). Token is persisted in SecureStore and restored on launch.
- **Realtime auth** — uses `authCallback` only (correctly fixed; no invalid `token: tokenRequest`).

---

## Suggested order of execution
1. **CR1 + CR2 + CR3** — wire the printer lifecycle on launch (single `useEffect` in `_layout.tsx`). Highest impact.
2. **CR4** — JSON/content-type guard in `request()`.
3. **CR5** — port the realtime close-grace from the partner app.
4. **CR8 + CR9** — housekeeping.
5. **CR6 + CR7** — before/at the next SDK upgrade.
