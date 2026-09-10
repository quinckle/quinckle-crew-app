import React, { useCallback, useState } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { crewShift, type OpenShift, type ShiftCloseResult } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

const inr = (n: number | string) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return '--'; } };

export default function CashDrawer() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OpenShift | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Open form
  const [floatAmt, setFloatAmt] = useState('');
  // Movement modal
  const [moveType, setMoveType] = useState<'PAY_IN' | 'PAY_OUT' | null>(null);
  const [moveAmt, setMoveAmt] = useState('');
  const [moveReason, setMoveReason] = useState('');
  // Close modal
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [result, setResult] = useState<ShiftCloseResult | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    crewShift.current()
      .then((res) => setData(res?.data ?? null))
      .catch(() => setErr('Could not load the drawer'))
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doOpen = async () => {
    const f = parseFloat(floatAmt);
    if (!isFinite(f) || f < 0) { setErr('Enter a valid opening float'); return; }
    setBusy(true); setErr(null);
    try { await crewShift.open(f); setFloatAmt(''); load(); }
    catch { setErr('Could not open the drawer'); }
    finally { setBusy(false); }
  };

  const doMovement = async () => {
    const a = parseFloat(moveAmt);
    if (!isFinite(a) || a <= 0) { setErr('Enter a valid amount'); return; }
    if (!moveReason.trim()) { setErr('Add a short reason'); return; }
    setBusy(true); setErr(null);
    try { await crewShift.movement(moveType!, a, moveReason.trim()); setMoveType(null); setMoveAmt(''); setMoveReason(''); load(); }
    catch { setErr('Could not record the entry'); }
    finally { setBusy(false); }
  };

  const doClose = async () => {
    const c = parseFloat(counted);
    if (!isFinite(c) || c < 0) { setErr('Enter the counted cash'); return; }
    setBusy(true); setErr(null);
    try { const res = await crewShift.close(c); setResult(res.data); setCloseOpen(false); setCounted(''); }
    catch { setErr('Could not close the drawer'); }
    finally { setBusy(false); }
  };

  const agg = data?.aggregates;
  const expected = agg?.expectedCash ?? 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cash Drawer</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={QuinckleColors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}>
          {err && <Text style={styles.errText}>{err}</Text>}

          {/* ── Closed result banner ── */}
          {result && (
            <View style={[styles.card, { borderColor: QuinckleColors.successBorder, backgroundColor: QuinckleColors.successSoft, marginBottom: Spacing.lg }]}>
              <Text style={styles.cardTitle}>Drawer closed</Text>
              {(result.cashWithRiders ?? 0) > 0 && (
                <Row label="Less: cash with riders" value={`−${inr(result.cashWithRiders ?? 0)}`} tone="warning" />
              )}
              {(result.selfSettledCash ?? 0) > 0 && (
                <Row label="Of which self-settled" value={inr(result.selfSettledCash ?? 0)} tone="warning" />
              )}
              <Row label="Expected in drawer" value={inr(result.expectedCash)} />
              <Row label="Counted" value={inr(result.countedCash)} />
              <View style={styles.divider} />
              <Row label="Variance" value={`${result.variance < 0 ? '−' : result.variance > 0 ? '+' : ''}${inr(Math.abs(result.variance))}`}
                strong tone={result.variance < 0 ? 'danger' : result.variance > 0 ? 'warning' : 'success'} />
              <Text style={styles.hint}>{result.variance === 0 ? 'Perfectly balanced.' : result.variance < 0 ? 'Drawer is short.' : 'Drawer is over.'}</Text>
              <TouchableOpacity style={styles.zLink} onPress={() => router.push('/(staff)/z-report')} activeOpacity={0.7}>
                <Ionicons name="today-outline" size={16} color={QuinckleColors.primary} />
                <Text style={styles.zLinkText}>View day-end report</Text>
              </TouchableOpacity>
            </View>
          )}

          {!data ? (
            /* ── No open shift → open form ── */
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Open the drawer</Text>
              <Text style={styles.hint}>Count the starting cash (float) and open the drawer to begin the shift.</Text>
              <Text style={styles.label}>Opening float (₹)</Text>
              <TextInput style={styles.input} value={floatAmt} onChangeText={setFloatAmt} placeholder="e.g. 2000"
                placeholderTextColor={QuinckleColors.textMuted} keyboardType="decimal-pad" />
              <TouchableOpacity style={styles.primaryBtn} onPress={doOpen} disabled={busy} activeOpacity={0.85}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Open drawer</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            /* ── Open shift dashboard ── */
            <>
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={styles.openPill}><View style={styles.openDot} /><Text style={styles.openPillText}>OPEN</Text></View>
                  <Text style={styles.metaText}>Opened {fmtTime(data.shift.openedAt)} · {data.shift.openedBy?.name ?? 'Staff'}</Text>
                </View>
                <Text style={styles.expectedLabel}>Expected in drawer now</Text>
                <Text style={styles.expectedValue}>{inr(expected)}</Text>
                <View style={styles.divider} />
                <Row label="Opening float" value={inr(data.shift.openingFloat)} />
                <Row label="Cash sales" value={inr(agg?.cashSales ?? 0)} />
                <Row label="Cash in (pay-ins)" value={`+${inr(agg?.payIns ?? 0)}`} tone={(agg?.payIns ?? 0) > 0 ? 'success' : undefined} />
                <Row label="Cash out (pay-outs)" value={`−${inr(agg?.payOuts ?? 0)}`} tone={(agg?.payOuts ?? 0) > 0 ? 'danger' : undefined} />
                {/* Money that is earned but not in the till. Shown live so the
                    counter knows what is still out before counting. */}
                {(agg?.cashWithRiders ?? 0) > 0 && (
                  <Row label="With riders (not in drawer)" value={`−${inr(agg?.cashWithRiders ?? 0)}`} tone="warning" />
                )}
                {(agg?.riderSettlementsIn ?? 0) > 0 && (
                  <Row label="Riders settled in" value={`+${inr(agg?.riderSettlementsIn ?? 0)}`} tone="success" />
                )}
                {/* No sign and no arithmetic: this cash is already inside the
                    line above. It is called out because it is the only float
                    one person both carried and received — an owner closing
                    their own (V2 §3). Hidden at zero, which is most venues. */}
                {(agg?.selfSettledCash ?? 0) > 0 && (
                  <Row label="Of which self-settled" value={inr(agg?.selfSettledCash ?? 0)} tone="warning" />
                )}
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setMoveType('PAY_IN'); setErr(null); }} activeOpacity={0.85}>
                  <Ionicons name="add-circle-outline" size={18} color={QuinckleColors.success} />
                  <Text style={styles.secondaryBtnText}>Cash in</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setMoveType('PAY_OUT'); setErr(null); }} activeOpacity={0.85}>
                  <Ionicons name="remove-circle-outline" size={18} color={QuinckleColors.danger} />
                  <Text style={styles.secondaryBtnText}>Cash out</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[styles.primaryBtn, { marginTop: Spacing.md }]} onPress={() => { setCloseOpen(true); setResult(null); setErr(null); }} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Close drawer</Text>
              </TouchableOpacity>

              {/* Movements list */}
              {data.shift.movements.length > 0 && (
                <View style={[styles.card, { marginTop: Spacing.lg }]}>
                  <Text style={styles.cardTitle}>Cash in / out</Text>
                  {data.shift.movements.map((m) => (
                    <View key={m.id} style={styles.moveRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.moveReason}>{m.reason}</Text>
                        <Text style={styles.metaText}>{fmtTime(m.createdAt)} · {m.staff?.name ?? ''}</Text>
                      </View>
                      <Text style={[styles.moveAmt, { color: m.type === 'PAY_IN' ? QuinckleColors.success : QuinckleColors.danger }]}>
                        {m.type === 'PAY_IN' ? '+' : '−'}{inr(m.amount)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Movement modal ── */}
      <Modal visible={!!moveType} transparent animationType="fade" onRequestClose={() => setMoveType(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>{moveType === 'PAY_IN' ? 'Cash in' : 'Cash out'}</Text>
            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput style={styles.input} value={moveAmt} onChangeText={setMoveAmt} keyboardType="decimal-pad" placeholder="0"
              placeholderTextColor={QuinckleColors.textMuted} autoFocus />
            <Text style={styles.label}>Reason</Text>
            <TextInput style={styles.input} value={moveReason} onChangeText={setMoveReason}
              placeholder={moveType === 'PAY_IN' ? 'e.g. Added change' : 'e.g. Paid vegetable vendor'}
              placeholderTextColor={QuinckleColors.textMuted} maxLength={120} />
            {err && <Text style={styles.errText}>{err}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.ghostBtn} onPress={() => { setMoveType(null); setMoveAmt(''); setMoveReason(''); setErr(null); }}><Text style={styles.ghostBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={doMovement} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}</TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Close modal ── */}
      <Modal visible={closeOpen} transparent animationType="fade" onRequestClose={() => setCloseOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Close drawer</Text>
            <Text style={styles.hint}>Count the cash physically in the drawer and enter the total. We’ll compare it to what’s expected.</Text>
            <Row label="Expected" value={inr(expected)} />
            <Text style={styles.label}>Counted cash (₹)</Text>
            <TextInput style={styles.input} value={counted} onChangeText={setCounted} keyboardType="decimal-pad" placeholder="0"
              placeholderTextColor={QuinckleColors.textMuted} autoFocus />
            {counted !== '' && isFinite(parseFloat(counted)) && (
              <Text style={[styles.varPreview, { color: parseFloat(counted) - expected < 0 ? QuinckleColors.danger : parseFloat(counted) - expected > 0 ? QuinckleColors.warning : QuinckleColors.success }]}>
                Variance: {parseFloat(counted) - expected < 0 ? '−' : parseFloat(counted) - expected > 0 ? '+' : ''}{inr(Math.abs(parseFloat(counted) - expected))}
              </Text>
            )}
            {err && <Text style={styles.errText}>{err}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.ghostBtn} onPress={() => { setCloseOpen(false); setCounted(''); setErr(null); }}><Text style={styles.ghostBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={doClose} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Close & count</Text>}</TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'success' | 'danger' | 'warning' }) {
  const color = tone === 'success' ? QuinckleColors.success : tone === 'danger' ? QuinckleColors.danger : tone === 'warning' ? QuinckleColors.warning : QuinckleColors.textPrimary;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: QuinckleColors.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: QuinckleColors.textPrimary, fontSize: 17, fontWeight: '700' },
  card: { backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, padding: Spacing.lg },
  cardTitle: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: Spacing.sm },
  hint: { color: QuinckleColors.textSecondary, fontSize: 12.5, lineHeight: 18, marginBottom: Spacing.md },
  label: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: Spacing.sm, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: QuinckleColors.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, color: QuinckleColors.textPrimary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: 16 },
  primaryBtn: { backgroundColor: QuinckleColors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md, minWidth: 120, flex: 1 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: QuinckleColors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, paddingVertical: Spacing.md },
  secondaryBtnText: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  ghostBtn: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { color: QuinckleColors.textSecondary, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  rowLabel: { color: QuinckleColors.textSecondary, fontSize: 13.5 },
  rowValue: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowValueStrong: { fontSize: 18, fontWeight: '800' },
  divider: { height: 1, backgroundColor: QuinckleColors.border, marginVertical: Spacing.sm },
  expectedLabel: { color: QuinckleColors.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: Spacing.sm },
  expectedValue: { color: QuinckleColors.textPrimary, fontSize: 30, fontWeight: '900', marginTop: 2, fontVariant: ['tabular-nums'] },
  openPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: QuinckleColors.successSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: QuinckleColors.success },
  openPillText: { color: QuinckleColors.success, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  metaText: { color: QuinckleColors.textMuted, fontSize: 12 },
  moveRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: QuinckleColors.borderSubtle },
  moveReason: { color: QuinckleColors.textPrimary, fontSize: 13.5 },
  moveAmt: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  errText: { color: QuinckleColors.danger, fontSize: 13, marginBottom: Spacing.sm },
  varPreview: { fontSize: 14, fontWeight: '700', marginTop: Spacing.sm },
  zLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  zLinkText: { color: QuinckleColors.primary, fontSize: 14, fontWeight: '600' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.lg },
  modalCard: { backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, padding: Spacing.lg },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, alignItems: 'center' },
});
