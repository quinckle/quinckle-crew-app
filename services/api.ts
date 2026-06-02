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

export interface CrewTable { table_id: string; table_number: number; capacity: number; status: 'available' | 'occupied' | 'reserved' | 'offline'; session_id: string | null; occupied_since: string | null; expires_at?: string | null; customer_name?: string | null; customer_phone?: string | null; bill_subtotal?: number; bill_tax?: number; bill_total?: number; }

export const crewTables = {
  list: () => request<{ tables: CrewTable[] }>('GET', '/api/crew/tables', undefined, true),
  updateStatus: (tableId: string, status: 'available' | 'reserved') =>
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
};

// ── Crew Sessions (STEWARD/ADMIN) ─────────────────────────────────────────────

export interface BillOrderItem { item_id: string; name: string; qty: number; price: number; item_status: 'pending' | 'done'; served: boolean; modifiers_summary?: string | null; }
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

  markPaid: (sessionId: string, splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[]) =>
    request<{ success: boolean }>(
      'POST', `/api/crew/sessions/${sessionId}/mark-paid`, { splits }, true
    ),
};

export const crewDiners = {
  lookup: (phone: string) =>
    request<{ success: boolean; data: { found: boolean; name: string | null; totalSessions: number } }>(
      'GET', `/api/crew/diners/lookup?phone=${phone.replace(/\D/g, '')}`, undefined, true
    ),
};

// ── Crew Orders (STEWARD/ADMIN) ───────────────────────────────────────────────

export interface ActiveOrderItem { item_id: string; name: string; qty: number; price: number; item_status: 'pending' | 'done'; served: boolean; }
export interface ActiveOrder { order_id: string; table_number: number; session_id: string; status: 'received' | 'preparing' | 'ready' | 'served'; placed_at: string; served_at?: string; items: ActiveOrderItem[]; }

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

  placeOrder: (sessionId: string, items: { item_id: string; qty: number; note?: string; selectedModifiers?: { groupId: string; optionId: string }[]; modifiers_summary?: string }[]) =>
    request<{ success: boolean; order_id: string; totals?: { total?: number } }>(
      'POST',
      '/api/crew/orders',
      { session_id: sessionId, items },
      true,
    ),
};

// ── Crew Payments (STEWARD/ADMIN) ─────────────────────────────────────────────

export interface CashLedgerItem { id: string; tableNo: string; amount: number; time: string; }
export interface CashLedgerGroup { date: string; total: number; items: CashLedgerItem[]; }
export interface CashLedger { shiftTotal: number; groups: CashLedgerGroup[]; }

export interface PendingCashRequest {
  orderId: string;
  intentId?: string;
  source?: 'ORDER' | 'INTENT';
  intentMethod?: 'STAFF_COLLECT' | 'UPI_DIRECT';
  sessionId: string;
  tableNumber: number;
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

export interface ModifierOption { id: string; name: string; priceAdjustment: string; }
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

  getMenu: (restaurantId: string) =>
    request<{ success: true; data: MenuCategory[] }>('GET', `/api/v1/dine/menu/${restaurantId}`),

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
