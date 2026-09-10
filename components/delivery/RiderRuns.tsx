/**
 * The rider's view — DELIVERY_V2_PLAN.md §4, Phase 5.
 *
 * Not a rider APP and not a rider STACK: it is the same Delivery tab, rendered
 * differently because the staffer holds DELIVERY_RIDER instead of
 * DELIVERY_COUNTER. That is the rule that already governs every other screen
 * (see deliveryViewFor in constants/capabilities), and it is why there is no
 * second login, no role switch and no duplicated lifecycle.
 *
 * A rider can do exactly two things to a run, and the backend enforces both:
 * close it as delivered once the bill is settled, or fail it with a coded
 * reason. Dispatching and cancelling belong to the counter — a rider naming
 * themself as the carrier is precisely the self-dispatch the capability split
 * exists to prevent.
 *
 * The layout is deliberately NOT the counter's dense board. This is read at
 * arm's length, one-handed, on a bike in the dark: the address is the biggest
 * thing on the card, and Call and Directions are thumb-sized and always
 * visible rather than hidden behind a tap.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Linking, Modal, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  crewDelivery,
  type DeliveryOrder,
  type DeliveryFailureReasonOption,
} from '../../services/api';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { PickupSegmented } from '../ui/pickup';
import {
  STATUS_META, money, timeAgo, oneLineAddress, cashStillOut, isPaid,
  directionsUrl, EmptyState,
} from './shared';

type RunTab = 'MINE' | 'DONE';

/** Still mine to finish. The run begins at OUT — dispatch is what assigns it. */
const isMine = (o: DeliveryOrder) => o.status === 'OUT';

/** Closed by me, however it ended. */
const isDone = (o: DeliveryOrder) =>
  o.status === 'DELIVERED' || o.status === 'CLOSED' || o.status === 'FAILED';

const at = (o: DeliveryOrder) => new Date(o.created_at ?? 0).getTime();

/**
 * The rider's runs.
 *
 * The list is scoped SERVER-side to this staffer (V2 §4) — `rider_id` is
 * caller-supplied, so scoping here as well would be decoration. What this
 * component must get right is that it never offers a move the rider is not
 * allowed to make.
 */
export function RiderRuns({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [failureReasons, setFailureReasons] = useState<DeliveryFailureReasonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<RunTab>('MINE');
  const [open, setOpen] = useState<DeliveryOrder | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, meta] = await Promise.all([crewDelivery.list(), crewDelivery.meta()]);
      setOrders(list.data);
      setFailureReasons(meta.data.failure_reasons);
      setNotEnabled(false);
      setError(null);
    } catch (e: any) {
      if (e?.code === 'FEATURE_NOT_ENABLED') setNotEnabled(true);
      else setError(e?.message ?? 'Could not load your runs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Re-runs when the rider comes back from the payment sheet, which is what
  // turns "Collect payment" into an enabled "Completed" with no manual refresh.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Oldest first: the drop that has been waiting longest is the next one.
  const mine = useMemo(() => orders.filter(isMine).sort((a, b) => at(a) - at(b)), [orders]);
  const done = useMemo(() => orders.filter(isDone).sort((a, b) => at(b) - at(a)), [orders]);

  /**
   * What this rider still owes the counter.
   *
   * The single number that decides whether they can go home, so it sits above
   * the list rather than being something they add up across cards.
   */
  const toHandOver = useMemo(
    () => orders.filter(cashStillOut).reduce((n, o) => n + Number(o.cod_amount ?? 0), 0),
    [orders],
  );

  const apply = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      setOpen(null);
    } catch (e: any) {
      setError(e?.message ?? 'That did not work');
    }
  };

  /** Money at the door goes through the SAME sheet as any other bill (V2 §5). */
  const collectPayment = (o: DeliveryOrder) => {
    const ids = o.unpaid_order_ids ?? [];
    setOpen(null);
    router.push({
      pathname: '/(staff)/payment-collect',
      params: {
        orderId: ids[0] ?? '',
        sessionId: o.session_id,
        orderIds: JSON.stringify(ids),
        tableNumber: '',
        channel: 'DELIVERY',
        pickupToken: o.order_token ?? '',
        amount: String(o.final_total ?? 0),
        customerName: o.recipient_name,
        customerPhone: o.recipient_phone,
      },
    });
  };

  const frame = (children: React.ReactNode) => (
    <View style={[styles.container, embedded ? styles.embedded : { paddingTop: insets.top + Spacing.sm }]}>
      {!embedded && (
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>My deliveries</Text>
          <TouchableOpacity onPress={load} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="refresh" size={20} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}
      {children}
    </View>
  );

  if (loading) {
    return frame(
      <View style={[styles.center, { flex: 1 }]}>
        <ActivityIndicator color={QuinckleColors.primary} />
      </View>,
    );
  }

  if (notEnabled) {
    return frame(
      <View style={[styles.center, { flex: 1, padding: Spacing.xl }]}>
        <EmptyState
          icon="bicycle-outline"
          title="Delivery isn't on for this venue"
          body="Ask the Quinckle team to enable it here."
        />
      </View>,
    );
  }

  const listPad = {
    flexGrow: 1,
    gap: Spacing.md,
    paddingBottom: embedded ? 100 : insets.bottom + Spacing.xl,
  };

  return frame(
    <>
      <View style={styles.segmentWrap}>
        <PickupSegmented
          items={[
            { key: 'MINE', label: 'My runs', count: mine.length },
            { key: 'DONE', label: 'Completed', count: done.length },
          ]}
          active={tab}
          onChange={(key) => setTab(key as RunTab)}
        />
      </View>

      {/* Cash the rider is carrying. Shown even at zero on the Completed tab,
          because "you owe nothing" is the answer they are looking for. */}
      {(toHandOver > 0 || tab === 'DONE') && (
        <View style={[styles.floatStrip, toHandOver > 0 && styles.floatStripWarn]}>
          <Ionicons
            name={toHandOver > 0 ? 'wallet-outline' : 'checkmark-done'}
            size={15}
            color={toHandOver > 0 ? QuinckleColors.warning : QuinckleColors.success}
          />
          <Text style={[styles.floatStripText, toHandOver > 0 && styles.floatStripTextWarn]}>
            {toHandOver > 0
              ? `${money(toHandOver)} to hand over at the counter`
              : 'Nothing to hand over'}
          </Text>
        </View>
      )}

      {error && (
        <TouchableOpacity style={styles.errorBar} onPress={() => setError(null)}>
          <Ionicons name="alert-circle-outline" size={15} color={QuinckleColors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={tab === 'MINE' ? mine : done}
        keyExtractor={(o) => o.id}
        contentContainerStyle={listPad}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={QuinckleColors.primary}
          />
        }
        ListEmptyComponent={
          tab === 'MINE' ? (
            <EmptyState
              icon="bicycle-outline"
              title="No runs right now"
              body="A delivery shows up here the moment the counter hands you the bag."
            />
          ) : (
            <EmptyState
              icon="time-outline"
              title="Nothing finished yet"
              body="Runs you close today land here, with anything you still owe the counter."
            />
          )
        }
        renderItem={({ item }) => <RunCard order={item} onPress={() => setOpen(item)} />}
      />

      {open && (
        <RunSheet
          order={open}
          failureReasons={failureReasons}
          onClose={() => setOpen(null)}
          onApply={apply}
          onCollectPayment={() => collectPayment(open)}
        />
      )}
    </>,
  );
}

/**
 * One run.
 *
 * Address first and largest — it is the only thing on this card that gets read
 * while moving. Everything else (who, how much, how long ago) is support.
 */
function RunCard({ order, onPress }: { order: DeliveryOrder; onPress: () => void }) {
  const meta = STATUS_META[order.status];
  const owed = cashStillOut(order);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardTop}>
        <View style={[styles.pill, { backgroundColor: meta.soft, borderColor: meta.border }]}>
          <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <Text style={styles.time}>{timeAgo(order.created_at)}</Text>
      </View>

      <Text style={styles.address}>{oneLineAddress(order)}</Text>
      {order.address.floor ? <Text style={styles.addressSub}>Floor {order.address.floor}</Text> : null}

      <Text style={styles.recipient}>
        {order.recipient_name} · {order.recipient_phone}
      </Text>

      {order.delivery_note ? (
        <View style={styles.noteRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={13} color={QuinckleColors.warning} />
          <Text style={styles.note}>{order.delivery_note}</Text>
        </View>
      ) : null}

      {/* Thumb-sized and always visible: a rider should never have to open a
          sheet to make the call that gets them through a locked gate. */}
      <View style={styles.quickRow}>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => Linking.openURL(`tel:${order.recipient_phone}`)}
          activeOpacity={0.8}
        >
          <Ionicons name="call" size={17} color={QuinckleColors.primary} />
          <Text style={styles.quickText}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => Linking.openURL(directionsUrl(order))}
          activeOpacity={0.8}
        >
          <Ionicons name="navigate" size={17} color={QuinckleColors.primary} />
          <Text style={styles.quickText}>Directions</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardBottom}>
        <Text style={styles.total}>{money(order.final_total)}</Text>
        <View style={[
          styles.pill,
          isPaid(order)
            ? { backgroundColor: QuinckleColors.successSoft, borderColor: QuinckleColors.successBorder }
            : { backgroundColor: QuinckleColors.surfaceMuted, borderColor: QuinckleColors.border },
        ]}>
          <Text style={[styles.pillText, { color: isPaid(order) ? QuinckleColors.success : QuinckleColors.textSecondary }]}>
            {isPaid(order) ? 'Paid' : 'Collect at door'}
          </Text>
        </View>
        {owed && (
          <View style={[styles.pill, { backgroundColor: QuinckleColors.warningSoft, borderColor: QuinckleColors.warningBorder }]}>
            <Text style={[styles.pillText, { color: QuinckleColors.warning }]}>
              {money(order.cod_amount)} to hand over
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

/**
 * The two moves a rider has, and only ever one of them is primary.
 *
 * Both round-trip and can be refused — this sheet mirrors the backend state
 * machine, it is not the authority on it.
 */
function RunSheet({
  order, failureReasons, onClose, onApply, onCollectPayment,
}: {
  order: DeliveryOrder;
  failureReasons: DeliveryFailureReasonOption[];
  onClose: () => void;
  onApply: (fn: () => Promise<unknown>) => Promise<void>;
  onCollectPayment: () => void;
}) {
  const [mode, setMode] = useState<'actions' | 'failed'>('actions');
  const [busy, setBusy] = useState(false);
  const paid = isPaid(order);
  const owed = cashStillOut(order);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await onApply(fn);
    setBusy(false);
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.sheetGrip} />

          <ScrollView style={{ maxHeight: 420 }}>
            <Text style={styles.sheetAddress}>{oneLineAddress(order)}</Text>
            <Text style={styles.sheetSub}>
              {order.recipient_name} · {order.recipient_phone}
            </Text>
            {order.delivery_note ? (
              <View style={styles.sheetNote}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={QuinckleColors.warning} />
                <Text style={styles.note}>{order.delivery_note}</Text>
              </View>
            ) : null}

            <View style={styles.sheetTotalRow}>
              <Text style={styles.sheetTotalLabel}>Bill</Text>
              <Text style={styles.sheetTotal}>{money(order.final_total)}</Text>
            </View>

            {busy && <ActivityIndicator color={QuinckleColors.primary} style={{ marginVertical: Spacing.md }} />}

            {mode === 'failed' ? (
              <View>
                <Text style={styles.hint}>
                  What happened? The food and the money are both gone, so this needs a reason.
                </Text>
                {failureReasons.map((r) => (
                  <TouchableOpacity
                    key={r.code}
                    style={styles.rowBtn}
                    onPress={() => run(() => crewDelivery.setStatus(order.id, 'FAILED', { failureReason: r.code }))}
                  >
                    <Ionicons name="alert-circle-outline" size={18} color={QuinckleColors.danger} />
                    <Text style={styles.rowBtnText}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : order.status === 'OUT' ? (
              <View style={{ gap: Spacing.sm }}>
                {/* Prepaid orders skip this entirely — asking a diner who has
                    already paid for money at the door is the worst bug this
                    screen could have. */}
                {!paid && (
                  <Action label="Collect payment" icon="card-outline" primary onPress={onCollectPayment} />
                )}
                <Action
                  label="Completed"
                  icon="checkmark-done-outline"
                  primary={paid}
                  disabled={!paid}
                  hint={!paid ? 'Collect the payment first' : undefined}
                  onPress={() => run(() => crewDelivery.setStatus(order.id, 'DELIVERED'))}
                />
                <Action label="Couldn't deliver" icon="close-circle-outline" danger onPress={() => setMode('failed')} />
              </View>
            ) : (
              <Text style={styles.hint}>
                {owed
                  ? `Hand ${money(order.cod_amount)} to the counter — they record it when they take it.`
                  : order.status === 'FAILED' && order.failure_reason
                    ? `Marked as failed: ${order.failure_reason.toLowerCase().replace(/_/g, ' ')}.`
                    : 'This run is finished.'}
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={mode === 'actions' ? onClose : () => setMode('actions')}>
            <Text style={styles.closeText}>{mode === 'actions' ? 'Close' : 'Back'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Action({
  label, icon, onPress, primary, danger, disabled, hint,
}: {
  label: string; icon: any; onPress: () => void;
  primary?: boolean; danger?: boolean; disabled?: boolean; hint?: string;
}) {
  const tint = danger ? QuinckleColors.danger : primary ? '#fff' : QuinckleColors.textPrimary;
  return (
    <View>
      <TouchableOpacity
        style={[
          styles.actionBtn,
          primary && styles.actionBtnPrimary,
          danger && styles.actionBtnDanger,
          disabled && styles.actionBtnDisabled,
        ]}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <Ionicons name={icon} size={18} color={tint} />
        <Text style={[styles.actionText, { color: tint }]}>{label}</Text>
      </TouchableOpacity>
      {!!hint && <Text style={styles.actionHint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background, paddingHorizontal: Spacing.lg },
  embedded: { paddingHorizontal: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: Spacing.md,
  },
  topBarTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },

  segmentWrap: { marginBottom: Spacing.md },

  floatStrip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1,
    borderColor: QuinckleColors.border, backgroundColor: QuinckleColors.surfaceMuted,
    marginBottom: Spacing.md,
  },
  floatStripWarn: { backgroundColor: QuinckleColors.warningSoft, borderColor: QuinckleColors.warningBorder },
  floatStripText: { ...Typography.caption, color: QuinckleColors.textSecondary, flex: 1 },
  floatStripTextWarn: { color: QuinckleColors.warning, fontWeight: '700' },

  errorBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: QuinckleColors.dangerSoft,
    borderWidth: 1, borderColor: QuinckleColors.dangerBorder, marginBottom: Spacing.md,
  },
  errorText: { ...Typography.caption, color: QuinckleColors.danger, flex: 1 },

  card: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border, padding: Spacing.lg,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  time: { ...Typography.micro, color: QuinckleColors.textTertiary },
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.pill, borderWidth: 1 },
  pillText: { ...Typography.micro, fontWeight: '700' },

  // The one line that gets read while moving.
  address: { ...Typography.subtitle, color: QuinckleColors.textPrimary, lineHeight: 24 },
  addressSub: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: 2 },
  recipient: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: Spacing.xs },

  noteRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    borderRadius: Radius.sm, backgroundColor: QuinckleColors.warningSoft,
  },
  note: { ...Typography.caption, color: QuinckleColors.textSecondary, flex: 1 },

  quickRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  quickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder,
    backgroundColor: QuinckleColors.primarySoft,
  },
  quickText: { ...Typography.bodyStrong, color: QuinckleColors.primary },

  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, flexWrap: 'wrap' },
  total: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: QuinckleColors.surface,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: Spacing.lg, paddingBottom: Spacing.xl,
  },
  sheetGrip: {
    width: 36, height: 4, borderRadius: 2, alignSelf: 'center',
    backgroundColor: QuinckleColors.border, marginBottom: Spacing.md,
  },
  sheetAddress: { ...Typography.subtitle, color: QuinckleColors.textPrimary, lineHeight: 24 },
  sheetSub: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: 2 },
  sheetNote: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    borderRadius: Radius.sm, backgroundColor: QuinckleColors.warningSoft,
  },
  sheetTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Spacing.md, marginBottom: Spacing.md,
    paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: QuinckleColors.border,
  },
  sheetTotalLabel: { ...Typography.caption, color: QuinckleColors.textSecondary },
  sheetTotal: { ...Typography.subtitle, color: QuinckleColors.textPrimary },

  hint: { ...Typography.caption, color: QuinckleColors.textSecondary, marginBottom: Spacing.sm },
  rowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: QuinckleColors.border,
  },
  rowBtnText: { ...Typography.body, color: QuinckleColors.textPrimary },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  actionBtnPrimary: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
  actionBtnDanger: { backgroundColor: QuinckleColors.dangerSoft, borderColor: QuinckleColors.dangerBorder },
  actionBtnDisabled: { opacity: 0.4 },
  actionText: { ...Typography.bodyStrong },
  actionHint: { ...Typography.micro, color: QuinckleColors.textTertiary, textAlign: 'center', marginTop: Spacing.xs },

  closeBtn: { marginTop: Spacing.md, alignItems: 'center', paddingVertical: Spacing.sm },
  closeText: { ...Typography.body, color: QuinckleColors.textSecondary },
});
