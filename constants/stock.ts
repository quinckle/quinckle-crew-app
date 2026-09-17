/**
 * Stock units and wastage reasons — mirrored from the web dashboard's
 * `components/dashboard/stock/shared.tsx` so the two surfaces say the same
 * words about the same numbers (STOCK_V2_PLAN.md · CREW_STOCK_PLAN.md).
 *
 * Quantities travel in BASE units (g / ml / pcs) and are typed and read in
 * kitchen units (kg / L / pcs). Every conversion lives here.
 */

export type StockBaseUnit = 'GRAM' | 'ML' | 'PCS';
export type StockEntryUnit = 'KG' | 'GRAM' | 'LITRE' | 'ML' | 'PCS';
export type WastageReason = 'SPOILED' | 'EXPIRED' | 'BURNT' | 'DROPPED' | 'RETURNED' | 'OTHER';

export const UNIT_LABEL: Record<StockEntryUnit, string> = {
  KG: 'kg', GRAM: 'g', LITRE: 'L', ML: 'ml', PCS: 'pcs',
};

const trim = (n: number, dp = 2) => Number(n.toFixed(dp)).toLocaleString('en-IN', { maximumFractionDigits: dp });

/** 2500 GRAM → "2.5 kg" · 750 ML → "750 ml" · 12 PCS → "12 pcs". */
export function fmtQty(qty: number, unit: StockBaseUnit | 'PLATE' | null | undefined): string {
  if (unit === 'PLATE') return `${trim(qty)} plate${qty === 1 ? '' : 's'}`;
  if (unit === 'GRAM') return Math.abs(qty) >= 1000 ? `${trim(qty / 1000, 3)} kg` : `${trim(qty)} g`;
  if (unit === 'ML') return Math.abs(qty) >= 1000 ? `${trim(qty / 1000, 3)} L` : `${trim(qty)} ml`;
  return `${trim(qty)} pcs`;
}

/** The units a quantity may be typed in, for a material stored in `base`. */
export function entryUnitsFor(base: StockBaseUnit): StockEntryUnit[] {
  if (base === 'GRAM') return ['KG', 'GRAM'];
  if (base === 'ML') return ['LITRE', 'ML'];
  return ['PCS'];
}

/** The unit a kitchen would normally SAY for this material — the sheet's default. */
export function defaultEntryUnit(base: StockBaseUnit): StockEntryUnit {
  return base === 'GRAM' ? 'KG' : base === 'ML' ? 'LITRE' : 'PCS';
}

/** Typed quantity → base units, for showing the effect of a sheet before saving. */
export function toBase(qty: number, unit: StockEntryUnit): number {
  if (unit === 'KG' || unit === 'LITRE') return qty * 1000;
  return qty;
}

export const REASONS: { value: WastageReason; label: string }[] = [
  { value: 'SPOILED', label: 'Spoiled' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'BURNT', label: 'Burnt' },
  { value: 'DROPPED', label: 'Dropped' },
  { value: 'RETURNED', label: 'Returned by guest' },
  { value: 'OTHER', label: 'Other' },
];

export const reasonLabel = (r: string) => REASONS.find((x) => x.value === r)?.label ?? r;

/** A movement's stored reason: "SPOILED: rotten" → "Spoiled — rotten". */
export function prettyReason(r: string | null | undefined): string | null {
  if (!r) return null;
  const m = /^(SPOILED|EXPIRED|BURNT|DROPPED|RETURNED|OTHER)(?::\s*(.*))?$/.exec(r);
  if (!m) return r;
  return m[2] ? `${reasonLabel(m[1]!)} — ${m[2]}` : reasonLabel(m[1]!);
}

export const inr = (n: number) =>
  '₹' + (Math.abs(n) < 0.005 ? 0 : n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** "17 Sep, 4:05 pm" in IST — venues read times in their own clock, not UTC. */
export function istDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}
