import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing, Typography } from '../constants/Colors';
import { useAuth } from '../context/AuthContext';
import { crewAuth } from '../services/api';
import { landingStackFor } from '../constants/capabilities';
import { useResponsive } from '../hooks/useResponsive';
import { AuthSplit } from '../components/auth/AuthSplit';
import { AuthStack } from '../components/auth/AuthStack';

const OTP_LENGTH = 4;
const BLINK_DURATION = 500;

// Offline fallback: used ONLY in development when the local API server is
// unreachable. In production builds Metro replaces `__DEV__` with `false` and
// dead-code-eliminates this object, so the lookup below can never match.
// NEVER add real or shared credentials here.
const MOCK_CREDENTIALS: Record<string, { otp: string; role: 'staff' | 'cook' }> = __DEV__
  ? {
      '1234567890': { otp: '123456', role: 'staff' },
      '0987654321': { otp: '654321', role: 'cook' },
    }
  : {};

type Step = 'welcome' | 'phone' | 'otp';

export default function LoginScreen() {
  const { isWide } = useResponsive();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>('welcome');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isFocused, setIsFocused] = useState(false);

  // Countdown timer for resend cooldown
  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const inputBorderAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const cursorOpacity = useRef(new Animated.Value(1)).current;
  const digitAnims = useRef(Array.from({ length: OTP_LENGTH }, () => new Animated.Value(1))).current;

  // Crossfade whenever the step changes, so swapping welcome <-> phone <-> otp
  // reads as one smooth transition instead of an instant cut.
  const contentFade = useRef(new Animated.Value(1)).current;
  const contentRise = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    contentFade.setValue(0);
    contentRise.setValue(10);
    Animated.parallel([
      Animated.timing(contentFade, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(contentRise, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  React.useEffect(() => {
    if (isFocused && step === 'otp') {
      const blink = Animated.loop(
        Animated.sequence([
          Animated.timing(cursorOpacity, { toValue: 0, duration: BLINK_DURATION, useNativeDriver: true }),
          Animated.timing(cursorOpacity, { toValue: 1, duration: BLINK_DURATION, useNativeDriver: true }),
        ]),
      );
      blink.start();
      return () => blink.stop();
    }
  }, [isFocused, step, cursorOpacity]);

  const animateDigit = (index: number) => {
    digitAnims[index].setValue(1.1);
    Animated.spring(digitAnims[index], { toValue: 1, friction: 4, useNativeDriver: true }).start();
  };

  const handleFocus = () => {
    setIsFocused(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(inputBorderAnim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    Animated.timing(inputBorderAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };

  const borderColor = inputBorderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [QuinckleColors.border, QuinckleColors.primary],
  });

  const isPhoneValid = phone.length >= 10;
  const isOtpValid = otp.length === OTP_LENGTH;
  const ctaDisabled = (step === 'phone' ? !isPhoneValid : !isOtpValid) || isLoading;

  const triggerShake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep('phone');
  };

  const handleNext = async () => {
    if (step === 'phone') {
      if (!isPhoneValid) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setError('');
      setIsLoading(true);
      try {
        await crewAuth.sendOtp(`+91${phone}`);
        setStep('otp');
        setResendCooldown(30);
      } catch (e: any) {
        const code: string = (e as any)?.code ?? '';
        if (code === 'CREW_NOT_FOUND') {
          setError('You\'re not registered as crew for any restaurant. Ask your manager to add you first.');
        } else if (code === 'INVALID_PHONE') {
          setError('Invalid phone number format.');
        } else if (code === 'OTP_RATE_LIMIT') {
          setError('Too many requests. Please wait and try again.');
        } else if (code === 'OTP_SEND_FAILED') {
          // SMS failed but the backend stored the OTP — still advance
          setStep('otp');
          setResendCooldown(30);
        } else {
          // Network error — can't reach server
          setError('Could not connect to server. Check your connection and try again.');
        }
      } finally {
        setIsLoading(false);
      }
    } else {
      if (!isOtpValid) return;
      await handleVerify();
    }
  };

  const handleVerify = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setError('');
    setIsLoading(true);

    try {
      const res = await crewAuth.verifyOtp(`+91${phone}`, otp);
      const { crewToken, staff } = res;
      // Capabilities decide the landing stack (plan §5). The old
      // `role === 'STEWARD' ? 'staff' : 'cook'` sent ADMINs and CASHIERs to the
      // kitchen purely because they weren't STEWARD.
      const role = landingStackFor(staff.capabilities, staff.role);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      login(role, crewToken, staff);
      router.replace(role === 'staff' ? '/(staff)' : '/(cook)');
    } catch (apiError: any) {
      // Dev-only offline fallback. In production builds MOCK_CREDENTIALS is
      // an empty object (see above), so this branch is unreachable.
      if (__DEV__) {
        const mock = MOCK_CREDENTIALS[phone];
        if (mock && otp === mock.otp) {
          console.warn('[API] verify-otp failed, using mock credentials (DEV ONLY)');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          login(mock.role);
          router.replace(mock.role === 'staff' ? '/(staff)' : '/(cook)');
          return;
        }
      }
      // Show actual error from backend
      const msg = apiError?.message ?? 'Verification failed. Please try again.';
      const isOtpError = msg.toLowerCase().includes('otp') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired');
      setError(isOtpError ? msg : 'The verification code is incorrect. Please try again.');
      triggerShake();
      setOtp('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError('');
    setOtp('');
    setIsLoading(true);
    try {
      await crewAuth.sendOtp(`+91${phone}`);
    } catch (e) {
      if (__DEV__) console.warn('[API] resend failed:', e);
    } finally {
      setIsLoading(false);
      setResendCooldown(30);
    }
  };

  // Greeting + CTA + terms — the entry step, shared between the phone
  // bottom-overlay and the tablet split panel.
  const welcomeBody = (
    <>
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
    </>
  );

  // Phone / OTP form — steps two and three, same shape on phone and tablet.
  const credentialBody = (
    <>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (step === 'otp') {
            setStep('phone');
            setOtp('');
            setError('');
          } else {
            setStep('welcome');
            setError('');
          }
        }}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={20} color={QuinckleColors.textSecondary} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>{step === 'phone' ? 'Enter Mobile' : 'Verify OTP'}</Text>
        <Text style={styles.subtitle}>
          {step === 'phone'
            ? 'We will send a one-time code to your\nregistered number.'
            : `A 6-digit code was sent to\n+91 ******${phone.slice(-4)}.`}
        </Text>
      </View>

      <View style={styles.inputSection}>
        <View style={styles.labelRow}>
          <Text style={styles.fieldLabel}>
            {step === 'phone' ? 'Mobile Number' : 'One-Time Code'}
          </Text>

          {step === 'otp' && (
            <TouchableOpacity
              activeOpacity={resendCooldown > 0 ? 1 : 0.7}
              onPress={handleResend}
              disabled={resendCooldown > 0 || isLoading}
            >
              {resendCooldown > 0
                ? <Text style={[styles.resendLink, { color: QuinckleColors.textTertiary }]}>Resend in {resendCooldown}s</Text>
                : <Text style={styles.resendLink}>Resend OTP</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        {step === 'phone' ? (
          <Animated.View style={[styles.phoneInputWrap, { borderColor }]}>
            <View style={styles.countryCodeBox}>
              <Text style={styles.countryCodeText}>+91</Text>
              <View style={styles.inputDivider} />
            </View>
            <TextInput
              value={phone}
              onChangeText={(text) => {
                const cleanText = text.replace(/[^0-9]/g, '');
                setPhone(cleanText);
                if (cleanText.length === 10) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
              }}
              placeholder="00000 00000"
              placeholderTextColor={QuinckleColors.textMuted}
              style={styles.phoneInput}
              keyboardType="phone-pad"
              maxLength={10}
              onFocus={handleFocus}
              onBlur={handleBlur}
              autoFocus
            />
            {isPhoneValid && (
              <View style={styles.validBadge}>
                <Ionicons name="checkmark" size={14} color="#fff" />
              </View>
            )}
          </Animated.View>
        ) : (
          <View style={styles.otpContainer}>
            <TextInput
              value={otp}
              onChangeText={(text) => {
                const cleanText = text.replace(/[^0-9]/g, '');
                if (cleanText.length > otp.length) {
                  animateDigit(otp.length);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                setOtp(cleanText);
              }}
              style={styles.hiddenInput}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              onFocus={handleFocus}
              onBlur={handleBlur}
              autoFocus
            />
            <Animated.View style={[styles.otpBoxesRow, { transform: [{ translateX: shakeAnim }] }]}>
              {Array.from({ length: OTP_LENGTH }).map((_, index) => {
                const digit = otp[index] || '';
                const isCurrent = index === otp.length;
                const isFilled = index < otp.length;

                return (
                  <Animated.View
                    key={index}
                    style={[
                      styles.otpBox,
                      isFilled && styles.otpBoxFilled,
                      isCurrent && isFocused && styles.otpBoxActive,
                      { transform: [{ scale: digitAnims[index] }] },
                    ]}
                  >
                    {isCurrent && isFocused && (
                      <Animated.View style={[styles.cursor, { opacity: cursorOpacity }]} />
                    )}
                    <Text style={styles.otpBoxText}>{digit}</Text>
                  </Animated.View>
                );
              })}
            </Animated.View>
          </View>
        )}
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color={QuinckleColors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.credentialCta, ctaDisabled && styles.ctaDisabled]}
        onPress={handleNext}
        activeOpacity={0.85}
        disabled={ctaDisabled}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.ctaText}>
            {step === 'phone' ? 'Send Code' : 'Verify & Continue'}
          </Text>
        )}
      </TouchableOpacity>
    </>
  );

  const content = step === 'welcome' ? welcomeBody : credentialBody;
  const animatedContent = (
    <Animated.View style={{ opacity: contentFade, transform: [{ translateY: contentRise }] }}>
      {content}
    </Animated.View>
  );

  // One shared design for both orientations: the feature-carousel hero swipes
  // away (right-to-left on tablet, up on phone) once we leave welcome, and
  // the form pane grows to fill the freed space and re-centers itself — no
  // screen navigation, no stack transition, same design on every screen size.
  // Tablet keeps the welcome step vertically centered in its side panel;
  // phone/portrait uses a taller hero with the greeting/CTA stuck to the
  // bottom of the screen.
  const keyboardAvoider = (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {animatedContent}
    </KeyboardAvoidingView>
  );

  if (isWide) {
    return (
      <AuthSplit align={step === 'welcome' ? 'center' : 'top'} showHero={step === 'welcome'}>
        {keyboardAvoider}
      </AuthSplit>
    );
  }

  return (
    <AuthStack align={step === 'welcome' ? 'bottom' : 'top'} showHero={step === 'welcome'}>
      {keyboardAvoider}
    </AuthStack>
  );
}

const styles = StyleSheet.create({
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

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backText: {
    color: QuinckleColors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },

  header: {
    gap: Spacing.sm,
    marginTop: Spacing.xxxl,
    marginBottom: Spacing.xxxl,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.7,
  },
  subtitle: {
    ...Typography.body,
    color: QuinckleColors.textSecondary,
    lineHeight: 22,
  },

  inputSection: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  phoneInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderRadius: Radius.lg,
    height: 60,
    paddingRight: Spacing.lg,
  },
  countryCodeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.lg,
    gap: Spacing.md,
  },
  inputDivider: {
    width: 1,
    height: 22,
    backgroundColor: QuinckleColors.borderStrong,
  },
  phoneInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    paddingLeft: Spacing.md,
    letterSpacing: 1,
  },
  countryCodeText: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  validBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: QuinckleColors.success,
    justifyContent: 'center',
    alignItems: 'center',
  },

  otpContainer: {
    width: '100%',
    height: 60,
    justifyContent: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    opacity: 0,
    zIndex: 10,
  },
  otpBoxesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  otpBox: {
    width: 48,
    height: 56,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpBoxActive: {
    borderColor: QuinckleColors.primary,
    backgroundColor: QuinckleColors.primarySoft,
  },
  otpBoxFilled: {
    borderColor: QuinckleColors.borderStrong,
  },
  otpBoxText: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  cursor: {
    position: 'absolute',
    width: 2,
    height: 22,
    backgroundColor: QuinckleColors.primary,
  },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  errorText: {
    color: QuinckleColors.danger,
    fontSize: 13,
    fontWeight: '500',
  },

  resendLink: {
    fontSize: 13,
    color: QuinckleColors.primary,
    fontWeight: '600',
  },

  credentialCta: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.lg,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  ctaDisabled: {
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
});
