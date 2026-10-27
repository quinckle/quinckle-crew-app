/**
 * Cross-screen signal: order-menu.tsx's desktop path (`isWide`) pops straight
 * back to the table grid after placing ANY dine-in order — a free table's
 * first one or "Add items" on an occupied one. It has no route params to carry
 * the news back with (it's a plain `router.back()`, not a push), so it marks
 * the table here right before popping.
 *
 * index.tsx's table panel consumes the mark when the grid regains focus with
 * that table in the panel (or, for a free table, once its panel flips to
 * occupied), to play the order-placed curtain. One entry per table,
 * self-clearing on read — same shape as tableSessionStart.ts's map, minus
 * the listeners (the panel polls this synchronously off its own state
 * change, it doesn't need a subscription).
 */

const pending = new Set<string>();

export function signalOrderPlaced(tableDbId: string) {
  pending.add(tableDbId);
}

/** Check-and-clear — true only the first time anyone asks about this table. */
export function takeOrderPlacedSignal(tableDbId: string): boolean {
  if (!pending.has(tableDbId)) return false;
  pending.delete(tableDbId);
  return true;
}
