/**
 * RangeCalendar — pure-JS month calendar with single-day or range selection.
 *
 * No native modules (no @react-native-community/datetimepicker) so it ships
 * via EAS OTA. One tap selects a single day (from == to); a second tap on a
 * different day extends it into a range. Tapping again after a range is set
 * starts over from a fresh single day.
 *
 * Usage:
 *   <RangeCalendar from={from} to={to} onChange={(f, t) => …} />
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export interface RangeCalendarProps {
  from: Date | null;
  to: Date | null;
  onChange: (from: Date | null, to: Date | null) => void;
  /** Latest selectable day (inclusive). Defaults to today. */
  maxDate?: Date;
}

export function RangeCalendar({ from, to, onChange, maxDate }: RangeCalendarProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const max = startOfDay(maxDate ?? today);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = from ?? max;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const monthStart = viewMonth;
  const leadingBlanks = monthStart.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();

  // Next-month button is disabled once the displayed month reaches max's month.
  const atMaxMonth =
    viewMonth.getFullYear() === max.getFullYear() && viewMonth.getMonth() === max.getMonth();

  const onPickDay = (day: number) => {
    const picked = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
    if (picked > max) return;
    // Nothing selected, or a multi-day range already set → start fresh as a
    // single day (from == to) so one tap is immediately usable.
    if (!from || !to || !sameDay(from, to)) {
      onChange(picked, picked);
      return;
    }
    // A single day is selected → a second tap extends it into a range.
    if (sameDay(picked, from)) {
      onChange(picked, picked);
    } else if (picked < from) {
      onChange(picked, from);
    } else {
      onChange(from, picked);
    }
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <View style={styles.wrap}>
      {/* Month header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setViewMonth((m) => addMonths(m, -1))}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={18} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>
          {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
        </Text>
        <TouchableOpacity
          style={[styles.navBtn, atMaxMonth && styles.navBtnDisabled]}
          onPress={() => !atMaxMonth && setViewMonth((m) => addMonths(m, 1))}
          disabled={atMaxMonth}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={atMaxMonth ? QuinckleColors.textTertiary : QuinckleColors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Weekday labels */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={styles.cell}>
            <Text style={styles.weekLabel}>{w}</Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      <View style={styles.grid}>
        {cells.map((day, idx) => {
          if (day == null) return <View key={`b${idx}`} style={styles.cell} />;
          const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
          const disabled = date > max;
          const isStart = sameDay(date, from);
          const isEnd = sameDay(date, to);
          const inRange = !!from && !!to && date > from && date < to;
          const isEndpoint = isStart || isEnd;
          return (
            <TouchableOpacity
              key={day}
              style={styles.cell}
              onPress={() => onPickDay(day)}
              disabled={disabled}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.dayPill,
                  inRange && styles.dayPillInRange,
                  isEndpoint && styles.dayPillEndpoint,
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    disabled && styles.dayTextDisabled,
                    inRange && styles.dayTextInRange,
                    isEndpoint && styles.dayTextEndpoint,
                  ]}
                >
                  {day}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  navBtnDisabled: { opacity: 0.4 },
  monthLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '700' },
  weekRow: { flexDirection: 'row' },
  weekLabel: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPill: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillInRange: { backgroundColor: QuinckleColors.primarySoft, borderRadius: 0, width: '100%' },
  dayPillEndpoint: { backgroundColor: QuinckleColors.primary },
  dayText: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '600' },
  dayTextDisabled: { color: QuinckleColors.textTertiary },
  dayTextInRange: { color: QuinckleColors.primary },
  dayTextEndpoint: { color: '#fff', fontWeight: '800' },
});
