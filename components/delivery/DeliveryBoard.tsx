/**
 * Delivery board — DELIVERY_PANEL_PLAN.md §6, Phase 1.
 *
 * Counter staff drive every transition from here: accept, pack, hand to a
 * rider, send out, close as delivered or failed, then take the cash back off
 * the rider. There is deliberately no rider app yet, so this board alone has
 * to be enough to run delivery end to end.
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
} from '../../services/api';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';
import { PickupSegmented } from '../ui/pickup';

// ── Presentation for each lifecycle state ────────────────────────────────────
const STATUS_META: Record<DeliveryStatus, { label: string; color: string; soft: string; border: string }> = {
  PENDING:          { label: 'New',        color: QuinckleColors.warning, soft: QuinckleColors.warningSoft, border: QuinckleColors.warningBorder },
  ACCEPTED:         { label: 'Preparing',  color: QuinckleColors.info,    soft: QuinckleColors.infoSoft,    border: QuinckleColors.infoBorder },
  READY:            { label: 'Packed',     color: QuinckleColors.primary, soft: QuinckleColors.primarySoft, border: QuinckleColors.primarySoftBorder },
  ASSIGNED:         { label: 'Rider set',  color: QuinckleColors.primary, soft: QuinckleColors.primarySoft, border: QuinckleColors.primarySoftBorder },
  OUT_FOR_DELIVERY: { label: 'On the way', color: QuinckleColors.info,    soft: QuinckleColors.infoSoft,    border: QuinckleColors.infoBorder },
  DELIVERED:        { label: 'Delivered',  color: QuinckleColors.success, soft: QuinckleColors.successSoft, border: QuinckleColors.successBorder },
  FAILED:           { label: 'Failed',     color: QuinckleColors.danger,  soft: QuinckleColors.dangerSoft,  border: QuinckleColors.dangerBorder },
  CANCELLED:        { label: 'Cancelled',  color: QuinckleColors.textTertiary, soft: QuinckleColors.surfaceMuted, border: QuinckleColors.border },
};

const OPEN_STATUSES: DeliveryStatus[] = ['PENDING', 'ACCEPTED', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY'];

/** Prepaid orders must not ask for cash at the door. */
const PAID_STATUSES = ['PAID_CASH', 'PAID_UPI_DIRECT', 'PAID_ONLINE', 'PAID_MIXED', 'WAIVED'];
const isPrepaid = (d: DeliveryOrder) => !!d.payment_status && PAID_STATUSES.includes(d.payment_status);

const money = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

const oneLineAddress = (d: DeliveryOrder) =>
  [d.address.house_no, d.address.line, d.address.landmark].filter(Boolean).join(', ');

type BoardTab = 'ACTIVE' | 'MINE' | 'DONE';

/** Delivered, but the rider still has the money — the venue is not done with it. */
const cashStillOut = (o: DeliveryOrder) =>
  o.status === 'DELIVERED' && !!o.cod_amount && !o.cod_settled_at;

/**
 * "Active" means somebody still has to do something: every open status, plus a
 * delivered order whose cash has not come back to the counter. The board used
 * to say "3 to collect" while the Active list showed none of them.
 */
const isActive = (o: DeliveryOrder) => OPEN_STATUSES.includes(o.status) || cashStillOut(o);

/** Run order for the Active list — the newest ticket is not the most urgent. */
const STAGE: Record<DeliveryStatus, number> = {
  PENDING: 0, ACCEPTED: 1, READY: 2, ASSIGNED: 3, OUT_FOR_DELIVERY: 4,
  DELIVERED: 5, FAILED: 6, CANCELLED: 7,
};

const at = (o: DeliveryOrder) => new Date(o.created_at ?? 0).getTime();
const byRun = (a: DeliveryOrder, b: DeliveryOrder) => STAGE[a.status] - STAGE[b.status] || at(a) - at(b);
const byNewest = (a: DeliveryOrder, b: DeliveryOrder) => at(b) - at(a);

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
  const { staffInfo } = useAuth();
  const myStaffId = staffInfo?.id ?? null;

  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [riders, setRiders] = useState<DeliveryRider[]>([]);
  const [failureReasons, setFailureReasons] = useState<DeliveryFailureReasonOption[]>([]);
  const [riderFloat, setRiderFloat] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 'MINE' is the rider view (§Phase 3): the same board scoped to the orders
  // this staffer is actually carrying. A separate screen would duplicate every
  // lifecycle action for no behavioural difference.
  const [tab, setTab] = useState<BoardTab>('ACTIVE');

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
      setRiderFloat(float.data.total);
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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const { active, mine, done } = useMemo(() => ({
    active: orders.filter(isActive).sort(byRun),
    mine: orders.filter((o) => o.assigned_staff?.id === myStaffId && isActive(o)).sort(byRun),
    done: orders.filter((o) => !isActive(o)).sort(byNewest),
  }), [orders, myStaffId]);

  const visible = tab === 'MINE' ? mine : tab === 'DONE' ? done : active;
  const isRiderView = tab === 'MINE';

  // What THIS rider owes the counter, as opposed to the venue-wide float.
  const myFloat = useMemo(
    () => mine.filter(cashStillOut).reduce((sum, o) => sum + Number(o.cod_amount ?? 0), 0),
    [mine],
  );
  const cashOut = isRiderView ? myFloat : riderFloat;
  const toCollect = (isRiderView ? mine : orders).filter(cashStillOut).length;

  const apply = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      setAction(null);
    } catch (e: any) {
      setError(e?.message ?? 'That did not work');
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

  return frame(
    <>
      {/* Same segmented control as the Orders and Takeaway tabs — this is one
          more channel on the dashboard, not a screen of its own. */}
      <View style={styles.segmentWrap}>
        <PickupSegmented
          items={[
            { key: 'ACTIVE', label: 'Active', count: active.length },
            { key: 'MINE', label: 'Mine', count: mine.length },
            { key: 'DONE', label: 'Done', count: done.length },
          ]}
          active={tab}
          onChange={(key) => setTab(key as BoardTab)}
        />
      </View>

      <View style={styles.controlsRow}>
        {/* Cash with riders is the number that matters at 11pm — it is money the
            venue has earned that is not in the drawer. */}
        <View style={[styles.cashStrip, cashOut > 0 && styles.cashStripWarn]}>
          <Ionicons
            name="cash-outline"
            size={15}
            color={cashOut > 0 ? QuinckleColors.warning : QuinckleColors.textTertiary}
          />
          <Text
            style={[styles.cashStripText, cashOut > 0 && styles.cashStripTextWarn]}
            numberOfLines={1}
          >
            {money(cashOut)} {isRiderView ? 'on you' : 'with riders'}
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

      <FlatList
        data={visible}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{
          flexGrow: 1,
          gap: Spacing.md,
          // Embedded, the bottom navbar floats over the list; standalone, only
          // the home indicator does.
          paddingBottom: embedded ? 100 : insets.bottom + Spacing.xl,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={QuinckleColors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={styles.emptyMedallion}>
              <Ionicons
                name={tab === 'DONE' ? 'time-outline' : 'bicycle-outline'}
                size={28}
                color={QuinckleColors.textTertiary}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {tab === 'MINE' ? 'Nothing on you' : tab === 'DONE' ? 'Nothing closed yet' : 'No live deliveries'}
            </Text>
            <Text style={styles.emptyBody}>
              {tab === 'MINE'
                ? 'Orders assigned to you — and any cash you still hold — show up here.'
                : tab === 'DONE'
                  ? 'Delivered, failed and cancelled orders land here.'
                  : 'New delivery orders show up here the moment they are placed.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => <DeliveryCard order={item} onPress={() => setAction(item)} />}
      />

      {action && (
        <ActionSheet
          order={action}
          riders={riders}
          failureReasons={failureReasons}
          onClose={() => setAction(null)}
          onApply={apply}
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
  const owesCash = order.status === 'DELIVERED' && !!order.cod_amount && !order.cod_settled_at;

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
        {order.assigned_staff && (
          <View style={styles.riderChip}>
            <Ionicons name="person-outline" size={11} color={QuinckleColors.textSecondary} />
            <Text style={styles.riderChipText}>{order.assigned_staff.name}</Text>
          </View>
        )}
        {owesCash && (
          <View style={[styles.pill, { backgroundColor: QuinckleColors.warningSoft, borderColor: QuinckleColors.warningBorder }]}>
            <Text style={[styles.pillText, { color: QuinckleColors.warning }]}>{money(order.cod_amount)} with rider</Text>
          </View>
        )}
        {isPrepaid(order) && order.status !== 'DELIVERED' && (
          <View style={[styles.pill, { backgroundColor: QuinckleColors.successSoft, borderColor: QuinckleColors.successBorder }]}>
            <Text style={[styles.pillText, { color: QuinckleColors.success }]}>Prepaid</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
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
  order, riders, failureReasons, onClose, onApply,
}: {
  order: DeliveryOrder;
  riders: DeliveryRider[];
  failureReasons: DeliveryFailureReasonOption[];
  onClose: () => void;
  onApply: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [mode, setMode] = useState<'actions' | 'rider' | 'cash' | 'failed'>('actions');
  const [cash, setCash] = useState(String(order.final_total ?? 0));
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await onApply(fn);
    setBusy(false);
  };

  const owesCash = order.status === 'DELIVERED' && !!order.cod_amount && !order.cod_settled_at;
  const canCancel = ['PENDING', 'ACCEPTED', 'READY', 'ASSIGNED'].includes(order.status);

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
            {/* Deep link to the real Maps app — live traffic, voice nav and
                offline maps for free, and it ships OTA because there is no
                native map dependency. Coordinates when the diner dropped a pin
                (exact), otherwise the typed address a phone order carries. */}
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => {
                const { latitude, longitude } = order.address;
                const dest = latitude != null && longitude != null
                  ? `${latitude},${longitude}`
                  : encodeURIComponent(oneLineAddress(order));
                Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${dest}`);
              }}
            >
              <Ionicons name="navigate-outline" size={16} color={QuinckleColors.textPrimary} />
              <Text style={styles.quickText}>Directions</Text>
            </TouchableOpacity>
          </View>

          {busy && <ActivityIndicator color={QuinckleColors.primary} style={{ marginVertical: Spacing.md }} />}

          {/* ── Pick a rider ── */}
          {mode === 'rider' && (
            <ScrollView style={{ maxHeight: 280 }}>
              {riders.length === 0 ? (
                <Text style={styles.hint}>
                  Nobody has the Delivery permission yet. An owner grants it on the staff screen.
                </Text>
              ) : riders.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.rowBtn}
                  onPress={() => run(() => crewDelivery.setStatus(order.id, 'ASSIGNED', { assignedStaffId: r.id }))}
                >
                  <Ionicons name="person-circle-outline" size={20} color={QuinckleColors.textSecondary} />
                  <Text style={styles.rowBtnText}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* ── How much cash came back ── */}
          {mode === 'cash' && (
            <View>
              <Text style={styles.hint}>How much did the rider collect at the door?</Text>
              <TextInput
                style={styles.input}
                value={cash}
                onChangeText={setCash}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={QuinckleColors.textMuted}
              />
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => run(() => crewDelivery.setStatus(order.id, 'DELIVERED', { collectedCash: Number(cash) || 0 }))}
              >
                <Text style={styles.primaryBtnText}>Mark delivered</Text>
              </TouchableOpacity>
              <Text style={styles.footnote}>
                This cash stays counted against the rider until they hand it over at the counter.
              </Text>
            </View>
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

          {/* ── The lifecycle buttons ── */}
          {mode === 'actions' && (
            <View style={{ gap: Spacing.sm }}>
              {order.status === 'PENDING' && (
                <Action label="Accept order" icon="checkmark-circle-outline"
                  onPress={() => run(() => crewDelivery.setStatus(order.id, 'ACCEPTED'))} />
              )}
              {order.status === 'ACCEPTED' && (
                <Action label="Packed & ready" icon="bag-check-outline"
                  onPress={() => run(() => crewDelivery.setStatus(order.id, 'READY'))} />
              )}
              {order.status === 'READY' && (
                <Action label="Assign a rider" icon="person-add-outline" onPress={() => setMode('rider')} />
              )}
              {order.status === 'ASSIGNED' && (
                <>
                  <Action label="Send out" icon="bicycle-outline"
                    onPress={() => run(() => crewDelivery.setStatus(order.id, 'OUT_FOR_DELIVERY'))} />
                  <Action label="Change rider" icon="swap-horizontal-outline" subtle onPress={() => setMode('rider')} />
                  <Action label="Take rider off" icon="person-remove-outline" subtle
                    onPress={() => run(() => crewDelivery.setStatus(order.id, 'READY'))} />
                </>
              )}
              {order.status === 'OUT_FOR_DELIVERY' && (
                <>
                  <Action
                    label="Delivered"
                    icon="checkmark-done-outline"
                    onPress={() =>
                      // A prepaid order takes no cash at the door, so skip the prompt.
                      isPrepaid(order)
                        ? run(() => crewDelivery.setStatus(order.id, 'DELIVERED'))
                        : setMode('cash')
                    }
                  />
                  <Action label="Couldn't deliver" icon="close-circle-outline" danger onPress={() => setMode('failed')} />
                </>
              )}
              {owesCash && (
                <Action
                  label={`Collect ${money(order.cod_amount)} from rider`}
                  icon="cash-outline"
                  onPress={() => run(() => crewDelivery.settleCod(order.id))}
                />
              )}
              {canCancel && (
                <Action label="Cancel order" icon="trash-outline" danger subtle
                  onPress={() => run(() => crewDelivery.setStatus(order.id, 'CANCELLED'))} />
              )}
              {['DELIVERED', 'FAILED', 'CANCELLED'].includes(order.status) && !owesCash && (
                <Text style={styles.hint}>This delivery is closed.</Text>
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
  label, icon, onPress, danger, subtle,
}: { label: string; icon: any; onPress: () => void; danger?: boolean; subtle?: boolean }) {
  const color = danger ? QuinckleColors.danger : subtle ? QuinckleColors.textSecondary : QuinckleColors.textPrimary;
  return (
    <TouchableOpacity
      style={[styles.actionBtn, !subtle && !danger && styles.actionBtnPrimary, danger && styles.actionBtnDanger]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name={icon} size={17} color={danger ? QuinckleColors.danger : subtle ? color : '#fff'} />
      <Text style={[styles.actionText, { color: danger ? QuinckleColors.danger : subtle ? color : '#fff' }]}>{label}</Text>
    </TouchableOpacity>
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
  emptyWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.huge, paddingHorizontal: Spacing.lg,
  },
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
  actionText: { ...Typography.bodyStrong },

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
