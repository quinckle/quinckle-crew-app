import { API_BASE_URL } from '../constants/env';

let _crewToken: string | null = null;
let _on401: (() => void) | null = null;

export function setCrewToken(token: string | null) { _crewToken = token; }
export function getCrewToken() { return _crewToken; }
export function setOn401Callback(cb: () => void) { _on401 = cb; }

// ── Types ──────────────────────────────────────────────────────────────────────

export type StaffRole = 'STEWARD' | 'CHEF' | 'ADMIN' | 'CASHIER';

export interface StaffInfo {
  id: string;
  name: string;
  phone?: string;
  role: StaffRole;
  restaurantId: string;
  restaurantName: string;
  photoUrl?: string | null;
}

interface RawVerifyOtpResponse {
  success: boolean;
  data: {
    token: string;
    user: { id: string; name: string; phone: string; role: StaffRole; restaurant_id: string; restaurant_name: string; photo_url: string | null };
  };
}

interface RawCrewBypassResponse {
  accessToken: string;
  user: { id: string; name: string; role: StaffRole; restaurant_id: string; restaurant_name: string };
}

// ── HTTP client ───────────────────────────────────────────────────────────────

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: object,
  useAuth = false,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (useAuth && _crewToken) headers['Authorization'] = `Bearer ${_crewToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Guard against non-JSON responses (e.g. Render.com cold-start splash / 502
  // HTML page). res.json() would otherwise throw a cryptic
  // "JSON Parse error: Unexpected character: <" and skip the status handling.
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Server is warming up — please try again in a moment.');
  }

  const json = await res.json().catch(() => {
    throw new Error('Server is warming up — please try again in a moment.');
  });

  if (res.status === 401) {
    // Only auto-logout on 401 for authenticated requests (expired crew token).
    // For unauthenticated requests (OTP verify etc.), the 401 means wrong code — show the error.
    if (useAuth) {
      _on401?.();
      throw new Error('SESSION_EXPIRED');
    }
    const msg = json.error ?? json.message ?? 'Invalid OTP';
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  if (!res.ok) {
    const msg = json.message ?? json.error?.message ?? json.error ?? `API error ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) as Error & { code?: string };
    err.code = json.code ?? undefined;
    throw err;
  }
  return json as T;
}

// ── Crew Auth ─────────────────────────────────────────────────────────────────

export const crewAuth = {
  sendOtp: (phone: string) =>
    request<{ message: string; expiresIn: number }>('POST', '/api/crew/auth/otp/request', { phone }),

  verifyOtp: async (phone: string, otp: string): Promise<{ crewToken: string; staff: StaffInfo }> => {
    const raw = await request<RawVerifyOtpResponse>('POST', '/api/crew/auth/otp/verify', { phone, otp });
    const d = raw.data;
    return {
      crewToken: d.token,
      staff: { id: d.user.id, name: d.user.name, phone: d.user.phone, role: d.user.role, restaurantId: d.user.restaurant_id, restaurantName: d.user.restaurant_name, photoUrl: d.user.photo_url },
    };
  },

  getProfile: () =>
    request<{ success: boolean; data: { id: string; name: string; phone: string; role: StaffRole; photoUrl: string | null; restaurantId: string; restaurantName: string; joinedAt: string } }>(
      'GET', '/api/crew/auth/profile', undefined, true
    ),

  // Upload a new profile photo. Pass raw base64 (no `data:` prefix needed —
  // server accepts either). Server resizes + WebP-encodes + uploads to R2 and
  // returns the permanent CDN URL.
  uploadPhoto: (photoBase64: string) =>
    request<{ success: boolean; data: { photoUrl: string } }>(
      'POST',
      '/api/crew/auth/profile/photo',
      { photoBase64 },
      true,
    ),

  // Legacy helper — direct URL update. Kept for any back-compat callers.
  updatePhoto: (photoUrl: string) =>
    request<{ success: boolean; data: { photoUrl: string } }>(
      'PATCH',
      '/api/crew/auth/profile/photo',
      { photoUrl },
      true,
    ),

  removePhoto: () =>
    request<{ success: boolean; data: { photoUrl: null } }>(
      'DELETE',
      '/api/crew/auth/profile/photo',
      undefined,
      true,
    ),
};

// ── Dev (development only) ────────────────────────────────────────────────────

export const devApi = {
  seed: () => request<{ message: string }>('POST', '/api/dev/seed'),

  getState: () =>
    request<{
      success: boolean;
      data: {
        restaurant: { id: string; name: string };
        staff: { id: string; name: string; role: StaffRole; phone: string; accessToken: string }[];
      };
    }>('GET', '/api/dev/state'),

  crewLoginBypass: async (phone: string): Promise<{ crewToken: string; staff: StaffInfo }> => {
    const raw = await request<RawCrewBypassResponse>('POST', '/api/dev/crew-login-bypass', { phone });
    return {
      crewToken: raw.accessToken,
      staff: { id: raw.user.id, name: raw.user.name, role: raw.user.role, restaurantId: raw.user.restaurant_id, restaurantName: raw.user.restaurant_name },
    };
  },
};

// ── Kitchen (CHEF) ────────────────────────────────────────────────────────────

export interface KitchenTicketItem { item_id: string; name: string; qty: number; note: string | null; modifiers_summary?: string | null; item_status: 'pending' | 'done'; }
export interface KitchenTicket { order_id: string; table_number: number; status: 'received' | 'preparing'; placed_at: string; items: KitchenTicketItem[]; }
export interface KitchenCompletedPage { tickets: KitchenTicket[]; page: number; limit: number; hasMore: boolean; }

export const kitchen = {
  getOrders: () => request<{ tickets: KitchenTicket[] }>('GET', '/api/kitchen/orders', undefined, true),
  // Recent completed tickets (READY/SERVED) — powers the cook "Completed" tab.
  getCompleted: (page = 1, limit = 30) =>
    request<KitchenCompletedPage>('GET', `/api/kitchen/orders/completed?page=${page}&limit=${limit}`, undefined, true),
  updateItemStatus: (orderId: string, itemId: string, status: 'done' | 'pending') =>
    request<unknown>('PATCH', `/api/kitchen/orders/${orderId}/items/${itemId}/status`, { item_status: status }, true),
  bumpOrder: (orderId: string) =>
    request<unknown>('PATCH', `/api/kitchen/orders/${orderId}/status`, {}, true),
  undoBump: (orderId: string) =>
    request<unknown>('POST', `/api/kitchen/orders/${orderId}/undo`, undefined, true),
};

// ── Crew Tables (STEWARD/ADMIN) ───────────────────────────────────────────────

export interface CrewTable { table_id: string; table_number: number; capacity: number; status: 'available' | 'occupied' | 'reserved' | 'offline'; session_id: string | null; occupied_since: string | null; expires_at?: string | null; customer_name?: string | null; customer_phone?: string | null; bill_subtotal?: number; bill_tax?: number; bill_total?: number; items_served?: number; items_total?: number; payment_settled?: boolean; }

export const crewTables = {
  list: () => request<{ tables: CrewTable[] }>('GET', '/api/crew/tables', undefined, true),
  updateStatus: (tableId: string, status: 'available' | 'reserved' | 'offline') =>
    request<unknown>('PATCH', `/api/crew/tables/${tableId}/status`, { status }, true),
  /**
   * Move the active session from one table to another. Mirrors the partner
   * endpoint — backend re-stamps order.tableNumber and fires session_moved
   * realtime on partner/waiter/dine channels.
   */
  transferSession: (fromTableId: string, targetTableId: string) =>
    request<{ success: true; data: { sessionId: string; fromTableNumber: number; toTableNumber: number; ordersMoved: number } }>(
      'POST',
      `/api/crew/tables/${fromTableId}/transfer-session`,
      { target_table_id: targetTableId },
      true,
    ),
  /**
   * Extend the active session's timer (15/30/45/60 min). Mirrors the partner
   * dashboard table modal. Returns the new expiresAt.
   */
  extendSession: (tableId: string, minutes: 15 | 30 | 45 | 60) =>
    request<{ success: true; data: { sessionId: string; tableNumber: number; expiresAt: string; extendedBy: number } }>(
      'PATCH',
      `/api/crew/tables/${tableId}/extend`,
      { minutes },
      true,
    ),
};

// ── Crew Menu (STEWARD/ADMIN) ─────────────────────────────────────────────────
export const crewMenu = {
  /**
   * Full menu for staff — INCLUDES unavailable items and unavailable modifier
   * options (each with isAvailable), so 86'd items can be re-enabled and
   * individual variants toggled. The public diner menu filters these out.
   */
  getMenu: () =>
    request<{ success: true; data: MenuCategory[] }>(
      'GET',
      `/api/crew/menu`,
      undefined,
      true,
    ),
  /**
   * Toggle item availability ("86" an item). Persists server-side and removes it
   * from the diner menu — same effect as the partner dashboard toggle.
   */
  setAvailability: (itemId: string, isAvailable: boolean) =>
    request<{ success: true; data: { id: string; isAvailable: boolean } }>(
      'PATCH',
      `/api/crew/menu/items/${itemId}/availability`,
      { isAvailable },
      true,
    ),
  /**
   * Toggle a single modifier option / variant ("86" one flavor) without taking
   * the whole item offline. Drops the option off the diner menu live.
   */
  setOptionAvailability: (optionId: string, isAvailable: boolean) =>
    request<{ success: true; data: { id: string; isAvailable: boolean } }>(
      'PATCH',
      `/api/crew/menu/options/${optionId}/availability`,
      { isAvailable },
      true,
    ),
};

// ── Crew Sessions (STEWARD/ADMIN) ─────────────────────────────────────────────

export interface BillOrderItem { item_id: string; name: string; qty: number; price: number; item_status: 'pending' | 'done' | 'cancelled'; served: boolean; modifiers_summary?: string | null; }
export interface BillOrder { order_id: string; placed_at: string; status: 'received' | 'preparing' | 'ready' | 'served'; items: BillOrderItem[]; order_total: number; }
/**
 * Canonical bill breakdown — same shape returned by /dine/cart/preview and
 * /checkout/staff-collect on the diner side. Always read from this object;
 * the flat fields (tax_total, total_payable, etc.) are aliases kept for
 * back-compat with older crew screens.
 */
export interface BillBreakdown {
  subtotal:     number;
  discount:     number;
  chargesTotal: number;
  taxRate:      number;
  taxAmount:    number;
  tip:          number;
  total:        number;
  currency:     'INR';
}

export interface CrewOrderPaymentContext {
  order_id: string;
  session_id: string;
  table_number: number;
  payment_status: string;
  subtotal: number;
  tax: number;
  service_charge: number;
  total: number;
  currency: 'INR';
}
export interface SessionBill {
  session_id: string;
  session_ref: string;
  table_number: number;
  status: 'active' | 'paid' | 'closed';
  started_at?: string;
  expires_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  orders: BillOrder[];
  session_total: number;
  tax_rate?: number;
  tax_total?: number;
  service_charge_total?: number;
  discount_total?: number;
  tip_total?: number;
  total_payable?: number;
  /** Canonical breakdown — render from this when present. */
  breakdown?: BillBreakdown;
  payment_method?: 'cash' | 'upi_direct' | 'mixed';
  splits?: Array<{ method: 'CASH' | 'UPI_DIRECT'; amount: number }>;
}

// ── Order Ledger (session history) ────────────────────────────────────────────
// Mirrors the partner Order Ledger. Returned by GET /api/crew/sessions/history
// via the shared backend buildSessionLedger service — identical shape on both.

export interface LedgerSessionItem {
  id: string;
  name: string;
  isVeg: boolean | null;
  qty: number;
  unitPrice: number;
  total: number;
  served?: boolean;
  itemStatus?: string | null;
  notes?: string | null;
  modifiersSummary?: string | null;
}

export interface LedgerOrder {
  id: string;
  shortId: string;
  status: string;
  paymentStatus?: string;
  createdAt: string;
  discount: number;
  tip: number;
  subtotal: number;
  paymentSummary?: {
    methods: string[];
    collectedBy: string | null;
    confirmedAt: string | null;
  };
  items: LedgerSessionItem[];
}

export type LedgerRange = 'today' | 'yesterday' | 'week' | 'month';

export interface LedgerSummary {
  totalSessions: number;
  totalRevenue: number;
  avgBill: number;
  avgDurationMins: number;
  quincklesCut: number;
  isFreePeriod: boolean;
  commissionRate: number;
  pgFeeRate: number;
  /** Revenue split by collected payment method (over all paid sessions in range). */
  paymentBreakdown?: { cash: number; upiDirect: number; gateway: number };
}

export interface LedgerSession {
  id: string;
  sessionRef?: string;
  shortId: string;
  tableNumber: number | null;
  status: string;
  statusView?: 'PAID' | 'OPEN' | 'CASH_PENDING' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  durationMins: number;
  customerName: string | null;
  customerPhone: string | null;
  orders: LedgerOrder[];
  foodSubtotal: number;
  totalDiscount: number;
  chargesGstTotal: number;
  totalTip: number;
  billTotal: number;
  grandTotal: number;
  balanceDue?: number;
  pgGatewayAmount?: number;
  quincklesCut: number;
  commissionRate?: number;
  paymentMethodsUsed?: string[];
  payment?: { method: string; amount: number; status: string; confirmedAt?: string | null } | null;
}

export interface LedgerResponse {
  summary: LedgerSummary;
  sessions: LedgerSession[];
  total: number;
  page: number;
  pages: number;
}

export const crewSessions = {
  start: (tableId: string) =>
    request<{ success: true; session_id: string; session_ref: string; table_id: string; table_number: number; started_at: string }>(
      'POST', '/api/crew/sessions', { table_id: tableId }, true
    ),
  end: (sessionId: string) =>
    request<unknown>('DELETE', `/api/crew/sessions/${sessionId}`, undefined, true),
  getBill: (sessionId: string) =>
    request<SessionBill>('GET', `/api/crew/sessions/${sessionId}/bill`, undefined, true),
  saveCustomer: (sessionId: string, phone: string, name?: string | null) =>
    request<{ success: boolean }>(
      'PATCH', `/api/crew/sessions/${sessionId}/customer`, { phone, name: name ?? null }, true
    ),

  requestCollection: (sessionId: string, customerPhone?: string | null, customerName?: string | null) =>
    request<{ success: boolean; data: { orderIds: string[]; totalAmount: number; sessionId: string; method: 'STAFF_COLLECT'; alreadyInCollection?: boolean } }>(
      'POST',
      `/api/crew/sessions/${sessionId}/request-collection`,
      { customerPhone: customerPhone ?? null, customerName: customerName ?? null },
      true,
    ),

  /** Crew custom discount across the session's unpaid orders. value=0 clears it. */
  applyDiscount: (sessionId: string, type: 'PERCENT' | 'FLAT', value: number, note?: string | null) =>
    request<{ success: boolean; data: { sessionId: string; tableNumber: number; manualDiscountTotal: number; sessionTotal: number } }>(
      'POST',
      `/api/crew/sessions/${sessionId}/discount`,
      { type, value, note: note ?? null },
      true,
    ),

  /** Order Ledger — paginated session history with filters (STEWARD/ADMIN). */
  getHistory: async (params: {
    range?: LedgerRange;
    from?: string;
    to?: string;
    fromTime?: string;
    toTime?: string;
    sessionRef?: string;
    status?: string;
    method?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<LedgerResponse> => {
    const parts: string[] = [];
    if (params.range)                              parts.push(`range=${params.range}`);
    if (params.from)                               parts.push(`from=${params.from}`);
    if (params.to)                                 parts.push(`to=${params.to}`);
    if (params.fromTime)                           parts.push(`fromTime=${params.fromTime}`);
    if (params.toTime)                             parts.push(`toTime=${params.toTime}`);
    if (params.sessionRef)                         parts.push(`sessionRef=${encodeURIComponent(params.sessionRef)}`);
    if (params.status && params.status !== 'all')  parts.push(`status=${params.status}`);
    if (params.method && params.method !== 'all')  parts.push(`method=${params.method}`);
    if (params.page  != null)                      parts.push(`page=${params.page}`);
    if (params.limit != null)                      parts.push(`limit=${params.limit}`);
    const qs = parts.length ? `?${parts.join('&')}` : '';
    const res = await request<{ success: boolean; data: LedgerResponse }>('GET', `/api/crew/sessions/history${qs}`, undefined, true);
    return res.data;
  },

  /** Convenience: today's ledger (first page). */
  getToday: async (): Promise<LedgerResponse> => {
    const res = await request<{ success: boolean; data: LedgerResponse }>('GET', '/api/crew/sessions/history?range=today&limit=50', undefined, true);
    return res.data;
  },
};

export const crewDiners = {
  lookup: (phone: string) =>
    request<{ success: boolean; data: { found: boolean; name: string | null; totalSessions: number } }>(
      'GET', `/api/crew/diners/lookup?phone=${phone.replace(/\D/g, '')}`, undefined, true
    ),
};

// ── Crew Memberships (enrol customers into owner-created tiers) ────────────────
export interface CrewMembershipTier {
  id: string; name: string; discountType: 'PERCENTAGE' | 'FLAT';
  discountValue: number; maxDiscount: number | null; minOrderValue: number | null;
}
export interface CrewMember {
  id: string; phone: string; name: string | null; status: string;
  membershipName: string | null; joinedAt: string;
}
export interface CrewEnrolInput {
  phone: string; name?: string | null; membershipId: string;
  customDiscountType?: 'PERCENTAGE' | 'FLAT' | null; customDiscountValue?: number | null;
}

export const crewMemberships = {
  tiers: () =>
    request<{ success: boolean; data: CrewMembershipTier[] }>('GET', '/api/crew/memberships/tiers', undefined, true),
  lookup: (phone: string) =>
    request<{ success: boolean; data: { exists: boolean; name: string | null; alreadyMember: boolean } }>(
      'GET', `/api/crew/memberships/lookup?phone=${phone.replace(/\D/g, '')}`, undefined, true,
    ),
  members: () =>
    request<{ success: boolean; data: CrewMember[] }>('GET', '/api/crew/memberships/members', undefined, true),
  enrol: (body: CrewEnrolInput) =>
    request<{ success: boolean; data: { id: string } }>('POST', '/api/crew/memberships/members', body, true),
};

// ── Crew Orders (STEWARD/ADMIN) ───────────────────────────────────────────────

export interface ActiveOrderItem { item_id: string; name: string; qty: number; price: number; item_status: 'pending' | 'done'; served: boolean; }
export interface ActiveOrder { order_id: string; table_number: number; session_id: string; status: 'received' | 'preparing' | 'ready' | 'served'; placed_at: string; served_at?: string; items: ActiveOrderItem[]; }

export interface TakeawayOrder {
  orderId: string;
  pickupToken: string | null;
  sessionRef: string | null;
  customerName: string | null;
  customerPhone: string | null;
  items: { name: string; qty: number; modifiers: string | null; itemStatus: string }[];
  status: string;
  total: number;
  paymentStatus: string;
  createdAt: string;
}

export interface CrewOffer {
  id: string;
  name: string;
  type: 'PERCENTAGE_OFF' | 'FLAT_OFF' | 'FREE_ITEM';
  minOrderValue: number | null;
  triggerItemId: string | null;
  discountPct: number | null;
  discountFlat: number | null;
  maxDiscount: number | null;
  freeItemId: string | null;
  freeItemQty: number;
}

export const crewOffers = {
  // sessionId lets the server return the table's prior-order subtotal so the
  // progress nudge matches the exact threshold the discount engine applies.
  list: (sessionId?: string) =>
    request<{ success: boolean; data: { offers: CrewOffer[]; sessionSubtotalBeforeCart: number } }>(
      'GET',
      `/api/crew/offers${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`,
      undefined,
      true,
    ),
};

export const crewOrders = {
  getActive: () =>
    request<{ orders: ActiveOrder[] }>('GET', '/api/crew/orders/active', undefined, true),
  getServedToday: (page = 1, limit = 30) =>
    request<{ orders: ActiveOrder[]; page: number; limit: number; hasMore: boolean }>(
      'GET',
      `/api/crew/orders/served-today?page=${page}&limit=${limit}`,
      undefined,
      true,
    ),
  getPaymentContext: (orderId: string) =>
    request<{ success: true; data: CrewOrderPaymentContext }>('GET', `/api/crew/orders/${orderId}/payment-context`, undefined, true),

  // Backend's Fastify schema requires `{ served: true }` in the body — sending
  // no body fails validation and the optimistic UI flip reverts when the
  // PATCH rejects. Pass the literal `true` here.
  serveItem: (orderId: string, itemId: string) =>
    request<unknown>('PATCH', `/api/crew/orders/${orderId}/items/${itemId}/serve`, { served: true }, true),

  // Cancel a whole item line before payment is settled. Recomputes the order
  // total server-side; returns the new total + whether the order is now empty.
  cancelItem: (orderId: string, itemId: string) =>
    request<{ success: boolean; order_id: string; session_id: string; item_id: string; new_order_total: number; order_cancelled: boolean }>(
      'PATCH', `/api/crew/orders/${orderId}/items/${itemId}/cancel`, undefined, true,
    ),

  // Write off an uncollected order (walkout / comp). ADMIN-only on the backend.
  waive: (orderId: string, reason: string) =>
    request<{ success: boolean; data: { orderId: string; sessionId: string; amount: number } }>(
      'POST', `/api/crew/orders/${orderId}/waive`, { reason }, true,
    ),

  placeOrder: (sessionId: string, items: { item_id: string; qty: number; note?: string; selectedModifiers?: { groupId: string; optionId: string }[]; modifiers_summary?: string }[]) =>
    request<{ success: boolean; order_id: string; totals?: { total?: number } }>(
      'POST',
      '/api/crew/orders',
      { session_id: sessionId, items },
      true,
    ),

  getTakeaway: (status?: string) =>
    request<{ data: TakeawayOrder[] }>(
      'GET',
      `/api/crew/orders/takeaway${status ? `?status=${status}` : ''}`,
      undefined,
      true,
    ),

  handoverTakeaway: (orderId: string) =>
    request<{ success: boolean }>(
      'PATCH',
      `/api/crew/orders/${orderId}/handover`,
      undefined,
      true,
    ),
};

// ── Crew Payments (STEWARD/ADMIN) ─────────────────────────────────────────────

export interface CashLedgerItem { id: string; tableNo: string; amount: number; time: string; }
export interface CashLedgerGroup { date: string; total: number; items: CashLedgerItem[]; }
export interface CashLedger { shiftTotal: number; groups: CashLedgerGroup[]; }

export interface PendingCashRequest {
  orderId: string;
  /** All pending order ids on this table — the whole-table collect settles these. */
  orderIds?: string[];
  /** Count of pending orders folded into this one card (>1 ⇒ show "N orders"). */
  orderCount?: number;
  intentId?: string;
  source?: 'ORDER' | 'INTENT';
  intentMethod?: 'STAFF_COLLECT' | 'UPI_DIRECT';
  sessionId: string;
  tableNumber: number;
  channel?: 'DINE_IN' | 'TAKEAWAY';
  pickupToken?: string | null;
  amount: number;
  upi?: { vpa: string; displayName: string | null } | null;
  /** Itemised total breakdown — render this on the payment-collect screen. */
  breakdown?: BillBreakdown;
  customerName: string | null;
  customerPhone: string;
  requestedAt: string;
  /** Drives the chip + confirmation endpoint to call:
   *    STAFF_COLLECT → new v3 Collection Sheet (one-tap + split)
   *    CASH / UPI_DIRECT → legacy per-method confirm (back-compat for in-flight orders) */
  method?: 'CASH' | 'UPI_DIRECT' | 'STAFF_COLLECT';
}

export interface CollectedCashRecord {
  orderId: string;
  sessionId: string;
  tableNumber: number;
  channel?: 'DINE_IN' | 'TAKEAWAY';
  pickupToken?: string | null;
  amount: number;
  method: 'CASH' | 'UPI_DIRECT';
  customerName: string | null;
  customerPhone: string;
  collectedAt: string;
  collectedByName: string | null;
}

export interface CashRequestsResponse {
  pending: PendingCashRequest[];
  todayCollected: CollectedCashRecord[];
}

export interface OutstandingGroup {
  sessionId: string;
  tableNumber: number;
  /** True when the table was already freed but money is still owed. */
  sessionClosed: boolean;
  orderIds: string[];
  orderCount: number;
  amount: number;
  customerName: string | null;
  customerPhone: string | null;
  oldestAt: string;
}

export interface PendingPaymentIntent {
  id: string;
  sessionId: string;
  tableNumber: number;
  method: 'STAFF_COLLECT' | 'UPI_DIRECT';
  amount: {
    subtotal: number;
    tax: number;
    charges: number;
    discount: number;
    tip: number;
    total: number;
    currency: string;
  };
  upi: { vpa: string; displayName: string | null } | null;
  expiresAt: string;
  createdAt: string;
}

export const crewPayments = {
  // v3: Unified Collection endpoint. Supports 1-method (all cash or all UPI)
  // or 2-method splits like [{method:'CASH', amount:200},{method:'UPI_DIRECT', amount:320}].
  // Works on PENDING_STAFF_COLLECTION (v3) AND legacy PENDING_CASH/UPI_DIRECT/UNPAID
  // orders — staff can use this single sheet for all of them.
  collectPayment: (
    orderId: string,
    staffId: string,
    splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[],
    idempotencyKey: string,
    upiReference?: string | null,
  ) =>
    request<{
      success: true;
      order_id: string;
      session_id: string;
      status: 'paid';
      payment_method: 'cash' | 'upi_direct' | 'mixed';
      total: number;
      splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number; payment_id: string }[];
      collected_by: string;
      paid_at: string;
    }>('POST', '/api/crew/payments/collect', {
      order_id:      orderId,
      staff_id:      staffId,
      splits,
      idempotency_key: idempotencyKey,
      upi_reference: upiReference ?? null,
    }, true),

  // v3 (whole table): settle EVERY pending order the card was showing in one
  // atomic transaction. Same split shape as collectPayment, keyed by session +
  // the explicit orderIds the sheet rendered.
  collectSessionPayment: (
    sessionId: string,
    orderIds: string[],
    staffId: string,
    splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[],
    idempotencyKey: string,
    upiReference?: string | null,
  ) =>
    request<{
      success: true;
      session_id: string;
      order_ids: string[];
      status: 'paid';
      payment_method: 'cash' | 'upi_direct' | 'mixed';
      total: number;
      splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number; payment_id: string }[];
      collected_by: string;
      paid_at: string;
    }>('POST', '/api/crew/payments/collect-session', {
      session_id:      sessionId,
      order_ids:       orderIds,
      staff_id:        staffId,
      splits,
      idempotency_key: idempotencyKey,
      upi_reference:   upiReference ?? null,
    }, true),

  // Powers the cash-collection screen: pending requests + today's history.
  // Backend wraps the payload in { success, data } — unwrap so callers get
  // the clean shape. Defaults to empty lists when the backend is on an old
  // version (graceful degradation while rolling out).
  getCashRequests: async (): Promise<CashRequestsResponse> => {
    const res = await request<{ success: boolean; data?: CashRequestsResponse }>(
      'GET', '/api/crew/payments/cash-requests', undefined, true,
    );
    return {
      pending:        res.data?.pending        ?? [],
      todayCollected: res.data?.todayCollected ?? [],
    };
  },

  requestOnlinePaymentLink: (sessionId: string) =>
    request<{ payment_link_url: string; amount: number }>(
      'POST', `/api/crew/sessions/${sessionId}/payment-link`, {}, true
    ),

  getCashLedger: () =>
    request<CashLedger>('GET', '/api/crew/payments/cash-ledger', undefined, true),

  // Every not-yet-resolved order across the restaurant — including freed
  // (CLOSED) tables — so uncollected money is never invisible.
  getOutstanding: async (): Promise<{ groups: OutstandingGroup[]; totalDue: number }> => {
    const res = await request<{ success: boolean; data?: { groups: OutstandingGroup[]; totalDue: number } }>(
      'GET', '/api/crew/payments/outstanding', undefined, true,
    );
    return { groups: res.data?.groups ?? [], totalDue: res.data?.totalDue ?? 0 };
  },

  getPendingPaymentIntents: async (): Promise<PendingPaymentIntent[]> => {
    const res = await request<{ success: boolean; data?: PendingPaymentIntent[] }>(
      'GET', '/api/crew/payments/intents/pending', undefined, true,
    );
    return Array.isArray(res.data) ? res.data : [];
  },

  confirmPaymentIntent: (intentId: string) =>
    request<{ success: boolean; data: { id: string; status: 'CONFIRMED' } }>(
      'POST', `/api/crew/payments/intents/${intentId}/confirm`, {}, true,
    ),

  rejectPaymentIntent: (intentId: string, reason?: string) =>
    request<{ success: boolean; data: { id: string; status: 'CANCELLED' } }>(
      'POST', `/api/crew/payments/intents/${intentId}/reject`, reason ? { reason } : {}, true,
    ),
};

// ── Restaurant / Menu (public) ────────────────────────────────────────────────

export interface ModifierOption { id: string; name: string; priceAdjustment: string; isAvailable?: boolean; }
export interface ModifierGroup { id: string; name: string; minSelections: number; maxSelections: number; options: ModifierOption[]; }
export interface MenuItem { id: string; name: string; description?: string; price: string; originalPrice?: string; category: string; isVeg: boolean; isAvailable: boolean; imageUrl?: string; modifierGroups?: ModifierGroup[]; }
export interface Restaurant { id: string; name: string; slug: string; upiId: string; }

export interface MenuCategory { name: string; items: MenuItem[]; }

export interface Combo {
  id: string; title: string; description?: string; tag: string;
  price: string; originalPrice: string; imageUrl?: string;
  items: string[]; isActive: boolean; itemDetails?: any;
}

export interface HighlightedSection {
  title: string; subtitle?: string; itemIds: string[];
}

// ── Crew Activity ─────────────────────────────────────────────────────────────
export interface CrewActivityItem {
  id: string;
  action: string;
  actor: string | null;
  actorRole: string | null;
  details: Record<string, any> | null;
  createdAt: string;
}
export interface CrewActivityPage {
  items: CrewActivityItem[];
  nextCursor?: string;
  hasMore: boolean;
}

export const crewActivity = {
  list: (params?: { cursor?: string; limit?: number; category?: string }) => {
    const q = new URLSearchParams();
    if (params?.cursor)   q.set('cursor', params.cursor);
    if (params?.limit)    q.set('limit', String(params.limit));
    if (params?.category) q.set('category', params.category);
    const qs = q.toString();
    return request<{ success: true; data: CrewActivityPage }>('GET', `/api/crew/activity${qs ? `?${qs}` : ''}`, undefined, true);
  },
};

export const restaurantApi = {
  get: (restaurantId: string) =>
    request<{ success: true; data: Restaurant }>('GET', `/api/v1/restaurants/${restaurantId}`),

  // `channel` scopes the menu. Pass 'CREW' from the order screen to include
  // crew-only special charges (birthday fees etc.) alongside the dine-in menu.
  // Omit for the default DINE_IN diner view.
  getMenu: (restaurantId: string, channel?: 'DINE_IN' | 'TAKEAWAY' | 'CREW') =>
    request<{ success: true; data: MenuCategory[] }>('GET', `/api/v1/dine/menu/${restaurantId}${channel ? `?channel=${channel}` : ''}`),

  // Branding includes everything the Collection Sheet needs to render the
  // partner's UPI QR + display name when the staff picks "UPI" for a split.
  getBranding: (restaurantId: string) =>
    request<{
      success: true;
      data: {
        name: string;
        address?: string | null;
        phone?: string | null;
        email?: string | null;
        fssaiLicenseNumber?: string | null;
        logoUrl: string | null;
        dineTheme: string;
        upiId?: string | null;
        upiDisplayName?: string | null;
        acceptCash?: boolean;
        acceptUpiDirect?: boolean;
        acceptStaffCollect?: boolean;
      };
    }>('GET', `/api/v1/dine/restaurant/${restaurantId}`),

  getCombos: (restaurantId: string) =>
    request<{ success: true; data: Combo[] }>('GET', `/api/v1/dine/combos/${restaurantId}`),

  getHighlighted: (restaurantId: string) =>
    request<{ success: true; data: HighlightedSection | null }>('GET', `/api/v1/dine/highlighted/${restaurantId}`),
};

// ── Print Status types ────────────────────────────────────────────────────────

export type KitchenMode = 'DIGITAL_ONLY' | 'PAPER_ONLY' | 'HYBRID';

export interface PrintStatus {
  kitchenMode: KitchenMode;
  paired: boolean;
  printerName: string | null;
  printerPaperWidth: number | null;
  printerPairedAt: string | null;
  pairedByName: string | null;
  pairedById: string | null;
  kotAutoPrint: boolean;
}

// ── Printer API ───────────────────────────────────────────────────────────────

export const printerApi = {
  /**
   * Report a print result to the backend (printed or failed).
   */
  ack: (orderId: string, status: 'printed' | 'failed', errorMessage?: string, isAddOn?: boolean) =>
    request<{ success: true; data: any }>(
      'POST',
      '/api/crew/print/ack',
      { orderId, status, errorMessage, isAddOn },
      true,
    ),

  /**
   * Request a reprint of an order from any crew device.
   */
  reprint: (orderId: string, reason?: string) =>
    request<{ success: boolean }>(
      'POST',
      '/api/crew/print/reprint',
      { orderId, reason },
      true,
    ),

  /**
   * Fetch the current printer pairing state + kitchen mode.
   */
  getStatus: () =>
    request<{ success: true; data: PrintStatus }>(
      'GET',
      '/api/crew/print/status',
      undefined,
      true,
    ),

  getPending: (limit = 25) =>
    request<{ success: true; data: Array<{
      id: string;
      orderNumber?: string | number;
      sessionId: string;
      tableNumber: number;
      createdAt: string;
      isAddOn: boolean;
      items: Array<{
        name: string;
        quantity: number;
        notes?: string;
        modifiersSummary?: string;
      }>;
    }> }>(
      'GET',
      `/api/crew/print/pending?limit=${Math.max(1, Math.min(limit, 100))}`,
      undefined,
      true,
    ),

  /**
   * Set or clear the printer pairing on behalf of the current crew member.
   * Uses the crew-auth endpoint (not the partner-auth one).
   * Pass pairedTo: null to unpair.
   */
  setPairing: (data: {
    pairedTo: string | null;
    name?: string;
    address?: string;
    paperWidth?: 58 | 80;
  }) =>
    request<{ success: true; data: any }>(
      'PATCH',
      '/api/crew/print/pair',
      data,
      true,
    ),

  setAutoPrint: (enabled: boolean) =>
    request<{ success: true; data: { kotAutoPrint: boolean } }>(
      'PATCH',
      '/api/crew/print/autoprint',
      { enabled },
      true,
    ),
};

export const crewNotifications = {
  registerToken: (
    token: string,
    metadata?: { platform?: string; deviceId?: string; deviceName?: string; appVersion?: string },
  ) =>
    request<{ success: true }>('POST', '/api/crew/notifications/token', { token, ...metadata }, true),

  heartbeat: (token: string) =>
    request<{ success: true }>('POST', '/api/crew/notifications/token/heartbeat', { token }, true),

  tokenHealth: () =>
    request<{ success: true; data: {
      total: number;
      active: number;
      stale: number;
      byRole: Array<{ role: StaffRole; active: number }>;
      lastSeenAt: string | null;
    } }>('GET', '/api/crew/notifications/token-health', undefined, true),
};

// ── Expenses (floor petty cash / supplier payments) ─────────────────────────

export type CrewExpensePaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'OTHER';

export interface CrewExpenseCategory { id: string; name: string; kind: string; color: string }
export interface CrewVendor { id: string; name: string }
export interface CrewExpenseItem {
  id: string;
  category: { id: string; name: string; kind: string; color: string } | null;
  vendor: { id: string; name: string } | null;
  amount: number;
  expenseDate: string;
  paymentMethod: CrewExpensePaymentMethod;
  note: string | null;
  source: string;
}
export interface CrewExpenseCreateInput {
  categoryId: string;
  vendorId?: string | null;
  amount: number;
  expenseDate: string; // YYYY-MM-DD
  paymentMethod?: CrewExpensePaymentMethod;
  note?: string | null;
}

export const crewExpenses = {
  categories: () =>
    request<{ success: boolean; data: CrewExpenseCategory[] }>('GET', '/api/crew/expenses/categories', undefined, true),

  vendors: () =>
    request<{ success: boolean; data: CrewVendor[] }>('GET', '/api/crew/expenses/vendors', undefined, true),

  recent: () =>
    request<{ success: boolean; data: { items: CrewExpenseItem[]; totalAmount: number; range: { label: string } } }>(
      'GET', '/api/crew/expenses?range=7d', undefined, true,
    ),

  create: (input: CrewExpenseCreateInput) =>
    request<{ success: boolean; data: CrewExpenseItem; error?: string }>('POST', '/api/crew/expenses', input, true),
};
