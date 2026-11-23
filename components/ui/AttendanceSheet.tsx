/**
 * Attendance sheet — swipe to clock in / out from this phone.
 *
 * Opened from the fingerprint icon in the header. One GPS fix is read at the
 * moment of the swipe (never in the background) and the backend decides
 * whether the staffer is inside the restaurant. Every failure blocks the punch
 * and points them to the attendance station. We never show a distance or a
 * radius — only "inside the restaurant".
 *
 * Built from the same parts as the e-bill sheet (BottomSheet, stat tiles,
 * tinted outcome card, ghost + solid buttons) so it looks like the rest of
 * the app.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Linking, PanResponder, Pressable, StyleSheet, Text, View,
} from 'react-native';

import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import { crewMyClock, type MyClock } from '../../services/api';
import { setMyClock } from '../../stores/myClock';
import { refreshOffShift } from '../../stores/offShift';
import { BottomSheet } from './BottomSheet';

type Dir = 'in' | 'out';
type Problem = 'outside' | 'mocked' | 'noFix' | 'permission' | 'gpsOff' | 'offline' | 'turnedOff';
type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; dir: Dir; at: Date; worked: number }
  | { kind: 'error'; dir: Dir; problem: Problem };

const FIX_TIMEOUT_MS = 15_000;

/** Plain words for each refusal. Never a distance. */
function copy(problem: Problem, dir: Dir): { tone: 'err' | 'warn'; title: string; body: string } {
  switch (problem) {
    case 'outside': return { tone: 'err', title: `Couldn't clock you ${dir}`, body: `You can only clock ${dir} from inside the restaurant.` };
    case 'mocked': return { tone: 'err', title: `Couldn't clock you ${dir}`, body: 'A location-changing app is on. Turn it off and try again.' };
    case 'noFix': return { tone: 'warn', title: "Couldn't find your location", body: 'Move closer to a window or the door and try again.' };
    case 'permission': return { tone: 'warn', title: 'Location is off', body: "Allow location so the app can check you're inside the restaurant. It's only checked when you swipe." };
    case 'gpsOff': return { tone: 'warn', title: 'Location is off', body: "Turn on location in your phone's settings and try again." };
    case 'offline': return { tone: 'warn', title: 'No internet', body: 'Nothing was recorded. Check your connection and try again.' };
    case 'turnedOff': return { tone: 'warn', title: `Couldn't clock you ${dir}`, body: 'Clocking in from your phone is turned off for this restaurant.' };
  }
}

function problemFromError(e: unknown): Problem {
  const code = (e as { code?: string })?.code;
  if (code === 'OUTSIDE_VENUE') return 'outside';
  if (code === 'MOCKED_LOCATION') return 'mocked';
  if (code === 'LOCATION_UNCERTAIN' || code === 'BAD_LOCATION') return 'noFix';
  if (code === 'PHONE_CLOCK_OFF' || code === 'VENUE_LOCATION_MISSING') return 'turnedOff';
  return 'offline';
}

const time = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
const hm = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

async function readFix(): Promise<
  { ok: true; fix: { latitude: number; longitude: number; accuracy: number | null; mocked: boolean | null } }
  | { ok: false; problem: Problem; canAskAgain?: boolean }
> {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return { ok: false, problem: 'permission', canAskAgain: perm.canAskAgain };
  if (!(await Location.hasServicesEnabledAsync())) return { ok: false, problem: 'gpsOff' };
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), FIX_TIMEOUT_MS)),
    ]);
    return {
      ok: true,
      fix: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        mocked: typeof pos.mocked === 'boolean' ? pos.mocked : null,
      },
    };
  } catch {
    return { ok: false, problem: 'noFix' };
  }
}

// ── Swipe ─────────────────────────────────────────────────────────────────────

const TRACK_H = 56;
const THUMB = 46;
const PAD = 4;

function SwipeBar({ dir, busy, onComplete }: { dir: Dir; busy: boolean; onComplete: () => void }) {
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const max = Math.max(0, width - THUMB - PAD * 2);
  // The pan handlers are created once, so they read the latest values here.
  const maxRef = useRef(0);
  const busyRef = useRef(busy);
  const completeRef = useRef(onComplete);
  useEffect(() => { maxRef.current = max; busyRef.current = busy; completeRef.current = onComplete; });

  // Busy: park the handle at the end; idle again (after an error): bring it home.
  useEffect(() => {
    Animated.spring(x, { toValue: busy ? max : 0, useNativeDriver: false, bounciness: 0, speed: 20 }).start();
  }, [busy, x, max]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !busyRef.current,
    onMoveShouldSetPanResponder: (_, g) => !busyRef.current && Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => x.setValue(Math.max(0, Math.min(maxRef.current, g.dx))),
    onPanResponderRelease: (_, g) => {
      const max = maxRef.current;
      if (max > 0 && g.dx >= max * 0.85) {
        Animated.timing(x, { toValue: max, duration: 120, useNativeDriver: false }).start(() => completeRef.current());
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 0, speed: 20 }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 0, speed: 20 }).start();
    },
  })).current;

  const isIn = dir === 'in';
  const labelOpacity = x.interpolate({ inputRange: [0, Math.max(1, max * 0.6)], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View
      style={styles.track}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={isIn ? 'Swipe to clock in' : 'Swipe to clock out'}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => { if (!busyRef.current) completeRef.current(); }}
    >
      <Animated.View
        style={[styles.fill, { backgroundColor: isIn ? C.successSoft : 'rgba(59,130,246,0.12)', width: Animated.add(x, THUMB + PAD * 2) }]}
      />
      {busy ? (
        <View style={[styles.label, { paddingLeft: 0, paddingRight: THUMB + PAD * 2 }]} pointerEvents="none">
          <ActivityIndicator size="small" color={C.textSecondary} />
          <Text style={styles.busyText}>Checking location…</Text>
        </View>
      ) : (
        <Animated.View style={[styles.label, { opacity: labelOpacity }]} pointerEvents="none">
          <Text style={styles.labelText}>{isIn ? 'Swipe to clock in' : 'Swipe to clock out'}</Text>
          <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
        </Animated.View>
      )}
      <Animated.View
        {...pan.panHandlers}
        style={[styles.thumb, { backgroundColor: isIn ? '#16A34A' : '#2563EB', transform: [{ translateX: x }] }]}
      >
        <Ionicons name={isIn ? 'log-in-outline' : 'log-out-outline'} size={20} color="#fff" />
      </Animated.View>
    </View>
  );
}

// ── Sheet ─────────────────────────────────────────────────────────────────────

export function AttendanceSheet({
  visible, onClose, clock, restaurantName,
}: { visible: boolean; onClose: () => void; clock: MyClock; restaurantName?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [canAskAgain, setCanAskAgain] = useState(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) setPhase({ kind: 'idle' });
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, [visible]);

  const clockedIn = !!clock.clockedInSince;
  const dir: Dir = clockedIn ? 'out' : 'in';

  const attempt = async () => {
    const d = dir;
    setPhase({ kind: 'checking' });
    const got = await readFix();
    if (!got.ok) {
      if (got.problem === 'permission') setCanAskAgain(got.canAskAgain !== false);
      setPhase({ kind: 'error', dir: d, problem: got.problem });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    try {
      const res = await crewMyClock.clock({ kind: d === 'in' ? 'IN' : 'OUT', ...got.fix });
      setMyClock(res.data);
      void refreshOffShift();
      setPhase({ kind: 'done', dir: d, at: new Date(), worked: res.data.workedMinutesToday });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      closeTimer.current = setTimeout(onClose, 1800);
    } catch (e) {
      setPhase({ kind: 'error', dir: d, problem: problemFromError(e) });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  };

  const busy = phase.kind === 'checking';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const last = clock.lastPunch;
  const lastAt = last ? new Date(last.at) : null;

  return (
    <BottomSheet visible={visible} onClose={() => { if (!busy) onClose(); }} title="Attendance" dismissible={!busy} disableInternalScroll maxWidth={480}>
      <View style={styles.body}>
        <View>
          <View style={styles.statusRow}>
            <View style={[styles.dot, clockedIn && styles.dotIn]} />
            <Text style={styles.statusText}>
              {clockedIn ? `Clocked in at ${time(new Date(clock.clockedInSince!))}` : 'Not clocked in'}
            </Text>
            <Text style={styles.date}>{today}</Text>
          </View>
          {!!restaurantName && <Text style={styles.venue}>{restaurantName}</Text>}
        </View>

        {lastAt && (
          <View style={styles.row}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Worked today</Text>
              <Text style={styles.statValue}>{hm(clock.workedMinutesToday)}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Last {last!.kind === 'IN' ? 'clock-in' : 'clock-out'}</Text>
              <Text style={styles.statValue}>
                {time(lastAt).replace(/\s?(AM|PM)$/, '')}
                <Text style={styles.statUnit}> {time(lastAt).slice(-2)}</Text>
              </Text>
            </View>
          </View>
        )}

        {phase.kind === 'done' && (
          <View style={[styles.card, phase.dir === 'in' ? styles.cardIn : styles.cardOut]}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="checkmark-circle" size={18} color={phase.dir === 'in' ? C.success : C.info} />
              <Text style={[styles.cardTitle, { color: phase.dir === 'in' ? C.success : C.info }]}>
                {phase.dir === 'in' ? 'Clocked in' : 'Clocked out'} · {time(phase.at)}
              </Text>
            </View>
            <Text style={styles.cardBody}>
              {phase.dir === 'in' ? 'Order and call alerts are on.' : `${hm(phase.worked)} today. Alerts are paused till you clock in.`}
            </Text>
          </View>
        )}

        {phase.kind === 'error' && (() => {
          const c = copy(phase.problem, phase.dir);
          const allow = phase.problem === 'permission' || phase.problem === 'gpsOff';
          return (
            <>
              <View style={[styles.card, c.tone === 'err' ? styles.cardErr : styles.cardWarn]}>
                <View style={styles.cardTitleRow}>
                  <Ionicons name={c.tone === 'err' ? 'close-circle' : 'alert-circle'} size={18} color={c.tone === 'err' ? C.danger : C.warning} />
                  <Text style={[styles.cardTitle, { color: c.tone === 'err' ? C.danger : C.warning }]}>{c.title}</Text>
                </View>
                <Text style={styles.cardBody}>
                  {c.body}{'\n'}Or clock {phase.dir} at the <Text style={styles.cardStrong}>attendance station</Text>.
                </Text>
              </View>
              <View style={styles.btnRow}>
                {allow ? (
                  <>
                    <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}><Text style={styles.btnGhostText}>Not now</Text></Pressable>
                    <Pressable
                      style={[styles.btn, styles.btnSolid]}
                      onPress={() => {
                        if (phase.problem === 'gpsOff' || !canAskAgain) { void Linking.openSettings(); setPhase({ kind: 'idle' }); }
                        else void attempt();
                      }}
                    >
                      <Text style={styles.btnSolidText}>{phase.problem === 'gpsOff' || !canAskAgain ? 'Open settings' : 'Allow location'}</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setPhase({ kind: 'idle' })}><Text style={styles.btnGhostText}>Try again</Text></Pressable>
                    <Pressable style={[styles.btn, styles.btnSolid]} onPress={onClose}><Text style={styles.btnSolidText}>OK</Text></Pressable>
                  </>
                )}
              </View>
            </>
          );
        })()}

        {(phase.kind === 'idle' || phase.kind === 'checking') && (
          <>
            <SwipeBar dir={dir} busy={busy} onComplete={attempt} />
            <Text style={styles.hint}>Works only inside the restaurant.</Text>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg, gap: Spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.textMuted },
  dotIn: { backgroundColor: C.success },
  statusText: { flex: 1, color: C.textPrimary, fontSize: 15, fontWeight: '600' },
  date: { color: C.textSecondary, fontSize: 13 },
  venue: { color: C.textSecondary, fontSize: 13, marginTop: 2, marginLeft: 18 },

  row: { flexDirection: 'row', gap: Spacing.sm },
  stat: {
    flex: 1, padding: Spacing.md, borderRadius: Radius.md,
    backgroundColor: C.surfaceElevated, borderWidth: 1, borderColor: C.border,
  },
  statLabel: { color: C.textSecondary, fontSize: 11.5 },
  statValue: { color: C.textPrimary, fontSize: 20, fontWeight: '800', marginTop: 2 },
  statUnit: { color: C.textSecondary, fontSize: 12, fontWeight: '600' },

  track: {
    height: TRACK_H, borderRadius: Radius.md, backgroundColor: C.surfaceElevated,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden', justifyContent: 'center', marginTop: 2,
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  label: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingLeft: THUMB,
  },
  labelText: { color: C.textPrimary, fontSize: 15, fontWeight: '700' },
  busyText: { color: C.textSecondary, fontSize: 14, fontWeight: '600' },
  thumb: {
    position: 'absolute', left: PAD, top: PAD - 1, width: THUMB, height: THUMB, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  hint: { color: C.textTertiary, fontSize: 12, textAlign: 'center' },

  card: { padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
  cardIn: { backgroundColor: C.successSoft, borderColor: C.successBorder },
  cardOut: { backgroundColor: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.3)' },
  cardErr: { backgroundColor: C.dangerSoft, borderColor: C.dangerBorder },
  cardWarn: { backgroundColor: C.warningSoft, borderColor: C.warningBorder },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  cardBody: { color: C.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 19 },
  cardStrong: { color: C.textPrimary, fontWeight: '600' },

  btnRow: { flexDirection: 'row', gap: Spacing.sm },
  btn: { flex: 1, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.borderStrong },
  btnGhostText: { color: C.textPrimary, fontSize: 15, fontWeight: '800' },
  btnSolid: { backgroundColor: C.textPrimary },
  btnSolidText: { color: C.background, fontSize: 15, fontWeight: '800' },
});
