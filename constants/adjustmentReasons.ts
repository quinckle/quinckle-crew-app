/**
 * Coded reasons offered in the crew UI for money-affecting adjustments.
 *
 * Every `code` here MUST exist in the backend's `AdjustmentReason` Postgres
 * enum (see ADJUSTMENT_REASONS in the ops backend's adjustments.service.ts).
 * An unknown code comes back as 400 INVALID_REASON, and `OTHER` without free
 * text comes back as 400 REASON_TEXT_REQUIRED — both are prevented here by
 * construction, so an adjustment can never fail on validation the crew can't
 * see.
 *
 * The two lists are deliberately different, and the backend enforces the same
 * split (VOID_REASONS / COMP_REASONS):
 *
 *   • CANCEL — the food is not being paid for AND not being given away;
 *     usually it was never made.
 *   • WAIVE  — the food WAS made and served, and the money is written off.
 *
 * "Out of stock" cannot explain a write-off and "walkout" cannot explain a
 * cancelled line. Mixing them makes the ledger unreadable rather than merely
 * incomplete, which is why the picker takes the list as an argument instead of
 * showing every code everywhere.
 */

export interface ReasonOption {
  code: string;
  label: string;
  icon: string;
}

/** Reasons for a VOID (cancelled item / order). */
export const CANCEL_REASONS = [
  { code: 'WRONG_ITEM', label: 'Wrong item', icon: 'swap-horizontal-outline' },
  { code: 'CUSTOMER_CHANGED', label: 'Changed mind', icon: 'refresh-outline' },
  { code: 'OUT_OF_STOCK', label: 'Out of stock', icon: 'close-circle-outline' },
  { code: 'KITCHEN_ERROR', label: 'Kitchen error', icon: 'flame-outline' },
  { code: 'SPILLAGE_WASTE', label: 'Spilled / wasted', icon: 'water-outline' },
  { code: 'DUPLICATE', label: 'Duplicate', icon: 'copy-outline' },
  { code: 'TESTER_QA', label: 'Test order', icon: 'construct-outline' },
  { code: 'OTHER', label: 'Other', icon: 'ellipsis-horizontal' },
] as const satisfies readonly ReasonOption[];

/** Reasons for a COMP (write-off / waive). */
export const WAIVE_REASONS = [
  { code: 'WALKOUT', label: 'Walkout', icon: 'walk-outline' },
  { code: 'SERVICE_RECOVERY', label: 'Service recovery', icon: 'heart-outline' },
  { code: 'OWNER_MEAL', label: 'Owner meal', icon: 'person-outline' },
  { code: 'STAFF_MEAL', label: 'Staff meal', icon: 'people-outline' },
  { code: 'TESTER_QA', label: 'Test order', icon: 'construct-outline' },
  { code: 'OTHER', label: 'Other', icon: 'ellipsis-horizontal' },
] as const satisfies readonly ReasonOption[];

/**
 * Reasons for a full-session EXEMPTION (a discount that zeroes the whole bill).
 * WAIVE_REASONS minus WALKOUT: a walkout is discovered after the fact, not a
 * decision someone makes at the table.
 */
export const EXEMPTION_REASONS = WAIVE_REASONS.filter((r) => r.code !== 'WALKOUT');

/**
 * Would this discount absorb the entire bill? Mirrors the backend's
 * `zeroesTheBill`, which is authoritative — this is only to decide whether to
 * ask for a reason. Under-detecting is safe (the server answers 403
 * ADMIN_REQUIRED, which the UI surfaces); over-detecting only asks for a reason
 * that the server then ignores on a partial discount.
 */
export function wouldZeroBill(type: 'PERCENT' | 'FLAT', value: number, subtotal: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  return type === 'PERCENT' ? value >= 100 : subtotal > 0 && value >= subtotal;
}

/**
 * Reasons for a REFUND (money already collected, going back).
 * No "out of stock" or "changed mind": the bill was already settled, so what
 * happened is that something was wrong with what was served, or they were
 * charged twice.
 */
export const REFUND_REASONS = [
  { code: 'WRONG_ITEM', label: 'Wrong item', icon: 'swap-horizontal-outline' },
  { code: 'KITCHEN_ERROR', label: 'Kitchen error', icon: 'flame-outline' },
  { code: 'SERVICE_RECOVERY', label: 'Service recovery', icon: 'heart-outline' },
  { code: 'DUPLICATE', label: 'Charged twice', icon: 'copy-outline' },
  { code: 'OTHER', label: 'Other', icon: 'ellipsis-horizontal' },
] as const satisfies readonly ReasonOption[];

export type CancelReasonCode = (typeof CANCEL_REASONS)[number]['code'];
export type WaiveReasonCode = (typeof WAIVE_REASONS)[number]['code'];
export type ReasonCode = CancelReasonCode | WaiveReasonCode;

/** Wire shape sent to the adjustment endpoints. snake_case to match the API. */
export interface CancelReason {
  reason_code: ReasonCode;
  reason_text?: string;
}

/** Server caps the note at 500 chars; trim here so we never send a rejected value. */
export const REASON_TEXT_MAX = 500;

/** A selection is only sendable once OTHER has its free text. */
export function isReasonComplete(code: string | null, text: string): boolean {
  if (!code) return false;
  return code !== 'OTHER' || text.trim().length > 0;
}

/** Build the wire payload from a completed selection. */
export function toReasonPayload(code: string, text: string): CancelReason {
  const trimmed = text.trim();
  return code === 'OTHER'
    ? { reason_code: code as ReasonCode, reason_text: trimmed }
    : { reason_code: code as ReasonCode };
}
