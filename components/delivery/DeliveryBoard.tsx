/**
 * Delivery board — DELIVERY_PANEL_PLAN.md §6, Phase 1.
 *
 * The COUNTER's view (DELIVERY_V2_PLAN §4). Counter staff drive the moves that
 * belong to the building: take a phone order, dispatch it to a rider, cancel
 * it before it leaves, and receive the cash back when the rider returns. The
 * moves that belong to the road — collect at the door, completed, couldn't
 * deliver — are the rider's, in components/delivery/RiderRuns.
 *
 * Which of the two a staffer gets is decided by capability, in one place
 * (deliveryViewFor in constants/capabilities). It matters that the counter
 * cannot be the rider: stage 3 and stage 4 are meant to be two people saying
 * the same number, and the split is what stops one person dispatching to
 * themself and then confirming their own cash (§3).
 *
 * This board can still run a delivery end to end — an owner holds both roles —
 * so nothing here assumes a rider is using the app.
 *
 * It lives in components/ rather than app/ because delivery is a channel on the
 * staff dashboard (a bottom-nav tab beside Orders, Tables and Takeaway), not a
 * screen buried in the burger menu. The /(staff)/delivery route renders the
 * same board standalone for anything that still links straight to it.
 *
 * The lifecycle rules live on the BACKEND state machine. This board only
 * offers the moves that are legal from the current status — it never re-derives
 * them, so the two can't drift.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Modal, Platform,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  crewDelivery,
  type DeliveryOrder,
  type DeliveryStatus,
  type DeliveryRider,
  type DeliveryFailureReasonOption,
  type DeliveryCancelReasonOption,
} from '../../services/api';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
// Every money/lifecycle predicate is shared with the rider view — two copies
// of "is this paid?" is how one surface ends up telling somebody a stale
// number. Layout stays per-view on purpose.
import {
  STATUS_META, money, timeAgo, oneLineAddress, cashStillOut, isLive, isPaid,
  prepOf, directionsUrl, PrepChip, EmptyState,
} from './shared';
import { PickupSegmented } from '../ui/pickup';

type BoardTab = 'LIVE' | 'CASH' | 'DONE';

/** Run order for the Live list — the newest ticket is not the most urgent. */
const STAGE: Record<DeliveryStatus, number> = {
  NEW: 0, OUT: 1, DELIVERED: 2, CLOSED: 3, FAILED: 4, CANCELLED: 5,
};

const at = (o: DeliveryOrder) => new Date(o.created_at ?? 0).getTime();
const byRun = (a: DeliveryOrder, b: DeliveryOrder) => STAGE[a.status] - STAGE[b.status] || at(a) - at(b);
const byNewest = (a: DeliveryOrder, b: DeliveryOrder) => at(b) - at(a);

/** One rider's outstanding float — what the Cash tab settles in a single tap. */
type RiderFloat = { staffId: string | null; name: string; amount: number; orders: DeliveryOrder[] };

/**
 * The delivery board.
 *
 * `embedded` renders it as a tab inside the staff dashboard: no back header, no
 * safe-area padding or side padding of its own (the dashboard supplies both),
 * and room under the list for the bottom navbar. The standalone route renders
 * the same board with its own header — one board, two frames, so the two can
 * never drift apart.
 */
export function DeliveryBoard({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [riders, setRiders] = useState<DeliveryRider[]>([]);
  const [failureReasons, setFailureReasons] = useState<DeliveryFailureReasonOption[]>([]);
  const [cancelReasons, setCancelReasons] = useState<DeliveryCancelReasonOption[]>([]);
  const [riderFloatTotal, setRiderFloatTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<BoardTab>('LIVE');
  const [settling, setSettling] = useState<string | null>(null);

  const [action, setAction] = useState<DeliveryOrder | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, meta, float] = await Promise.all([
        crewDelivery.list(),
        crewDelivery.meta(),
        crewDelivery.cashWithRiders(),
      ]);
      setOrders(list.data);
      setRiders(meta.data.riders);
      setFailureReasons(meta.data.failure_reasons);
      setCancelReasons(meta.data.cancel_reasons ?? []);
      setRiderFloatTotal(float.data.total);
      setNotEnabled(false);
      setError(null);
    } catch (e: any) {
      // A venue that has not been switched on 404s every route here. That is a
      // configuration state, not a failure — say so plainly instead of showing
      // a scary error.
      if (e?.code === 'FEATURE_NOT_ENABLED') setNotEnabled(true);
      else setError(e?.message ?? 'Could not load deliveries');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Also re-runs when the counter comes back from the payment sheet, which is
  // what turns "Collect payment" into "Completed" without a manual refresh.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const live = useMemo(() => orders.filter(isLive).sort(byRun), [orders]);
  const done = useMemo(
    () => orders.filter((o) => o.status === 'CLOSED' || o.status === 'FAILED' || o.status === 'CANCELLED').sort(byNewest),
    [orders],
  );

  /**
   * Cash, grouped by the rider carrying it. A rider comes back with one bundle
   * of notes across several drops; settling that order by order is three taps
   * of friction at the busiest moment of the evening.
   */
  const floats = useMemo<RiderFloat[]>(() => {
    const byRider = new Map<string, RiderFloat>();
    for (const o of orders.filter(cashStillOut)) {
      const key = o.assigned_staff?.id ?? '_unassigned';
      const cur = byRider.get(key) ?? {
        staffId: o.assigned_staff?.id ?? null,
        name: o.assigned_staff?.name ?? 'Unassigned',
        amount: 0,
        orders: [],
      };
      cur.amount += Number(o.cod_amount ?? 0);
      cur.orders.push(o);
      byRider.set(key, cur);
    }
    return [...byRider.values()].sort((a, b) => b.amount - a.amount);
  }, [orders]);

  const toCollect = floats.reduce((n, f) => n + f.orders.length, 0);

  const apply = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      setAction(null);
    } catch (e: any) {
      setError(e?.message ?? 'That did not work');
    }
  };

  /** Money at the door goes through the SAME sheet as any other bill (V2 §5). */
  const collectPayment = (o: DeliveryOrder) => {
    const ids = o.unpaid_order_ids ?? [];
    setAction(null);
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

  const settleRider = async (f: RiderFloat) => {
    if (!f.staffId) {
      setError('This cash is not attached to a rider — settle it order by order.');
      return;
    }
    setSettling(f.staffId);
    try {
      await crewDelivery.settleRider(f.staffId);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Could not record that handover');
    } finally {
      setSettling(null);
    }
  };

  // Standalone keeps its own header and insets; embedded sits inside the
  // dashboard, which already owns the top bar and the side padding.
  const frame = (children: React.ReactNode) => (
    <View style={[styles.container, embedded ? styles.embedded : { paddingTop: insets.top + Spacing.sm }]}>
      {!embedded && <Header onBack={() => router.back()} onRefresh={load} />}
      {children}
    </View>
  );

  // ── States before the list ────────────────────────────────────────────────
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
        <View style={styles.emptyMedallion}>
          <Ionicons name="bicycle-outline" size={28} color={QuinckleColors.textTertiary} />
        </View>
        <Text style={styles.emptyTitle}>Delivery isn&apos;t on for this venue</Text>
        <Text style={styles.emptyBody}>
          It&apos;s being switched on one venue at a time. Ask the Quinckle team to enable it here.
        </Text>
      </View>,
    );
  }

  const listPad = {
    flexGrow: 1,
    gap: Spacing.md,
    // Embedded, the bottom navbar floats over the list; standalone, only the
    // home indicator does.
    paddingBottom: embedded ? 100 : insets.bottom + Spacing.xl,
  };

  return frame(
    <>
      {/* Same segmented control as the Orders and Takeaway tabs — this is one
          more channel on the dashboard, not a screen of its own. */}
      <View style={styles.segmentWrap}>
        <PickupSegmented
          items={[
            { key: 'LIVE', label: 'Live', count: live.length },
            { key: 'CASH', label: 'Cash', count: toCollect },
            { key: 'DONE', label: 'Done', count: done.length },
          ]}
          active={tab}
          onChange={(key) => setTab(key as BoardTab)}
        />
      </View>

      <View style={styles.controlsRow}>
        {/* Cash with riders is the number that matters at 11pm — it is money the
            venue has earned that is not in the drawer. */}
        <View style={[styles.cashStrip, riderFloatTotal > 0 && styles.cashStripWarn]}>
          <Ionicons
            name="cash-outline"
            size={15}
            color={riderFloatTotal > 0 ? QuinckleColors.warning : QuinckleColors.textTertiary}
          />
          <Text
            style={[styles.cashStripText, riderFloatTotal > 0 && styles.cashStripTextWarn]}
            numberOfLines={1}
          >
            {money(riderFloatTotal)} with riders
            {toCollect > 0 ? `  ·  ${toCollect} to collect` : ''}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => { setRefreshing(true); load(); }}
          disabled={refreshing}
          activeOpacity={0.75}
          accessibilityLabel="Refresh deliveries"
        >
          {refreshing
            ? <ActivityIndicator size="small" color={QuinckleColors.primary} />
            : <Ionicons name="refresh" size={18} color={QuinckleColors.primary} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowNew(true)}
          activeOpacity={0.85}
          accessibilityLabel="Take a phone order"
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {error && (
        <TouchableOpacity style={styles.errorBar} onPress={() => setError(null)}>
          <Ionicons name="alert-circle-outline" size={15} color={QuinckleColors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </TouchableOpacity>
      )}

      {tab === 'CASH' ? (
        <FlatList
          data={floats}
          keyExtractor={(f) => f.staffId ?? '_unassigned'}
          contentContainerStyle={listPad}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={QuinckleColors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="checkmark-done"
              title="No cash out"
              body="Every rider has handed back what they collected."
            />
          }
          renderItem={({ item }) => (
            <RiderFloatCard
              float={item}
              busy={settling === item.staffId}
              onSettle={() => settleRider(item)}
              onOpenOrder={setAction}
            />
          )}
        />
      ) : (
        <FlatList
          data={tab === 'LIVE' ? live : done}
          keyExtractor={(o) => o.id}
          contentContainerStyle={listPad}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={QuinckleColors.primary} />
          }
          ListEmptyComponent={
            tab === 'DONE' ? (
              <EmptyState icon="time-outline" title="Nothing closed yet" body="Delivered, failed and cancelled orders land here." />
            ) : (
              <EmptyState icon="bicycle-outline" title="No live deliveries" body="New delivery orders show up here the moment they are placed." />
            )
          }
          renderItem={({ item }) => <DeliveryCard order={item} onPress={() => setAction(item)} />}
        />
      )}

      {action && (
        <ActionSheet
          order={action}
          riders={riders}
          failureReasons={failureReasons}
          cancelReasons={cancelReasons}
          onClose={() => setAction(null)}
          onApply={apply}
          onCollectPayment={() => collectPayment(action)}
        />
      )}

      {showNew && (
        <NewDeliverySheet
          onClose={() => setShowNew(false)}
          onCreated={async (sessionId, orderToken) => {
            setShowNew(false);
            await load();
            // Straight into the order screen: an address with no food is not an
            // order, and making staff find it again is how it gets forgotten.
            // The token rides along so the order header identifies the order.
            router.push({
              pathname: '/(staff)/order-menu',
              params: { sessionId, channel: 'DELIVERY', pickupToken: orderToken ?? '' },
            });
          }}
          onError={setError}
        />
      )}
    </>,
  );
}

function Header({ onBack, onRefresh }: { onBack: () => void; onRefresh: () => void }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="arrow-back" size={22} color={QuinckleColors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.topBarTitle}>Delivery</Text>
      <TouchableOpacity onPress={onRefresh} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="refresh" size={20} color={QuinckleColors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

function DeliveryCard({ order, onPress }: { order: DeliveryOrder; onPress: () => void }) {
  const meta = STATUS_META[order.status];
  const owed = cashStillOut(order);
  // Only while the bag is still in the building — after dispatch this would be
  // reporting on food that is already at somebody's door.
  const prep = order.status === 'NEW' ? prepOf(order) : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardTop}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Text style={styles.token}>{order.order_token ?? order.session_ref ?? '—'}</Text>
          <View style={[styles.pill, { backgroundColor: meta.soft, borderColor: meta.border }]}>
            <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>
        <Text style={styles.time}>{timeAgo(order.created_at)}</Text>
      </View>

      <Text style={styles.recipient}>{order.recipient_name}</Text>
      <Text style={styles.address} numberOfLines={2}>{oneLineAddress(order)}</Text>

      {order.delivery_note ? (
        <View style={styles.noteRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={12} color={QuinckleColors.textTertiary} />
          <Text style={styles.note} numberOfLines={1}>{order.delivery_note}</Text>
        </View>
      ) : null}

      <View style={styles.cardBottom}>
        <Text style={styles.total}>{money(order.final_total)}</Text>
        {prep && <PrepChip prep={prep} />}
        {order.assigned_staff && (
          <View style={styles.riderChip}>
            <Ionicons name="person-outline" size={11} color={QuinckleColors.textSecondary} />
            <Text style={styles.riderChipText}>{order.assigned_staff.name}</Text>
          </View>
        )}
        {owed && (
          <View style={[styles.pill, { backgroundColor: QuinckleColors.warningSoft, borderColor: QuinckleColors.warningBorder }]}>
            <Text style={[styles.pillText, { color: QuinckleColors.warning }]}>{money(order.cod_amount)} with rider</Text>
          </View>
        )}
        {/* Unpaid is the thing that blocks "Completed", so it belongs on the
            card rather than being discovered inside the sheet. */}
        {isLive(order) && (
          <View style={[
            styles.pill,
            isPaid(order)
              ? { backgroundColor: QuinckleColors.successSoft, borderColor: QuinckleColors.successBorder }
              : { backgroundColor: QuinckleColors.surfaceMuted, borderColor: QuinckleColors.border },
          ]}>
            <Text style={[styles.pillText, { color: isPaid(order) ? QuinckleColors.success : QuinckleColors.textSecondary }]}>
              {isPaid(order) ? 'Paid' : 'Unpaid'}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

/**
 * One rider's float. The button settles the WHOLE bundle — that is the event
 * that actually happens at the counter.
 */
function RiderFloatCard({
  float, busy, onSettle, onOpenOrder,
}: {
  float: RiderFloat;
  busy: boolean;
  onSettle: () => void;
  onOpenOrder: (o: DeliveryOrder) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Ionicons name="person-circle-outline" size={20} color={QuinckleColors.textSecondary} />
          <Text style={styles.token}>{float.name}</Text>
        </View>
        <Text style={[styles.total, { color: QuinckleColors.warning }]}>{money(float.amount)}</Text>
      </View>

      {float.orders.map((o) => (
        <TouchableOpacity key={o.id} style={styles.floatRow} onPress={() => onOpenOrder(o)} activeOpacity={0.7}>
          <Text style={styles.floatRowText} numberOfLines={1}>
            {o.order_token ?? o.session_ref ?? '—'} · {o.recipient_name}
          </Text>
          <Text style={styles.floatRowAmount}>{money(o.cod_amount)}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        style={[styles.actionBtn, styles.actionBtnPrimary, { marginTop: Spacing.md }, busy && { opacity: 0.6 }]}
        onPress={onSettle}
        disabled={busy}
        activeOpacity={0.85}
      >
        {busy ? <ActivityIndicator color="#fff" /> : (
          <>
            <Ionicons name="cash-outline" size={17} color="#fff" />
            <Text style={[styles.actionText, { color: '#fff' }]}>
              Received {money(float.amount)} from {float.name.split(' ')[0]}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

/**
 * The moves offered for a delivery.
 *
 * Mirrors the backend state machine but is NOT the authority on it — every
 * button here still round-trips and can be refused. Anything the backend
 * rejects surfaces as an error rather than being silently swallowed.
 */
function ActionSheet({
  order, riders, failureReasons, cancelReasons, onClose, onApply, onCollectPayment,
}: {
  order: DeliveryOrder;
  riders: DeliveryRider[];
  failureReasons: DeliveryFailureReasonOption[];
  cancelReasons: DeliveryCancelReasonOption[];
  onClose: () => void;
  onApply: (fn: () => Promise<unknown>) => Promise<void>;
  onCollectPayment: () => void;
}) {
  const [mode, setMode] = useState<'actions' | 'dispatch' | 'failed' | 'cancel'>('actions');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await onApply(fn);
    setBusy(false);
  };

  const owed = cashStillOut(order);
  const paid = isPaid(order);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.sheetGrip} />

          <Text style={styles.sheetTitle}>{order.recipient_name}</Text>
          <Text style={styles.sheetSub}>{oneLineAddress(order)}</Text>

          <View style={styles.quickRow}>
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => Linking.openURL(`tel:${order.recipient_phone}`)}
            >
              <Ionicons name="call-outline" size={16} color={QuinckleColors.textPrimary} />
              <Text style={styles.quickText}>Call</Text>
            </TouchableOpacity>
            {/* Deep link to the real Maps app — see directionsUrl in ./shared. */}
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => Linking.openURL(directionsUrl(order))}
            >
              <Ionicons name="navigate-outline" size={16} color={QuinckleColors.textPrimary} />
              <Text style={styles.quickText}>Directions</Text>
            </TouchableOpacity>
          </View>

          {busy && <ActivityIndicator color={QuinckleColors.primary} style={{ marginVertical: Spacing.md }} />}

          {/* ── Hand the bag to a rider ── */}
          {mode === 'dispatch' && (
            <ScrollView style={{ maxHeight: 280 }}>
              <Text style={styles.hint}>Who is taking it? Naming the rider sends the order out.</Text>
              {riders.length === 0 ? (
                <Text style={styles.hint}>
                  Nobody has the Delivery permission yet. An owner grants it on the staff screen.
                </Text>
              ) : riders.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.rowBtn}
                  onPress={() => run(() => crewDelivery.setStatus(order.id, 'OUT', { assignedStaffId: r.id }))}
                >
                  <Ionicons name="person-circle-outline" size={20} color={QuinckleColors.textSecondary} />
                  <Text style={styles.rowBtnText}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* ── Why it failed ── */}
          {mode === 'failed' && (
            <View>
              <Text style={styles.hint}>What happened? The food and the money are both gone, so this needs a reason.</Text>
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
          )}

          {/* ── Why it was cancelled ── */}
          {mode === 'cancel' && (
            <View>
              <Text style={styles.hint}>
                Why is it being cancelled? This lands in the discarded-orders ledger with your name and the time.
              </Text>
              {cancelReasons.map((r) => (
                <TouchableOpacity
                  key={r.code}
                  style={styles.rowBtn}
                  onPress={() => run(() => crewDelivery.setStatus(order.id, 'CANCELLED', { cancelReason: r.code }))}
                >
                  <Ionicons name="close-circle-outline" size={18} color={QuinckleColors.textSecondary} />
                  <Text style={styles.rowBtnText}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── The lifecycle buttons ── */}
          {mode === 'actions' && (
            <View style={{ gap: Spacing.sm }}>
              {order.status === 'NEW' && (
                <>
                  <Action label="Dispatch — pick a rider" icon="bicycle-outline" onPress={() => setMode('dispatch')} />
                  <Action label="Cancel order" icon="trash-outline" danger subtle onPress={() => setMode('cancel')} />
                </>
              )}

              {order.status === 'OUT' && (
                <>
                  {/* Money at the door goes through the normal payment sheet —
                      cash, UPI, split or khata — so the sale lands in the same
                      ledger as every other bill instead of as a typed number. */}
                  {!paid && (
                    <Action label="Collect payment" icon="card-outline" onPress={onCollectPayment} />
                  )}
                  <Action
                    label="Completed"
                    icon="checkmark-done-outline"
                    disabled={!paid}
                    hint={!paid ? 'Collect the payment first' : undefined}
                    onPress={() => run(() => crewDelivery.setStatus(order.id, 'DELIVERED'))}
                  />
                  <Action label="Couldn't deliver" icon="close-circle-outline" danger onPress={() => setMode('failed')} />
                </>
              )}

              {owed && (
                <Action
                  label={`Received ${money(order.cod_amount)} from ${order.assigned_staff?.name ?? 'the rider'}`}
                  icon="cash-outline"
                  onPress={() => run(() => crewDelivery.settleCod(order.id))}
                />
              )}

              {!isLive(order) && !owed && (
                <Text style={styles.hint}>
                  {order.status === 'FAILED' && order.failure_reason
                    ? `This delivery failed: ${order.failure_reason.toLowerCase().replace(/_/g, ' ')}.`
                    : 'This delivery is closed.'}
                </Text>
              )}
            </View>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={mode === 'actions' ? onClose : () => setMode('actions')}>
            <Text style={styles.closeText}>{mode === 'actions' ? 'Close' : 'Back'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Action({
  label, icon, onPress, danger, subtle, disabled, hint,
}: {
  label: string; icon: any; onPress: () => void;
  danger?: boolean; subtle?: boolean; disabled?: boolean; hint?: string;
}) {
  const color = danger ? QuinckleColors.danger : subtle ? QuinckleColors.textSecondary : QuinckleColors.textPrimary;
  return (
    <View>
      <TouchableOpacity
        style={[
          styles.actionBtn,
          !subtle && !danger && styles.actionBtnPrimary,
          danger && styles.actionBtnDanger,
          disabled && styles.actionBtnDisabled,
        ]}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <Ionicons name={icon} size={17} color={danger ? QuinckleColors.danger : subtle ? color : '#fff'} />
        <Text style={[styles.actionText, { color: danger ? QuinckleColors.danger : subtle ? color : '#fff' }]}>{label}</Text>
      </TouchableOpacity>
      {!!hint && <Text style={styles.actionHint}>{hint}</Text>}
    </View>
  );
}

/**
 * Take a delivery order over the phone.
 *
 * Only the four fields that make an address deliverable are required: who,
 * their number, the flat/house, and the street. Everything else is optional —
 * at 8:30pm on a Saturday a form with ten required boxes just doesn't get used.
 * There is no map here on purpose (the crew app has no maps dependency), so
 * coordinates stay empty and distance-based fees aren't offered.
 */
function NewDeliverySheet({
  onClose, onCreated, onError,
}: { onClose: () => void; onCreated: (sessionId: string, orderToken: string | null) => void; onError: (m: string) => void }) {
  const insets = useSafeAreaInsets();
  const [f, setF] = useState({
    recipientName: '', recipientPhone: '', houseNo: '', addressLine: '', landmark: '', deliveryNote: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const phoneOk = /^[6-9]\d{9}$/.test(f.recipientPhone.trim());
  const ready = f.recipientName.trim() && phoneOk && f.houseNo.trim() && f.addressLine.trim();

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const res = await crewDelivery.create({
        recipientName: f.recipientName.trim(),
        recipientPhone: f.recipientPhone.trim(),
        houseNo: f.houseNo.trim(),
        addressLine: f.addressLine.trim(),
        landmark: f.landmark.trim() || undefined,
        deliveryNote: f.deliveryNote.trim() || undefined,
      });
      onCreated(res.data.session_id, res.data.order_token);
    } catch (e: any) {
      onError(e?.message ?? 'Could not create the order');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.sheetGrip} />
            <Text style={styles.sheetTitle}>Phone order</Text>

            <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
              <Field label="Name" value={f.recipientName} onChange={set('recipientName')} placeholder="Who is it for" />
              <Field
                label="Phone" value={f.recipientPhone} onChange={set('recipientPhone')}
                placeholder="10-digit mobile" keyboardType="phone-pad"
                error={f.recipientPhone.length > 0 && !phoneOk ? 'Enter a valid 10-digit mobile' : undefined}
              />
              <Field label="Flat / house no." value={f.houseNo} onChange={set('houseNo')} placeholder="Gets the rider to the door" />
              <Field label="Street / area" value={f.addressLine} onChange={set('addressLine')} placeholder="Road, area" />
              <Field label="Landmark" value={f.landmark} onChange={set('landmark')} placeholder="Optional, but riders rely on it" />
              <Field label="Note" value={f.deliveryNote} onChange={set('deliveryNote')} placeholder="Ring twice, gate code…" />
            </ScrollView>

            <TouchableOpacity
              style={[styles.primaryBtn, !ready && styles.primaryBtnDisabled]}
              onPress={submit}
              disabled={!ready || busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create & add items</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label, value, onChange, placeholder, keyboardType, error,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: 'phone-pad' | 'numeric'; error?: string;
}) {
  return (
    <View style={{ marginBottom: Spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, !!error && { borderColor: QuinckleColors.dangerBorder }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={QuinckleColors.textMuted}
        keyboardType={keyboardType}
      />
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // Standalone owns its side padding; embedded, the dashboard already applies
  // the same Spacing.lg and a second one would step the whole tab inwards.
  container: { flex: 1, backgroundColor: QuinckleColors.background, paddingHorizontal: Spacing.lg },
  embedded: { paddingHorizontal: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: Spacing.md,
  },
  topBarTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },

  segmentWrap: { marginBottom: Spacing.md },

  controlsRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  cashStrip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    height: 40, paddingHorizontal: Spacing.md,
    backgroundColor: QuinckleColors.surfaceMuted, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  cashStripWarn: { backgroundColor: QuinckleColors.warningSoft, borderColor: QuinckleColors.warningBorder },
  cashStripText: { ...Typography.caption, color: QuinckleColors.textSecondary, flex: 1 },
  cashStripTextWarn: { color: QuinckleColors.warning, fontWeight: '700' },
  iconBtn: {
    width: 40, height: 40, borderRadius: Radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  addBtn: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.primary,
  },

  errorBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginBottom: Spacing.sm, padding: Spacing.md,
    backgroundColor: QuinckleColors.dangerSoft, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.dangerBorder,
  },
  errorText: { ...Typography.caption, color: QuinckleColors.danger, flex: 1 },

  card: {
    backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border, padding: Spacing.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  token: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  time: { ...Typography.micro, color: QuinckleColors.textTertiary },
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.pill, borderWidth: 1 },
  pillText: { ...Typography.micro, fontWeight: '700' },
  recipient: { ...Typography.body, color: QuinckleColors.textPrimary },
  address: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: 2 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.sm },
  note: { ...Typography.micro, color: QuinckleColors.textTertiary, flex: 1 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, flexWrap: 'wrap' },
  total: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  riderChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderRadius: Radius.pill, backgroundColor: QuinckleColors.surfaceMuted,
  },
  riderChipText: { ...Typography.micro, color: QuinckleColors.textSecondary },

  // Same medallion + two lines of copy as every other empty tab on the
  // dashboard, so an empty Delivery tab doesn't read as a different app.
  emptyMedallion: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  emptyTitle: { ...Typography.subtitle, color: QuinckleColors.textSecondary, marginTop: Spacing.md },
  emptyBody: { ...Typography.caption, color: QuinckleColors.textTertiary, textAlign: 'center', marginTop: Spacing.xs },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: QuinckleColors.surfaceElevated,
    borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl,
    padding: Spacing.lg, paddingBottom: Spacing.xl,
  },
  sheetGrip: {
    width: 36, height: 4, borderRadius: 2, alignSelf: 'center',
    backgroundColor: QuinckleColors.borderStrong, marginBottom: Spacing.md,
  },
  sheetTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  sheetSub: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: 2, marginBottom: Spacing.md },

  quickRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: QuinckleColors.surfaceMuted, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  quickText: { ...Typography.caption, color: QuinckleColors.textPrimary },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.md, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted, borderWidth: 1, borderColor: QuinckleColors.border,
  },
  actionBtnPrimary: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
  actionBtnDanger: { backgroundColor: QuinckleColors.dangerSoft, borderColor: QuinckleColors.dangerBorder },
  actionBtnDisabled: { opacity: 0.4 },
  actionText: { ...Typography.bodyStrong },
  actionHint: { ...Typography.micro, color: QuinckleColors.textTertiary, textAlign: 'center', marginTop: Spacing.xs },

  // One line per drop inside a rider's float card.
  floatRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: QuinckleColors.borderSubtle,
  },
  floatRowText: { ...Typography.caption, color: QuinckleColors.textSecondary, flex: 1 },
  floatRowAmount: { ...Typography.caption, color: QuinckleColors.textPrimary, fontWeight: '700' },

  rowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: QuinckleColors.borderSubtle,
  },
  rowBtnText: { ...Typography.body, color: QuinckleColors.textPrimary },

  primaryBtn: {
    marginTop: Spacing.md, paddingVertical: Spacing.md, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primary, alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { ...Typography.bodyStrong, color: '#fff' },

  closeBtn: { marginTop: Spacing.md, alignItems: 'center', paddingVertical: Spacing.sm },
  closeText: { ...Typography.body, color: QuinckleColors.textSecondary },

  hint: { ...Typography.caption, color: QuinckleColors.textSecondary, marginBottom: Spacing.md },
  footnote: { ...Typography.micro, color: QuinckleColors.textTertiary, marginTop: Spacing.sm, textAlign: 'center' },

  fieldLabel: { ...Typography.label, color: QuinckleColors.textTertiary, marginBottom: Spacing.xs },
  fieldError: { ...Typography.micro, color: QuinckleColors.danger, marginTop: Spacing.xs },
  input: {
    backgroundColor: QuinckleColors.surfaceMuted, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    color: QuinckleColors.textPrimary, ...Typography.body,
  },
});
