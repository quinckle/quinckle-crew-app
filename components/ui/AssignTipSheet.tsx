/**
 * AssignTipSheet — who the tip goes to.
 *
 * Lifted out of the adjust-bill form because a list of every active staff
 * member is the longest thing on that screen and the least often touched: most
 * bills have no tip, and a tipped bill is usually one name. The screen shows a
 * single row instead, and this opens when the biller actually wants to choose.
 *
 * Edits are local until Done, so backing out leaves the screen's allocation
 * alone — the biller can open it, look, and dismiss without changing the bill.
 *
 * Tapping a name hands them whatever is still unassigned rather than ₹0, so one
 * tap is a complete answer for the common case (one person, whole tip) and no
 * one has to type a number to make their selection mean anything.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { StaffAvatar } from './StaffAvatar';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

export type Staff = { id: string; name: string; role: string; photoUrl?: string | null };
export type Allocation = { staffMemberId: string; amount: number };

interface Props {
  visible: boolean;
  /** The tip being divided. The sheet never changes it, only who it goes to. */
  tip: number;
  staff: Staff[];
  value: Allocation[];
  onClose: () => void;
  onDone: (allocations: Allocation[]) => void;
}

const money = (v: string) => v.replace(/[^0-9.]/g, '');
const round2 = (n: number) => Number(n.toFixed(2));

/** Even split with the remainder on the first person, so ₹100 across three is
 *  34/33/33 and the parts still sum to the tip. Mirrors the server's rule. */
export function evenSplit(ids: string[], total: number): Record<string, string> {
  if (ids.length === 0) return {};
  const each = Math.floor((total / ids.length) * 100) / 100;
  const out: Record<string, string> = {};
  ids.forEach((id) => { out[id] = String(each); });
  const rem = round2(total - each * ids.length);
  if (rem > 0 && ids[0]) out[ids[0]] = String(round2(each + rem));
  return out;
}

export function AssignTipSheet({ visible, tip, staff, value, onClose, onDone }: Props) {
  const [shares, setShares] = useState<Record<string, string>>({});

  // Reload from the caller each time it opens, so a dismissed edit is really
  // discarded rather than lingering until the screen unmounts.
  useEffect(() => {
    if (!visible) return;
    setShares(Object.fromEntries(value.map((a) => [a.staffMemberId, String(a.amount)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const selected = useMemo(() => Object.keys(shares), [shares]);
  const assigned = useMemo(
    () => round2(selected.reduce((s, id) => s + (Number(shares[id]) || 0), 0)),
    [selected, shares],
  );
  const remainder = round2(tip - assigned);

  const toggle = (id: string) => {
    setShares((prev) => {
      if (id in prev) {
        const { [id]: _drop, ...rest } = prev;
        return rest;
      }
      // Give them what is still going spare. Zero would make the tap look like
      // it did nothing until a number is typed.
      const spare = round2(tip - round2(Object.keys(prev).reduce((s, k) => s + (Number(prev[k]) || 0), 0)));
      return { ...prev, [id]: String(Math.max(0, spare)) };
    });
  };

  const splitEvenly = () => {
    const ids = selected.length > 0 ? selected : staff.map((m) => m.id);
    setShares(evenSplit(ids, tip));
  };

  const done = () => {
    onDone(
      selected
        .map((id) => ({ staffMemberId: id, amount: Number(shares[id]) || 0 }))
        .filter((a) => a.amount > 0),
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={s.body}>
        <View style={s.head}>
          <Text style={s.title}>Who gets the ₹{tip.toFixed(0)}?</Text>
          <TouchableOpacity onPress={splitEvenly} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.7}>
            <Text style={s.action}>Split evenly</Text>
          </TouchableOpacity>
        </View>

        <View style={s.group}>
          {staff.map((m, i) => {
            const on = m.id in shares;
            return (
              <React.Fragment key={m.id}>
                {i > 0 && <View style={s.divider} />}
                <TouchableOpacity
                  style={[s.row, on && s.rowOn]}
                  onPress={() => toggle(m.id)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <StaffAvatar id={m.id} name={m.name} photoUrl={m.photoUrl} />
                  <View style={s.who}>
                    <Text style={[s.name, on && s.nameOn]} numberOfLines={1}>{m.name}</Text>
                    <Text style={s.role}>{m.role}</Text>
                  </View>
                  {on ? (
                    <View style={s.shareWrap}>
                      <Text style={s.rupee}>₹</Text>
                      <TextInput
                        style={s.shareInput}
                        value={shares[m.id] ?? ''}
                        onChangeText={(v) => setShares((sh) => ({ ...sh, [m.id]: money(v) }))}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        selectTextOnFocus
                      />
                    </View>
                  ) : (
                    <Ionicons name="add" size={19} color={QuinckleColors.textTertiary} />
                  )}
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </View>

        {selected.length > 0 && (
          <View style={s.tally}>
            <Ionicons
              name={remainder === 0 ? 'checkmark-circle' : remainder < 0 ? 'alert-circle' : 'ellipse-outline'}
              size={15}
              color={
                remainder === 0 ? QuinckleColors.success
                  : remainder < 0 ? QuinckleColors.danger
                    : QuinckleColors.textTertiary
              }
            />
            <Text
              style={[
                s.tallyText,
                remainder === 0 && { color: QuinckleColors.success },
                remainder < 0 && { color: QuinckleColors.danger },
              ]}
            >
              {remainder === 0
                ? `₹${tip.toFixed(0)} of ₹${tip.toFixed(0)} assigned`
                : remainder < 0
                  ? `₹${Math.abs(remainder).toFixed(0)} over the tip`
                  : `₹${remainder.toFixed(0)} still unassigned`}
            </Text>
          </View>
        )}
      </View>

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.done, remainder < 0 && s.doneOff]}
          onPress={done}
          disabled={remainder < 0}
          activeOpacity={0.85}
        >
          <Text style={s.doneText}>Done</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.clear} onPress={() => onDone([])} activeOpacity={0.7}>
          <Text style={s.clearText}>Leave unassigned</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl },
  head: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', marginBottom: Spacing.lg,
  },
  title: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  action: { fontSize: 12, fontWeight: '600', color: QuinckleColors.primary },

  group: {
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  // Inset to where the text starts, so the rule never cuts across a face.
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: QuinckleColors.border,
    marginLeft: Spacing.lg + 40 + Spacing.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    minHeight: 64, paddingHorizontal: Spacing.lg,
  },
  rowOn: { backgroundColor: QuinckleColors.primarySoft },
  who: { flex: 1 },
  name: { fontSize: 14, fontWeight: '600', color: QuinckleColors.textPrimary },
  nameOn: { color: QuinckleColors.primary },
  role: { ...Typography.micro, color: QuinckleColors.textTertiary, marginTop: 2 },

  shareWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 36, minWidth: 84, paddingHorizontal: 10,
    backgroundColor: QuinckleColors.background,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: QuinckleColors.borderStrong,
  },
  rupee: { fontSize: 14, color: QuinckleColors.textSecondary },
  shareInput: {
    flex: 1, height: '100%', padding: 0, fontSize: 14,
    color: QuinckleColors.textPrimary,
  },

  tally: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  tallyText: { fontSize: 12, color: QuinckleColors.textSecondary },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: QuinckleColors.border,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    marginTop: Spacing.xl,
  },
  done: {
    height: 52, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.primary,
  },
  doneOff: { opacity: 0.4 },
  doneText: { ...Typography.bodyStrong, color: '#fff' },
  clear: { height: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { ...Typography.caption, color: QuinckleColors.textSecondary },
});
