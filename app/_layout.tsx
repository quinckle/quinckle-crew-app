import { AuthProvider } from '@/context/AuthContext';
import { Stack } from 'expo-router';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { QuinckleColors } from '@/constants/Colors';
import { initPrinter } from '@/services/printer';
import { registerPrintSinkRunner, watchPrintSinkLifecycle } from '@/services/printSink';
import { watchForOtaUpdates } from '@/services/otaUpdate';
import { isDesktop } from '@/services/platform';
import '@/services/webFocusRing';

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

/**
 * Navigation theme for the desktop shell.
 *
 * React Navigation's implicit DefaultTheme paints its backdrop
 * rgb(242, 242, 242), which is what showed as two light arcs behind the
 * screen's rounded top corners in the Electron window. Desktop gets a backdrop
 * that matches the app instead, so nothing light can appear behind a screen
 * during a transition either.
 */
const DesktopNavTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: QuinckleColors.background },
};

export default function RootLayout() {
  // Desktop design diverges from the phone from here on; see services/platform.
  const desktop = isDesktop();

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

  // Auto-apply OTA updates in-session so a device that stays running (the print
  // FGS keeps it alive) doesn't lag a published update until its next cold start.
  // Reloads only while foregrounded — never mid background print. See otaUpdate.ts.
  useEffect(() => {
    const stop = watchForOtaUpdates();
    return stop;
  }, []);

  const stack = (
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
          // The rounded top corners are a phone affordance — they make a pushed
          // screen read as a sheet sliding over the one beneath. In a maximised
          // desktop window they are just two bites out of the top edge, with
          // the navigator's backdrop showing through them.
          ...(desktop ? null : {
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            overflow: 'hidden' as const,
          }),
        },
      }}
    />
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: QuinckleColors.background }}>
      <AuthProvider>
        <StatusBar style="light" />
        {/* The phone keeps React Navigation's implicit theme; only desktop is
            re-themed, so this changes nothing that ships to a device. */}
        {desktop ? <ThemeProvider value={DesktopNavTheme}>{stack}</ThemeProvider> : stack}
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
