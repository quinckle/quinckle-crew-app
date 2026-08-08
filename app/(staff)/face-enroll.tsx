/**
 * Face enrollment at the station.
 *
 * Enrollment is the moment biometric data starts existing, so this screen is
 * deliberately not a convenience. Two things it does NOT do:
 *
 *  - It does not collect consent. Consent is signed by the employee themselves
 *    in the dashboard, against a versioned notice, and the server refuses to
 *    enroll without it. A kiosk operator tapping "yes he agreed" would be
 *    exactly the owner-attestation this design rejects.
 *  - It does not store a photo. The capture becomes 192 floats and is discarded.
 *
 * Reached from the station, not the tab bar — it is an occasional setup task.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { crewAttendance, crewFace, type AttendanceRosterEntry } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import FaceScanner from '../../components/face-scanner';
import { MODEL_VERSION } from '../../services/face';

/** The server's refusals, said in a way that names the next action. */
const ENROLL_ERROR: Record<string, string> = {
  NO_CONSENT: 'They need to sign the biometric consent in the dashboard first',
  CONSENT_REVOKED: 'They withdrew biometric consent — it must be signed again',
  FACE_DISABLED: 'Face attendance is not switched on for this venue',
  BAD_EMBEDDING: 'That capture was not usable. Try again.',
  STAFF_NOT_FOUND: 'That staff member is no longer at this venue',
};

export default function FaceEnrollScreen() {
  const insets = useSafeAreaInsets();
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [target, setTarget] = useState<AttendanceRosterEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      const res = await crewAttendance.roster();
      setRoster(res.data.staff);
    } catch {
      // The roster failing is not worth an error state here — pull to retry.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const onEmbedding = async (embedding: number[], quality: number) => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await crewFace.enroll(target.staffMemberId, embedding, MODEL_VERSION, quality);
      const name = target.name;
      setTarget(null);
      flash(`${name} enrolled`);
      if (quality < 0.6) {
        // Enrolling off-angle poisons every later comparison, so say so now
        // rather than let it read as "face recognition is unreliable".
        setTimeout(() => flash('Tip: re-enroll face-on for a stronger match'), 3400);
      }
    } catch (e: any) {
      const code = e?.code ?? e?.error ?? '';
      setTarget(null);
      flash(ENROLL_ERROR[code] ?? e?.message ?? 'Could not enroll that face');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Face enrollment' }} />

      <View style={styles.header}>
        <Text style={styles.title}>Face enrollment</Text>
        <Text style={styles.subtitle}>
          Tap a staff member to capture their face. They must have signed the
          biometric consent first.
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={QuinckleColors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.xxl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={QuinckleColors.textSecondary}
            />
          }
        >
          {roster.map((entry) => (
            <TouchableOpacity
              key={entry.staffMemberId}
              style={styles.row}
              onPress={() => setTarget(entry)}
              activeOpacity={0.75}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{entry.name}</Text>
                {entry.designation ? (
                  <Text style={styles.rowRole}>{entry.designation}</Text>
                ) : null}
              </View>
              <Ionicons name="scan-outline" size={18} color={QuinckleColors.textTertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + Spacing.xl }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <FaceScanner
        visible={!!target}
        title={target ? `Enroll ${target.name}` : 'Enroll'}
        subtitle="Face the camera straight on, in good light."
        actionLabel="Capture"
        busy={busy}
        onClose={() => setTarget(null)}
        onEmbedding={onEmbedding}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: QuinckleColors.background },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title: { fontSize: 24, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.4 },
  subtitle: { marginTop: 4, fontSize: 12.5, color: QuinckleColors.textSecondary, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.lg, gap: Spacing.sm, paddingTop: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  rowName: { fontSize: 14.5, fontWeight: '600', color: QuinckleColors.textPrimary },
  rowRole: { marginTop: 1, fontSize: 11.5, color: QuinckleColors.textSecondary },
  toast: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceElevated,
  },
  toastText: { fontSize: 13.5, fontWeight: '600', color: QuinckleColors.textPrimary },
});
