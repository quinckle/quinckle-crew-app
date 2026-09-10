# Background KOT Printing (Android Foreground Service)

Keeps Kitchen Order Tickets printing even when the print-sink device's **screen
is off or the app is backgrounded**, by running an Android **foreground service**
that holds the JS runtime alive.

> **Android only.** iOS does not allow this style of always-on background work;
> on iOS every export in `services/printSink.ts` is a no-op and printing behaves
> as before (works while the app is foregrounded).

---

## Why this exists

React Native suspends the JS runtime when the app is backgrounded or the screen
sleeps. That froze the two auto-print triggers:

- the live Ably `new_order` push, and
- the in-screen 15-second pull-queue drain.

So a KOT placed while the device was asleep only printed once someone woke it.
The foreground service fixes this: an ongoing notification tells Android *"keep
this process alive"*, and a drain loop inside the service keeps pulling the
server's unprinted-order queue and printing — screen off or not.

---

## How it works

```
app/_layout.tsx
  registerPrintSinkRunner()        // module scope — registers the FGS task once
  watchPrintSinkLifecycle()        // effect — reconciles start/stop every 8s

context/AuthContext.tsx
  login / restore  → setSinkContext({ authed:true, restaurantName })
  logout           → setSinkContext({ authed:false }) + stopPrintSink()

app/(staff)/index.tsx, app/(cook)/index.tsx
  toggle changes   → setSinkContext({ autoPrint })

services/printSink.ts   ← the service itself
  registerPrintSinkRunner()  registers a Notifee foreground-service task whose
                             promise never resolves; it owns a 15s drain loop.
  startPrintSink()           shows the ongoing notification → starts the service
  stopPrintSink()            tears down the service + notification
  watchPrintSinkLifecycle()  starts the service only while:
                               signed in  AND  auto-print on  AND  printer paired
  drainPendingPrintJobs()    GET /crew/print/pending → printKot() for each
```

### The print path is unchanged

The service reuses the exact same `printKot()` from `services/printer.ts`, which
**de-duplicates** (in-flight set + 90s recently-printed TTL). So the foreground
service drain, the on-screen drains, and the live Ably push can all run together
and **never double-print** an order. A failed print is not marked done, so the
server pull-queue hands it back on the next loop until it succeeds.

### What starts / stops the service

`watchPrintSinkLifecycle()` runs a small reconcile loop (every 8s). The service
runs **only** when all three are true:

1. a crew member is signed in,
2. KOT auto-print is enabled (the toggle on the Printer screen), and
3. this device holds the Bluetooth pairing (`getStatus() === 'connected'`).

Flip any of those off and the service (and its notification) stops.

---

## Native configuration

### `@notifee/react-native` (v9.1.8)
Provides the foreground-service primitive. Autolinks via Expo prebuild — no
config plugin of its own is required for the service.

### `plugins/withKotForegroundService.js`
A custom Expo config plugin (same pattern as
`withAllowNativeHeapPointerTagging.js`) that, on prebuild:

1. ensures the `xmlns:tools` namespace on `<manifest>`,
2. ensures these permissions:
   - `FOREGROUND_SERVICE`
   - `FOREGROUND_SERVICE_CONNECTED_DEVICE`
   - `POST_NOTIFICATIONS`
3. merges `android:foregroundServiceType="connectedDevice"` onto Notifee's
   `app.notifee.core.ForegroundService` via `tools:node="merge"`.

> **Step 3 is the critical Android-14 (API 34) requirement.** Without the
> `foregroundServiceType` on the service element, Android 14 throws
> `MissingForegroundServiceTypeException` and crashes the moment the service
> starts. We use the `connectedDevice` type because the sink talks to a
> Bluetooth printer.

The plugin is registered in `app.json` → `expo.plugins`.

### Verifying the generated manifest (no build needed)
```bash
npx expo config --type introspect --json \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d,indent=1))" \
  | grep -A2 notifee.core.ForegroundService
```
Expected:
```
"android:name": "app.notifee.core.ForegroundService",
"android:foregroundServiceType": "connectedDevice",
"tools:node": "merge"
```

---

## Building it

This is a **native** change — it cannot ship via OTA (`eas update`). It needs a
new build that every print-sink device installs.

```bash
# from quinckle crew app expo/quinckle-crew-app
npx expo prebuild --platform android --clean   # regenerates android/ with the plugin
# re-add SDK path if needed:
#   echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
npx expo run:android                            # local debug build + install
```

For a distributable build:
```bash
eas build --platform android --profile apk      # internal APK
```

> After `prebuild --clean`, re-check that the notification large-icon drawable
> (`ic_notification_large`) is present if you rely on it — prebuild regenerates
> the `android/` tree.

---

## Operational guidance (give this to the venue)

A foreground service keeps the app alive, but aggressive OEM battery managers
(Xiaomi/MIUI, Samsung, Oppo, Vivo, Realme) can still kill it. For a reliable
print sink:

1. **Dedicate the device** to QuinckleCrew and keep it **plugged into power**.
2. **Disable battery optimization** for the app:
   Settings → Apps → QuinckleCrew → Battery → **Unrestricted**.
3. **Allow autostart** (MIUI/ColorOS/FuntouchOS): Settings → Apps → QuinckleCrew
   → enable **Autostart**.
4. Keep the app **signed in** and a **printer paired** — the ongoing
   "Quinckle — printer ready" notification confirms the sink is active.

If the notification is showing, the sink is alive and will print with the screen
off. If it's gone, one of {signed out, auto-print off, printer unpaired, OEM
killed it} is true.

---

## Rollback

- The service is gated behind the new native build. If a build misbehaves, ship
  the previous build; nothing about the server or other apps changes.
- To disable the feature in code without removing it: remove
  `watchPrintSinkLifecycle()` from `app/_layout.tsx` (the service then never
  starts) and rebuild. The OTA-level auto-print (foreground) keeps working.
