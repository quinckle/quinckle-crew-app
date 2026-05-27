import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { crewNotifications } from './api';

let lastRegisteredToken: string | null = null;

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

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;

  if (!projectId || projectId === 'REPLACE_WITH_EAS_PROJECT_ID') {
    console.warn('[push] EAS projectId not configured in app.json');
    return;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;
  if (token === lastRegisteredToken) return;

  await crewNotifications.registerToken(token, {
    platform: Platform.OS,
    deviceName: (Constants as any).deviceName ?? undefined,
    appVersion: Constants.expoConfig?.version ?? undefined,
  });
  lastRegisteredToken = token;
}
