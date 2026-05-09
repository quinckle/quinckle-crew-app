// app/credential.tsx
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { QuinckleColors } from '../constants/Colors';
import { useAuth } from '../context/AuthContext';

export default function CredentialScreen() {
  const { role: rawRole } = useLocalSearchParams<{ role?: string }>();
  const role = rawRole === 'staff' || rawRole === 'cook' ? rawRole : null;
  const { login } = useAuth();

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');

  const roleLabel = useMemo(() => (role === 'staff' ? 'Staff' : 'Cook'), [role]);
  const roleIcon = (role === 'staff' ? 'people' : 'flame') as React.ComponentProps<typeof Ionicons>['name'];

  const handleContinue = () => {
    if (!role) { router.replace('/login'); return; }
    if (!phone.trim() || !otp.trim()) {
      setError('Please enter your phone number and OTP.');
      return;
    }
    setError('');
    login(role);
    router.replace(role === 'staff' ? '/(staff)' : '/(cook)');
  };

  if (!role) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Invalid Role</Text>
        <TouchableOpacity style={styles.submitBtn} onPress={() => router.replace('/login')}>
          <Text style={styles.submitBtnText}>Back to Role Selection</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={18} color={QuinckleColors.textSecondary} />
        <Text style={styles.backText}>Change role</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <View style={styles.roleChip}>
          <Ionicons name={roleIcon} size={13} color={QuinckleColors.primary} />
          <Text style={styles.roleChipText}>{roleLabel}</Text>
        </View>
        <Text style={styles.title}>Sign in to QuinckleCrew</Text>
        <Text style={styles.subtitle}>
          Enter your credentials to continue as {roleLabel.toLowerCase()}.
        </Text>
      </View>

      <View style={styles.formCard}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Phone Number</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="call-outline" size={16} color={QuinckleColors.textSecondary} />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+92 300 0000000"
              placeholderTextColor={QuinckleColors.textSecondary}
              style={styles.input}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>One-Time Password</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="keypad-outline" size={16} color={QuinckleColors.textSecondary} />
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="Enter OTP"
              placeholderTextColor={QuinckleColors.textSecondary}
              style={styles.input}
              keyboardType="number-pad"
              secureTextEntry
            />
          </View>
        </View>

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={14} color={QuinckleColors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.submitBtn} onPress={handleContinue} activeOpacity={0.85}>
          <Text style={styles.submitBtnText}>Continue as {roleLabel}</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    paddingHorizontal: 18,
    paddingTop: 56,
    gap: 20,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  backText: { color: QuinckleColors.textSecondary, fontSize: 14 },
  header: { gap: 6 },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(243,93,59,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(243,93,59,0.28)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 4,
  },
  roleChipText: { color: QuinckleColors.primary, fontSize: 12, fontWeight: '600' },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: QuinckleColors.textSecondary,
    lineHeight: 20,
  },
  formCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  field: { gap: 6 },
  fieldLabel: {
    color: QuinckleColors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    paddingVertical: 13,
    fontSize: 15,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  errorText: { color: QuinckleColors.danger, fontSize: 13 },
  submitBtn: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    elevation: 6,
    shadowColor: QuinckleColors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
