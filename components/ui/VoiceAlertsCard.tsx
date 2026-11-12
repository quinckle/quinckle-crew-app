/**
 * Per-phone picker for spoken new-order alerts (services/voiceAlerts).
 *
 * Shown on the floor menu and the kitchen profile — kitchen-only phones never
 * reach the floor menu. Not capability-gated: like the printer, it's about
 * this device, not the person holding it.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { getVoiceAlertSetting, previewVoice, setVoiceAlertSetting, type VoiceAlertSetting } from '../../services/voiceAlerts';

const OPTIONS: { value: VoiceAlertSetting; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

export function VoiceAlertsCard() {
  const [voice, setVoice] = useState<VoiceAlertSetting>('off');

  useEffect(() => {
    void getVoiceAlertSetting().then(setVoice);
  }, []);

  const choose = (value: VoiceAlertSetting) => {
    setVoice(value);
    void setVoiceAlertSetting(value);
    if (value !== 'off') previewVoice(value);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}><Ionicons name="megaphone-outline" size={18} color="white" /></View>
        <View style={styles.text}>
          <Text style={styles.label}>Voice alerts</Text>
          <Text style={styles.sub}>{'Says "New takeaway order received" instead of the chime'}</Text>
        </View>
      </View>
      <View style={styles.segment}>
        {OPTIONS.map(opt => {
          const active = voice === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => choose(opt.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  icon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  label: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  sub: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 2 },
  segment: {
    flexDirection: 'row', gap: Spacing.xs,
    marginHorizontal: Spacing.md, marginBottom: Spacing.md, padding: 3,
    borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border,
  },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.sm },
  segmentBtnActive: { backgroundColor: 'rgba(243,93,59,0.12)' },
  segmentText: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: QuinckleColors.primary },
});
