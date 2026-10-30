import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { QuinckleColors, Spacing, Radius } from '@/constants/Colors';
import { TimeField, formatSpan } from './TimeClockPicker';

/**
 * Availability schedule for a menu item — the app half of the web dashboard's
 * editor. Deliberately named the same as the combo editor's "Availability
 * schedule" rather than any new coinage, so one product doesn't ship two words
 * for the same idea.
 *
 * Times are minutes from IST midnight and dates are IST calendar days, matching
 * the backend exactly (services/availability-rules.ts). The form works in
 * "HH:MM" / "YYYY-MM-DD" strings like combo-edit does.
 */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const IST_OFFSET_MS = 330 * 60 * 1000;

export type AvailabilityWindow = { days: number[]; start: number; end: number };

export type ScheduleValue = {
  scheduleEnabled: boolean;
  windows: AvailabilityWindow[];
  validFrom: string; // YYYY-MM-DD (IST), '' when unset
  validUntil: string;
  lastOrderCutoffMin: string; // kept as text so the field can be blank
  dailyQtyCap: string;
  hideWhenUnavailable: boolean;
};

export const emptySchedule = (): ScheduleValue => ({
  scheduleEnabled: false,
  windows: [],
  validFrom: '',
  validUntil: '',
  lastOrderCutoffMin: '',
  dailyQtyCap: '',
  hideWhenUnavailable: false,
});

export const minToTime = (m?: number | null): string =>
  m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const timeToMin = (v: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
};

const isoToISTDate = (iso?: string | null): string =>
  !iso ? '' : new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Read the slotting fields off a menu item (or a router param blob) into form state. */
export function scheduleFromItem(raw: any): ScheduleValue {
  if (!raw) return emptySchedule();
  const windows = Array.isArray(raw.availabilityWindows)
    ? raw.availabilityWindows
        .filter((w: any) => w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
        .map((w: any) => ({
          days: Array.isArray(w.days) ? w.days.map(Number).filter((d: number) => d >= 0 && d <= 6) : [],
          start: Number(w.start),
          end: Number(w.end),
        }))
    : [];
  return {
    scheduleEnabled: !!raw.scheduleEnabled,
    windows,
    validFrom: isoToISTDate(raw.validFrom),
    validUntil: isoToISTDate(raw.validUntil),
    lastOrderCutoffMin: raw.lastOrderCutoffMin != null ? String(raw.lastOrderCutoffMin) : '',
    dailyQtyCap: raw.dailyQtyCap != null ? String(raw.dailyQtyCap) : '',
    hideWhenUnavailable: !!raw.hideWhenUnavailable,
  };
}

/** Form state → the fields the partner menu API expects. */
export function scheduleToPayload(v: ScheduleValue) {
  const num = (s: string) => {
    const n = parseInt(s.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    scheduleEnabled: v.scheduleEnabled,
    availabilityWindows: v.scheduleEnabled ? v.windows : null,
    validFrom: v.validFrom ? new Date(`${v.validFrom}T00:00:00+05:30`).toISOString() : null,
    validUntil: v.validUntil ? new Date(`${v.validUntil}T23:59:59+05:30`).toISOString() : null,
    lastOrderCutoffMin: num(v.lastOrderCutoffMin),
    dailyQtyCap: num(v.dailyQtyCap),
    hideWhenUnavailable: v.hideWhenUnavailable,
  };
}

/**
 * Mirrors the server's guards (applySlottingFields) so a bad setup is caught
 * here instead of coming back as a 400. Returns an error string or null.
 */
export function validateSchedule(v: ScheduleValue): string | null {
  if (!v.scheduleEnabled) return null;
  if (v.windows.length === 0 && !v.validFrom && !v.validUntil) {
    return 'Add at least one time window or a date range — or turn the schedule off.';
  }
  for (const w of v.windows) {
    if (w.start === w.end) return 'A window needs a start and an end that differ.';
  }
  const cutoff = parseInt(v.lastOrderCutoffMin, 10);
  if (Number.isFinite(cutoff) && cutoff > 0) {
    for (const w of v.windows) {
      const span = w.end > w.start ? w.end - w.start : 1440 - w.start + w.end;
      if (cutoff >= span) return 'Last orders must be shorter than every window.';
    }
  }
  for (const d of [v.validFrom, v.validUntil]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'Dates must look like YYYY-MM-DD.';
  }
  return null;
}

const fmt12 = (min: number): string => {
  const wrapped = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

/** "Mon & Wed, 7 AM – 11 AM and 5 PM – 7 PM" — matches the diner-facing label. */
export function describeSchedule(v: ScheduleValue): string {
  if (!v.scheduleEnabled || v.windows.length === 0) return 'Available all the time';
  const dayPart = (days: number[]) =>
    days.length === 0 || days.length === 7
      ? 'Every day'
      : [...days].sort((a, b) => a - b).map(d => DAY_LABELS[d]).join(' & ');
  return v.windows
    .map(w => `${dayPart(w.days)}, ${fmt12(w.start)} – ${fmt12(w.end)}`)
    .join(' · ');
}

export default function AvailabilityScheduleEditor({
  value,
  onChange,
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
}) {
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });

  const addWindow = () =>
    set({ scheduleEnabled: true, windows: [...value.windows, { days: [], start: 17 * 60, end: 19 * 60 }] });

  const patchWindow = (i: number, patch: Partial<AvailabilityWindow>) =>
    set({ windows: value.windows.map((w, wi) => (wi === i ? { ...w, ...patch } : w)) });

  const removeWindow = (i: number) => set({ windows: value.windows.filter((_, wi) => wi !== i) });

  const toggleDay = (i: number, d: number) => {
    const w = value.windows[i];
    if (!w) return;
    patchWindow(i, { days: w.days.includes(d) ? w.days.filter(x => x !== d) : [...w.days, d].sort((a, b) => a - b) });
  };

  const error = validateSchedule(value);

  return (
    <View>
      <TouchableOpacity
        style={styles.toggleRow}
        activeOpacity={0.8}
        onPress={() => {
          const next = !value.scheduleEnabled;
          // Turning it on with nothing set is an invalid state the owner would
          // have to fix, so seed a sensible evening window instead.
          set({
            scheduleEnabled: next,
            windows: next && value.windows.length === 0 ? [{ days: [], start: 17 * 60, end: 19 * 60 }] : value.windows,
          });
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleLabel}>Availability schedule</Text>
          <Text style={styles.toggleSub}>Serve this dish only on certain days and hours.</Text>
        </View>
        <View style={[styles.switch, value.scheduleEnabled && styles.switchOn]}>
          <View style={[styles.knob, value.scheduleEnabled && styles.knobOn]} />
        </View>
      </TouchableOpacity>

      {value.scheduleEnabled && (
        <View style={{ gap: Spacing.md, marginTop: Spacing.sm }}>
          {value.windows.map((w, i) => (
            <View key={i} style={styles.windowCard}>
              <View style={styles.windowHead}>
                <Text style={styles.windowTitle}>
                  Window {i + 1}
                  {w.end <= w.start && <Text style={styles.overnight}>  runs past midnight</Text>}
                </Text>
                <TouchableOpacity onPress={() => removeWindow(i)} hitSlop={8}>
                  <Text style={styles.remove}>Remove</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.hint}>Days (none selected = every day)</Text>
              <View style={styles.chipRow}>
                {DAY_LABELS.map((lbl, d) => {
                  const active = w.days.includes(d);
                  return (
                    <TouchableOpacity
                      key={d}
                      onPress={() => toggleDay(i, d)}
                      activeOpacity={0.8}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
                <TimeField
                  label="From"
                  value={w.start}
                  onChange={m => patchWindow(i, { start: m })}
                  helper="When the dish starts being orderable."
                />
                <TimeField
                  label="Until"
                  value={w.end}
                  onChange={m => patchWindow(i, { end: m })}
                  helper="An earlier time than the start runs the window past midnight."
                />
              </View>

              {w.start !== w.end && (
                <Text style={styles.span}>Serving for {formatSpan(w.start, w.end)}</Text>
              )}

              {w.end <= w.start && (
                <Text style={styles.overnightNote}>
                  Ends the next morning. The days above are the days it starts — a Friday 10 PM – 2 AM
                  window is still serving at 1 AM on Saturday.
                </Text>
              )}
            </View>
          ))}

          {value.windows.length < 6 && (
            <TouchableOpacity onPress={addWindow} activeOpacity={0.8} style={styles.addWindow}>
              <Text style={styles.addWindowText}>+ Add another window</Text>
            </TouchableOpacity>
          )}

          <View style={styles.summary}>
            <Text style={styles.summaryText}>{describeSchedule(value)}</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hint}>In season from (optional)</Text>
              <TextInput
                style={styles.input} value={value.validFrom} onChangeText={t => set({ validFrom: t })}
                placeholder="YYYY-MM-DD" placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="numbers-and-punctuation" autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hint}>Until (optional)</Text>
              <TextInput
                style={styles.input} value={value.validUntil} onChangeText={t => set({ validUntil: t })}
                placeholder="YYYY-MM-DD" placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="numbers-and-punctuation" autoCapitalize="none"
              />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hint}>Last orders (min before close)</Text>
              <TextInput
                style={styles.input} value={value.lastOrderCutoffMin}
                onChangeText={t => set({ lastOrderCutoffMin: t.replace(/[^0-9]/g, '') })}
                placeholder="none" placeholderTextColor={QuinckleColors.textMuted} keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hint}>Daily limit (units/day)</Text>
              <TextInput
                style={styles.input} value={value.dailyQtyCap}
                onChangeText={t => set({ dailyQtyCap: t.replace(/[^0-9]/g, '') })}
                placeholder="∞" placeholderTextColor={QuinckleColors.textMuted} keyboardType="number-pad"
              />
            </View>
          </View>

          <TouchableOpacity
            style={styles.toggleRow}
            activeOpacity={0.8}
            onPress={() => set({ hideWhenUnavailable: !value.hideWhenUnavailable })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Hide completely when off</Text>
              <Text style={styles.toggleSub}>Off by default — showing the timing sells the next visit.</Text>
            </View>
            <View style={[styles.switch, value.hideWhenUnavailable && styles.switchOn]}>
              <View style={[styles.knob, value.hideWhenUnavailable && styles.knobOn]} />
            </View>
          </TouchableOpacity>

          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  toggleLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  toggleSub: { color: QuinckleColors.textMuted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', padding: 2, justifyContent: 'center' },
  switchOn: { backgroundColor: QuinckleColors.primary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFF' },
  knobOn: { alignSelf: 'flex-end' },

  windowCard: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: Radius.md, padding: Spacing.md, backgroundColor: 'rgba(255,255,255,0.02)' },
  windowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  windowTitle: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '700' },
  overnight: { color: QuinckleColors.primary, fontSize: 11, fontWeight: '500' },
  overnightNote: { color: QuinckleColors.textMuted, fontSize: 11, lineHeight: 15, marginTop: Spacing.sm },
  remove: { color: QuinckleColors.textMuted, fontSize: 12, fontWeight: '600' },

  hint: { color: QuinckleColors.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 5 },
  span: { color: QuinckleColors.textTertiary, fontSize: 11.5, fontWeight: '600', marginTop: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: Radius.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' },
  chipActive: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
  chipText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFF' },

  input: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, color: QuinckleColors.textPrimary,
    fontSize: 14, backgroundColor: 'rgba(255,255,255,0.03)',
  },

  addWindow: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.14)', borderRadius: Radius.sm, paddingVertical: 12, alignItems: 'center' },
  addWindowText: { color: QuinckleColors.textSecondary, fontSize: 12.5, fontWeight: '600' },

  summary: { borderWidth: 1, borderColor: 'rgba(242,93,59,0.22)', backgroundColor: 'rgba(242,93,59,0.06)', borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 9 },
  summaryText: { color: QuinckleColors.primary, fontSize: 12, fontWeight: '600' },

  errorBox: { borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 9 },
  errorText: { color: '#FCA5A5', fontSize: 12 },
});
