# Quinckle Crew — desktop shell

The crew app as a real desktop program, so a venue can run the till on a PC and
print without an Android tablet and an OTG cable.

## How it fits together

There is **one** crew app. Metro exports it to web, and Electron serves that
build and owns the one thing a web page cannot do — talking to a printer.

```
app/ components/        the 38 screens — unchanged, shared with Android
services/printer.ts     de-dup, ack outbox, retry, pairing — shared with Android
services/printTransport.ts      ← Android/iOS: react-native-thermal-printer
services/printTransport.web.ts  ← desktop: calls the preload bridge
desktop/main.js         Electron main: serves the build over app://, owns IPC
desktop/preload.js      the entire surface the app can see (nothing else)
desktop/print/          DantSu markup → ESC/POS bytes → TCP / USB
```

Metro resolves `.web.ts` before `.ts`, so the platform swap needs no branching
in `printer.ts` and no changes at any call site.

## Run it

```bash
npm run desktop          # export the web build, then launch
npm run desktop:export   # export only  → desktop/web-build/
npm run desktop:start    # launch only
npm run desktop:test     # renderer unit tests
```

### Live mode — edit and see it, no export

```bash
cd desktop && npm run live
```

Starts Metro's dev server and opens the shell on it, so a saved source file
updates the window in about a second. Quit any running Quinckle Crew first — the
shell allows one instance per machine, so a second launch just focuses the first.

- Extra arguments go to Electron: `npm run live -- --user-data-dir=/tmp/p` runs
  a second profile beside a running instance.
- Port 8099 by default; `QUINCKLE_LIVE_PORT` changes it.
- It sets `web.output: "single"` in `app.json` for the session and puts it back
  on exit (`singleOutput.js`, shared with the export). If the process is
  SIGKILLed, `git checkout app.json` clears the leftover.
- Live mode runs on its own origin (`http://localhost`), so the per-origin staff
  profile is separate from the exported build's. Sign in once in each.
- The shell only honours `QUINCKLE_DEV_URL` when unpackaged, and only for
  localhost.

## Login persistence

`expo-secure-store` has no web build, so on desktop the token used to live in
memory only and every reload signed you out. `services/secureStorage.web.ts`
now goes through the preload bridge (`window.quinckle.secureStore`) to
`secureStore.js`, which encrypts with Electron's `safeStorage` (the macOS
Keychain, Windows DPAPI) and writes `secure-store.json` in `userData`. There is
no plaintext fallback: if encryption is unavailable a write fails and the user
signs in again next launch. A plain browser tab has no bridge and persists
nothing.

## Why the templates are untouched

`kotTemplate.ts`, `invoiceTemplate.ts` and `zReportTemplate.ts` emit DantSu
markup. On Android the native library renders it; on desktop `print/markup.js`
does. Neither side alters the markup, so **the same ticket prints identically on
both** and ticket layout keeps exactly one source of truth.

`print/markup.js` implements the complete set the templates emit — `[L] [C] [R]`,
`<b>`, `<font size="big">`, `<qrcode>`, `<cut/>` — and skips `<img>` (the bill
logo is already Android-only).

## Things that will bite you

- **Replacements must be one character wide.** The templates pad against
  `profile.charsPerLine`, so `₹` → `Rs.` or `…` → `...` would shift every column
  on the line. See the `CP437` table in `print/escpos.js`; the tests assert it.
- **No Bluetooth.** Desktop BT ESC/POS means a per-OS pairing stack for a case
  that does not occur — on a desktop the printer is plugged in or on the LAN.
  `capabilities()` reports this so the pairing UI can hide the option.
- **`usb` is optional.** If its prebuilt binary is unavailable the shell still
  starts with network printing; `capabilities().usb` goes false.
- **Socket drain.** `DRAIN_SETTLE_MS` in `print/transports.js` is the desktop
  counterpart of `KOT_END_FEED_MM` — closing early truncates long tickets.

## Not done yet

Phases 2–5 of the plan: capability gating for the camera/face screens,
`electron-updater`, Windows code signing, auto-launch, and the desktop keyboard/mouse layer.
