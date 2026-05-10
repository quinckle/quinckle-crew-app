// app/login.tsx
import { router } from 'expo-router';
import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { QuinckleColors } from '../constants/Colors';
import { useAuth } from '../context/AuthContext';
import { useEffect } from 'react';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [showSimMenu, setShowSimMenu] = useState(false);
  const { login } = useAuth();

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/credential');
  };

  const handleSimLogin = (role: 'staff' | 'cook') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowSimMenu(false);
    login(role);
    router.replace(role === 'staff' ? '/(staff)' : '/(cook)');
  };

  return (
    <View style={styles.container}>
      {/* ── Hero Image Section ── */}
      <View style={styles.heroContainer}>
        <Image
          source={require('../assets/images/auth/quinckle crew auth hero.png')}
          style={styles.heroImage}
          resizeMode="cover"
        />

        <LinearGradient
          colors={['transparent', QuinckleColors.background]}
          style={styles.heroGradient}
        />

        {/* Test Access Overlay */}
        <View style={[styles.topBarOverlay, { top: insets.top > 0 ? insets.top : 20 }]}>
          <TouchableOpacity
            style={styles.simToggle}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowSimMenu(!showSimMenu);
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="flask" size={14} color={QuinckleColors.primary} />
            <Text style={styles.simToggleText}>Test Access</Text>
          </TouchableOpacity>
        </View>

        {showSimMenu && (
          <View style={[styles.simDropdown, { top: (insets.top > 0 ? insets.top : 20) + 44 }]}>
            <TouchableOpacity style={styles.simOption} onPress={() => handleSimLogin('cook')}>
              <View style={styles.simIconWrap}><Ionicons name="flame" size={14} color={QuinckleColors.primary} /></View>
              <Text style={styles.simOptionText}>Kitchen Staff</Text>
            </TouchableOpacity>
            <View style={styles.simDivider} />
            <TouchableOpacity style={styles.simOption} onPress={() => handleSimLogin('staff')}>
              <View style={styles.simIconWrap}><Ionicons name="people" size={14} color={QuinckleColors.primary} /></View>
              <Text style={styles.simOptionText}>Steward</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── CTA Section ── */}
      <View style={[styles.inputCard, { paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeTitle}>Welcome, Crew</Text>
          <Text style={styles.welcomeSubtitle}>
            Your one-stop terminal for managing orders and tables efficiently.
          </Text>
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
          <Text style={styles.termsLink}>Privacy Policy</Text>
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
  contentContainer: {
    flex: 1,
  },
  inputCard: {
    backgroundColor: QuinckleColors.background,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 32,
    paddingHorizontal: 24,
    // paddingBottom handled inline with insets
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -10 },
    elevation: 10,
    marginTop: -30, // Slight overlap with hero gradient
  },

  /* ── Top Bar Overlay ── */
  topBarOverlay: {
    position: 'absolute',
    right: 24,
    zIndex: 100,
  },
  simToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: 'rgba(9,9,11,0.6)', // Darker background to pop on image
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  simToggleText: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },

  /* ── Sim Dropdown ── */
  simDropdown: {
    position: 'absolute',
    top: 56, // Base top, overridden by inline style with insets
    right: 24,
    backgroundColor: QuinckleColors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
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
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  simIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(243,93,59,0.12)',
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: 8,
  },

  /* ── Hero ── */
  heroContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65, // Increased height for "fully spread" feel
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
    height: 150, // Height of the fade transition
  },

  /* ── Welcome ── */
  welcomeSection: {
    alignItems: 'center',
    gap: 4,
    marginBottom: 20,
    paddingHorizontal: 24,
  },
  welcomeTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.5,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  /* ── Input ── */
  inputSection: {
    gap: 8,
    marginBottom: 20,
    paddingHorizontal: 24,
  },
  fieldLabel: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginLeft: 2,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 4,
    height: 54,
  },
  countryCodeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  flagEmoji: {
    fontSize: 18,
  },
  countryCodeText: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  inputDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  phoneInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '500',
    paddingHorizontal: 12,
    letterSpacing: 0.5,
  },
  validBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: QuinckleColors.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },

  /* ── CTA ── */
  ctaButton: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: 14,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 28,
    marginHorizontal: 24,
  },
  ctaDisabled: {
    backgroundColor: 'rgba(243,93,59,0.35)',
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.2,
  },

  /* ── Terms ── */
  termsText: {
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(161,161,170,0.6)',
    lineHeight: 18,
    paddingHorizontal: 40,
  },
  termsLink: {
    color: QuinckleColors.primary,
    fontWeight: '500',
  },
});
