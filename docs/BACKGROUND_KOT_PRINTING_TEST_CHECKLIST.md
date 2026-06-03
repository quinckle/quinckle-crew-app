# Background KOT Printing — Test Checklist

Work through this on a **real Android device with the actual Bluetooth printer**.
An emulator cannot test Bluetooth printing. Test on at least one **Android 14+**
device (the foreground-service-type rules are strictest there) and, if possible,
one older (Android 12/13) device.

Tick each box. If any **MUST-PASS** item fails, do **not** publish — note the
failure and come back.

---

## 0. Build

- [ ] `npx expo prebuild --platform android --clean` completes with no error
- [ ] `android/local.properties` has the SDK path (`sdk.dir=...`) if the build complains
- [ ] `npx expo run:android` builds and installs (this is the moment a bad
      foreground-service config would fail the Gradle build) — **MUST PASS**
- [ ] App launches without crashing — **MUST PASS**
      *(an Android-14 FGS-type misconfig crashes on launch / first service start)*

## 1. Service starts under the right conditions

- [ ] Sign in as Staff (or Cook), pair the Bluetooth printer on the Printer screen
- [ ] Within ~10s an ongoing notification **"Quinckle — printer ready"** appears — **MUST PASS**
- [ ] The notification is **silent** and **non-dismissable** (ongoing) while paired
- [ ] Notification icon renders (Quinckle mark; if it shows the default app icon,
      note it — see Troubleshooting "icon")

## 2. Service stops under the right conditions

- [ ] Unpair the printer → notification disappears within ~10s
- [ ] Re-pair → notification returns
- [ ] Turn **off** the KOT auto-print toggle → notification disappears
- [ ] Turn it back **on** → notification returns
- [ ] Log out → notification disappears immediately — **MUST PASS**

## 3. Core: prints with screen OFF — **the whole point**

- [ ] Printer paired, auto-print on, "printer ready" notification showing
- [ ] **Press the power button to turn the screen off** (do not unplug)
- [ ] From another device, place a dine-in order on a table for this restaurant
- [ ] KOT prints within ~15–20s **with the screen still off** — **MUST PASS**

## 4. Core: prints when app is backgrounded

- [ ] Press Home (app to background), screen on
- [ ] Place an order from another device
- [ ] KOT prints within ~15–20s without reopening the app — **MUST PASS**

## 5. No double-printing

- [ ] App **foregrounded** on the dashboard, place one order
- [ ] Exactly **one** KOT prints (not two) — **MUST PASS**
      *(verifies the live Ably push + the FGS drain de-dupe correctly)*
- [ ] Place 3 orders quickly → exactly 3 KOTs, one per order, no duplicates

## 6. Self-healing / recovery

- [ ] **Turn the printer OFF**, place an order → nothing prints (expected)
- [ ] **Turn the printer back ON** → the missed KOT prints automatically within
      ~15s, no manual action — **MUST PASS**
- [ ] **Turn Bluetooth off** on the phone, place an order, turn BT back on →
      KOT prints once BT + printer reconnect
- [ ] Kill the app from recents, reopen → any order placed while it was dead
      prints on relaunch (server pull-queue backstop)

## 7. Staff identity (the original bug)

- [ ] Printer paired on this device by staff member A
- [ ] Log out, log in as staff member **B** on the **same device**
- [ ] Place an order → KOT prints for B too — **MUST PASS**
      *(confirms printing is gated on the device's BT pairing, not on who paired)*

## 8. Manual reprint still works

- [ ] Trigger a reprint from the partner dashboard → KOT reprints even if that
      order printed seconds ago (reprint bypasses de-dup)

## 9. Battery / longevity (do last, leave running)

- [ ] Set the app to **Unrestricted** battery (Settings → Apps → QuinckleCrew →
      Battery), enable **Autostart** on MIUI/ColorOS if present
- [ ] Leave the device idle, screen off, ~30–60 min
- [ ] Place an order → still prints — **MUST PASS for the target device model**
      *(if it fails only here, it's the OEM battery killer — document the device
      and the required battery setting; this is a device-config issue, not a code bug)*

## 10. iOS sanity (if you ship iOS)

- [ ] iOS build runs, no crash, no "printer ready" notification (expected — FGS
      is Android-only), foreground printing still works

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| **Build fails** at Gradle | plugin / Notifee native issue | read the Gradle error; confirm `npx expo config --type introspect --json \| grep foregroundServiceType` shows `connectedDevice` |
| **Crash on launch / first order** (Android 14) | missing `foregroundServiceType` | confirm the manifest merge applied (see doc); rebuild with `--clean` |
| **No "printer ready" notification** | notifications blocked | grant POST_NOTIFICATIONS; check Settings → Apps → Notifications |
| **Notification shows app icon, not Quinckle mark** | `smallIcon: 'notification_icon'` drawable name mismatch | check the drawable name the expo-notifications plugin generated in `android/app/src/main/res/drawable*`; update `smallIcon` in `services/printSink.ts` |
| **Prints with screen off but not after long idle** | OEM battery killer | Unrestricted battery + Autostart; this is expected OEM behavior, not a code bug |
| **Double prints** | de-dup regression | should not happen — capture logs and check `printKot` `_inFlight` / `_recentlyPrinted` |

---

## Publish (only after all MUST-PASS boxes are ticked)

1. Merge `feat/background-kot-printing` → `main`
2. Bump the app version (native change — new build, new version)
3. Build the distributable: `eas build --platform android --profile apk` (or `production`)
4. Distribute the new build to all print-sink devices (this **cannot** be OTA'd)
5. Walk each venue through the battery/autostart settings (section 9)

> Note: future **JS-only** fixes still OTA as before; only this native service
> required a build.
