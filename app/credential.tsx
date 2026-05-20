import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing, Typography } from '../constants/Colors';
import { useAuth } from '../context/AuthContext';
import { crewAuth } from '../services/api';

const OTP_LENGTH = 4;
const BLINK_DURATION = 500;

// Offline fallback: used when the local API server is unreachable
const MOCK_CREDENTIALS: Record<string, { otp: string; role: 'staff' | 'cook' }> = {
  '1234567890': { otp: '123456', role: 'staff' },
  '0987654321': { otp: '654321', role: 'cook' },
};

export default function CredentialScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const inputBorderAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const cursorOpacity = useRef(new Animated.Value(1)).current;
  const digitAnims = useRef(Array.from({ length: OTP_LENGTH }, () => new Animated.Value(1))).current;

  React.useEffect(() => {
    if (isFocused && step === 2) {
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
  const ctaDisabled = (step === 1 ? !isPhoneValid : !isOtpValid) || isLoading;

  const triggerShake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!isPhoneValid) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setError('');
      setIsLoading(true);
      try {
        await crewAuth.sendOtp(`+91${phone}`);
      } catch (e) {
        // If API is unreachable, fall through to OTP step anyway (offline mock mode)
        if (__DEV__) console.warn('[API] send-otp failed, using mock mode:', e);
      } finally {
        setIsLoading(false);
        setStep(2);
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
      const role = staff.role === 'STEWARD' ? 'staff' : 'cook';
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      login(role, crewToken, staff);
      router.replace(role === 'staff' ? '/(staff)' : '/(cook)');
    } catch (apiError: any) {
      // Try offline mock credentials if API is unreachable
      const mock = MOCK_CREDENTIALS[phone];
      if (mock && otp === mock.otp) {
        if (__DEV__) console.warn('[API] verify-otp failed, using mock credentials');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        login(mock.role);
        router.replace(mock.role === 'staff' ? '/(staff)' : '/(cook)');
        return;
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (step === 2) {
                setStep(1);
                setOtp('');
                setError('');
              } else {
                router.back();
              }
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={20} color={QuinckleColors.textSecondary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>{step === 1 ? 'Enter Mobile' : 'Verify OTP'}</Text>
            <Text style={styles.subtitle}>
              {step === 1
                ? 'We will send a one-time code to your\nregistered number.'
                : `A 6-digit code was sent to\n+91 ${phone}.`}
            </Text>
          </View>

          <View style={styles.inputSection}>
            <Text style={styles.fieldLabel}>
              {step === 1 ? 'Mobile Number' : 'One-Time Code'}
            </Text>

            {step === 1 ? (
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

          {step === 2 && (
            <TouchableOpacity style={styles.resendRow} activeOpacity={0.7}>
              <Text style={styles.resendText}>Didn&apos;t receive the code? </Text>
              <Text style={styles.resendLink}>Resend OTP</Text>
            </TouchableOpacity>
          )}

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color={QuinckleColors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            style={[styles.ctaButton, ctaDisabled && styles.ctaDisabled]}
            onPress={handleNext}
            activeOpacity={0.85}
            disabled={ctaDisabled}
          >
            <Text style={styles.ctaText}>
              {isLoading ? 'Processing…' : step === 1 ? 'Send Code' : 'Verify & Continue'}
            </Text>
            {!isLoading && <Ionicons name="arrow-forward" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    paddingHorizontal: Spacing.xxl,
    paddingBottom: Spacing.huge,
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

  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  resendText: {
    fontSize: 13,
    color: QuinckleColors.textSecondary,
  },
  resendLink: {
    fontSize: 13,
    color: QuinckleColors.primary,
    fontWeight: '600',
  },

  ctaButton: {
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
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
