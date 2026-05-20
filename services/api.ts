import { API_BASE_URL } from '../constants/env';

let _crewToken: string | null = null;

export function setCrewToken(token: string | null) {
  _crewToken = token;
}

export function getCrewToken() {
  return _crewToken;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type StaffRole = 'STEWARD' | 'CHEF' | 'ADMIN' | 'CASHIER';

// Normalized staff info (camelCase) used throughout the app
export interface StaffInfo {
  id: string;
  name: string;
  role: StaffRole;
  restaurantId: string;
  restaurantName: string;
}

// ── Raw backend response shapes (snake_case from the API) ─────────────────────

interface RawVerifyOtpResponse {
  token: string;
  user: {
    id: string;
    name: string;
    role: StaffRole;
    restaurant_id: string;
    restaurant_name: string;
  };
}

interface RawCrewBypassResponse {
  accessToken: string;
  user: {
    id: string;
    name: string;
    role: StaffRole;
    restaurant_id: string;
    restaurant_name: string;
  };
}

// ── HTTP client ───────────────────────────────────────────────────────────────

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: object,
  useAuth = false,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (useAuth && _crewToken) {
    headers['Authorization'] = `Bearer ${_crewToken}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();

  // This backend returns errors as { error: 'CODE', message: '...' } (no success wrapper)
  // or sometimes { statusCode, error, message } from Fastify's default error format
  if (!res.ok) {
    const msg = json.message ?? json.error?.message ?? json.error ?? `API error ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  return json as T;
}

// ── Crew Auth ─────────────────────────────────────────────────────────────────
// Actual paths: /api/crew/auth/otp/request  and  /api/crew/auth/otp/verify

export const crewAuth = {
  sendOtp: (phone: string) =>
    request<{ message: string; expiresIn: number }>(
      'POST', '/api/crew/auth/otp/request', { phone }
    ),

  // Returns normalized StaffInfo — maps backend snake_case to camelCase
  verifyOtp: async (phone: string, otp: string): Promise<{ crewToken: string; staff: StaffInfo }> => {
    const raw = await request<RawVerifyOtpResponse>(
      'POST', '/api/crew/auth/otp/verify', { phone, otp }
    );
    return {
      crewToken: raw.token,
      staff: {
        id: raw.user.id,
        name: raw.user.name,
        role: raw.user.role,
        restaurantId: raw.user.restaurant_id,
        restaurantName: raw.user.restaurant_name,
      },
    };
  },
};

// ── Dev Bypass (only works when NODE_ENV=development on the backend) ───────────
// Actual paths: /api/dev/seed  /api/dev/state  /api/dev/crew-login-bypass

export const devApi = {
  seed: () =>
    request<{ message: string }>('POST', '/api/dev/seed'),

  getState: () =>
    request<{ restaurantId: string; staff: { id: string; name: string; role: StaffRole; phone: string; accessToken: string }[] }>(
      'GET', '/api/dev/state'
    ),

  crewLoginBypass: async (phone: string): Promise<{ crewToken: string; staff: StaffInfo }> => {
    const raw = await request<RawCrewBypassResponse>(
      'POST', '/api/dev/crew-login-bypass', { phone }
    );
    return {
      crewToken: raw.accessToken,
      staff: {
        id: raw.user.id,
        name: raw.user.name,
        role: raw.user.role,
        restaurantId: raw.user.restaurant_id,
        restaurantName: raw.user.restaurant_name,
      },
    };
  },
};

// ── Kitchen ─────────────────────────────────────────────────────────────────
// Actual path: /api/kitchen/...

export const kitchen = {
  getOrders: () =>
    request<unknown>('GET', '/api/kitchen/orders', undefined, true),

  updateItemStatus: (orderId: string, itemId: string, status: 'done' | 'pending') =>
    request<unknown>('PATCH', `/api/kitchen/orders/${orderId}/items/${itemId}/status`, { item_status: status }, true),

  bumpOrder: (orderId: string) =>
    request<unknown>('PATCH', `/api/kitchen/orders/${orderId}/status`, undefined, true),

  undoBump: (orderId: string) =>
    request<unknown>('POST', `/api/kitchen/orders/${orderId}/undo`, undefined, true),
};

// ── Crew Tables ──────────────────────────────────────────────────────────────
// Actual path: /api/crew/tables

export const crewTables = {
  list: () =>
    request<unknown>('GET', '/api/crew/tables', undefined, true),

  updateStatus: (tableId: string, status: 'available' | 'reserved') =>
    request<unknown>('PATCH', `/api/crew/tables/${tableId}/status`, { status }, true),
};
