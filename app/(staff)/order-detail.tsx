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
import { crewSessions, crewOrders, restaurantApi, type LedgerSession, type LedgerOrder } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { getStatus as getPrinterStatus } from '../../services/printer';
import { printBillFromHere, type InvoicePrinterChoice } from '../../services/billPrint';
import { useInvoicePrinterPicker } from '../../hooks/useInvoicePrinterPicker';
import type { InvoiceBill, InvoiceItem } from '../../services/invoiceTemplate';
import { useAuth } from '../../context/AuthContext';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { RefundSheet } from '../../components/ui/RefundSheet';
import { useManagerApproval } from '../../components/ui/ManagerPinSheet';
import { PrintProgressOverlay, type PrintJob } from '../../components/ui/PrintProgressOverlay';

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
  CASH_PENDING: { label: 'Payment Pending', color: QuinckleColors.warning },
  CANCELLED:    { label: 'Cancelled',    color: QuinckleColors.danger },
  CLOSED:       { label: 'Closed',       color: QuinckleColors.textTertiary },
  // Without these the chip would print the raw enum name at the crew.
  REFUNDED:           { label: 'Refunded',      color: QuinckleColors.info ?? QuinckleColors.textSecondary },
  PARTIALLY_REFUNDED: { label: 'Part refunded', color: QuinckleColors.info ?? QuinckleColors.textSecondary },
  COMPED:             { label: 'Written off',   color: QuinckleColors.warning },
  EXEMPT:             { label: 'Exempted',      color: QuinckleColors.warning },
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
function OrderCard({ order, onRefund }: { order: LedgerOrder; onRefund?: (o: LedgerOrder) => void }) {
  const methods = order.paymentSummary?.methods ?? [];
  // Only settled money can come back. Gateway refunds need webhook
  // reconciliation that does not exist yet, so they are not offered here.
  const refundable =
    !!onRefund &&
    ['PAID_CASH', 'PAID_UPI_DIRECT', 'PAID_MIXED'].includes(String(order.paymentStatus ?? ''));
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

      {/* Voided lines — shown struck-through so the bill reconciles with what
          was actually rung up. These don't count toward the order total. */}
      {(order.cancelledItems ?? []).map((it) => (
        <View key={it.id} style={styles.itemRow}>
          <View style={styles.itemLeft}>
            <Ionicons name="close" size={14} color={QuinckleColors.danger} style={{ marginTop: 2 }} />
            <Text style={[styles.itemQty, styles.itemStruck]}>{it.qty}×</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, styles.itemStruck]} numberOfLines={2}>{it.name}</Text>
              {!!it.modifiersSummary && <Text style={styles.itemNote} numberOfLines={2}>{it.modifiersSummary}</Text>}
            </View>
          </View>
          <View style={styles.removedTag}>
            <Text style={styles.removedTagText}>Removed</Text>
          </View>
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

      {refundable && (
        <TouchableOpacity style={styles.refundBtn} onPress={() => onRefund!(order)} activeOpacity={0.8}>
          <Ionicons name="arrow-undo-outline" size={14} color={QuinckleColors.textSecondary} />
          <Text style={styles.refundBtnText}>Record a refund</Text>
        </TouchableOpacity>
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
  const [refundTarget, setRefundTarget] = useState<LedgerOrder | null>(null);
  const [refundCeiling, setRefundCeiling] = useState(0);
  const [refunding, setRefunding] = useState(false);
  const { sheet: managerPinSheet, runWithApproval } = useManagerApproval();
  const submitRefund = async (input: { amount: number; method: 'CASH' | 'UPI_DIRECT'; coded: any }) => {
    const order = refundTarget;
    if (!order || refunding) return;
    setRefunding(true);
    try {
      await runWithApproval({ action: 'REFUND', amount: input.amount }, async (mint) => {
        const grantId = mint ? await mint(order.id, input.amount) : undefined;
        await crewOrders.refund(order.id, { amount: input.amount, method: input.method }, input.coded, grantId);
        setRefundTarget(null);
        await load();
      });
    } catch (e: any) {
      const code = String(e?.code ?? '');
      // The server knows the true remaining figure; show it rather than a bare
      // rejection, and reopen the sheet at the corrected ceiling.
      if ((code === 'AMOUNT_EXCEEDS_REFUNDABLE' || code === 'ALREADY_FULLY_REFUNDED') && typeof e?.refundable === 'number') {
        setRefundCeiling(e.refundable);
        setDialog({
          visible: true,
          title: 'Amount too high',
          message: e.refundable > 0
            ? `Only ₹${e.refundable.toFixed(0)} is left to refund on this order.`
            : 'This order has already been fully refunded.',
          actions: [{ label: 'OK', onPress: () => {} }],
        });
        if (!(e.refundable > 0)) setRefundTarget(null);
      } else {
        setRefundTarget(null);
        setDialog({
          visible: true,
          title: 'Could not record refund',
          // REFUND_NOT_RECORDED means nothing was written down — the crew must
          // NOT hand money over on the strength of a failed save.
          message: code === 'REFUND_NOT_RECORDED'
            ? 'The refund was not saved. Do not hand over the money — try again.'
            : code === 'GATEWAY_REFUND_UNSUPPORTED'
            ? 'Online payments must be refunded from the payment provider.'
            : (typeof e?.message === 'string' && e.message) || 'Please try again.',
          actions: [{ label: 'OK', onPress: () => {} }],
        });
      }
    } finally {
      setRefunding(false);
    }
  };

  const [printing, setPrinting] = useState(false);
  // Tap-to-paper progress overlay; null = hidden.
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [meta, setMeta] = useState<{ address?: string | null; phone?: string | null; email?: string | null; fssaiLicenseNumber?: string | null; upiId?: string | null; upiName?: string | null; billThankYouMsg?: string | null; billFooterNote?: string | null } | null>(null);
  const [dialog, setDialog] = useState<{
    visible: boolean; title: string; message: string;
    actions: { label: string; onPress: () => void; variant?: 'default' | 'danger' | 'primary' }[];
  }>({ visible: false, title: '', message: '', actions: [] });
  const closeDialog = useCallback(() => {
    setDialog((prev) => ({ ...prev, visible: false }));
  }, []);
  const showDialog = useCallback((title: string, message: string, actions: typeof dialog['actions']) => {
    setDialog({
      visible: true,
      title,
      message,
      actions: actions.map((action) => ({
        ...action,
        onPress: () => { closeDialog(); action.onPress(); },
      })),
    });
  }, [closeDialog]);

  const { chooseInvoicePrinters, invoicePrinterSheet } = useInvoicePrinterPicker();

  // `only` narrows a retry to the printers that failed. It is checked for shape
  // because a handler like this is one `onPress={handleReprint}` away from
  // receiving a press event as its first argument.
  const handleReprint = useCallback(async (only?: InvoicePrinterChoice) => {
    if (!session || printing) return;
    const retryTargets = only && Array.isArray(only.ids) ? only : undefined;
    // Which invoice printer(s) — asked only with two or more, never on a retry.
    const targets = retryTargets ?? await chooseInvoicePrinters();
    if (targets === null) return; // sheet dismissed — print nothing
    // No local-printer gate — see the note in [tableId].tsx handlePrintInvoice.
    setPrinting(true);
    setPrintJob({ phase: 'preparing', label: 'Invoice' });
    try {
      // Restaurant header meta (address / FSSAI) — fetched once, best-effort.
      let m = meta;
      if (!m && staffInfo?.restaurantId) {
        try {
          const res = await restaurantApi.getBranding(staffInfo.restaurantId);
          if (res?.success) {
            m = { address: res.data.address ?? null, phone: res.data.phone ?? null, email: res.data.email ?? null, fssaiLicenseNumber: res.data.fssaiLicenseNumber ?? null, upiId: res.data.upiId ?? null, upiName: res.data.upiDisplayName ?? res.data.name ?? null, billThankYouMsg: res.data.billThankYouMsg ?? null, billFooterNote: res.data.billFooterNote ?? null };
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
        channel: session.channel ?? 'DINE_IN',
        pickupToken: session.pickupToken ?? null,
        // Historical reprints must be stable: carry the already-assigned invoice
        // number + recipient GSTIN so a ledger reprint matches the original bill.
        invoiceNumber: session.invoiceNumber ?? null,
        buyerGstin: session.buyerGstin ?? null,
        buyerName: session.buyerName ?? null,
        sessionRef: session.sessionRef ?? null,
        items,
        subtotal: session.foodSubtotal,
        discount: session.totalDiscount,
        // These three used to be wrong in a way that survived because the grand
        // total (which comes straight from billTotal) still looked right:
        // the TIP was passed as `charges`, so a ₹50 tip printed as
        // "Service charge ₹50"; and `chargesGstTotal` — which fuses charges AND
        // GST into one number — was printed on the tax line, overstating GST on
        // a document that is a tax invoice. The ledger now returns them
        // separated, from the stored per-order columns.
        // Degrade safely against a backend that predates the separated fields:
        // charges fall to 0 and tax falls back to the fused figure, i.e. exactly
        // the old output, rather than a blank or doubled line.
        charges: session.chargesTotal ?? 0,
        chargeLines: session.chargeLines,
        tax: session.taxTotal ?? Math.max(0, session.chargesGstTotal - (session.chargesTotal ?? 0)),
        tip: session.totalTip > 0 ? session.totalTip : undefined,
        roundOff: session.roundOffTotal ?? 0,
        grandTotal: session.billTotal,
        isPaid: session.statusView === 'PAID',
        paymentMethod,
        customerName: session.customerName ?? null,
        customerPhone: session.customerPhone ?? null,
        billerName: staffInfo?.name ?? null,
        upiVpa: m?.upiId ?? null,
        upiName: m?.upiName ?? null,
        orderDateTime: session.openedAt,
        generatedAt: new Date().toISOString(),
        thankYouMessage: m?.billThankYouMsg ?? null,
        footerNote: m?.billFooterNote ?? null,
      };

      setPrintJob({ phase: 'printing', label: 'Invoice' });
      // Local when this device drives a bill printer, otherwise dispatched to
      // the one that does — see services/billPrint.ts.
      const outcome = await printBillFromHere({
        restaurantId: staffInfo?.restaurantId ?? '',
        sessionId: session.id,
        bill,
        targets,
        onDispatched: (printerName) => setPrintJob({ phase: 'printing', label: `Invoice → ${printerName}` }),
      });
      if (outcome.status === 'printed') {
        setPrintJob({ phase: 'done', label: 'Invoice' });
      } else {
        setPrintJob({
          phase: 'failed',
          label: 'Invoice',
          message: outcome.message
            ?? 'Could not print. Check that the printer is nearby and powered on.',
          onRetry: () => {
            void handleReprint(
              targets && outcome.failedPrinterIds?.length
                ? { ids: outcome.failedPrinterIds, names: targets.names }
                : targets,
            );
          },
        });
      }
    } finally {
      setPrinting(false);
    }
  }, [session, printing, meta, staffInfo, showDialog, chooseInvoicePrinters]);

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
          {(session.orders ?? []).map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              onRefund={(order) => {
                // The ledger does not carry per-order refunds, so the order
                // total is the opening ceiling; the server is authoritative and
                // reports the real figure if this is a second refund.
                setRefundCeiling(Number(order.total ?? order.subtotal ?? 0));
                setRefundTarget(order);
              }}
            />
          ))}

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
            onPress={() => { void handleReprint(); }}
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

      {/* Tap-to-paper print progress */}
      <RefundSheet
        visible={!!refundTarget}
        refundable={refundCeiling}
        orderLabel={refundTarget ? `#${refundTarget.shortId}` : null}
        busy={refunding}
        onClose={() => setRefundTarget(null)}
        onSubmit={(input) => void submitRefund(input)}
      />

      {managerPinSheet}

      {invoicePrinterSheet}
      <PrintProgressOverlay job={printJob} onDismiss={() => setPrintJob(null)} />
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
  itemStruck: { color: QuinckleColors.textTertiary, textDecorationLine: 'line-through' },
  removedTag: { backgroundColor: QuinckleColors.dangerSoft, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
  removedTagText: { color: QuinckleColors.danger, fontSize: 10, fontWeight: '700' },
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

  refundBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: Spacing.md, paddingVertical: 9, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  refundBtnText: { color: QuinckleColors.textSecondary, fontSize: 12.5, fontWeight: '700' },

  reprintBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    height: 52, borderRadius: Radius.md, marginTop: Spacing.xl,
    backgroundColor: QuinckleColors.primary,
  },
  reprintBtnDisabled: { opacity: 0.6 },
  reprintBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
