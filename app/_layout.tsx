import { AuthProvider } from '@/context/AuthContext';
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { QuinckleColors } from '@/constants/Colors';
import { initPrinter } from '@/services/printer';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  } as any),
});

export default function RootLayout() {
  // Restore the saved Bluetooth printer config so printing survives restarts.
  // Without this, getStatus() reports 'unpaired' on every launch and all KOT/
  // bill printing (and the cook's pending-print drain) is silently skipped.
  useEffect(() => {
    void initPrinter();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: QuinckleColors.background }}>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            animationDuration: 250,
            animationTypeForReplace: 'push',
            gestureEnabled: true,
            gestureDirection: 'horizontal',
            presentation: 'card',
            contentStyle: {
              backgroundColor: QuinckleColors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              overflow: 'hidden',
            },
          }}
        />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
