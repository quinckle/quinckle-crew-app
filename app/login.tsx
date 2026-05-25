import { router } from 'expo-router';
import React from 'react';
import {
  Dimensions,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing, Typography } from '../constants/Colors';
import { useAuth } from '../context/AuthContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/credential');
  };

  return (
    <View style={styles.container}>
      {/* Full screen background hero */}
      <View style={StyleSheet.absoluteFillObject}>
        <Image
          source={require('../assets/images/auth/auth hero.webp')}
          style={styles.heroImage}
          resizeMode="cover"
        />
        {/* Dark overlay fading smoothly into the bottom */}
        <LinearGradient
          colors={['transparent', 'rgba(10, 10, 11, 0.01)', QuinckleColors.background, QuinckleColors.background]}
          locations={[0, 0.4, 0.8, 1]}
          style={StyleSheet.absoluteFillObject}
        />
      </View>

      {/* Bottom Fixed Content Area */}
      <View style={styles.contentWrapper}>
        <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.greetingContainer}>
            <Text style={styles.greetingTitle}>Welcome, Crew</Text>
            <Text style={styles.greetingSubtitle}>Manage your floor seamlessly.</Text>
          </View>

          <TouchableOpacity
            style={styles.ctaButton}
            onPress={handleGetStarted}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaText}>Get Started</Text>
          </TouchableOpacity>

          <Text style={styles.termsText}>
            By continuing, you agree to our{' '}
            <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },

  heroImage: {
    width: '100%',
    height: '100%',
  },

  contentWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  bottomOverlay: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    width: '100%',
  },

  greetingContainer: {
    marginBottom: Spacing.xl,
  },
  greetingTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: QuinckleColors.textPrimary,
    letterSpacing: -1,
    marginBottom: Spacing.xs,
  },
  greetingSubtitle: {
    fontSize: 16,
    color: QuinckleColors.textSecondary,
    letterSpacing: 0,
  },

  ctaButton: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.lg,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    width: '100%',
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  termsText: {
    textAlign: 'center',
    fontSize: 11,
    color: QuinckleColors.textTertiary,
    lineHeight: 16,
    paddingHorizontal: Spacing.md,
  },
  termsLink: {
    color: QuinckleColors.primary,
    fontWeight: '600',
  },
});
