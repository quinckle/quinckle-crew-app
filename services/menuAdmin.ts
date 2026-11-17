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

// ── Menu Activity ─────────────────────────────────────────────────────────────

export type MenuChangeAction = 'CREATED' | 'UPDATED' | 'DELETED' | 'AVAILABILITY' | 'REORDERED' | 'RENAMED';

/** Menu Activity tabs. A row can belong to several (price + photo in one save). */
export type MenuActivityKind =
  | 'ADDED' | 'PRICE' | 'IMAGE' | 'CATEGORY' | 'GST' | 'CHANNELS' | 'AVAILABILITY' | 'DETAILS' | 'REMOVED' | 'AUTOMATIC';

/** Items / combos / add-ons chip on the whole-menu feed. */
export type MenuActivityEntity = 'ITEM' | 'COMBO' | 'ADDON';

export interface MenuChange {
  id: string;
  entityType: 'ITEM' | 'COMBO' | 'CATEGORY' | 'MODIFIER_GROUP' | 'MODIFIER_OPTION' | 'HIGHLIGHT';
  entityId: string | null;
  entityName: string;
  menuItemId: string | null;
  action: MenuChangeAction;
  /** [{ field, from, to, reason? }] for UPDATED / AVAILABILITY; a snapshot object for CREATED / DELETED. */
  changes: unknown;
  /** SYSTEM = nobody did it by hand: stock ran out, a temporary off ended, a combo sold out. */
  actorType: 'OWNER' | 'STAFF' | 'SYSTEM';
  actorId?: string | null;
  actorName: string;
  actorRole: string | null;
  source: 'PARTNER' | 'CREW' | 'SYSTEM';
  createdAt: string;
  /** Tabs this row is filed under (older servers omit it). */
  kinds?: MenuActivityKind[];
}

export interface MenuActivityPage {
  success: boolean;
  data: MenuChange[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor?: string | null;
  /** Older servers page by timestamp only. */
  nextBefore: string | null;
  /** Rows matching the filters — first page only. */
  total?: number;
  /** For an item/combo query: when the record was made, even before tracking began. */
  createdAt?: string;
}

/** Someone who has changed the menu — for the "Done by" filter. */
export interface MenuActivityActor {
  actorType: 'OWNER' | 'STAFF' | 'SYSTEM';
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  count: number;
  lastAt: string;
}

export interface MenuActivityQuery {
  itemId?: string;
  comboId?: string;
  kind?: MenuActivityKind | null;
  entity?: MenuActivityEntity | null;
  actorType?: MenuActivityActor['actorType'] | null;
  actorId?: string | null;
  /** ISO, inclusive. */
  from?: string | null;
  /** ISO, exclusive. */
  to?: string | null;
  cursor?: string | null;
  limit?: number;
}

export const adminHistory = {
  /** Newest first. Pass `cursor` = the previous page's nextCursor to load more. */
  list: (f: MenuActivityQuery) => {
    const q = new URLSearchParams();
    if (f.itemId) q.set('itemId', f.itemId);
    if (f.comboId) q.set('comboId', f.comboId);
    if (f.kind) q.set('kind', f.kind);
    if (f.entity) q.set('entity', f.entity);
    if (f.actorType) q.set('actorType', f.actorType);
    if (f.actorType && f.actorId) q.set('actorId', f.actorId);
    if (f.from) q.set('from', f.from);
    if (f.to) q.set('to', f.to);
    if (f.cursor) q.set('cursor', f.cursor);
    if (f.limit) q.set('limit', String(f.limit));
    const qs = q.toString();
    return call<MenuActivityPage>(`/history${qs ? `?${qs}` : ''}`);
  },
  /** Everyone who has changed the menu, busiest first. */
  actors: () => call<{ success: boolean; data: MenuActivityActor[] }>('/history/actors'),
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
