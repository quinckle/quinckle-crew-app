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
  role: StaffRole;
  restaurantId: string;
  restaurantName: string;
}

interface RawVerifyOtpResponse {
  success: boolean;
  data: {
    token: string;
    user: { id: string; name: string; role: StaffRole; restaurant_id: string; restaurant_name: string };
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
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
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
      staff: { id: d.user.id, name: d.user.name, role: d.user.role, restaurantId: d.user.restaurant_id, restaurantName: d.user.restaurant_name },
    };
  },
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

export interface KitchenTicketItem { item_id: string; name: string; qty: number; note: string | null; item_status: 'pending' | 'done'; }
export interface KitchenTicket { order_id: string; table_number: number; status: 'received' | 'preparing'; placed_at: string; items: KitchenTicketItem[]; }

export const kitchen = {
  getOrders: () => request<{ tickets: KitchenTicket[] }>('GET', '/api/kitchen/orders', undefined, true),
  updateItemStatus: (orderId: string, itemId: string, status: 'done' | 'pending') =>
    request<unknown>('PATCH', `/api/kitchen/orders/${orderId}/items/${itemId}/status`, { item_status: status }, true),
  bumpOrder: (orderId: string) =>
    request<unknown>('PATCH', `/api/kitchen/orders/${orderId}/status`, undefined, true),
  undoBump: (orderId: string) =>
    request<unknown>('POST', `/api/kitchen/orders/${orderId}/undo`, undefined, true),
};

// ── Crew Tables (STEWARD/ADMIN) ───────────────────────────────────────────────

export interface CrewTable { table_id: string; table_number: number; capacity: number; status: 'available' | 'occupied' | 'reserved' | 'offline'; session_id: string | null; occupied_since: string | null; }

export const crewTables = {
  list: () => request<{ tables: CrewTable[] }>('GET', '/api/crew/tables', undefined, true),
  updateStatus: (tableId: string, status: 'available' | 'reserved') =>
    request<unknown>('PATCH', `/api/crew/tables/${tableId}/status`, { status }, true),
};

// ── Crew Sessions (STEWARD/ADMIN) ─────────────────────────────────────────────

export interface BillOrderItem { item_id: string; name: string; qty: number; price: number; item_status: 'pending' | 'done'; served: boolean; }
export interface BillOrder { order_id: string; placed_at: string; status: 'received' | 'preparing' | 'ready' | 'served'; items: BillOrderItem[]; order_total: number; }
export interface SessionBill { session_id: string; table_number: number; status: 'active' | 'paid' | 'closed'; orders: BillOrder[]; session_total: number; }

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
  getActive: () => request<{ orders: ActiveOrder[] }>('GET', '/api/crew/orders/active', undefined, true),
  serveItem: (orderId: string, itemId: string) =>
    request<unknown>('PATCH', `/api/crew/orders/${orderId}/items/${itemId}/serve`, undefined, true),
};

// ── Crew Payments (STEWARD/ADMIN) ─────────────────────────────────────────────

export const crewPayments = {
  cashConfirm: (sessionId: string, staffId: string, amountCollected: number) =>
    request<unknown>('POST', '/api/crew/payments/cash', { session_id: sessionId, staff_id: staffId, amount_collected: amountCollected }, true),
};

// ── Restaurant / Menu (public) ────────────────────────────────────────────────

export interface MenuItem { id: string; name: string; description?: string; price: string; category: string; isVeg: boolean; isAvailable: boolean; imageUrl?: string; }
export interface Restaurant { id: string; name: string; slug: string; upiId: string; }

export const restaurantApi = {
  get: (idOrSlug: string) =>
    request<{ success: true; data: { restaurant: Restaurant; menuItems: MenuItem[] } }>(
      'GET', `/api/v1/restaurants/${idOrSlug}`
    ),
};
