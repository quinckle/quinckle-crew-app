/**
 * Attendance station — the shared clock-in kiosk (STAFF_CAPABILITIES_HR_PLAN §7).
 *
 * This screen is a DEVICE MODE, not a personal screen. One tablet sits at the
 * entrance signed in as an operator who holds ATTENDANCE_STATION; everyone else
 * walks up to it, taps their own name, and types their own PIN. So nothing here
 * is scoped to the logged-in user — the roster is the whole venue, and the
 * person acting is whoever is standing in front of the device.
 *
 * Design consequences of it being unattended and shared:
 *
 *  - The PIN pad clears itself after every action and on backgrounding, so the
 *    next person never inherits a half-typed PIN.
 *  - Errors are shown inline on the pad, not in an Alert — an Alert on an
 *    unattended kiosk can sit there blocking the queue until someone dismisses
 *    it, and modal dialogs are the one thing a kiosk must never get stuck in.
 *  - Nothing is destructive, so nothing asks for confirmation. Speed matters
 *    more than precision here: a wrong tap is fixed by tapping again.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { crewAttendance, crewFace, type AttendanceRosterEntry } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ROLE_COLOR_FALLBACK } from '../../constants/capabilities';
import FaceScanner from '../../components/face-scanner';
import { MODEL_VERSION } from '../../constants/face';
import { faceRuntimeAvailable } from '../../services/face';

const PIN_MAX = 8;
const PIN_MIN = 4;

const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    : null;

type Mode = 'in' | 'out';

export default function AttendanceStationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [date, setDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AttendanceRosterEntry | null>(null);
  const [mode, setMode] = useState<Mode>('in');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Face is additive: the name-and-PIN grid below is always there, and every
  // face path falls back to it. If any of this errors the station keeps working.
  // Two separate facts. `faceOn` is whether the venue may use face at all;
  // `faceReady` is whether anyone is enrolled yet. Gating enrollment on
  // faceReady would make the FIRST enrollment impossible — the button that
  // creates enrollments would only appear once one existed.
  const [faceOn, setFaceOn] = useState(false);
  const [faceReady, setFaceReady] = useState(false);
  const [faceMode, setFaceMode] = useState<Mode | null>(null);
  const [faceBusy, setFaceBusy] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      const res = await crewAttendance.roster();
      setRoster(res.data.staff);
      setDate(res.data.date);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load the roster');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Separate from the roster load on purpose — a 404 here is the NORMAL answer
  // at a venue where face is off, and it must never surface as a station error.
  // No enrollments yet also means no button: a scanner that can only ever fail
  // is worse than no scanner.
  useEffect(() => {
    let alive = true;
    crewFace
      .status()
      .then((res) => {
        if (!alive) return;
        // THREE conditions, not two. The venue may have face switched on while
        // THIS device is running native code that predates it — an OTA can put
        // new JS on an old binary. Offering a scanner it cannot run would be a
        // crash dressed up as a feature.
        const usable = res.data.enabled && faceRuntimeAvailable();
        setFaceOn(usable);
        setFaceReady(usable && res.data.enrolledCount > 0);
      })
      .catch(() => {
        if (!alive) return;
        setFaceOn(false);
        setFaceReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A shared kiosk must never keep one person's PIN on screen for the next.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') closePad();
    });
    return () => sub.remove();
  }, []);

  const closePad = () => {
    setSelected(null);
    setPin('');
    setPinError(null);
    setSubmitting(false);
  };

  const openPad = (entry: AttendanceRosterEntry) => {
    // Already clocked out for the day — nothing left to do, and re-opening the
    // pad would only invite a confusing "already recorded".
    if (entry.checkOutAt) {
      flash(`${entry.name} has already clocked out today`);
      return;
    }
    setSelected(entry);
    setMode(entry.checkInAt ? 'out' : 'in');
    setPin('');
    setPinError(null);
  };

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const press = (digit: string) => {
    if (pin.length >= PIN_MAX) return;
    Haptics.selectionAsync().catch(() => {});
    setPinError(null);
    setPin((p) => p + digit);
  };

  const backspace = () => {
    Haptics.selectionAsync().catch(() => {});
    setPinError(null);
    setPin((p) => p.slice(0, -1));
  };

  const submit = async () => {
    if (!selected || pin.length < PIN_MIN || submitting) return;
    setSubmitting(true);
    setPinError(null);
    try {
      const call = mode === 'in' ? crewAttendance.checkIn : crewAttendance.checkOut;
      const res = await call(selected.staffMemberId, pin);
      const { name, alreadyRecorded } = res.data;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      closePad();
      flash(
        alreadyRecorded
          ? `${name} was already clocked ${mode === 'in' ? 'in' : 'out'}`
          : `${name} clocked ${mode === 'in' ? 'in' : 'out'}`,
      );
      load();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      // Inline, never an Alert — see the header note about unattended kiosks.
      setPinError(e?.message ?? 'Could not record that. Try again.');
      setPin('');
      setSubmitting(false);
    }
  };

  /**
   * A face was captured. Send the vector and let the SERVER say who it is.
   *
   * A non-match comes back as a 200 with `matched: false` — it is not an error
   * and must not be shown as one. The person is told to use their name and PIN,
   * which is the whole reason face is allowed to be optional: nobody is ever
   * stuck at the door because the light was bad or they grew a beard.
   */
  const onFaceCaptured = async (embedding: number[]) => {
    if (!faceMode || faceBusy) return;
    setFaceBusy(true);
    try {
      const call = faceMode === 'in' ? crewAttendance.checkInFace : crewAttendance.checkOutFace;
      const res = await call(embedding, MODEL_VERSION);

      if (!res.data.matched) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        setFaceMode(null);
        flash('Not recognised — tap your name and use your PIN');
        return;
      }

      const { name, alreadyRecorded } = res.data.clock;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setFaceMode(null);
      flash(
        alreadyRecorded
          ? `${name} was already clocked ${faceMode === 'in' ? 'in' : 'out'}`
          : `${name} clocked ${faceMode === 'in' ? 'in' : 'out'}`,
      );
      load();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setFaceMode(null);
      flash('Face check unavailable — tap your name and use your PIN');
    } finally {
      setFaceBusy(false);
    }
  };

  const present = useMemo(
    () => roster.filter((r) => r.checkInAt && !r.checkOutAt).length,
    [roster],
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Attendance</Text>
          <Text style={styles.subtitle}>
            {date ? `${date} · ` : ''}
            {present} on shift
          </Text>
        </View>
        {faceOn && (
          <TouchableOpacity
            style={styles.enrollBtn}
            onPress={() => router.push('/(staff)/face-enroll')}
            accessibilityLabel="Face enrollment"
          >
            <Ionicons name="person-add-outline" size={15} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>
        )}
        <View style={styles.kioskBadge}>
          <Ionicons name="tablet-portrait-outline" size={13} color={QuinckleColors.textSecondary} />
          <Text style={styles.kioskBadgeText}>Station</Text>
        </View>
      </View>

      {faceReady && (
        <View style={styles.faceBar}>
          <TouchableOpacity style={styles.faceBtn} onPress={() => setFaceMode('in')}>
            <Ionicons name="scan-outline" size={16} color={QuinckleColors.primary} />
            <Text style={styles.faceBtnText}>Clock in with face</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.faceBtn} onPress={() => setFaceMode('out')}>
            <Ionicons name="exit-outline" size={16} color={QuinckleColors.textSecondary} />
            <Text style={[styles.faceBtnText, styles.faceBtnTextMuted]}>Clock out</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.hint}>
        {faceReady
          ? 'Scan your face, or tap your name and enter your PIN.'
          : 'Tap your name, then enter your PIN.'}
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={QuinckleColors.primary} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={30} color={QuinckleColors.textTertiary} />
          <Text style={styles.emptyText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : roster.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={30} color={QuinckleColors.textTertiary} />
          <Text style={styles.emptyText}>No active staff to clock in.</Text>
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
            <StaffTile key={entry.staffMemberId} entry={entry} onPress={() => openPad(entry)} />
          ))}
        </ScrollView>
      )}

      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + Spacing.xl }]}>
          <Ionicons name="checkmark-circle" size={16} color={QuinckleColors.success} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <FaceScanner
        visible={!!faceMode}
        title={faceMode === 'out' ? 'Clock out' : 'Clock in'}
        subtitle="Look at the camera — it will recognise you on its own."
        auto
        actionLabel={faceMode === 'out' ? 'Clock out' : 'Clock in'}
        busy={faceBusy}
        onClose={() => setFaceMode(null)}
        onEmbedding={onFaceCaptured}
      />

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={closePad}>
        <Pressable style={styles.backdrop} onPress={closePad}>
          <Pressable style={styles.pad} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.padName}>{selected?.name}</Text>
            <Text style={styles.padMode}>
              {mode === 'in' ? 'Clocking in' : 'Clocking out'}
              {mode === 'out' && selected?.checkInAt ? ` · in at ${fmtTime(selected.checkInAt)}` : ''}
            </Text>

            <View style={styles.dots}>
              {Array.from({ length: Math.max(PIN_MIN, pin.length) }).map((_, i) => (
                <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
              ))}
            </View>

            {pinError && <Text style={styles.padError}>{pinError}</Text>}

            <View style={styles.keypad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <Key key={d} label={d} onPress={() => press(d)} />
              ))}
              <View style={styles.key} />
              <Key label="0" onPress={() => press('0')} />
              <Key icon="backspace-outline" onPress={backspace} />
            </View>

            <TouchableOpacity
              style={[styles.confirm, (pin.length < PIN_MIN || submitting) && styles.confirmDisabled]}
              onPress={submit}
              disabled={pin.length < PIN_MIN || submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.confirmText}>
                  {mode === 'in' ? 'Clock in' : 'Clock out'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancel} onPress={closePad}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function StaffTile({ entry, onPress }: { entry: AttendanceRosterEntry; onPress: () => void }) {
  const color = entry.designationColor ?? ROLE_COLOR_FALLBACK;
  const inAt = fmtTime(entry.checkInAt);
  const outAt = fmtTime(entry.checkOutAt);

  const state = entry.checkOutAt ? 'done' : entry.checkInAt ? 'in' : 'out';

  return (
    <TouchableOpacity
      style={[styles.tile, state === 'in' && styles.tileIn, state === 'done' && styles.tileDone]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.avatar, { borderColor: color }]}>
        {entry.photoUrl ? (
          <Image source={{ uri: entry.photoUrl }} style={styles.avatarImg} contentFit="cover" />
        ) : (
          <Text style={[styles.avatarLetter, { color }]}>{entry.name.charAt(0).toUpperCase()}</Text>
        )}
      </View>

      <Text style={styles.tileName} numberOfLines={1}>{entry.name}</Text>
      {entry.designation && (
        <Text style={[styles.tileRole, { color }]} numberOfLines={1}>{entry.designation}</Text>
      )}

      {state === 'out' && !entry.canSelfCheckIn ? (
        // Shown, not hidden: the person still needs to know why they can't, and
        // the owner needs to see that a PIN is missing.
        <Text style={styles.tileNoPin}>No PIN set</Text>
      ) : state === 'done' ? (
        <Text style={styles.tileMeta}>{inAt} – {outAt}</Text>
      ) : state === 'in' ? (
        <Text style={[styles.tileMeta, styles.tileMetaIn]}>In at {inAt}</Text>
      ) : (
        <Text style={styles.tileMeta}>Tap to clock in</Text>
      )}

      {entry.flaggedForReview && (
        <View style={styles.flag}>
          <Ionicons name="flag" size={10} color={QuinckleColors.warning} />
        </View>
      )}
    </TouchableOpacity>
  );
}

function Key({
  label,
  icon,
  onPress,
}: {
  label?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.key} onPress={onPress} activeOpacity={0.6}>
      {icon ? (
        <Ionicons name={icon} size={22} color={QuinckleColors.textSecondary} />
      ) : (
        <Text style={styles.keyText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: QuinckleColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  title: { fontSize: 26, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.5 },
  subtitle: { marginTop: 2, fontSize: 13, color: QuinckleColors.textSecondary },
  kioskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  kioskBadgeText: { fontSize: 11.5, fontWeight: '600', color: QuinckleColors.textSecondary },
  enrollBtn: {
    width: 34,
    height: 34,
    marginRight: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  hint: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    fontSize: 13,
    color: QuinckleColors.textTertiary,
  },

  faceBar: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  faceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  faceBtnText: { fontSize: 13.5, fontWeight: '600', color: QuinckleColors.primary },
  faceBtnTextMuted: { color: QuinckleColors.textSecondary },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  emptyText: { fontSize: 13.5, color: QuinckleColors.textSecondary, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  retryText: { fontSize: 13, fontWeight: '600', color: QuinckleColors.textPrimary },

  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  tile: {
    width: '31%',
    minWidth: 104,
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  tileIn: { borderColor: QuinckleColors.successBorder, backgroundColor: QuinckleColors.successSoft },
  tileDone: { opacity: 0.55 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceElevated,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarLetter: { fontSize: 19, fontWeight: '700' },
  tileName: {
    marginTop: Spacing.sm,
    fontSize: 13.5,
    fontWeight: '600',
    color: QuinckleColors.textPrimary,
    textAlign: 'center',
  },
  tileRole: { marginTop: 1, fontSize: 11, fontWeight: '600' },
  tileMeta: { marginTop: 4, fontSize: 11, color: QuinckleColors.textTertiary, textAlign: 'center' },
  tileMetaIn: { color: QuinckleColors.success },
  tileNoPin: { marginTop: 4, fontSize: 11, color: QuinckleColors.warning, textAlign: 'center' },
  flag: { position: 'absolute', top: 8, right: 8 },

  toast: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.successBorder,
    backgroundColor: QuinckleColors.surfaceElevated,
  },
  toastText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: QuinckleColors.textPrimary },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  pad: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    padding: Spacing.xl,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  padName: { fontSize: 19, fontWeight: '700', color: QuinckleColors.textPrimary },
  padMode: { marginTop: 2, fontSize: 12.5, color: QuinckleColors.textSecondary },
  dots: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl, height: 14 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: QuinckleColors.borderStrong,
  },
  dotFilled: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
  padError: {
    marginTop: Spacing.md,
    fontSize: 12.5,
    color: QuinckleColors.danger,
    textAlign: 'center',
  },

  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  key: {
    width: 74,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  keyText: { fontSize: 22, fontWeight: '600', color: QuinckleColors.textPrimary },

  confirm: {
    marginTop: Spacing.xl,
    width: '100%',
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primary,
  },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cancel: { marginTop: Spacing.md, paddingVertical: Spacing.sm },
  cancelText: { fontSize: 13.5, color: QuinckleColors.textSecondary },
});
