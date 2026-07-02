/**
 * One-time onboarding card nudging the crew to exempt the app from battery
 * optimization — the biggest real-world fix for KOTs not printing when the app
 * is closed (OEM battery managers kill the process + foreground service).
 *
 * Android-only. Renders nothing once the crew taps "Done" / "Not now". Manages
 * its own visibility + dismissal so screens just drop <BatteryOptimizationCard/>.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '@/constants/Colors';
import {
  isAndroid,
  isBatteryPromptDismissed,
  dismissBatteryPrompt,
  openBatteryOptimizationSettings,
} from '@/services/batteryOptimization';

export function BatteryOptimizationCard() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isAndroid) return;
    let active = true;
    void isBatteryPromptDismissed().then((dismissed) => {
      if (active) setVisible(!dismissed);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    void dismissBatteryPrompt();
  };

  const fixNow = async () => {
    await openBatteryOptimizationSettings();
    // Assume they handled it — don't nag again. They can always adjust in Settings.
    dismiss();
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="battery-charging" size={18} color={QuinckleColors.warning} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>Keep printing when the app is closed</Text>
          <Text style={styles.subtitle}>
            Allow Quinckle to run in the background so kitchen tickets keep printing
            even when the app isn&apos;t open. Set battery usage to &quot;Unrestricted&quot;
            (and turn on Autostart on Xiaomi/Realme/Oppo/Vivo).
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity onPress={dismiss} style={[styles.btn, styles.btnGhost]}>
          <Text style={styles.btnGhostText}>Not now</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={fixNow} style={[styles.btn, styles.btnPrimary]}>
          <Text style={styles.btnPrimaryText}>Fix now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: QuinckleColors.warningSoft,
    borderWidth: 1,
    borderColor: QuinckleColors.warningBorder,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,158,11,0.15)',
  },
  body: { flex: 1 },
  title: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '700' },
  subtitle: { color: QuinckleColors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
  btnGhost: { backgroundColor: QuinckleColors.surfaceMuted },
  btnGhostText: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '600' },
  btnPrimary: { backgroundColor: QuinckleColors.primary },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
