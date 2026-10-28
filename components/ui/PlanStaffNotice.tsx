/**
 * PlanStaffNotice — the venue's Quinckle plan, as staff need to know it
 * (PLAN_BILLING_PLAN.md, phase 5).
 *
 *   Grace   a small pill at the top: "plan needs renewal, tell your manager".
 *           Tap to hide it until the app is reopened.
 *   Paused  a sheet once per launch ("This venue is paused") whose button goes
 *           back to the tables, plus a pill that stays. New orders are refused
 *           by the server; tables already open can still be billed.
 *
 * Never shows an amount. Nothing shows until the owner's plan has run out AND
 * Quinckle has switched pausing on; the backend decides both. Rechecked every
 * 5 minutes and whenever the app comes back to the foreground, so a payment
 * clears it quickly. A failed check shows nothing — it must never get between
 * a steward and service. Renders inside the staff layout, like the item-ready
 * cards, so it sits above every staff screen. OTA-safe: no new modules.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { crewPlan, type CrewPlanStatus } from '../../services/api';
import { QuinckleColors } from '../../constants/Colors';

const RECHECK_MS = 5 * 60 * 1000;
let pausedSheetShown = false;

export function PlanStaffNotice() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<CrewPlanStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [sheet, setSheet] = useState(false);

  const check = useCallback(() => {
    crewPlan
      .getStatus()
      .then((s) => {
        setStatus(s);
        if (s.paused && !pausedSheetShown) {
          pausedSheetShown = true;
          setSheet(true);
        }
        if (!s.paused) pausedSheetShown = false;
      })
      .catch(() => { /* never block service on this */ });
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, RECHECK_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [check]);

  const b = status?.banner;
  if (!b) return null;
  const paused = status?.paused === true;

  return (
    <>
      {(!hidden || paused) && (
        <View pointerEvents="box-none" style={[styles.pillWrap, { top: insets.top + 6 }]}>
          <Pressable
            onPress={() => { if (!paused) setHidden(true); else setSheet(true); }}
            style={styles.pill}
            accessibilityRole="button"
            accessibilityLabel={`${b.title}. ${b.body}`}
          >
            <Ionicons name={paused ? 'pause-circle-outline' : 'alert-circle-outline'} size={15} color={QuinckleColors.danger} />
            <Text style={styles.pillText} numberOfLines={1}>{paused ? 'Venue paused · new orders are off' : `${b.title} · tell your manager`}</Text>
            {!paused && <Ionicons name="close" size={14} color={QuinckleColors.textSecondary} />}
          </Pressable>
        </View>
      )}

      <Modal visible={sheet} transparent animationType="fade" onRequestClose={() => setSheet(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Ionicons name="pause-circle-outline" size={40} color={QuinckleColors.danger} />
            <Text style={styles.title}>{b.title}</Text>
            <Text style={styles.body}>{b.body}</Text>
            <Pressable onPress={() => setSheet(false)} style={styles.okBtn} accessibilityRole="button">
              <Text style={styles.okText}>Bill open tables</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '92%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: QuinckleColors.dangerBorder,
    backgroundColor: QuinckleColors.surface,
  },
  pillText: { color: QuinckleColors.textPrimary, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    backgroundColor: QuinckleColors.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: QuinckleColors.dangerBorder,
    padding: 24,
  },
  title: { color: QuinckleColors.textPrimary, fontSize: 21, fontWeight: '900', marginTop: 12, textAlign: 'center' },
  body: { color: QuinckleColors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  okBtn: {
    marginTop: 22,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: QuinckleColors.primary,
  },
  okText: { color: QuinckleColors.primary, fontSize: 15, fontWeight: '800' },
});
