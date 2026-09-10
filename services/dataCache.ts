/**
 * dataCache.ts — tiny stale-while-revalidate cache for read-mostly API data
 * (menu, offers, branding). In-memory map for instant hits within the app
 * session, mirrored to AsyncStorage so the first screen-open after a cold
 * start also renders instantly.
 *
 * Usage pattern (SWR):
 *   const cached = await readCache<T>(key);
 *   if (cached) render(cached);            // instant paint
 *   fetchFresh().then(v => { writeCache(key, v); render(v); });
 *
 * There is deliberately no TTL — callers always revalidate in the background,
 * so the cache is only ever one fetch behind. Invalidate explicitly when this
 * device performs a write that changes the cached data (e.g. 86'ing an item).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'quinckle:cache:';

const mem = new Map<string, unknown>();

export async function readCache<T>(key: string): Promise<T | null> {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (raw == null) return null;
    const value = JSON.parse(raw) as T;
    mem.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  mem.set(key, value);
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => {});
}

/** Drop every cached entry whose key starts with `keyPrefix`. */
export function invalidateCache(keyPrefix: string): void {
  for (const key of mem.keys()) {
    if (key.startsWith(keyPrefix)) mem.delete(key);
  }
  AsyncStorage.getAllKeys()
    .then(keys => {
      const doomed = keys.filter(k => k.startsWith(PREFIX + keyPrefix));
      if (doomed.length) return AsyncStorage.multiRemove(doomed);
    })
    .catch(() => {});
}

export const cacheKeys = {
  crewOrderMenu: (restaurantId: string, channel: string) => `crew-order-menu:${restaurantId}:${channel}`,
  crewOffers: (restaurantId: string) => `crew-offers:${restaurantId}`,
};
