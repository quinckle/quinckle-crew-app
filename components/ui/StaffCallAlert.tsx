/**
 * Call Staff — the crew side.
 *
 * A diner tapped "Call Staff" on the menu page. Every floor phone shows this
 * full-screen alert and rings until one waiter taps "On my way"; the backend
 * then broadcasts `staff_call:resolved` and every other phone goes quiet.
 *
 * Mounted once in the staff layout (above the Stack) so it covers whatever
 * screen the waiter is on.
 *
 * How a call reaches this screen:
 *  - Ably `waiter:<restaurantId>` → `staff_call:created` (app open)
 *  - a push arriving while the app is open (Ably may be reconnecting) → refetch
 *  - tapping the push from the lock screen / a killed app → refetch on launch
 *  - coming back to the foreground → refetch
 * The server is the source of truth: anything shown is re-checked against
 * GET /api/crew/staff-calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, AppState, Easing, Modal, Pressable, StyleSheet, Text, Vibration, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors as C } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';
import { crewStaffCalls, type StaffCall } from '../../services/api';
import { subscribeChannel } from '../../services/realtime';
import { useOffShift } from '../../stores/offShift';

/** One ring on the phone lasts this long; the server re-rings every 30s. */
const LOCAL_RING_MS = 25_000;
const VIBRATE_PATTERN = [0, 700, 300, 700, 300, 700, 900];

function tableLabel(call: Pick<StaffCall, 'tableNumber'>) {
  return call.tableNumber != null ? `Table ${call.tableNumber}` : 'A table';
}

/** Time since the diner tapped, as m:ss — counts up on the ringing screen. */
function elapsedLabel(createdAt: string, now: number) {
  const s = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function agoLabel(createdAt: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(createdAt)) / 1000));
  if (s < 5) return 'Just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

/** Looping ring + vibration while a call is on screen. */
function useRinger() {
  const soundRef = useRef<Audio.Sound | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringing = useRef(false);

  const stop = useCallback(() => {
    ringing.current = false;
    if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }
    Vibration.cancel();
    const s = soundRef.current;
    soundRef.current = null;
    if (s) { void s.stopAsync().catch(() => {}).finally(() => { void s.unloadAsync().catch(() => {}); }); }
  }, []);

  const start = useCallback(async () => {
    if (ringing.current) return;
    ringing.current = true;
    Vibration.vibrate(VIBRATE_PATTERN, true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    stopTimer.current = setTimeout(stop, LOCAL_RING_MS);
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true, staysActiveInBackground: false,
        shouldDuckAndroid: false, playThroughEarpieceAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/audio/notifications/staff_call_alarm.wav'),
        { isLooping: true, volume: 1 },
      );
      if (!ringing.current) { void sound.unloadAsync(); return; }
      soundRef.current = sound;
      await sound.playAsync();
    } catch { /* sound is best-effort — vibration still runs */ }
  }, [stop]);

  useEffect(() => stop, [stop]);
  return { start, stop };
}

function Ripple({ delay }: { delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 2100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => { loop.stop(); };
  }, [v, delay]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ripple, {
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1.45] }) }],
      }]}
    />
  );
}

/** Whole-screen orange wash that breathes in and out — readable from across the floor. */
function AlarmWash() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => { loop.stop(); };
  }, [v]);
  return (
    <Animated.View pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: C.primary, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.22] }) }]} />
  );
}

function BlinkDot() {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.25, duration: 500, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]));
    loop.start();
    return () => { loop.stop(); };
  }, [v]);
  return <Animated.View style={[styles.liveDot, { opacity: v }]} />;
}

function SwingingBell({ size = 30 }: { size?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 110, useNativeDriver: true }),
      Animated.timing(v, { toValue: -1, duration: 180, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.6, duration: 150, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.delay(450),
    ]));
    loop.start();
    return () => { loop.stop(); };
  }, [v]);
  return (
    <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] }) }] }}>
      <Ionicons name="notifications" size={size} color="#FFF" />
    </Animated.View>
  );
}

type Toast = { text: string; tone: 'ok' | 'info'; key: number };

export function StaffCallAlert() {
  const { staffInfo, role } = useAuth();
  const restaurantId = staffInfo?.restaurantId ?? null;
  const insets = useSafeAreaInsets();
  const { start: startRing, stop: stopRing } = useRinger();
  // Off shift (clocked out at the station): calls stay listed for whoever is
  // on, but this phone neither rings nor shows them.
  const { alertsMuted: offShift } = useOffShift();

  const [calls, setCalls] = useState<StaffCall[]>([]);
  // Calls this waiter dismissed with "Not me" — quiet on this phone, still listed.
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState(Date.now());
  const callsRef = useRef<StaffCall[]>([]);
  useEffect(() => { callsRef.current = calls; }, [calls]);

  const showToast = useCallback((text: string, tone: Toast['tone']) => {
    setToast({ text, tone, key: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => { clearTimeout(t); };
  }, [toast]);

  const upsert = useCallback((call: StaffCall) => {
    setCalls(prev => {
      const rest = prev.filter(c => c.id !== call.id);
      return [...rest, call].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    });
    // A re-ring (nobody answered) brings the alert back even after "Not me".
    setSnoozed(prev => {
      if (!(call.id in prev) || (prev[call.id] ?? 0) >= call.ring) return prev;
      const next = { ...prev }; delete next[call.id]; return next;
    });
  }, []);

  const remove = useCallback((callId: string) => {
    setCalls(prev => prev.filter(c => c.id !== callId));
    setSnoozed(prev => { if (!(callId in prev)) return prev; const n = { ...prev }; delete n[callId]; return n; });
  }, []);

  const refresh = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const open = await crewStaffCalls.listOpen();
      setCalls(open);
    } catch { /* keep what we have; the next event or foreground retries */ }
  }, [restaurantId]);

  // Live events.
  useEffect(() => {
    if (!restaurantId || role !== 'staff') return;
    const offCreated = subscribeChannel(`waiter:${restaurantId}`, 'staff_call:created', (data: StaffCall) => {
      if (data?.id) upsert(data);
    });
    const offResolved = subscribeChannel(`waiter:${restaurantId}`, 'staff_call:resolved', (data: any) => {
      const callId = data?.callId as string | undefined;
      if (!callId) return;
      const wasShown = callsRef.current.some(c => c.id === callId);
      remove(callId);
      if (wasShown && data?.staffId !== staffInfo?.id) {
        const first = String(data?.staffName ?? 'Someone').trim().split(/\s+/)[0];
        showToast(`${first} is on ${data?.tableNumber != null ? `Table ${data.tableNumber}` : 'it'}`, 'info');
      }
      // Clear the matching notification from the shade on this phone.
      void Notifications.getPresentedNotificationsAsync().then(list => {
        list.forEach(n => {
          const d: any = n.request.content.data;
          if (d?.type === 'staff_call' && d?.callId === callId) {
            void Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
          }
        });
      }).catch(() => {});
    });
    void refresh();
    return () => { offCreated(); offResolved(); };
  }, [restaurantId, role, staffInfo?.id, upsert, remove, refresh, showToast]);

  // Push received while open, push tapped, app back in front → re-sync.
  useEffect(() => {
    if (!restaurantId || role !== 'staff') return;
    const isCall = (n: Notifications.Notification) => (n.request.content.data as any)?.type === 'staff_call';
    const recv = Notifications.addNotificationReceivedListener(n => { if (isCall(n)) void refresh(); });
    const resp = Notifications.addNotificationResponseReceivedListener(r => { if (isCall(r.notification)) void refresh(); });
    void Notifications.getLastNotificationResponseAsync().then(r => { if (r && isCall(r.notification)) void refresh(); }).catch(() => {});
    const app = AppState.addEventListener('change', s => { if (s === 'active') void refresh(); });
    return () => { recv.remove(); resp.remove(); app.remove(); };
  }, [restaurantId, role, refresh]);

  const active = offShift ? null : calls.find(c => !(c.id in snoozed)) ?? null;
  const othersWaiting = calls.filter(c => c.id !== active?.id).length;
  const snoozedOpen = offShift ? [] : calls.filter(c => c.id in snoozed);

  // Ring while there's an unsnoozed call on screen.
  const activeKey = active ? `${active.id}:${active.ring}` : null;
  useEffect(() => {
    if (activeKey) void startRing(); else stopRing();
  }, [activeKey, startRing, stopRing]);

  useEffect(() => {
    if (!calls.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); };
  }, [calls.length]);

  const accept = async (call: StaffCall) => {
    if (busyId) return;
    setBusyId(call.id);
    stopRing();
    try {
      await crewStaffCalls.acknowledge(call.id);
      remove(call.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(`You're on the way to ${tableLabel(call)}`, 'ok');
    } catch (e: any) {
      // Someone beat us to it, or the call expired — either way it's handled.
      remove(call.id);
      const msg = typeof e?.message === 'string' && !e.message.startsWith('API error') ? e.message : `${tableLabel(call)} is already handled`;
      showToast(msg, 'info');
    } finally {
      setBusyId(null);
    }
  };

  const snooze = (call: StaffCall) => {
    stopRing();
    setSnoozed(prev => ({ ...prev, [call.id]: call.ring }));
  };

  if (role !== 'staff') return null;

  return (
    <>
      {/* Quiet reminder for calls this waiter passed on. */}
      {!active && snoozedOpen.length > 0 && (
        <Pressable
          onPress={() => setSnoozed({})}
          style={[styles.pill, { top: insets.top + 8 }]}
          accessibilityRole="button"
          accessibilityLabel={`${tableLabel(snoozedOpen[0])} is still waiting. Open the call`}>
          <View style={styles.pillDot} />
          <Text style={styles.pillText} numberOfLines={1}>
            {snoozedOpen.length > 1 ? `${snoozedOpen.length} tables waiting` : `${tableLabel(snoozedOpen[0])} still waiting`}
            {' · '}{agoLabel(snoozedOpen[0].createdAt, now)}
          </Text>
          <Text style={styles.pillCta}>Respond</Text>
        </Pressable>
      )}

      {toast && (
        <View
          key={toast.key}
          pointerEvents="none"
          style={[styles.toast, { bottom: insets.bottom + 72 }, toast.tone === 'ok' ? styles.toastOk : styles.toastInfo]}>
          <Ionicons name={toast.tone === 'ok' ? 'checkmark-circle' : 'information-circle'} size={18}
            color={toast.tone === 'ok' ? C.success : C.textSecondary} />
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}

      <Modal visible={!!active} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (active) snooze(active); }}>
        {active && (
          <View style={styles.sheet}>
            <AlarmWash />
            <LinearGradient pointerEvents="none" colors={['rgba(243,93,59,0.55)', 'rgba(243,93,59,0)']} style={styles.topGlow} />

            <View style={[styles.body, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 18 }]}>
              {/* Status row */}
              <View style={styles.statusRow}>
                <View style={styles.liveChip}>
                  <BlinkDot />
                  <Text style={styles.liveText}>{active.ring > 1 ? 'Still waiting' : 'Diner calling'}</Text>
                </View>
                <View style={styles.timerChip}>
                  <Ionicons name="time-outline" size={14} color={C.textPrimary} />
                  <Text style={styles.timerText}>{elapsedLabel(active.createdAt, now)}</Text>
                </View>
              </View>

              {/* Table */}
              <View style={styles.center}>
                <View style={styles.rings}>
                  <Ripple delay={0} />
                  <Ripple delay={700} />
                  <Ripple delay={1400} />
                  <View style={styles.disc}>
                    {active.tableNumber != null ? (
                      <>
                        <Text style={styles.discLabel}>Table</Text>
                        <Text style={styles.discNumber} numberOfLines={1} adjustsFontSizeToFit>{active.tableNumber}</Text>
                      </>
                    ) : (
                      <SwingingBell size={56} />
                    )}
                  </View>
                  <View style={styles.bellBadge}><SwingingBell size={20} /></View>
                </View>

                <Text style={styles.headline}>
                  {active.tableNumber != null ? 'needs you at the table' : 'A table needs help'}
                </Text>

                <View style={styles.ringTrack} accessibilityLabel={`Ring ${active.ring} of 3`}>
                  {[1, 2, 3].map(n => (
                    <View key={n} style={[styles.ringSeg, n <= active.ring && styles.ringSegOn]} />
                  ))}
                  <Text style={styles.ringText}>Ring {Math.min(active.ring, 3)} of 3</Text>
                </View>

                {othersWaiting > 0 && (
                  <View style={styles.queue}>
                    <Text style={styles.queueLabel}>Also calling</Text>
                    <View style={styles.queueRow}>
                      {calls.filter(c => c.id !== active.id).slice(0, 4).map(c => (
                        <View key={c.id} style={styles.queueChip}>
                          <Text style={styles.queueChipText}>
                            {c.tableNumber != null ? `T${c.tableNumber}` : 'Table'} · {agoLabel(c.createdAt, now)}
                          </Text>
                        </View>
                      ))}
                      {othersWaiting > 4 && <Text style={styles.queueMore}>+{othersWaiting - 4}</Text>}
                    </View>
                  </View>
                )}
              </View>

              {/* Actions */}
              <Pressable
                onPress={() => { void accept(active); }}
                disabled={busyId === active.id}
                style={({ pressed }) => [styles.go, pressed && { transform: [{ scale: 0.98 }] }, busyId === active.id && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`On my way to ${tableLabel(active)}`}>
                {busyId === active.id ? (
                  <ActivityIndicator color={C.background} />
                ) : (
                  <>
                    <Text style={styles.goText}>On my way</Text>
                    <View style={styles.goIcon}><Ionicons name="arrow-forward" size={20} color="#FFF" /></View>
                  </>
                )}
              </Pressable>
              <Pressable onPress={() => snooze(active)} style={({ pressed }) => [styles.later, pressed && { opacity: 0.7 }]} accessibilityRole="button">
                <Text style={styles.laterText}>Not me · let someone else take it</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: C.background },
  topGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  body: { flex: 1, paddingHorizontal: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.16)', borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
  liveText: { color: '#FFF', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase' },
  timerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.16)', borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  timerText: { color: C.textPrimary, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  rings: { width: 250, height: 250, alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', width: 250, height: 250, borderRadius: 125, borderWidth: 3, borderColor: C.primary },
  disc: {
    width: 184, height: 184, borderRadius: 92, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: C.primary, shadowOpacity: 0.7, shadowRadius: 36, shadowOffset: { width: 0, height: 10 }, elevation: 18,
  },
  discLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '800', letterSpacing: 3, textTransform: 'uppercase', marginBottom: -6 },
  discNumber: { color: '#FFF', fontSize: 96, fontWeight: '900', letterSpacing: -3, fontVariant: ['tabular-nums'] },
  bellBadge: {
    position: 'absolute', top: 30, right: 30, width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.background, borderWidth: 2, borderColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  headline: { color: C.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 22, textAlign: 'center' },
  ringTrack: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  ringSeg: { width: 26, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.16)' },
  ringSegOn: { backgroundColor: C.primary },
  ringText: { color: C.textSecondary, fontSize: 12, fontWeight: '700', marginLeft: 6 },
  queue: { marginTop: 22, alignItems: 'center', gap: 8 },
  queueLabel: { color: C.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  queueRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 6 },
  queueChip: {
    backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  queueChipText: { color: C.primaryLight, fontSize: 12, fontWeight: '700' },
  queueMore: { color: C.textSecondary, fontSize: 12, fontWeight: '700' },
  go: {
    alignSelf: 'stretch', height: 68, borderRadius: 22, backgroundColor: '#FFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  goText: { color: C.background, fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  goIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  later: {
    alignSelf: 'stretch', marginTop: 10, paddingVertical: 14, borderRadius: 18, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(0,0,0,0.25)',
  },
  laterText: { color: C.textSecondary, fontSize: 14, fontWeight: '700' },
  pill: {
    position: 'absolute', left: 12, right: 12, zIndex: 50,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#2A1410', borderColor: C.primarySoftBorder, borderWidth: 1,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  pillText: { flex: 1, color: C.textPrimary, fontSize: 13, fontWeight: '600' },
  pillCta: { color: C.primary, fontSize: 13, fontWeight: '800' },
  toast: {
    position: 'absolute', left: 12, right: 12, zIndex: 60,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1,
  },
  toastOk: { backgroundColor: '#10261A', borderColor: C.successBorder },
  toastInfo: { backgroundColor: C.surfaceElevated, borderColor: C.border },
  toastText: { flex: 1, color: C.textPrimary, fontSize: 13, fontWeight: '600' },
});
