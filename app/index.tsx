// app/index.tsx
import { useRootNavigationState, router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Image, 
  Animated, 
  Dimensions, 
  StatusBar 
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { landingStackFor } from '../constants/capabilities';
import { QuinckleColors } from '../constants/Colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function Index() {
  const { role, isRestoring, staffInfo } = useAuth();
  const rootNavigationState = useRootNavigationState();
  const [isSplashReady, setIsSplashReady] = useState(false);
  
  // Animation values
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Start splash animation
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 10,
        friction: 5,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();

    // Simulation of initialization/loading
    const timer = setTimeout(() => {
      setIsSplashReady(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [logoScale, logoOpacity]);

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
      <View style={styles.content}>
        <Animated.View style={[
          styles.logoContainer,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }]
          }
        ]}>
          <Image
            source={require('../assets/images/logo/quinckle crew logo dark.webp')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: SCREEN_WIDTH * 0.7,
    height: 120,
  },
});
