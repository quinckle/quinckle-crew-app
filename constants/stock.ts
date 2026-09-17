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

/**
 * Formatters are the last thing between a server response and the screen, so
 * they must survive a missing or non-numeric field. A throw here takes the whole
 * screen down — that is exactly what blanked the wastage tab when a mis-named
 * field arrived as undefined.
 */
const safe = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : Number(n) || 0);

const trim = (n: number, dp = 2) => Number(safe(n).toFixed(dp)).toLocaleString('en-IN', { maximumFractionDigits: dp });

/** 2500 GRAM → "2.5 kg" · 750 ML → "750 ml" · 12 PCS → "12 pcs". */
export function fmtQty(qty: number, unit: StockBaseUnit | 'PLATE' | null | undefined): string {
  const q = safe(qty);
  if (unit === 'PLATE') return `${trim(q)} plate${q === 1 ? '' : 's'}`;
  if (unit === 'GRAM') return Math.abs(q) >= 1000 ? `${trim(q / 1000, 3)} kg` : `${trim(q)} g`;
  if (unit === 'ML') return Math.abs(q) >= 1000 ? `${trim(q / 1000, 3)} L` : `${trim(q)} ml`;
  return `${trim(q)} pcs`;
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

/**
 * Base units → what to put in an entry box. The inverse of `toBase`: 2000 g
 * becomes `2 KG`, 150 g stays `150 GRAM`, pieces are always pieces. Used when
 * loading a saved recipe back into an editable form.
 */
export function fromBase(qtyBase: number, base: StockBaseUnit): { qty: number; unit: StockEntryUnit } {
  const q = Number(qtyBase) || 0;
  if (base === 'PCS') return { qty: q, unit: 'PCS' };
  const big = base === 'GRAM' ? 'KG' : 'LITRE';
  const small = base === 'GRAM' ? 'GRAM' : 'ML';
  return Math.abs(q) >= 1000 ? { qty: q / 1000, unit: big } : { qty: q, unit: small };
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

export const inr = (n: number) => {
  const v = safe(n);
  return '₹' + (Math.abs(v) < 0.005 ? 0 : v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

/** "17 Sep, 4:05 pm" in IST — venues read times in their own clock, not UTC. */
export function istDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}
