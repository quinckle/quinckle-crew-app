// app/credential.tsx
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { QuinckleColors } from '../constants/Colors';
import { useAuth } from '../context/AuthContext';

const OTP_LENGTH = 6;
const BLINK_DURATION = 500;

export default function CredentialScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [step, setStep] = useState<1 | 2>(1); // 1: Phone, 2: OTP
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [isFocused, setIsFocused] = useState(false);

  const inputBorderAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const cursorOpacity = useRef(new Animated.Value(1)).current;
  const digitAnims = useRef(Array.from({ length: OTP_LENGTH }, () => new Animated.Value(1))).current;

  // Blinking cursor logic
  React.useEffect(() => {
    if (isFocused && step === 2) {
      const blink = Animated.loop(
        Animated.sequence([
          Animated.timing(cursorOpacity, {
            toValue: 0,
            duration: BLINK_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(cursorOpacity, {
            toValue: 1,
            duration: BLINK_DURATION,
            useNativeDriver: true,
          }),
        ])
      );
      blink.start();
      return () => blink.stop();
    }
  }, [isFocused, step]);

  const animateDigit = (index: number) => {
    digitAnims[index].setValue(1.1);
    Animated.spring(digitAnims[index], {
      toValue: 1,
      friction: 4,
      useNativeDriver: true,
    }).start();
  };

  const handleFocus = () => {
    setIsFocused(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(inputBorderAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    Animated.timing(inputBorderAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const borderColor = inputBorderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.08)', QuinckleColors.primary],
  });

  const isPhoneValid = phone.length >= 10;
  const isOtpValid = otp.length === OTP_LENGTH;

  const handleNext = () => {
    if (step === 1) {
      if (!isPhoneValid) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsLoading(true);
      // Simulate API call to send OTP
      setTimeout(() => {
        setIsLoading(false);
        setStep(2);
      }, 800);
    } else {
      if (!isOtpValid) return;
      handleVerify();
    }
  };

  const triggerShake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleVerify = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setError('');
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      // Simulate validation failure if OTP is not '123456' for demonstration
      if (otp !== '123456') {
        setError('The verification code is incorrect. Please try again.');
        triggerShake();
        setOtp('');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      login('staff');
      router.replace('/(staff)');
    }, 1200);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          {/* ── Back Button ── */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (step === 2) setStep(1);
              else router.back();
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={20} color={QuinckleColors.textSecondary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          {/* ── Header ── */}
          <View style={styles.header}>
            <Text style={styles.title}>{step === 1 ? 'Mobile Number' : 'Verify OTP'}</Text>
            <Text style={styles.subtitle}>
              {step === 1
                ? 'Enter your registered number to receive\na verification code'
                : `We've sent a 6-digit code to\n+91 ${phone}`}
            </Text>
          </View>

          {/* ── Input Section ── */}
          <View style={styles.inputSection}>
            <Text style={styles.fieldLabel}>
              {step === 1 ? 'Mobile Number' : 'One-Time Password'}
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
                  placeholderTextColor="rgba(161,161,170,0.4)"
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

          {/* ── Resend (Only for OTP) ── */}
          {step === 2 && (
            <TouchableOpacity style={styles.resendRow} activeOpacity={0.7}>
              <Text style={styles.resendText}>Didn't receive the code? </Text>
              <Text style={styles.resendLink}>Resend OTP</Text>
            </TouchableOpacity>
          )}

          {/* ── Error Display ── */}
          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color={QuinckleColors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ── CTA Button ── */}
          <TouchableOpacity
            style={[
              styles.ctaButton,
              ((step === 1 && !isPhoneValid) || (step === 2 && !isOtpValid)) && styles.ctaDisabled,
            ]}
            onPress={handleNext}
            activeOpacity={0.85}
            disabled={((step === 1 && !isPhoneValid) || (step === 2 && !isOtpValid)) || isLoading}
          >
            <Text style={styles.ctaText}>
              {isLoading ? 'Processing…' : (step === 1 ? 'Get Verification Code' : 'Verify & Continue')}
            </Text>
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
    paddingHorizontal: 24,
    paddingBottom: 40,
  },

  /* ── Back ── */
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingTop: 12,
    paddingBottom: 8,
  },
  backText: {
    color: QuinckleColors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },

  /* ── Header ── */
  header: {
    alignItems: 'center',
    gap: 8,
    marginTop: 40,
    marginBottom: 36,
  },
  otpIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(243,93,59,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(243,93,59,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  phoneHighlight: {
    color: QuinckleColors.textPrimary,
    fontWeight: '600',
  },

  /* ── Input ── */
  inputSection: {
    gap: 8,
    marginBottom: 16,
  },
  fieldLabel: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginLeft: 2,
  },
  phoneInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderRadius: 16,
    height: 64,
    paddingRight: 16,
  },
  countryCodeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    gap: 12,
  },
  inputDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  phoneInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
    paddingLeft: 12,
    letterSpacing: 1,
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
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpBoxActive: {
    borderColor: QuinckleColors.primary,
    backgroundColor: 'rgba(243,93,59,0.05)',
  },
  otpBoxFilled: {
    borderColor: 'rgba(255,255,255,0.2)',
  },
  otpBoxText: {
    color: QuinckleColors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  cursor: {
    position: 'absolute',
    width: 2,
    height: 24,
    backgroundColor: QuinckleColors.primary,
  },
  countryCodeText: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  validBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: QuinckleColors.success,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ── Error ── */
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  errorText: {
    color: QuinckleColors.danger,
    fontSize: 13,
  },

  /* ── Resend ── */
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 28,
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

  /* ── CTA ── */
  ctaButton: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: 14,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaDisabled: {
    backgroundColor: QuinckleColors.textSecondary,
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
