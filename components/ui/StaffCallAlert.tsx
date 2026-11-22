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
  Animated, AppState, Easing, Modal, Pressable, StyleSheet, Text, Vibration, View,
} from 'react-native';
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
const VIBRATE_PATTERN = [0, 500, 400, 500, 1200];

function tableLabel(call: Pick<StaffCall, 'tableNumber'>) {
  return call.tableNumber != null ? `Table ${call.tableNumber}` : 'A table';
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
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false });
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/audio/notifications/waiter notification.mp3'),
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
        Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => { loop.stop(); };
  }, [v, delay]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ripple, {
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.3] }) }],
      }]}
    />
  );
}

function SwingingBell() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(v, { toValue: -1, duration: 200, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.6, duration: 160, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.delay(500),
    ]));
    loop.start();
    return () => { loop.stop(); };
  }, [v]);
  return (
    <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [-1, 1], outputRange: ['-16deg', '16deg'] }) }] }}>
      <Ionicons name="notifications" size={36} color="#FFF" />
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
          <View style={[styles.sheet, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.glow} pointerEvents="none" />
            <View style={styles.rings}>
              <Ripple delay={0} />
              <Ripple delay={600} />
              <Ripple delay={1200} />
              <View style={styles.core}><SwingingBell /></View>
            </View>

            <Text style={styles.kicker}>{active.ring > 1 ? 'Still waiting' : 'Diner is calling'}</Text>
            <Text style={styles.table}>{tableLabel(active)}</Text>
            <Text style={styles.sub}>Someone at the table needs help.</Text>

            <View style={styles.metaRow}>
              <Text style={styles.meta}>{agoLabel(active.createdAt, now)}</Text>
              {active.ring > 1 && <Text style={styles.meta}>Ring {active.ring} of 3</Text>}
              {othersWaiting > 0 && <Text style={[styles.meta, styles.metaHot]}>+{othersWaiting} more calling</Text>}
            </View>

            <View style={{ flex: 1 }} />

            <Pressable
              onPress={() => { void accept(active); }}
              disabled={busyId === active.id}
              style={({ pressed }) => [styles.go, (pressed || busyId === active.id) && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`On my way to ${tableLabel(active)}`}>
              <Text style={styles.goText}>{busyId === active.id ? 'Sending…' : 'On my way'}</Text>
            </Pressable>
            <Pressable onPress={() => snooze(active)} style={styles.later} accessibilityRole="button">
              <Text style={styles.laterText}>Not me, keep it ringing for others</Text>
            </Pressable>
          </View>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: C.background, alignItems: 'center', paddingHorizontal: 24 },
  glow: {
    position: 'absolute', top: -120, width: 520, height: 520, borderRadius: 260,
    backgroundColor: 'rgba(243,93,59,0.14)',
  },
  rings: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  ripple: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 2, borderColor: C.primary },
  core: {
    width: 92, height: 92, borderRadius: 46, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  kicker: { color: C.primary, fontSize: 12, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  table: { color: C.textPrimary, fontSize: 52, fontWeight: '800', letterSpacing: -1, marginTop: 6 },
  sub: { color: C.textSecondary, fontSize: 15, marginTop: 6 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16 },
  meta: {
    color: C.textPrimary, fontSize: 12, fontWeight: '600', overflow: 'hidden',
    backgroundColor: C.surfaceElevated, borderColor: C.border, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  metaHot: { color: C.primary, borderColor: C.primarySoftBorder },
  go: {
    alignSelf: 'stretch', backgroundColor: C.primary, borderRadius: 18, paddingVertical: 18, alignItems: 'center',
    shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  goText: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  later: { paddingVertical: 14, paddingHorizontal: 8 },
  laterText: { color: C.textSecondary, fontSize: 14, fontWeight: '600' },
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
