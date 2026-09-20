# Crew app on desktop

Status: **working end to end, printed on real hardware 2026-09-21.**
Branch `feat/desktop-shell`, commit `5f599b2`. Not packaged, not deployed,
not yet installed at a venue.

---

## Why

A venue running the till on a Windows PC could not use the crew app at all, and
printing meant an Android tablet with an OTG cable. This makes the same crew app
run as an ordinary desktop program that talks to a thermal printer directly.

## The idea in one paragraph

There is **one** crew app, not a desktop fork. Metro already exports the app to
web — that worked on the first attempt, all 38 routes, no code changes. A web
page cannot talk to a printer, so Electron wraps that export and owns the
hardware. Everything that makes the app worth trusting stays exactly where it
was, shared with Android.

## Architecture

```
app/  components/          the 38 screens — unchanged, shared with Android
services/printer.ts        de-dup, ack outbox, retry, pairing — shared
services/api.ts            unchanged apart from one call site

services/printTransport.ts       native  → react-native-thermal-printer
services/printTransport.web.ts   desktop → the preload bridge
services/httpClient.ts           native  → plain fetch
services/httpClient.web.ts       desktop → the preload bridge

desktop/main.js            serves the build over app://, owns IPC + lifecycle
desktop/preload.js         the ENTIRE surface the app can see
desktop/http.js            outbound HTTP, performed natively
desktop/print/             DantSu markup → ESC/POS → TCP / USB
desktop/export.js          the web export, without touching app.json
```

### The load-bearing trick: Metro platform extensions

Metro resolves `.web.ts` before `.ts`. That is the whole mechanism. It means:

- no `if (isDesktop)` anywhere in 43k lines of screens,
- no second UI tree,
- **no call site changes at all.**

`printer.ts` does not know Electron exists. It calls `sendToPrinter()`; which
file that resolves to is decided at bundle time. Verified: `printBluetooth` and
`getBluetoothDeviceList` are absent from the web bundle.

**Reuse this pattern for the remaining native gaps** (camera/face, push
notifications). It is the cheapest way to add a platform to this codebase.

### What was deliberately NOT moved

De-duplication, the durable ack outbox, retry and pairing state stay in
`services/printer.ts`. Only the transport is swapped. The three ticket templates
(`kotTemplate`, `invoiceTemplate`, `zReportTemplate`) are untouched and shared,
so **a desktop ticket and an Android ticket are byte-equivalent** and ticket
layout keeps exactly one source of truth.

`printSink.ts` needed no shim: every Notifee call was already `isAndroid`-guarded,
so `drainPendingPrintJobs` — the reconciliation that catches KOTs a live push
missed — keeps working on desktop for free. The Android foreground service it
also contains is simply inert, which is correct: a desktop process is never
suspended, so that entire class of bug does not exist here.

## Printing

`desktop/print/markup.js` replaces DantSu, the Java library Android gets for
free. The templates emit a markup string; on Android the native layer renders
it, on desktop this does. Supported — the complete set the templates emit:

| Markup | Meaning |
|---|---|
| `[L] [C] [R]` | alignment; several on one line means columns |
| `<b>…</b>` | emphasis |
| `<font size="big">…</font>` | double width + height |
| `<qrcode size='N'>…</qrcode>` | native ESC/POS QR, N in mm |
| `<cut/>` | feed and cut |
| `<img>…</img>` | **skipped** — the bill logo is already Android-only |

Transports: raw **TCP 9100** (`net.Socket`, zero dependencies) and **USB**
(`node-usb`, an optional dependency — if its prebuilt binary is unavailable the
shell still starts and `capabilities().usb` goes false).

**No Bluetooth, on purpose.** Desktop BT ESC/POS means a per-OS pairing stack
for a case that does not occur: on a desktop the printer is plugged in or on the
LAN. `capabilities()` reports `bluetooth: false` so the pairing UI can hide the
option rather than offer something that cannot work.

### ⚠ Every CP437 substitution must be exactly one character wide

The templates lay themselves out against `profile.charsPerLine` and pad with
`padStart`/`padEnd`. A two-character substitution silently shifts every column
on that line. This rules out the obvious `₹` → `Rs.` and `…` → `...`.

The em-dash in the KOT notes line (`[L]       — ${item.notes}`) printed as `?`
until the mapping table in `print/escpos.js` existed. The tests assert width
preservation; keep them passing.

### ⚠ Socket drain

`DRAIN_SETTLE_MS` in `print/transports.js` is the desktop counterpart of
`KOT_END_FEED_MM` in `services/printer.ts`. Closing the socket while the printer
is still draining its buffer truncates the tail of a long ticket — the bug that
once made a six-item KOT print only its first few lines. Here we wait on a real
flush callback, so this is a safety margin rather than a guess, but it is the
knob to turn if long tickets lose their end.

## Networking: why requests go through the main process

**Symptom:** every API call on desktop failed with "Could not connect to
server." That message is misleading — the request succeeded and the server
answered.

**Cause:** the backend keeps an explicit CORS allowlist of website origins
(`src/app.ts:96`, fed by the `CORS_ORIGIN` env var) and echoes back only origins
on it. A desktop window's origin is `app://local`, which is not one, so the
preflight returns `204` with **no** `access-control-allow-origin` and Chromium
discards the response before the app can read it.

```bash
# how to confirm this class of problem
curl -i -X OPTIONS https://api.quinckle.com/api/crew/auth/send-otp \
  -H "Origin: app://local" -H "Access-Control-Request-Method: POST"
# → 204, and no access-control-allow-origin header
```

**Fix: stop being a browser.** `httpClient.web.ts` routes every request through
the Electron main process, which is a native HTTP client where CORS does not
apply — the same position the Android app has always been in. Nothing is
relaxed: no response header is rewritten, and the server's allowlist keeps
protecting real websites exactly as before.

Rejected alternatives, and why:

- **Add `app://local` to `CORS_ORIGIN`.** Couples every desktop release to a
  backend env change, and puts a non-web origin in a list meant for websites.
- **Inject the missing header in the renderer.** Hides a CORS relaxation inside
  the client where nobody reviewing the backend would see it.

This was cheap because the app has exactly **two** `fetch` call sites —
`services/api.ts` and `services/realtime.ts` — and no `AbortController`
anywhere. Ably is unaffected: its realtime transport is a WebSocket, which CORS
does not apply to; only its token call goes through the bridge.

`desktop/http.js` is deliberately narrow: only the hosts in `QUINCKLE_API_HOSTS`,
https-only (localhost excepted for dev), `Host`/`Origin`/`Cookie` stripped, the
allowlist re-checked **after** redirects so a redirect cannot walk it off the
backend, and a 30s timeout so a hung request cannot wedge a till.

## ⚠ The fingerprint constraint — read before adding any script

`runtimeVersion` is the **fingerprint** policy. `app.json` and `package.json`
both feed that fingerprint, and package.json is hashed **whole**, not just its
dependency block. Measured with the project's own tooling:

```
package.json as committed        → c85f8b34e35590c103dbbca9a9cbde6d874f06e3   ← the live android runtime
+ one "desktop:export" script    → 80fae4d999a6030a9b4e989fb23b780908f6361c
app.json web.output static→single → also moves
```

Adding a convenience npm script — no dependency, no native code — **strands
every crew APK in the field with no further OTAs.**

So:

- every desktop script lives in **`desktop/package.json`**, never the app's;
- **`desktop/export.js`** applies the `web.output: "single"` override for the
  duration of the export and restores `app.json` byte-for-byte, including on
  failure and on Ctrl-C.

New source files and JS/TS edits are fingerprint-neutral, as OTAs require: this
work added a whole `desktop/` tree and five `services/*.ts` files and refactored
114 lines of `printer.ts`, and the android fingerprint stayed at `c85f8b34`.

Check with `npx expo-updates fingerprint:generate --platform android` — **not**
`npx @expo/fingerprint@latest`, which gives a different hash. See
`KOT_PRINTER_PLAN.md` and the OTA notes for the rest.

## Running it

```bash
npm --prefix desktop run export   # Metro → desktop/web-build/
npm --prefix desktop start        # open the app
npm --prefix desktop run dev      # both
npm --prefix desktop test         # renderer unit tests
```

In dev the renderer console is mirrored to the terminal, which is the fastest
way to diagnose a desktop-only problem.

## What is verified

| | |
|---|---|
| Web export | all 38 routes, first attempt, no code changes |
| Renders in Electron | every route checked; no native-module errors |
| Printing | **real thermal hardware, 2026-09-21** |
| Print path bytes | init, CP437, QR payload, partial cut — asserted by tests |
| API against production | `200` on health, clean `401` on an authed route |
| Bridge hardening | disallowed hosts and plain http refused; `Host`/`Cookie` stripped |
| Fingerprint | `c85f8b34` — identical to the live android runtime |
| Quality gates | `tsc` clean, eslint 0 errors, 9/9 tests |

## What is left

1. **Capability gating.** `attendance-punch`, `face-enroll` and
   `attendance-station` pull `expo-camera`, `@react-native-ml-kit/face-detection`
   and `react-native-fast-tflite`. There is no desktop path; those entry points
   must hide, not crash. Extend the `isUsbSupported()` pattern into a
   capabilities module.
2. **Secure token storage.** Tokens currently land in `localStorage` on web.
   On a shared till they belong in Electron `safeStorage` (DPAPI / Keychain).
3. **Content-Security-Policy.** The page has none; Electron warns in dev. Set
   one before shipping to venues.
4. **Packaging + updates.** `electron-builder` for the installer,
   `electron-updater` against a hosted feed.
5. **Windows code signing.** ~₹25–40k/yr, and **1–3 weeks of identity
   verification** — the long pole. Unsigned, SmartScreen shows a red wall on
   every install and a restaurant owner will not click through it. Start
   procurement before the packaging work, not after.
6. **Desktop input layer.** `useResponsive` and the `isWide` branches already
   exist, so layout is half done. Missing: hover states, Esc-closes-sheet, Tab
   order, F-key shortcuts and barcode keyboard-wedge input. A POS without F-keys
   feels broken to a cashier.
7. **Offline.** The app assumes network. A tablet with 4G survives an ISP
   outage; a desktop does not. Recommended for the pilot: stay online-only and
   keep the tablets as the fallback, rather than adding a sync-conflict surface
   to money paths.
