/**
 * Wake-on-push background KOT print.
 *
 * Problem: the Android foreground service (services/printSink.ts) keeps KOTs
 * printing while the app is backgrounded-but-alive — but once the app is
 * *swiped away* or killed by the OS / an aggressive OEM battery manager, the
 * process (and the FGS) is gone, so nothing prints until someone reopens the
 * app. The visible FCM new-order alert can't fix this: a message with a
 * `notification` block is handled by the OS and never runs our JS when killed.
 *
 * Fix: the backend also sends a SILENT, data-only push (`type: 'print_wake'`,
 * see wakeCrewForPrint on the server). A data-only message DOES invoke this
 * registered background task even from a fully-closed app — Android spins the
 * JS runtime up briefly, we drain the server's unprinted-KOT queue and print,
 * then it winds down.
 *
 * Cold-start caveat: when the app was killed, none of the React layer ran, so
 * the API auth token, printer config and sink context are all empty module
 * state. bootstrapForBackgroundPrint() restores them from SecureStore /
 * AsyncStorage before draining. printKot de-dupes, so this overlapping with the
 * FGS drain and the live Ably push never double-prints.
 *
 * Android-only in practice; on iOS the silent push still fires the task but the
 * Bluetooth print path is a no-op there.
 */

import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { setCrewToken } from './api';
import { initPrinter } from './printer';
import { setSinkContext, drainPendingPrintJobs } from './printSink';

// Task name registered with expo-notifications' background dispatcher.
const PRINT_WAKE_TASK = 'quinckle-print-wake';

// Persistence keys — kept in sync with context/AuthContext.tsx + printSink.ts.
const TOKEN_KEY = 'crewToken';
const STAFF_KEY = 'quinckle_crew_staff';
const AUTOPRINT_KEY = 'kotAutoPrintEnabled';

/**
 * Restore auth + printer config + sink context in a cold/headless start (the
 * React layer never ran, so all of it is empty). Returns false if there's no
 * signed-in crew member — nothing to print for.
 */
async function bootstrapForBackgroundPrint(): Promise<boolean> {
  try {
    const [token, staffRaw, autoRaw] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      AsyncStorage.getItem(STAFF_KEY),
      AsyncStorage.getItem(AUTOPRINT_KEY),
    ]);
    if (!token) return false;
    setCrewToken(token);

    let restaurantName = '';
    if (staffRaw) {
      try {
        restaurantName = (JSON.parse(staffRaw)?.staffInfo?.restaurantName as string) ?? '';
      } catch {
        /* keep default */
      }
    }
    // Default ON — matches the app default when the toggle was never persisted.
    const autoPrint = autoRaw == null ? true : autoRaw === 'true';

    setSinkContext({ authed: true, restaurantName, autoPrint });
    await initPrinter(); // loads the saved Bluetooth pairing → status 'connected'
    return true;
  } catch {
    return false;
  }
}

// Register the task body ONCE at module load. defineTask must run at module
// scope so the OS can re-invoke it after the app was killed.
TaskManager.defineTask(PRINT_WAKE_TASK, async () => {
  // We deliberately don't gate on the message contents: draining is idempotent
  // and de-duped, so running it on any received push is harmless — and it means
  // a missed/garbled payload still results in the KOT printing.
  const ready = await bootstrapForBackgroundPrint();
  if (!ready) return;
  await drainPendingPrintJobs();
});

/**
 * Wire the background task into expo-notifications' remote-message dispatcher.
 * Call once at app start (module scope in app/_layout.tsx). No-op if the task
 * is already registered.
 */
export function registerPrintWakeTask(): void {
  Notifications.registerTaskAsync(PRINT_WAKE_TASK).catch((err) => {
    console.warn('[print-wake] failed to register background task', err);
  });
}
