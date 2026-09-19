/**
 * How much of a bill's GST was ADDED on top, and how much was already inside
 * the prices.
 *
 * A venue with tax-inclusive menu prices (or a charge set to "incl. GST") still
 * reports its full GST — CGST/SGST must appear on a tax invoice — but that GST
 * is not added to the total. Listing it in the column that sums to TOTAL makes
 * the column not add up, which reads as a mistake.
 *
 * The backend doesn't send the split, but it doesn't need to: every order
 * satisfies `total = subtotal − discount + charges + tip + taxOnTop + roundOff`
 * (checkout-pricing.service.ts), and a session bill is the sum of its orders,
 * so the added part falls out by subtraction. Inclusive charges already carry
 * their GST inside `charges`, so they need no special case.
 */
export interface BillTaxSplit {
  /** GST that was added to the bill — belongs in the column above TOTAL. */
  added: number;
  /** GST already inside the prices — shown as a breakup, never summed. */
  included: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function splitBillTax(b: {
  subtotal: number;
  discount?: number | null;
  charges?: number | null;
  tip?: number | null;
  roundOff?: number | null;
  tax: number;
  total: number;
}): BillTaxSplit {
  const tax = r2(Math.max(0, b.tax));
  if (tax === 0) return { added: 0, included: 0 };
  const beforeTax = b.subtotal - (b.discount ?? 0) + (b.charges ?? 0) + (b.tip ?? 0) + (b.roundOff ?? 0);
  // Clamped: a bill whose columns don't reconcile (legacy data) degrades to
  // "all added" — exactly how every bill printed before this existed.
  const added = Math.min(tax, Math.max(0, r2(b.total - beforeTax)));
  const included = r2(tax - added);
  // Paise of float noise are not an inclusive venue.
  return included < 0.01 ? { added: tax, included: 0 } : { added, included };
}
