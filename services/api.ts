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

  const json = await res.json();

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
    request<{ success: boolean; data: { id: string; name: string; phone: string; role: StaffRole; photoUrl: string | null; restaurantId: string; restaurantName: string } }>(
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

export const kitchen = {
  getOrders: () => request<{ tickets: KitchenTicket[] }>('GET', '/api/kitchen/orders', undefined, true),
  // Recent completed tickets (READY/SERVED) — powers the cook "Completed" tab.
  getCompleted: () => request<{ tickets: KitchenTicket[] }>('GET', '/api/kitchen/orders/completed', undefined, true),
  updateItemStatus: (orderId: string, itemId: string, status: 'done' | 'pending') =>
    request<unknown>('PATCH', `/api/kitchen/orders/${orderId}/items/${itemId}/status`, { item_status: status }, true),
  bumpOrder: (orderId: string) =>
    request<unknown>('PATCH', `/api/kitchen/orders/${orderId}/status`, undefined, true),
  undoBump: (orderId: string) =>
    request<unknown>('POST', `/api/kitchen/orders/${orderId}/undo`, undefined, true),
};

// ── Crew Tables (STEWARD/ADMIN) ───────────────────────────────────────────────

export interface CrewTable { table_id: string; table_number: number; capacity: number; status: 'available' | 'occupied' | 'reserved' | 'offline'; session_id: string | null; occupied_since: string | null; bill_subtotal?: number; bill_tax?: number; bill_total?: number; }

export const crewTables = {
  list: () => request<{ tables: CrewTable[] }>('GET', '/api/crew/tables', undefined, true),
  updateStatus: (tableId: string, status: 'available' | 'reserved') =>
    request<unknown>('PATCH', `/api/crew/tables/${tableId}/status`, { status }, true),
};

// ── Crew Sessions (STEWARD/ADMIN) ─────────────────────────────────────────────

export interface BillOrderItem { item_id: string; name: string; qty: number; price: number; item_status: 'pending' | 'done'; served: boolean; modifiers_summary?: string | null; }
export interface BillOrder { order_id: string; placed_at: string; status: 'received' | 'preparing' | 'ready' | 'served'; items: BillOrderItem[]; order_total: number; }
export interface SessionBill { session_id: string; table_number: number; status: 'active' | 'paid' | 'closed'; orders: BillOrder[]; session_total: number; tax_total?: number; total_payable?: number; }

export const crewSessions = {
  start: (tableId: string) =>
    request<{ success: true; session_id: string; table_id: string; table_number: number; started_at: string }>(
      'POST', '/api/crew/sessions', { table_id: tableId }, true
    ),
  end: (sessionId: string) =>
    request<unknown>('DELETE', `/api/crew/sessions/${sessionId}`, undefined, true),
  getBill: (sessionId: string) =>
    request<SessionBill>('GET', `/api/crew/sessions/${sessionId}/bill`, undefined, true),
};

// ── Crew Orders (STEWARD/ADMIN) ───────────────────────────────────────────────

export interface ActiveOrderItem { item_id: string; name: string; qty: number; price: number; item_status: 'pending' | 'done'; served: boolean; }
export interface ActiveOrder { order_id: string; table_number: number; session_id: string; status: 'received' | 'preparing' | 'ready' | 'served'; placed_at: string; items: ActiveOrderItem[]; }

export const crewOrders = {
  getActive: () =>
    request<{ orders: ActiveOrder[] }>('GET', '/api/crew/orders/active', undefined, true),

  // Backend's Fastify schema requires `{ served: true }` in the body — sending
  // no body fails validation and the optimistic UI flip reverts when the
  // PATCH rejects. Pass the literal `true` here.
  serveItem: (orderId: string, itemId: string) =>
    request<unknown>('PATCH', `/api/crew/orders/${orderId}/items/${itemId}/serve`, { served: true }, true),

  placeOrder: (sessionId: string, items: { item_id: string; qty: number; note?: string }[]) =>
    request<unknown>('POST', '/api/crew/orders', { session_id: sessionId, items }, true),
};

// ── Crew Payments (STEWARD/ADMIN) ─────────────────────────────────────────────

export interface CashLedgerItem { id: string; tableNo: string; amount: number; time: string; }
export interface CashLedgerGroup { date: string; total: number; items: CashLedgerItem[]; }
export interface CashLedger { shiftTotal: number; groups: CashLedgerGroup[]; }

export interface PendingCashRequest {
  orderId: string;
  sessionId: string;
  tableNumber: number;
  amount: number;
  customerName: string | null;
  customerPhone: string;
  requestedAt: string;
}

export interface CollectedCashRecord {
  orderId: string;
  sessionId: string;
  tableNumber: number;
  amount: number;
  customerName: string | null;
  customerPhone: string;
  collectedAt: string;
  collectedByName: string | null;
}

export interface CashRequestsResponse {
  pending: PendingCashRequest[];
  todayCollected: CollectedCashRecord[];
}

export const crewPayments = {
  // Cash collection is per-ORDER now (decoupled from session lifecycle). The
  // waiter confirms cash received against one Order at a time — flipping that
  // order's paymentStatus to PAID_CASH. Session stays ACTIVE until explicitly
  // freed.
  cashConfirm: (orderId: string, staffId: string, amountCollected: number) =>
    request<unknown>('POST', '/api/crew/payments/cash', { order_id: orderId, staff_id: staffId, amount_collected: amountCollected }, true),

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
};

// ── Crew Notifications ────────────────────────────────────────────────────────

export const crewNotifications = {
  registerToken: (expoPushToken: string) =>
    request<{ success: boolean }>('POST', '/api/crew/notifications/token', { token: expoPushToken }, true),
};

// ── Restaurant / Menu (public) ────────────────────────────────────────────────

export interface MenuItem { id: string; name: string; description?: string; price: string; category: string; isVeg: boolean; isAvailable: boolean; imageUrl?: string; }
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

export const restaurantApi = {
  get: (restaurantId: string) =>
    request<{ success: true; data: Restaurant }>('GET', `/api/v1/restaurants/${restaurantId}`),

  getMenu: (restaurantId: string) =>
    request<{ success: true; data: MenuCategory[] }>('GET', `/api/v1/dine/menu/${restaurantId}`),

  getBranding: (restaurantId: string) =>
    request<{ success: true; data: { name: string; logoUrl: string | null; dineTheme: string } }>(
      'GET', `/api/v1/dine/restaurant/${restaurantId}`
    ),

  getCombos: (restaurantId: string) =>
    request<{ success: true; data: Combo[] }>('GET', `/api/v1/dine/combos/${restaurantId}`),

  getHighlighted: (restaurantId: string) =>
    request<{ success: true; data: HighlightedSection | null }>('GET', `/api/v1/dine/highlighted/${restaurantId}`),
};
