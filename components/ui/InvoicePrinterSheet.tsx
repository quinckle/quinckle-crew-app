/**
 * InvoicePrinterSheet — where should this bill print?
 *
 * Shown only when a venue has two or more invoice printers (role Invoice or
 * Both). One printer never sees it, so Print Invoice stays a single tap there.
 *
 * Three ways to answer, in order of how often they're wanted:
 *   - tap a printer   → print there. One tap; the phone remembers the choice
 *                       and marks it next time, so a steward at the bar taps once.
 *   - All             → one copy on every connected invoice printer. Copies of
 *                       ONE invoice (same number), never several invoices.
 *   - Choose several  → tick any subset, then print.
 *
 * A printer no device is driving is listed but disabled with the reason, so the
 * crew understands why it can't be picked instead of wondering where it went.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import type { InvoicePrinterOption } from '../../services/billPrint';

interface Props {
  visible: boolean;
  printers: InvoicePrinterOption[];
  /** This phone's last choice — marked so a repeat is one tap. */
  lastChoice: string[];
  onPick: (ids: string[]) => void;
  onClose: () => void;
}

function whereLabel(p: InvoicePrinterOption): string {
  const where = !p.connected ? 'Not connected to any device' : p.here ? 'This device' : 'Another device';
  const parts = [where];
  if (p.isDefault) parts.push('Default');
  // The hardware name tells two renamed printers apart at a glance.
  if (p.systemName) parts.push(p.systemName);
  return parts.join(' · ');
}

export function InvoicePrinterSheet({ visible, printers, lastChoice, onPick, onClose }: Props) {
  const [several, setSeveral] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const connected = useMemo(() => printers.filter((p) => p.connected), [printers]);

  // Every time it opens: back to the simple list, with the last choice ticked
  // ready in case they go to "Choose several".
  useEffect(() => {
    if (!visible) return;
    setSeveral(false);
    setTicked(new Set(lastChoice.filter((id) => connected.some((p) => p.id === id))));
  }, [visible, lastChoice, connected]);

  const lastWasOne = lastChoice.length === 1 ? lastChoice[0] : null;
  const lastWasAll =
    lastChoice.length > 1 &&
    connected.length === lastChoice.length &&
    connected.every((p) => lastChoice.includes(p.id));

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <BottomSheet visible={visible} onClose={onClose} title={several ? 'Choose printers' : 'Print invoice on'}>
      {!several ? (
        <View style={styles.list}>
          {printers.map((p) => {
            const last = lastWasOne === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.row, last && styles.rowSelected, !p.connected && styles.rowDisabled]}
                onPress={() => onPick([p.id])}
                disabled={!p.connected}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Print on ${p.name}`}
              >
                <View style={[styles.iconWrap, last && styles.iconWrapSelected]}>
                  <Ionicons
                    name={p.here ? 'phone-portrait-outline' : 'receipt-outline'}
                    size={20}
                    color={last ? QuinckleColors.primary : QuinckleColors.textSecondary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rowSub}>{whereLabel(p)}</Text>
                </View>
                {last && <Text style={styles.lastTag}>Last used</Text>}
              </TouchableOpacity>
            );
          })}

          {connected.length >= 2 && (
            <TouchableOpacity
              style={[styles.row, lastWasAll && styles.rowSelected]}
              onPress={() => onPick(connected.map((p) => p.id))}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Print on all invoice printers"
            >
              <View style={[styles.iconWrap, lastWasAll && styles.iconWrapSelected]}>
                <Ionicons
                  name="copy-outline"
                  size={20}
                  color={lastWasAll ? QuinckleColors.primary : QuinckleColors.textSecondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>All invoice printers</Text>
                <Text style={styles.rowSub}>
                  One copy on each of {connected.length} — same invoice number
                </Text>
              </View>
              {lastWasAll && <Text style={styles.lastTag}>Last used</Text>}
            </TouchableOpacity>
          )}

          {connected.length >= 2 && (
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => setSeveral(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Ionicons name="options-outline" size={16} color={QuinckleColors.textPrimary} />
              <Text style={styles.linkText}>Choose several…</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.list}>
          {printers.map((p) => {
            const on = ticked.has(p.id);
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.row, on && styles.rowSelected, !p.connected && styles.rowDisabled]}
                onPress={() => toggle(p.id)}
                disabled={!p.connected}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !p.connected }}
                accessibilityLabel={p.name}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={on ? QuinckleColors.primary : QuinckleColors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rowSub}>{whereLabel(p)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[styles.cta, ticked.size === 0 && styles.ctaDisabled]}
            onPress={() => onPick(printers.filter((p) => ticked.has(p.id)).map((p) => p.id))}
            disabled={ticked.size === 0}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>
              {ticked.size === 0
                ? 'Pick at least one'
                : `Print on ${ticked.size} printer${ticked.size === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkRow} onPress={() => setSeveral(false)} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={16} color={QuinckleColors.textPrimary} />
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  rowSelected: { borderColor: QuinckleColors.primary },
  rowDisabled: { opacity: 0.45 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  iconWrapSelected: { backgroundColor: `${QuinckleColors.primary}1A` },
  rowTitle: { ...Typography.body, color: QuinckleColors.textPrimary, fontWeight: '600' },
  rowSub: { ...Typography.caption, color: QuinckleColors.textMuted, marginTop: 2 },
  lastTag: { ...Typography.caption, color: QuinckleColors.primary, fontWeight: '600' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
  },
  linkText: { ...Typography.body, color: QuinckleColors.textPrimary, fontWeight: '600' },
  cta: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    alignItems: 'center',
    backgroundColor: QuinckleColors.primary,
  },
  ctaDisabled: { backgroundColor: QuinckleColors.surfaceMuted },
  ctaText: { ...Typography.body, color: '#fff', fontWeight: '700' },
});
