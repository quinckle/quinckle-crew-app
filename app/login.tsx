import { router } from 'expo-router';
import React, { useState } from 'react';
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
import { devApi } from '../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [showSimMenu, setShowSimMenu] = useState(false);
  const { login } = useAuth();

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/credential');
  };

  const handleSimLogin = async (role: 'staff' | 'cook') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowSimMenu(false);

    try {
      // Try real backend: fetch seeded staff and bypass OTP for the right role
      const state = await devApi.getState();
      const targetRole = role === 'staff' ? 'STEWARD' : 'CHEF';
      const match = state.staff.find(s => s.role === targetRole)
        ?? state.staff.find(s => role === 'staff' ? ['STEWARD', 'CASHIER', 'ADMIN'].includes(s.role) : s.role === 'CHEF');

      if (match) {
        const result = await devApi.crewLoginBypass(match.phone);
        login(role, result.crewToken, result.staff);
        router.replace(role === 'staff' ? '/(staff)' : '/(cook)');
        return;
      }
    } catch {
      // Backend not running — fall through to offline mock
    }

    // Offline fallback: no real token, just set the role
    login(role);
    router.replace(role === 'staff' ? '/(staff)' : '/(cook)');
  };

  return (
    <View style={styles.container}>
      <View style={styles.heroContainer}>
        <Image
          source={require('../assets/images/auth/quinckle crew auth hero.png')}
          style={styles.heroImage}
          resizeMode="cover"
        />

        <LinearGradient
          colors={['transparent', 'rgba(10,10,11,0.4)', QuinckleColors.background]}
          locations={[0, 0.6, 1]}
          style={styles.heroGradient}
        />

        <View style={[styles.topBarOverlay, { top: insets.top > 0 ? insets.top + 4 : 24 }]}>
          <TouchableOpacity
            style={styles.simToggle}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowSimMenu(!showSimMenu);
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="flask-outline" size={13} color={QuinckleColors.primary} />
            <Text style={styles.simToggleText}>Test Access</Text>
          </TouchableOpacity>
        </View>

        {showSimMenu && (
          <View style={[styles.simDropdown, { top: (insets.top > 0 ? insets.top + 4 : 24) + 40 }]}>
            <TouchableOpacity style={styles.simOption} onPress={() => handleSimLogin('cook')} activeOpacity={0.7}>
              <View style={styles.simIconWrap}>
                <Ionicons name="flame" size={14} color={QuinckleColors.primary} />
              </View>
              <Text style={styles.simOptionText}>Kitchen Staff</Text>
            </TouchableOpacity>
            <View style={styles.simDivider} />
            <TouchableOpacity style={styles.simOption} onPress={() => handleSimLogin('staff')} activeOpacity={0.7}>
              <View style={styles.simIconWrap}>
                <Ionicons name="people" size={14} color={QuinckleColors.primary} />
              </View>
              <Text style={styles.simOptionText}>Steward</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={[styles.bottomCard, { paddingBottom: insets.bottom + Spacing.huge }]}>
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeTitle}>Welcome, Crew</Text>
          <Text style={styles.welcomeSubtitle}>
            Your terminal for managing orders and tables{`\n`}across the floor.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.ctaButton}
          onPress={handleGetStarted}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Get Started</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.termsText}>
          By continuing, you agree to our{' '}
          <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },

  heroContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.62,
    position: 'relative',
  },
  heroImage: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
  },

  topBarOverlay: {
    position: 'absolute',
    right: Spacing.xxl,
    zIndex: 100,
  },
  simToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(10,10,11,0.7)',
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
  },
  simToggleText: {
    color: QuinckleColors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },

  simDropdown: {
    position: 'absolute',
    right: Spacing.xxl,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
    paddingVertical: 6,
    paddingHorizontal: 6,
    zIndex: 200,
    elevation: 20,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    minWidth: 190,
  },
  simOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
  },
  simIconWrap: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  simOptionText: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  simDivider: {
    height: 1,
    backgroundColor: QuinckleColors.borderSubtle,
    marginHorizontal: Spacing.sm,
  },

  bottomCard: {
    backgroundColor: QuinckleColors.background,
    paddingTop: Spacing.xxxl,
    paddingHorizontal: Spacing.xxl,
    marginTop: -40,
  },

  welcomeSection: {
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xxl,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.6,
  },
  welcomeSubtitle: {
    ...Typography.body,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  ctaButton: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.lg,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  termsText: {
    textAlign: 'center',
    fontSize: 12,
    color: QuinckleColors.textTertiary,
    lineHeight: 18,
    paddingHorizontal: Spacing.xxl,
  },
  termsLink: {
    color: QuinckleColors.primary,
    fontWeight: '600',
  },
});
