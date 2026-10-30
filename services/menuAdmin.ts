/**
 * Menu management for crew — /api/crew/menu-manage/*.
 *
 * The backend mounts the partner app's own menu routes here, so these shapes
 * are the partner app's (services/api.ts there) and the edit screens under
 * app/(staff)/menu-admin* are ports of the partner screens. Keep the two in
 * step when a field is added on either side.
 *
 * Needs MENU_EDIT; every delete also needs MENU_DELETE. Both are enforced on
 * the server — the screens only hide what the staffer can't do.
 */

import { API_BASE_URL } from '../constants/env';
import { getCrewToken } from './api';
import * as ImageManipulator from 'expo-image-manipulator';

const BASE = '/api/crew/menu-manage';

async function call<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: object },
): Promise<T> {
  const token = getCrewToken();
  if (!token) throw new Error('SESSION_EXPIRED');
  const hasBody = options?.body !== undefined;

  const res = await fetch(`${API_BASE_URL}${BASE}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
    body: hasBody ? JSON.stringify(options!.body) : undefined,
  });

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Server is warming up — please try again in a moment.');
  }
  const json = await res.json().catch(() => {
    throw new Error('Server is warming up — please try again in a moment.');
  });

  if (!res.ok) {
    // Partner routes answer { error: { code, message } }; crew guards answer
    // { error: message, code }. Read both.
    const code: string | undefined = json?.error?.code ?? json?.code;
    if (res.status === 403 && code === 'CAPABILITY_REQUIRED') {
      throw Object.assign(new Error("You don't have permission to do this. Ask your manager."), { code });
    }
    const msg = json?.error?.message ?? json?.message ?? json?.error ?? `API error ${res.status}`;
    throw Object.assign(new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)), { code });
  }
  return json as T;
}

// ── Items ─────────────────────────────────────────────────────────────────────

export type SpiceLevel = 'MILD' | 'MEDIUM' | 'HOT';

// CREW = staff-added "special charge" (e.g. a birthday fee) hidden from diners.
export type ItemChannel = 'DINE_IN' | 'TAKEAWAY' | 'CREW' | 'COMBO';

export interface DineMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: string;           // Decimal string from Prisma
  originalPrice: string | null;
  takeawayPrice: string | null;
  category: string;
  isVeg: boolean;
  spiceLevel: SpiceLevel;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
  channels?: ItemChannel[];
  taxRatePercent?: number | null;
  taxCategory?: 'STANDARD' | 'EXEMPT' | 'NIL' | 'NON_GST' | null;
  hsnSac?: string | null;
  scheduleEnabled?: boolean;
  availabilityWindows?: { days: number[]; start: number; end: number }[] | null;
  validFrom?: string | null;
  validUntil?: string | null;
  lastOrderCutoffMin?: number | null;
  dailyQtyCap?: number | null;
  hideWhenUnavailable?: boolean;
}

export interface DineMenuCategory {
  name: string;
  imageUrl?: string | null;
  items: DineMenuItem[];
}

export interface MenuItemPayload {
  name: string;
  description?: string;
  price: number;
  originalPrice?: number | null;
  takeawayPrice?: number | null;
  category: string;
  isVeg: boolean;
  spiceLevel: SpiceLevel;
  imageUrl?: string | null;
  channels?: ItemChannel[];
  taxRatePercent?: number | null;
  taxCategory?: 'STANDARD' | 'EXEMPT' | 'NIL' | 'NON_GST' | null;
  hsnSac?: string | null;
  scheduleEnabled?: boolean;
  availabilityWindows?: { days: number[]; start: number; end: number }[] | null;
  validFrom?: string | null;
  validUntil?: string | null;
  lastOrderCutoffMin?: number | null;
  dailyQtyCap?: number | null;
  hideWhenUnavailable?: boolean;
}

export const adminMenu = {
  getMenu: () => call<DineMenuCategory[]>(''),

  toggleAvailability: (itemId: string, isAvailable: boolean) =>
    call<DineMenuItem>(`/items/${itemId}/availability`, { method: 'PATCH', body: { isAvailable } }),

  createItem: (data: MenuItemPayload) =>
    call<DineMenuItem>('/items', { method: 'POST', body: data }),

  updateItem: (itemId: string, data: MenuItemPayload) =>
    call<DineMenuItem>(`/items/${itemId}`, { method: 'PUT', body: data }),

  deleteItem: (itemId: string) =>
    call<{ id: string; deleted: boolean }>(`/items/${itemId}`, { method: 'DELETE' }),

  renameCategory: async (items: DineMenuItem[], newName: string) => {
    const oldName = items[0]?.category;
    if (!oldName) return;
    await call<{ success: boolean }>('/categories/rename', { method: 'PATCH', body: { oldName, newName } });
  },

  reorderCategories: (orderedCategories: string[]) =>
    call<{ success: boolean }>('/categories/reorder', { method: 'PATCH', body: { orderedCategories } }),

  reorderItems: (orderedIds: string[]) =>
    call<{ success: boolean }>('/items/reorder', { method: 'PATCH', body: { orderedIds } }),
};

// ── Modifier groups ───────────────────────────────────────────────────────────

export interface AppModifierOption {
  id: string;
  name: string;
  priceAdjustment: string;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
  imageUrl?: string | null;
}

export interface AppModifierGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  isActive: boolean;
  hasImages?: boolean;
  options: AppModifierOption[];
}

export const adminModifiers = {
  getGroups: (itemId: string) =>
    call<{ success: boolean; data: AppModifierGroup[] }>(`/items/${itemId}/modifier-groups`).then(r => r.data ?? []),

  createGroup: (itemId: string, data: { name: string; minSelections: number; maxSelections: number; sortOrder?: number; hasImages?: boolean }) =>
    call<{ success: boolean; data: AppModifierGroup }>(`/items/${itemId}/modifier-groups`, { method: 'POST', body: data })
      .then(r => r.data),

  updateGroup: (
    itemId: string,
    groupId: string,
    data: Partial<{ name: string; minSelections: number; maxSelections: number; sortOrder: number; isActive: boolean; hasImages: boolean }>,
  ) =>
    call<{ success: boolean; data: AppModifierGroup }>(`/items/${itemId}/modifier-groups/${groupId}`, { method: 'PATCH', body: data })
      .then(r => r.data),

  deleteGroup: (itemId: string, groupId: string) =>
    call<{ success: boolean }>(`/items/${itemId}/modifier-groups/${groupId}`, { method: 'DELETE' }),

  createOption: (itemId: string, groupId: string, data: { name: string; priceAdjustment: number; isDefault?: boolean; sortOrder?: number; imageUrl?: string | null }) =>
    call<{ success: boolean; data: AppModifierOption }>(`/items/${itemId}/modifier-groups/${groupId}/options`, { method: 'POST', body: data })
      .then(r => r.data),

  updateOption: (
    itemId: string,
    groupId: string,
    optionId: string,
    data: Partial<{ name: string; priceAdjustment: number; isDefault: boolean; isAvailable: boolean; sortOrder: number; imageUrl: string | null }>,
  ) =>
    call<{ success: boolean; data: AppModifierOption }>(
      `/items/${itemId}/modifier-groups/${groupId}/options/${optionId}`,
      { method: 'PATCH', body: data },
    ).then(r => r.data),

  deleteOption: (itemId: string, groupId: string, optionId: string) =>
    call<{ success: boolean }>(`/items/${itemId}/modifier-groups/${groupId}/options/${optionId}`, { method: 'DELETE' }),
};

// ── Combos ────────────────────────────────────────────────────────────────────

export type ComboChannel = 'DINE_IN' | 'TAKEAWAY';
export type ComboDailyCapMode = 'PER_REDEMPTION' | 'PER_QUANTITY';

export interface ComboItemDetail {
  menuItemId?: string;
  name: string;
  comboPrice: number;
  originalPrice: number;
  // Must round-trip on save or a crew edit wipes prices set on web.
  takeawayPrice?: number | null;
  quantity?: number;
  // Must round-trip on save or a crew edit wipes exclusions set on web.
  excludedOptionIds?: string[];
}

export interface ComboRules {
  channels?: ComboChannel[];
  scheduleEnabled?: boolean;
  availableDays?: number[];
  windowStartMinute?: number | null;
  windowEndMinute?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  dailyCap?: number | null;
  dailyCapMode?: ComboDailyCapMode;
  lifetimeCap?: number | null;
}

export interface DineCombo extends ComboRules {
  id: string;
  title: string;
  description: string | null;
  tag: string;
  price: number;
  originalPrice: number;
  takeawayPrice?: number | null;
  imageUrl: string | null;
  items: string[];
  itemDetails: ComboItemDetail[];
  isActive: boolean;
  sortOrder: number;
  lifetimeRedeemed?: number;
}

export interface ComboPayload extends ComboRules {
  title: string;
  description?: string;
  tag?: string;
  imageUrl?: string;
  itemDetails: ComboItemDetail[];
  isActive?: boolean;
  sortOrder?: number;
}

export const adminCombos = {
  list: () => call<{ success: boolean; data: DineCombo[] }>('/combos'),

  create: (data: ComboPayload) =>
    call<{ success: boolean; data: DineCombo }>('/combos', { method: 'POST', body: data }),

  update: (comboId: string, data: ComboPayload) =>
    call<{ success: boolean; data: DineCombo }>(`/combos/${comboId}`, { method: 'PUT', body: data }),

  delete: (comboId: string) =>
    call<{ success: boolean }>(`/combos/${comboId}`, { method: 'DELETE' }),

  reorder: (orderedIds: string[]) =>
    call<{ success: boolean }>('/combos/reorder', { method: 'PATCH', body: { orderedIds } }),
};

// ── Change history ────────────────────────────────────────────────────────────

export type MenuChangeAction = 'CREATED' | 'UPDATED' | 'DELETED' | 'AVAILABILITY' | 'REORDERED' | 'RENAMED';

export interface MenuChange {
  id: string;
  entityType: 'ITEM' | 'COMBO' | 'CATEGORY' | 'MODIFIER_GROUP' | 'MODIFIER_OPTION' | 'HIGHLIGHT';
  entityId: string | null;
  entityName: string;
  menuItemId: string | null;
  action: MenuChangeAction;
  /** [{ field, from, to }] for UPDATED; a snapshot object for CREATED / DELETED. */
  changes: unknown;
  actorType: 'OWNER' | 'STAFF';
  actorName: string;
  actorRole: string | null;
  source: 'PARTNER' | 'CREW';
  createdAt: string;
}

export const adminHistory = {
  /** Newest first. Pass `before` = the previous page's nextBefore to load more. */
  list: (filter: { itemId?: string; comboId?: string; before?: string | null }) => {
    const q = new URLSearchParams();
    if (filter.itemId) q.set('itemId', filter.itemId);
    if (filter.comboId) q.set('comboId', filter.comboId);
    if (filter.before) q.set('before', filter.before);
    const qs = q.toString();
    return call<{ success: boolean; data: MenuChange[]; nextBefore: string | null }>(`/history${qs ? `?${qs}` : ''}`);
  },
};

// ── Photos ────────────────────────────────────────────────────────────────────

/**
 * Upload a menu photo. Returns the base URL every client appends
 * -thumb / -medium / -full to — the same contract as the partner upload.
 * Same signature as the partner app's uploadMenuImage so ported screens call it
 * unchanged; the image is resized and re-encoded here to stay under the
 * server's body limit.
 */
export async function uploadMenuImage(uri: string, _mimeType: string): Promise<string> {
  const shrunk = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!shrunk.base64) throw new Error('Could not read that photo.');
  const res = await call<{ success: boolean; url: string }>('/images', {
    method: 'POST',
    body: { imageBase64: shrunk.base64 },
  });
  return res.url;
}
