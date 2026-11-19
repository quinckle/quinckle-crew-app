import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { crewNotifications } from './api';
import { getPrintDeviceId } from './printDevice';
import { getVoiceAlertSetting } from './voiceAlerts';

let lastRegisteredToken: string | null = null;
let lastHeartbeatAt = 0;

export async function registerCrewPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('crew-alerts', {
      name: 'Crew alerts',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'waiter_notification.mp3',
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    // Call Staff gets its own channel: a channel's sound is fixed on the phone
    // the first time it's created, so the alarm can't share `crew-alerts`.
    // ALARM usage plays on the alarm stream — loud even with the ringer on
    // silent — and the server only targets this channel from app 1.1.0 up
    // (STAFF_CALL_CHANNEL_MIN_APP in the backend), so the id must not change.
    await Notifications.setNotificationChannelAsync('staff-call', {
      name: 'Diner calls',
      description: 'Rings loudly when a diner taps Call Staff',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'staff_call_alarm.wav',
      enableVibrate: true,
      vibrationPattern: [0, 700, 300, 700, 300, 700, 900, 700, 300, 700, 300, 700],
      bypassDnd: true,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    // Spoken new-order alerts with the app closed: one channel per voice and
    // order type, each with its clip bundled as the channel sound. The server
    // picks `order-<type>-<voice>` from the voice this phone reports (see
    // heartbeat), so these ids must match the backend and never change.
    for (const voice of ['female', 'male'] as const) {
      for (const [slug, label] of [['dine_in', 'Dine-in'], ['takeaway', 'Takeaway'], ['delivery', 'Delivery']] as const) {
        await Notifications.setNotificationChannelAsync(`order-${slug}-${voice}`, {
          name: `${label} orders (${voice} voice)`,
          description: `Says "New ${label.toLowerCase()} order received" when voice alerts are on`,
          importance: Notifications.AndroidImportance.MAX,
          sound: `en_${voice}_${slug}.mp3`,
          vibrationPattern: [0, 250, 250, 250],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }
    }
  }

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;
  if (finalStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[push] permission not granted');
    return;
  }

  if (Constants.appOwnership === 'expo') {
    console.warn('[push] Expo Go cannot receive remote push notifications; use a dev or production build');
    return;
  }

  // Register the NATIVE FCM device token (Android) / APNs token (iOS) rather
  // than an Expo push token. The backend sends true FCM notification messages
  // via firebase-admin, which the OS displays even when the app is fully
  // closed/killed — the Expo-push data-message path did not survive kill.
  const tokenData = await Notifications.getDevicePushTokenAsync();
  const token = typeof tokenData.data === 'string' ? tokenData.data : String(tokenData.data);
  if (!token) {
    console.warn('[push] no device push token returned');
    return;
  }
  if (token === lastRegisteredToken) return;

  await crewNotifications.registerToken(token, {
    platform: Platform.OS,
    // The same install id a printer records as its host, so the backend can
    // send a print wake to just the phone that prints instead of every phone.
    deviceId: await getPrintDeviceId(),
    deviceName: (Constants as any).deviceName ?? undefined,
    appVersion: Constants.expoConfig?.version ?? undefined,
    voice: await getVoiceAlertSetting(),
  });
  lastRegisteredToken = token;
  lastHeartbeatAt = Date.now();
}

export async function heartbeatCrewPushToken(force = false): Promise<void> {
  if (!lastRegisteredToken) return;
  const now = Date.now();
  if (!force && now - lastHeartbeatAt < 5 * 60_000) return;
  try {
    await crewNotifications.heartbeat(lastRegisteredToken, await getVoiceAlertSetting());
    lastHeartbeatAt = now;
  } catch (err) {
    console.warn('[push] heartbeat failed', err);
  }
}
