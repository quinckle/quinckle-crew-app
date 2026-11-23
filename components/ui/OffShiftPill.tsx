/**
 * "Off shift" pill — shown while this phone's alerts are paused because the
 * staffer clocked out at the attendance station (stores/offShift.ts).
 *
 * Small, centred, above the bottom nav and touch-transparent, so it never
 * covers a header button or a table card the staffer might still tap. Blue
 * dot: clock-out is blue across the crew app (My attendance).
 */

import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QuinckleColors as C } from '../../constants/Colors';
import { useOffShift } from '../../stores/offShift';
import { useAnySheetOpen } from '../../stores/openSheets';

export function OffShiftPill() {
  const { alertsMuted } = useOffShift();
  const sheetOpen = useAnySheetOpen();
  const insets = useSafeAreaInsets();
  // Drawn by the layout above every screen, so it would float over a
  // BottomSheet. Step aside while one is open.
  if (!alertsMuted || sheetOpen) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { bottom: insets.bottom + 76 }]}
      accessibilityRole="text"
      accessibilityLabel="Off shift. Alerts are paused until you clock in.">
      <View style={styles.pill}>
        <View style={styles.dot} />
        <Text style={styles.text} numberOfLines={1}>
          Off shift <Text style={styles.sub}>· alerts paused till you clock in</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 40 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 420,
    backgroundColor: C.surfaceElevated, borderColor: 'rgba(59,130,246,0.35)', borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.info },
  text: { color: C.textPrimary, fontSize: 13, fontWeight: '700' },
  sub: { color: C.textSecondary, fontWeight: '500' },
});
