/**
 * One line per dish on the guest's bill.
 *
 * Every round of ordering is its own Order with its own KOT, so a Garlic Bread
 * ordered at 06:11 and three more at 06:34 arrive as two lines. The kitchen
 * needs them apart; the guest does not — they expect "4× Garlic Bread".
 *
 * Lines merge only when they are the same dish, the same options AND the same
 * unit price, so a price change between rounds keeps them apart and every
 * printed line still reads qty × price = amount. First-seen order is kept.
 *
 * Mirrors mergeBillLines in the backend's partner/bill-print.service.ts (the
 * remote-print path) — keep the rule identical, or a bill printed on another
 * phone's printer stops matching one printed here.
 */
export function mergeBillLines<T extends { name: string; qty: number; unitPrice: number; modifiersSummary?: string | null; menuItemId?: string | null }>(
  lines: T[],
): Omit<T, 'menuItemId'>[] {
  const merged = new Map<string, T>();
  for (const line of lines) {
    const key = [line.menuItemId || line.name, Number(line.unitPrice).toFixed(2), line.modifiersSummary ?? ''].join('\u0000');
    const seen = merged.get(key);
    if (seen) seen.qty += line.qty;
    else merged.set(key, { ...line });
  }
  return [...merged.values()].map(({ menuItemId: _drop, ...rest }) => rest as Omit<T, 'menuItemId'>);
}
