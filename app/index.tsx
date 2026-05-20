// app/index.tsx
import { Redirect, useRootNavigationState, router } from 'expo-router';
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
import { QuinckleColors } from '../constants/Colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function Index() {
  const { role, isRestoring } = useAuth();
  const rootNavigationState = useRootNavigationState();
  const [isSplashReady, setIsSplashReady] = useState(false);
  
  // Animation values
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const splashOpacity = useRef(new Animated.Value(1)).current;

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
  }, []);

  // Handle redirect only after splash is done AND navigation is ready
  const isReady = rootNavigationState?.key && isSplashReady && !isRestoring;

  if (isReady) {
    if (role === null) return <Redirect href="/login" />;
    if (role === 'staff') return <Redirect href="/(staff)" />;
    return <Redirect href="/(cook)" />;
  }

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