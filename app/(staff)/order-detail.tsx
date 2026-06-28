import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { crewSessions, restaurantApi, type LedgerSession, type LedgerOrder } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { printBill, getStatus as getPrinterStatus } from '../../services/printer';
import type { InvoiceBill, InvoiceItem } from '../../services/invoiceTemplate';
import { useAuth } from '../../context/AuthContext';
import { ThemedDialog } from '../../components/ui/themed-dialog';

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtMoney(n: number): string {
  return `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN')}`;
}
function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash', UPI_DIRECT: 'UPI Direct', PAYMENT_GATEWAY: 'Gateway',
};
const STATUS_META: Record<string, { label: string; color: string }> = {
  PAID:         { label: 'Paid',         color: QuinckleColors.success },
  OPEN:         { label: 'Open',         color: QuinckleColors.warning },
  CASH_PENDING: { label: 'Cash Pending', color: QuinckleColors.warning },
  CLOSED:       { label: 'Closed',       color: QuinckleColors.textTertiary },
};

function statusMeta(s: LedgerSession) {
  const v = (s.statusView ?? s.status ?? 'CLOSED') as string;
  return STATUS_META[v] ?? { label: v, color: QuinckleColors.textTertiary };
}

function prettyPaymentStatus(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/^PAID_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Total row ─────────────────────────────────────────────────────────────────
function TotalRow({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, strong && styles.totalLabelStrong]}>{label}</Text>
      <Text style={[styles.totalValue, strong && styles.totalValueStrong, accent && { color: QuinckleColors.primary }]}>{value}</Text>
    </View>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────
function OrderCard({ order }: { order: LedgerOrder }) {
  const methods = order.paymentSummary?.methods ?? [];
  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <Text style={styles.orderRef}>#{order.shortId}</Text>
        <Text style={styles.orderTime}>{fmtTime(order.createdAt)}</Text>
      </View>

      {(order.items ?? []).map((it) => (
        <View key={it.id} style={styles.itemRow}>
          <View style={styles.itemLeft}>
            {it.isVeg != null && (
              <View style={[styles.vegDot, { borderColor: it.isVeg ? QuinckleColors.success : QuinckleColors.danger }]}>
                <View style={[styles.vegInner, { backgroundColor: it.isVeg ? QuinckleColors.success : QuinckleColors.danger }]} />
              </View>
            )}
            <Text style={styles.itemQty}>{it.qty}×</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName} numberOfLines={2}>{it.name}</Text>
              {!!it.modifiersSummary && <Text style={styles.itemNote} numberOfLines={2}>{it.modifiersSummary}</Text>}
              {!!it.notes && <Text style={styles.itemNote} numberOfLines={2}>{it.notes}</Text>}
            </View>
          </View>
          <Text style={styles.itemTotal}>{fmtMoney(it.total)}</Text>
        </View>
      ))}

      <View style={styles.orderFooter}>
        <View style={styles.methodWrap}>
          {methods.map((m) => (
            <View key={m} style={styles.methodChip}>
              <Text style={styles.methodChipText}>{METHOD_LABEL[m] ?? m}</Text>
            </View>
          ))}
          {!!order.paymentStatus && (
            <Text style={styles.payStatusText}>{prettyPaymentStatus(order.paymentStatus)}</Text>
          )}
        </View>
        <Text style={styles.orderSubtotal}>{fmtMoney(order.subtotal)}</Text>
      </View>

      {!!order.paymentSummary?.collectedBy && (
        <Text style={styles.collectedBy}>
          Collected by {order.paymentSummary.collectedBy}
          {order.paymentSummary.confirmedAt ? ` · ${fmtDateTime(order.paymentSummary.confirmedAt)}` : ''}
        </Text>
      )}
    </View>
  );
}

export default function OrderDetail() {
  const insets = useSafeAreaInsets();
  const { id, ref } = useLocalSearchParams<{ id: string; ref?: string }>();

  const [session, setSession] = useState<LedgerSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setError('Missing session id'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await crewSessions.getHistory({ sessionRef: String(id), limit: 1 });
      const found = res.sessions?.[0] ?? null;
      if (!found) setError('Session not found');
      setSession(found);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ── Reprint invoice ─────────────────────────────────────────────────────────
  const { staffInfo } = useAuth();
  const [printing, setPrinting] = useState(false);
  const [meta, setMeta] = useState<{ address?: string | null; phone?: string | null; email?: string | null; fssaiLicenseNumber?: string | null; upiId?: string | null; upiName?: string | null } | null>(null);
  const [dialog, setDialog] = useState<{
    visible: boolean; title: string; message: string;
    actions: { label: string; onPress: () => void; variant?: 'default' | 'danger' | 'primary' }[];
  }>({ visible: false, title: '', message: '', actions: [] });
  const closeDialog = () => setDialog((prev) => ({ ...prev, visible: false }));
  const showDialog = (title: string, message: string, actions: typeof dialog['actions']) =>
    setDialog({ visible: true, title, message, actions: actions.map((a) => ({ ...a, onPress: () => { closeDialog(); a.onPress(); } })) });

  const handleReprint = useCallback(async () => {
    if (!session || printing) return;
    if (getPrinterStatus() !== 'connected') {
      showDialog('No printer paired', 'Pair a Bluetooth printer to print the invoice.', [
        { label: 'Set up printer', variant: 'primary', onPress: () => router.push('/printer') },
        { label: 'Cancel', onPress: () => {} },
      ]);
      return;
    }
    setPrinting(true);
    try {
      // Restaurant header meta (address / FSSAI) — fetched once, best-effort.
      let m = meta;
      if (!m && staffInfo?.restaurantId) {
        try {
          const res = await restaurantApi.getBranding(staffInfo.restaurantId);
          if (res?.success) {
            m = { address: res.data.address ?? null, phone: res.data.phone ?? null, email: res.data.email ?? null, fssaiLicenseNumber: res.data.fssaiLicenseNumber ?? null, upiId: res.data.upiId ?? null, upiName: res.data.upiDisplayName ?? res.data.name ?? null };
            setMeta(m);
          }
        } catch { /* meta is optional */ }
      }

      const items: InvoiceItem[] = (session.orders ?? []).flatMap((o) =>
        (o.items ?? []).map((it) => ({ name: it.name, qty: it.qty, unitPrice: it.unitPrice, modifiersSummary: it.modifiersSummary ?? null })),
      );
      const methods = session.paymentMethodsUsed ?? [];
      const paymentMethod =
        methods.length > 1 ? 'mixed'
        : methods[0] === 'CASH' ? 'cash'
        : methods[0] === 'UPI_DIRECT' ? 'upi_direct'
        : methods[0] === 'PAYMENT_GATEWAY' ? 'online'
        : (session.payment?.method ?? null);

      // The ledger stores charges + GST combined and a separate tip; map both so
      // the printed breakdown reconciles to the bill total.
      const bill: InvoiceBill = {
        restaurantName: staffInfo?.restaurantName ?? '',
        restaurantAddress: m?.address ?? null,
        restaurantPhone: m?.phone ?? null,
        restaurantEmail: m?.email ?? null,
        fssaiLicenseNumber: m?.fssaiLicenseNumber ?? null,
        tableNumber: session.tableNumber ?? 'Walk-in',
        sessionRef: session.sessionRef ?? null,
        items,
        subtotal: session.foodSubtotal,
        discount: session.totalDiscount,
        charges: session.totalTip > 0 ? session.totalTip : undefined,
        tax: session.chargesGstTotal,
        grandTotal: session.billTotal,
        isPaid: session.statusView === 'PAID',
        paymentMethod,
        upiVpa: m?.upiId ?? null,
        upiName: m?.upiName ?? null,
        orderDateTime: session.openedAt,
        generatedAt: new Date().toISOString(),
      };

      const result = await printBill(bill);
      if (result === 'failed') {
        showDialog('Print failed', 'Could not print. Check that the printer is nearby and powered on.', [{ label: 'OK', onPress: () => {} }]);
      } else {
        showDialog('Printed', 'Invoice sent to the printer.', [{ label: 'OK', onPress: () => {} }]);
      }
    } finally {
      setPrinting(false);
    }
  }, [session, printing, meta, staffInfo]);

  const st = session ? statusMeta(session) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{ref || session?.sessionRef || 'Session'}</Text>
        <View style={styles.btnPlaceholder} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="small" color={QuinckleColors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={32} color={QuinckleColors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
        </View>
      ) : session ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.huge }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Session meta */}
          <View style={styles.metaCard}>
            <View style={styles.metaTopRow}>
              <Text style={styles.metaTable}>
                {session.tableNumber != null ? `Table ${session.tableNumber}` : 'Walk-in'}
              </Text>
              {st && (
                <View style={[styles.statusBadge, { borderColor: st.color }]}>
                  <View style={[styles.statusDot, { backgroundColor: st.color }]} />
                  <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                </View>
              )}
            </View>
            {(session.customerName || session.customerPhone) && (
              <Text style={styles.metaCustomer}>
                {session.customerName || 'Guest'}{session.customerPhone ? ` · ${session.customerPhone}` : ''}
              </Text>
            )}
            <Text style={styles.metaTime}>
              {fmtDateTime(session.openedAt)}
              {session.closedAt ? ` – ${fmtTime(session.closedAt)}` : ''}
              {session.durationMins > 0 ? ` · ${session.durationMins} min` : ''}
            </Text>
          </View>

          {/* Orders */}
          <Text style={styles.sectionLabel}>Orders ({session.orders?.length ?? 0})</Text>
          {(session.orders ?? []).map((o) => <OrderCard key={o.id} order={o} />)}

          {/* Totals */}
          <View style={styles.totalsCard}>
            <TotalRow label="Food subtotal" value={fmtMoney(session.foodSubtotal)} />
            {session.totalDiscount > 0 && <TotalRow label="Discount" value={`– ${fmtMoney(session.totalDiscount)}`} />}
            {session.chargesGstTotal > 0 && <TotalRow label="Charges & GST" value={fmtMoney(session.chargesGstTotal)} />}
            {session.totalTip > 0 && <TotalRow label="Tip" value={fmtMoney(session.totalTip)} />}
            <View style={styles.totalsDivider} />
            <TotalRow label="Bill total" value={fmtMoney(session.billTotal)} strong />
            <TotalRow label="Collected" value={fmtMoney(session.grandTotal)} />
            {!!session.balanceDue && session.balanceDue > 0 && (
              <TotalRow label="Balance due" value={fmtMoney(session.balanceDue)} accent />
            )}
            <View style={styles.totalsDivider} />
            <TotalRow
              label={`Quinckle's cut${session.commissionRate ? ` (${(session.commissionRate * 100).toFixed(1)}%)` : ''}`}
              value={fmtMoney(session.quincklesCut)}
            />
          </View>

          {/* Reprint invoice */}
          <TouchableOpacity
            style={[styles.reprintBtn, printing && styles.reprintBtnDisabled]}
            onPress={handleReprint}
            disabled={printing}
            activeOpacity={0.85}
          >
            {printing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="print-outline" size={18} color="#fff" />}
            <Text style={styles.reprintBtnText}>{printing ? 'Printing…' : 'Reprint Invoice'}</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : null}

      <ThemedDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        actions={dialog.actions}
        onClose={closeDialog}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: QuinckleColors.border,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPlaceholder: { width: 38, height: 38 },
  headerTitle: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.2, flex: 1, textAlign: 'center', marginHorizontal: Spacing.sm },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  errorText: { color: QuinckleColors.textTertiary, fontSize: 13, textAlign: 'center' },
  retryBtn: {
    marginTop: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: QuinckleColors.primarySoft,
    borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder,
  },
  retryText: { color: QuinckleColors.primary, fontSize: 13, fontWeight: '700' },

  scroll: { padding: Spacing.lg },

  metaCard: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
    padding: Spacing.lg, marginBottom: Spacing.lg,
  },
  metaTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaTable: { color: QuinckleColors.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  metaCustomer: { color: QuinckleColors.textSecondary, fontSize: 13, marginTop: Spacing.sm },
  metaTime: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 4 },

  sectionLabel: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: Spacing.sm, marginLeft: 2 },

  orderCard: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
    padding: Spacing.lg, marginBottom: Spacing.md,
  },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  orderRef: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '700' },
  orderTime: { color: QuinckleColors.textTertiary, fontSize: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5, gap: Spacing.sm },
  itemLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, flex: 1 },
  vegDot: { width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  vegInner: { width: 6, height: 6, borderRadius: 3 },
  itemQty: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '700', marginTop: 1 },
  itemName: { color: QuinckleColors.textPrimary, fontSize: 13.5 },
  itemNote: { color: QuinckleColors.textTertiary, fontSize: 11.5, marginTop: 2, fontStyle: 'italic' },
  itemTotal: { color: QuinckleColors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  orderFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: QuinckleColors.borderSubtle,
  },
  methodWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1, flexWrap: 'wrap' },
  methodChip: { backgroundColor: QuinckleColors.surfaceMuted, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: QuinckleColors.border },
  methodChipText: { color: QuinckleColors.textSecondary, fontSize: 10.5, fontWeight: '700' },
  payStatusText: { color: QuinckleColors.textTertiary, fontSize: 11.5 },
  orderSubtotal: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '700' },
  collectedBy: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: Spacing.sm },

  totalsCard: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
    padding: Spacing.lg, marginTop: Spacing.sm,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  totalLabel: { color: QuinckleColors.textSecondary, fontSize: 13 },
  totalLabelStrong: { color: QuinckleColors.textPrimary, fontWeight: '700' },
  totalValue: { color: QuinckleColors.textSecondary, fontSize: 13 },
  totalValueStrong: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '800' },
  totalsDivider: { height: 1, backgroundColor: QuinckleColors.border, marginVertical: Spacing.sm },

  reprintBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    height: 52, borderRadius: Radius.md, marginTop: Spacing.xl,
    backgroundColor: QuinckleColors.primary,
  },
  reprintBtnDisabled: { opacity: 0.6 },
  reprintBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
