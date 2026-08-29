/**
 * Sales-channel helpers, mirroring the backend's src/utils/channel.ts.
 *
 * The app grew up with two channels and hand-rolled `channel === 'TAKEAWAY'`
 * in ~19 places. Every one of those quietly treats a third channel as DINE_IN,
 * which for a delivery order means the wrong menu, or a label reading
 * "Table Tnull". Same bug the backend had; same fix — one place that decides.
 */

export type Channel = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

const CHANNELS: Channel[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];

/** Unknown input falls back to DINE_IN — the historical behaviour. */
export function normalizeChannel(raw: unknown): Channel {
  return CHANNELS.includes(raw as Channel) ? (raw as Channel) : 'DINE_IN';
}

/**
 * True when the food leaves the building — takeaway OR delivery.
 *
 * This is what almost every old `=== 'TAKEAWAY'` predicate actually meant:
 * "is this a tableless order?".
 */
export function isOffPremise(raw: unknown): boolean {
  return normalizeChannel(raw) !== 'DINE_IN';
}

/** "Takeaway" / "Delivery" / "Dine-in". */
export function channelLabel(raw: unknown): string {
  const c = normalizeChannel(raw);
  return c === 'DELIVERY' ? 'Delivery' : c === 'TAKEAWAY' ? 'Takeaway' : 'Dine-in';
}

/**
 * What to show where a table number would go.
 *
 * A tableless order has no table number, so `T${table_number}` renders as
 * "Tnull". Falls back to the channel name when there is no token.
 */
export function locationLabel(
  raw: unknown,
  opts: { token?: string | null; tableNumber?: number | string | null } = {},
): string {
  if (isOffPremise(raw)) return opts.token || channelLabel(raw);
  const t = opts.tableNumber;
  return t === null || t === undefined || t === '' ? 'Table —' : `T${t}`;
}
