// app/index.tsx
import { useRootNavigationState, router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, StatusBar } from 'react-native';
import { OrbitSplash, ORBIT_SPLASH_MS } from '../components/splash/OrbitSplash';
import { useAuth } from '../context/AuthContext';
import { landingStackFor } from '../constants/capabilities';
import { QuinckleColors } from '../constants/Colors';

export default function Index() {
  const { role, isRestoring, staffInfo } = useAuth();
  const rootNavigationState = useRootNavigationState();
  const [isSplashReady, setIsSplashReady] = useState(false);
  
  // Auth restore runs underneath; leave once the animation has played out.
  useEffect(() => {
    const timer = setTimeout(() => setIsSplashReady(true), ORBIT_SPLASH_MS + 150);
    return () => clearTimeout(timer);
  }, []);

  // Handle redirect only after splash is done AND navigation is ready
  const isReady = rootNavigationState?.key && isSplashReady && !isRestoring;

  // Route imperatively exactly once. This screen subscribes to
  // useRootNavigationState(), so it re-renders on every navigation. A
  // declarative <Redirect href="/login"> here re-fired on every re-render
  // while logged out, fighting the login screen's own internal step state
  // (the "auth page keeps redirecting back" bug). A one-shot guarded replace
  // decides the entry route and then never fights forward nav.
  const hasRedirected = useRef(false);
  useEffect(() => {
    if (!isReady || hasRedirected.current) return;
    hasRedirected.current = true;
    if (role === null) {
      router.replace('/login');
      return;
    }
    // A restored session carries the stack chosen at its last login, which may
    // predate a capability change (e.g. a chef who has since been given floor
    // duties). Re-derive from capabilities; falls back to the stored role when
    // they're unknown, so nothing changes against an older backend.
    const stack = landingStackFor(staffInfo?.capabilities, staffInfo?.role) ?? role;
    router.replace(stack === 'cook' ? '/(cook)' : '/(staff)');
  }, [isReady, role, staffInfo?.capabilities, staffInfo?.role]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <OrbitSplash />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },
});
