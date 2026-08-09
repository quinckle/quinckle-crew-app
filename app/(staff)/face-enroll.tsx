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

/**
 * Captures taken per person.
 *
 * The server keeps several templates and matches on the best of them, so this is
 * where the variation gets collected: five slightly different angles beat one
 * perfect one, because a clock-in never reproduces the enrollment pose exactly.
 *
 * The cap is 10, deliberately double this — so a SECOND session, run in the
 * venue's evening light, sits alongside the first rather than evicting it.
 * Lighting is the variation that actually breaks recognition, and five captures
 * taken in one sitting are five views of a single lighting condition.
 */
const ENROLL_SHOTS = 5;

/** Below this the head is turned too far to be worth storing. See onEmbedding. */
const MIN_ENROLL_QUALITY = 0.6;

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
  const [shots, setShots] = useState(0);
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

    // A poor capture is REFUSED at enrollment, not merely warned about.
    //
    // Everywhere else in this flow the bias is to accept and let the person get
    // on with their shift. Enrollment is the exception: an off-angle template is
    // compared against every future clock-in for that person, so one careless
    // capture degrades them permanently and reads afterwards as "face
    // recognition is unreliable". Cheaper to ask them to stand straight now.
    if (quality < MIN_ENROLL_QUALITY) {
      flash('Face the camera straight on — that one was at too much of an angle');
      return;
    }

    setBusy(true);
    try {
      await crewFace.enroll(target.staffMemberId, embedding, MODEL_VERSION, quality);
      const done = shots + 1;
      setShots(done);

      if (done >= ENROLL_SHOTS) {
        const name = target.name;
        setTarget(null);
        setShots(0);
        flash(`${name} enrolled with ${ENROLL_SHOTS} captures`);
        load();
      } else {
        flash(`Capture ${done} of ${ENROLL_SHOTS} saved — change your angle slightly`);
      }
    } catch (e: any) {
      const code = e?.code ?? e?.error ?? '';
      setTarget(null);
      setShots(0);
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
          Tap a staff member and take {ENROLL_SHOTS} captures at slightly
          different angles. They must have signed the biometric consent first.
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
              onPress={() => {
                setShots(0);
                setTarget(entry);
              }}
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
        subtitle={`Capture ${Math.min(shots + 1, ENROLL_SHOTS)} of ${ENROLL_SHOTS} — face the camera straight on, in good light.`}
        actionLabel={shots === 0 ? 'Capture' : `Capture ${shots + 1}`}
        busy={busy}
        onClose={() => {
          setTarget(null);
          setShots(0);
        }}
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
