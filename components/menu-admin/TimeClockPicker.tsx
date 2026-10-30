/**
 * TimeClockPicker — a dial clock for picking a time of day.
 *
 * Replaces the "HH:MM" text fields, which could not actually be typed into: the
 * input was controlled off a number and only committed a fully-parsed "HH:MM",
 * so every intermediate keystroke ("1", "17", "17:") parsed to null and the
 * field snapped back to its old value.
 *
 * Pure JS on purpose — no @react-native-community/datetimepicker — so this
 * ships over the air like RangeCalendar does. Drag the hand or tap a number;
 * hours hand off to minutes on release, the way a native clock picker does.
 *
 * Times are minutes from midnight (0–1439), matching the backend's IST
 * minute-of-day fields exactly.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius, Spacing } from '@/constants/Colors';

const { width: SCREEN_W } = Dimensions.get('window');
const DIAL = Math.min(288, SCREEN_W - 88);
const CENTER = DIAL / 2;
const RING = CENTER - 26; // radius the hour/minute numbers sit on
const TILE = 40;

type Mode = 'hour' | 'minute';

const clampMin = (m: number) => ((Math.round(m) % 1440) + 1440) % 1440;

/** "5:30 PM" — the same shape the schedule summary and the diner label use. */
export function formatTime12(min: number): string {
  const m = clampMin(min);
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

/** "2 hrs 30 min" for a start→end span, wrapping past midnight. */
export function formatSpan(start: number, end: number): string {
  const span = end > start ? end - start : 1440 - start + end;
  const h = Math.floor(span / 60);
  const m = span % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? '1 hr' : `${h} hrs`;
  return `${h} hr${h === 1 ? '' : 's'} ${m} min`;
}

/** Position on the number ring for step `value` of `steps`, 12 o'clock at top. */
function polar(value: number, steps: number) {
  const theta = (value / steps) * Math.PI * 2 - Math.PI / 2;
  return { x: CENTER + RING * Math.cos(theta), y: CENTER + RING * Math.sin(theta) };
}

export function TimeClockPicker({
  visible,
  value,
  title,
  helper,
  onCancel,
  onConfirm,
  onClear,
}: {
  visible: boolean;
  value: number;
  title?: string;
  helper?: string;
  onCancel: () => void;
  onConfirm: (minutes: number) => void;
  /** When given, the picker offers a way back to "no time set". */
  onClear?: () => void;
}) {
  const [draft, setDraft] = useState(() => clampMin(value));
  const [mode, setMode] = useState<Mode>('hour');

  // Refs so the PanResponder — built once — always reads the live state.
  const draftRef = useRef(draft);
  const modeRef = useRef<Mode>(mode);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    // Reopening always starts on the hour, from whatever is saved.
    setDraft(clampMin(value));
    setMode('hour');
    anim.setValue(0);
    Animated.spring(anim, {
      toValue: 1,
      damping: 22,
      mass: 0.8,
      stiffness: 260,
      overshootClamping: true,
      useNativeDriver: true,
    }).start();
  }, [visible, value, anim]);

  const h24 = Math.floor(draft / 60);
  const minute = draft % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const isPM = h24 >= 12;

  const setPeriod = (pm: boolean) => {
    if (pm === isPM) return;
    Haptics.selectionAsync();
    setDraft(((h24 % 12) + (pm ? 12 : 0)) * 60 + minute);
  };

  const pan = useMemo(
    () => {
      // locationX/Y are relative to the responder view. Every child of the dial
      // is pointerEvents="none", so the dial is always the touch target and the
      // coordinates stay in dial space for the whole gesture.
      const apply = (lx: number, ly: number) => {
        const dx = lx - CENTER;
        const dy = ly - CENTER;
        if (dx === 0 && dy === 0) return;
        const deg = (((Math.atan2(dy, dx) * 180) / Math.PI + 90) % 360 + 360) % 360;
        const cur = draftRef.current;
        const next =
          modeRef.current === 'hour'
            // 0° is 12 o'clock, which is hour 0 (or 12 in the afternoon).
            ? ((Math.round(deg / 30) % 12) + (cur >= 720 ? 12 : 0)) * 60 + (cur % 60)
            : Math.floor(cur / 60) * 60 + (Math.round(deg / 6) % 60);
        if (next !== cur) {
          draftRef.current = next;
          setDraft(next);
          Haptics.selectionAsync();
        }
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => apply(e.nativeEvent.locationX, e.nativeEvent.locationY),
        onPanResponderMove: (e) => apply(e.nativeEvent.locationX, e.nativeEvent.locationY),
        onPanResponderRelease: () => {
          // Picking an hour hands off to minutes, so one gesture each sets a time.
          if (modeRef.current === 'hour') setMode('minute');
        },
      });
    },
    [],
  );

  // Hand angle + whether the current value lands on a printed number.
  const handDeg = mode === 'hour' ? (h12 % 12) * 30 : minute * 6;
  const onLabel = mode === 'hour' ? true : minute % 5 === 0;

  const numbers = mode === 'hour'
    ? Array.from({ length: 12 }, (_, i) => ({ i, label: String(i === 0 ? 12 : i), on: h12 % 12 === i }))
    : Array.from({ length: 12 }, (_, i) => ({
        i,
        label: String(i * 5).padStart(2, '0'),
        on: minute === i * 5,
      }));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={onCancel}>
        <Animated.View
          style={[
            s.card,
            {
              opacity: anim,
              transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            },
          ]}
        >
          {/* Swallow taps on the card so they don't reach the dismiss backdrop. */}
          <Pressable onPress={() => {}}>
            {!!title && <Text style={s.title}>{title}</Text>}
            <Text style={s.modeHint}>
              {mode === 'hour' ? 'Pick the hour' : 'Pick the minutes'}
            </Text>

            {/* Big readout — each half switches the dial to that unit. */}
            <View style={s.readout}>
              <TouchableOpacity onPress={() => setMode('hour')} activeOpacity={0.7} hitSlop={6}>
                <Text style={[s.readoutNum, mode === 'hour' && s.readoutNumActive]}>{h12}</Text>
              </TouchableOpacity>
              <Text style={s.readoutColon}>:</Text>
              <TouchableOpacity onPress={() => setMode('minute')} activeOpacity={0.7} hitSlop={6}>
                <Text style={[s.readoutNum, mode === 'minute' && s.readoutNumActive]}>
                  {String(minute).padStart(2, '0')}
                </Text>
              </TouchableOpacity>

              <View style={s.period}>
                {[false, true].map((pm) => (
                  <TouchableOpacity
                    key={String(pm)}
                    style={[s.periodBtn, isPM === pm && s.periodBtnOn]}
                    onPress={() => setPeriod(pm)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.periodText, isPM === pm && s.periodTextOn]}>{pm ? 'PM' : 'AM'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Dial */}
            <View style={s.dial} {...pan.panHandlers}>
              {/* Hand — rotating the whole layer spins it about the dial centre. */}
              <View
                style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${handDeg}deg` }] }]}
                pointerEvents="none"
              >
                <View style={[s.hand, { left: CENTER - 1, top: CENTER - RING, height: RING }]} />
                <View
                  style={[
                    s.knob,
                    onLabel
                      ? { left: CENTER - TILE / 2, top: CENTER - RING - TILE / 2, width: TILE, height: TILE, borderRadius: TILE / 2 }
                      : { left: CENTER - 7, top: CENTER - RING - 7, width: 14, height: 14, borderRadius: 7 },
                  ]}
                />
              </View>

              <View style={s.hub} pointerEvents="none" />

              {/* Numbers sit above the knob so the selected one reads white on orange. */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                {numbers.map(({ i, label, on }) => {
                  const { x, y } = polar(i, 12);
                  return (
                    <View
                      key={i}
                      style={[s.tile, { left: x - TILE / 2, top: y - TILE / 2 }]}
                    >
                      <Text style={[s.tileText, on && s.tileTextOn]}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <Text style={s.preview}>{formatTime12(draft)}</Text>
            {!!helper && <Text style={s.helper}>{helper}</Text>}

            {!!onClear && (
              <TouchableOpacity style={s.clear} onPress={onClear} activeOpacity={0.7} hitSlop={6}>
                <Text style={s.clearText}>Clear — no time limit</Text>
              </TouchableOpacity>
            )}

            <View style={s.actions}>
              <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={onCancel} activeOpacity={0.7}>
                <Text style={s.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, s.btnPrimary]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onConfirm(draft);
                }}
                activeOpacity={0.85}
              >
                <Text style={s.btnPrimaryText}>Set time</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/**
 * A labelled field that reads like a time and opens the dial when tapped.
 * Drop-in replacement for the old "HH:MM" TextInput pair.
 */
export function TimeField({
  label,
  value,
  onChange,
  onClear,
  helper,
  placeholder = 'Any time',
  defaultValue = 9 * 60,
}: {
  label: string;
  /** null renders `placeholder` — used where a window is optional. */
  value: number | null;
  onChange: (minutes: number) => void;
  /** Pass to let the owner unset the time again. */
  onClear?: () => void;
  helper?: string;
  placeholder?: string;
  /** What the dial opens on when nothing is set yet. */
  defaultValue?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TouchableOpacity
        style={s.field}
        activeOpacity={0.8}
        onPress={() => {
          Haptics.selectionAsync();
          setOpen(true);
        }}
      >
        <Text style={[s.fieldValue, value == null && s.fieldValueEmpty]}>
          {value == null ? placeholder : formatTime12(value)}
        </Text>
        <Ionicons name="time-outline" size={16} color={QuinckleColors.textSecondary} />
      </TouchableOpacity>
      <TimeClockPicker
        visible={open}
        value={value ?? defaultValue}
        title={label}
        helper={helper}
        onCancel={() => setOpen(false)}
        onConfirm={(m) => {
          setOpen(false);
          onChange(m);
        }}
        onClear={
          onClear && value != null
            ? () => {
                setOpen(false);
                onClear();
              }
            : undefined
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 0.5,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  title: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  modeHint: {
    color: QuinckleColors.textTertiary,
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 3,
  },

  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  readoutNum: { color: QuinckleColors.textTertiary, fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  readoutNumActive: { color: QuinckleColors.primary },
  readoutColon: { color: QuinckleColors.textTertiary, fontSize: 36, fontWeight: '700', marginHorizontal: 2 },
  period: { marginLeft: Spacing.md, gap: 4 },
  periodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  periodBtnOn: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
  periodText: { color: QuinckleColors.textSecondary, fontSize: 11, fontWeight: '800' },
  periodTextOn: { color: '#FFF' },

  dial: {
    width: DIAL,
    height: DIAL,
    borderRadius: DIAL / 2,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
    alignSelf: 'center',
  },
  hand: { position: 'absolute', width: 2, backgroundColor: QuinckleColors.primary },
  knob: { position: 'absolute', backgroundColor: QuinckleColors.primary },
  hub: {
    position: 'absolute',
    left: CENTER - 4,
    top: CENTER - 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: QuinckleColors.primary,
  },
  tile: { position: 'absolute', width: TILE, height: TILE, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },
  tileTextOn: { color: '#FFF', fontWeight: '800' },

  preview: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  helper: {
    color: QuinckleColors.textTertiary,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },

  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  btn: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, alignItems: 'center' },
  btnGhost: { borderWidth: 1, borderColor: QuinckleColors.border, backgroundColor: QuinckleColors.surfaceMuted },
  btnGhostText: { color: QuinckleColors.textSecondary, fontSize: 13.5, fontWeight: '700' },
  btnPrimary: { backgroundColor: QuinckleColors.primary },
  btnPrimaryText: { color: '#FFF', fontSize: 13.5, fontWeight: '800' },

  fieldLabel: { color: QuinckleColors.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 5 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  fieldValue: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  fieldValueEmpty: { color: QuinckleColors.textMuted, fontWeight: '500' },

  clear: { alignSelf: 'center', marginTop: Spacing.md, paddingVertical: 2 },
  clearText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600' },
});
