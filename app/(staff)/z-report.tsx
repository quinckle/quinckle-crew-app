import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { crewShift, type ZReport } from '../../services/api';
import { printZReport, getStatus as getPrinterStatus } from '../../services/printer';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function ZReportScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [z, setZ] = useState<ZReport | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    crewShift.zreport()
      .then((res) => setZ(res.data))
      .catch(() => setToast('Could not load the report'))
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const doPrint = async () => {
    if (!z) return;
    if (getPrinterStatus() !== 'connected') { flash('No printer connected'); return; }
    setPrinting(true);
    const r = await printZReport(z);
    setPrinting(false);
    flash(r === 'printed' ? 'Sent to printer' : 'Print failed');
  };

  const doEmail = async () => {
    setEmailing(true);
    try {
      const res = await crewShift.emailZreport();
      flash(res.data.sent ? 'Emailed to owner' : res.data.reason === 'no_recipient' ? 'No owner email on file' : 'Email not configured');
    } catch { flash('Could not send email'); }
    finally { setEmailing(false); }
  };

  const d = z?.drawer;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Day-end Report</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={QuinckleColors.primary} /></View>
      ) : !z ? (
        <View style={styles.center}><Text style={styles.metaText}>No data</Text></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 120 }}>
          <Text style={styles.dateText}>{z.date} · {z.restaurantName}</Text>

          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Total collected</Text>
            <Text style={styles.heroValue}>{inr(z.collected.total)}</Text>
          </View>

          <Section title="Collected by method">
            <Row label={`Cash (${z.collected.cashCount})`} value={inr(z.collected.cash)} />
            <Row label={`UPI direct (${z.collected.upiCount})`} value={inr(z.collected.upiDirect)} />
            <Row label={`Card / online (${z.collected.gatewayCount})`} value={inr(z.collected.gateway)} />
          </Section>

          <Section title="Sales">
            <Row label="Orders" value={String(z.sales.orders)} />
            <Row label="Tables / sessions" value={String(z.sales.sessions)} />
            <Row label="Gross sales" value={inr(z.sales.grossSales)} />
            <Row label="Discounts given" value={`−${inr(z.sales.discounts)}`} tone="success" />
            <Row label="GST collected" value={inr(z.sales.gstCollected)} />
            <View style={styles.divider} />
            <Row label="Net billed" value={inr(z.sales.netSales)} strong />
          </Section>

          {(z.adjustments.voidCount > 0 || z.adjustments.compCount > 0) && (
            <Section title="Voids & comps">
              <Row label={`Voided (${z.adjustments.voidCount})`} value={inr(z.adjustments.voidAmount)} tone="danger" />
              <Row label={`Comped (${z.adjustments.compCount})`} value={inr(z.adjustments.compAmount)} tone="warning" />
            </Section>
          )}

          <Section title="Cash drawer">
            {d?.state === 'CLOSED' ? (
              <>
                <Row label="Opening float" value={inr(d.openingFloat)} />
                <Row label="Cash sales" value={inr(d.cashSales)} />
                <Row label="Expected" value={inr(d.expected)} />
                <Row label="Counted" value={inr(d.counted)} />
                <View style={styles.divider} />
                <Row label="Variance"
                  value={`${d.variance < 0 ? '−' : d.variance > 0 ? '+' : ''}${inr(Math.abs(d.variance))}`}
                  strong tone={d.variance < 0 ? 'danger' : d.variance > 0 ? 'warning' : 'success'} />
                <Text style={styles.hint}>{d.variance === 0 ? 'Balanced.' : d.variance < 0 ? 'Drawer was short.' : 'Drawer was over.'}</Text>
              </>
            ) : d?.state === 'OPEN' ? (
              <Text style={styles.hint}>Drawer is still open — close it to reconcile cash.</Text>
            ) : (
              <Text style={styles.hint}>No cash drawer was opened today.</Text>
            )}
          </Section>
        </ScrollView>
      )}

      {/* Action bar */}
      {z && !loading && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={doPrint} disabled={printing} activeOpacity={0.85}>
            {printing ? <ActivityIndicator color={QuinckleColors.textPrimary} /> : <><Ionicons name="print-outline" size={18} color={QuinckleColors.textPrimary} /><Text style={styles.secondaryBtnText}>Print</Text></>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} onPress={doEmail} disabled={emailing} activeOpacity={0.85}>
            {emailing ? <ActivityIndicator color="#fff" /> : <><Ionicons name="mail-outline" size={18} color="#fff" /><Text style={styles.primaryBtnText}>Email owner</Text></>}
          </TouchableOpacity>
        </View>
      )}

      {toast && <View style={[styles.toast, { bottom: insets.bottom + 90 }]}><Text style={styles.toastText}>{toast}</Text></View>}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
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
  dateText: { color: QuinckleColors.textSecondary, fontSize: 13, marginBottom: Spacing.md },
  hero: { backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, padding: Spacing.xl, alignItems: 'center', marginBottom: Spacing.lg },
  heroLabel: { color: QuinckleColors.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroValue: { color: QuinckleColors.textPrimary, fontSize: 34, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, padding: Spacing.lg, marginBottom: Spacing.md },
  cardTitle: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { color: QuinckleColors.textSecondary, fontSize: 13.5 },
  rowValue: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowValueStrong: { fontSize: 17, fontWeight: '800' },
  divider: { height: 1, backgroundColor: QuinckleColors.border, marginVertical: Spacing.sm },
  hint: { color: QuinckleColors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  metaText: { color: QuinckleColors.textMuted, fontSize: 13 },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, backgroundColor: QuinckleColors.background, borderTopWidth: 1, borderTopColor: QuinckleColors.border },
  primaryBtn: { flex: 1, flexDirection: 'row', gap: 6, backgroundColor: QuinckleColors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { flex: 1, flexDirection: 'row', gap: 6, backgroundColor: QuinckleColors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, paddingVertical: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: 999, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  toastText: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '600' },
});
