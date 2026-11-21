/**
 * Send e-bill on WhatsApp — from a settled bill (Order detail).
 *
 * Shows how many e-bills are left (free this month + the venue's top-up
 * balance), lets the crew fix the guest's number, and sends. Nothing is ever
 * sent without this tap. Top-ups are bought by the owner on the dashboard.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { BottomSheet } from './BottomSheet';
import { crewEbill, type EbillState } from '../../services/api';

const STATUS: Record<string, { label: string; color: string }> = {
  SENDING: { label: 'Sending', color: QuinckleColors.textSecondary },
  SENT: { label: 'Sent', color: QuinckleColors.textSecondary },
  DELIVERED: { label: 'Delivered', color: QuinckleColors.success },
  READ: { label: 'Read', color: QuinckleColors.success },
  FAILED: { label: 'Failed · credit returned', color: QuinckleColors.danger },
};

function localDigits(phone: string | null): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d.slice(-10);
}

function monthName(monthKey: string): string {
  const m = Number(monthKey.split('-')[1] ?? 1);
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] ?? '';
}

export interface SendEbillSheetProps {
  visible: boolean;
  sessionId: string;
  onClose: () => void;
}

export function SendEbillSheet({ visible, sessionId, onClose }: SendEbillSheetProps) {
  const [state, setState] = useState<EbillState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await crewEbill.state(sessionId);
      setState(s);
      setPhone((p) => p || localDigits(s.phone));
      setLoadError(null);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load this bill");
    }
  }, [sessionId]);

  useEffect(() => {
    if (!visible) return;
    setDone(false);
    setError(null);
    void load();
  }, [visible, load]);

  const valid = /^[6-9]\d{9}$/.test(phone);
  const c = state?.credits;
  const noCredits = c ? c.totalRemaining <= 0 : false;
  const blocked = !state || !c || !c.enabled || !c.configured || !state.settled || state.sendsLeft <= 0 || noCredits;

  const send = async () => {
    if (!state || !valid || sending || blocked) return;
    setSending(true);
    setError(null);
    try {
      await crewEbill.send(sessionId, phone, state.alreadySent);
      setDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't send. Try again.");
    } finally {
      setSending(false);
      void load();
    }
  };

  const buttonLabel = !state
    ? 'Send e-bill'
    : noCredits
      ? 'No e-bills left · ask the owner to top up'
      : state.sendsLeft <= 0
        ? 'Sent the maximum times'
        : state.alreadySent
          ? 'Resend · uses 1 more e-bill'
          : 'Send e-bill';

  return (
    <BottomSheet visible={visible} onClose={() => { if (!sending) onClose(); }} title="Send e-bill on WhatsApp" maxHeightRatio={0.85}>
      {!state && !loadError && <ActivityIndicator style={{ marginVertical: Spacing.xl }} color={QuinckleColors.primary} />}
      {loadError && <Text style={styles.err}>{loadError}</Text>}

      {state && c && (
        <View style={styles.body}>
          <View style={styles.row}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Free in {monthName(c.monthKey)}</Text>
              <Text style={styles.statValue}>
                {c.freeRemaining}
                <Text style={styles.statSub}> / {c.freeAllowed ? c.monthlyFreeQuota : 0} left</Text>
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Top-up balance</Text>
              <Text style={styles.statValue}>{c.topupBalance}</Text>
            </View>
          </View>

          {!c.enabled && <Text style={styles.warn}>WhatsApp e-bills aren&apos;t switched on for this restaurant yet.</Text>}
          {c.enabled && !c.configured && <Text style={styles.warn}>WhatsApp sending is being set up. Try again later.</Text>}
          {!state.settled && <Text style={styles.warn}>Settle the bill first, then send it.</Text>}

          <Text style={styles.label}>Guest&apos;s WhatsApp number</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.prefix}>+91</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile"
              placeholderTextColor={QuinckleColors.textMuted}
              keyboardType="number-pad"
              maxLength={10}
            />
          </View>
          {phone.length > 0 && !valid && <Text style={styles.err}>Enter a 10-digit mobile number</Text>}

          <Text style={styles.hint}>
            Bill {state.invoiceNo} · ₹{state.total.toFixed(2)}. Send only if the guest asked for it.
          </Text>

          {state.messages.length > 0 && (
            <View style={styles.list}>
              {state.messages.map((m) => {
                const st = STATUS[m.status] ?? STATUS.SENT;
                return (
                  <View key={m.id} style={styles.listRow}>
                    <Text style={styles.listText} numberOfLines={1}>
                      {m.phone} · {new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                    <Text style={[styles.listText, { color: st.color }]}>{st.label}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {done && (
            <View style={styles.doneRow}>
              <Ionicons name="checkmark-circle" size={16} color={QuinckleColors.success} />
              <Text style={styles.doneText}>Sent. Status updates above.</Text>
            </View>
          )}
          {error && <Text style={styles.err}>{error}</Text>}

          <TouchableOpacity
            style={[styles.btn, (blocked || !valid || sending) && styles.btnDisabled]}
            onPress={() => { void send(); }}
            disabled={blocked || !valid || sending}
            activeOpacity={0.85}
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="logo-whatsapp" size={18} color="#fff" />}
            <Text style={styles.btnText}>{buttonLabel}</Text>
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: Spacing.lg, gap: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.sm },
  stat: {
    flex: 1, padding: Spacing.md, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.border,
  },
  statLabel: { color: QuinckleColors.textSecondary, fontSize: 11.5 },
  statValue: { color: QuinckleColors.textPrimary, fontSize: 20, fontWeight: '800', marginTop: 2 },
  statSub: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600' },
  warn: { color: QuinckleColors.warning, fontSize: 13 },
  label: { color: QuinckleColors.textSecondary, fontSize: 12.5, fontWeight: '600', marginTop: Spacing.sm },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.borderStrong, backgroundColor: QuinckleColors.surfaceElevated,
  },
  prefix: { color: QuinckleColors.textSecondary, fontSize: 15, paddingLeft: Spacing.md, paddingRight: 6 },
  input: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 16, paddingVertical: 12, paddingRight: Spacing.md },
  hint: { color: QuinckleColors.textMuted, fontSize: 12 },
  list: { borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border },
  listRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: QuinckleColors.borderSubtle,
  },
  listText: { color: QuinckleColors.textSecondary, fontSize: 12 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { color: QuinckleColors.success, fontSize: 13, fontWeight: '600' },
  err: { color: QuinckleColors.danger, fontSize: 12.5 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    height: 52, borderRadius: Radius.md, marginTop: Spacing.sm, backgroundColor: '#16A34A',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
