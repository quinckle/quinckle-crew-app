import { AuthProvider } from '@/context/AuthContext';
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { QuinckleColors } from '@/constants/Colors';
import { initPrinter } from '@/services/printer';
import { registerPrintSinkRunner, watchPrintSinkLifecycle } from '@/services/printSink';
import { registerPrintWakeTask } from '@/services/printBackgroundTask';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  } as any),
});

// Register the background-print foreground-service task at module scope (before
// the app finishes booting) so Android can re-attach it if it restarts the
// service. No-op on iOS.
registerPrintSinkRunner();

// Register the wake-on-push background task so a fully-closed / OEM-killed app
// is woken by the backend's silent `print_wake` push to drain + print pending
// KOTs. Must be at module scope so the OS can invoke it after an app kill.
registerPrintWakeTask();

export default function RootLayout() {
  // Restore the saved Bluetooth printer config so printing survives restarts.
  // Without this, getStatus() reports 'unpaired' on every launch and all KOT/
  // bill printing (and the cook's pending-print drain) is silently skipped.
  useEffect(() => {
    void initPrinter();
  }, []);

  // Drive the background-print foreground service: it runs only while a crew
  // member is signed in AND this device holds the Bluetooth pairing. This keeps
  // the JS runtime alive so KOTs print even with the screen off / app
  // backgrounded. Self-contained — no coupling to the dashboards.
  useEffect(() => {
    const stop = watchPrintSinkLifecycle();
    return stop;
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
