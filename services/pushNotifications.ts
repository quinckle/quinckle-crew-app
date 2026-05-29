import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { crewNotifications } from './api';

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
    deviceName: (Constants as any).deviceName ?? undefined,
    appVersion: Constants.expoConfig?.version ?? undefined,
  });
  lastRegisteredToken = token;
  lastHeartbeatAt = Date.now();
}

export async function heartbeatCrewPushToken(force = false): Promise<void> {
  if (!lastRegisteredToken) return;
  const now = Date.now();
  if (!force && now - lastHeartbeatAt < 5 * 60_000) return;
  try {
    await crewNotifications.heartbeat(lastRegisteredToken);
    lastHeartbeatAt = now;
  } catch (err) {
    console.warn('[push] heartbeat failed', err);
  }
}
