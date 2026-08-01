/**
 * Cancellation reasons offered in the crew UI.
 *
 * Every `code` here MUST exist in the backend's `AdjustmentReason` Postgres
 * enum (see ADJUSTMENT_REASONS in the ops backend's adjustments.service.ts).
 * An unknown code comes back as 400 INVALID_REASON, and `OTHER` without free
 * text comes back as 400 REASON_TEXT_REQUIRED — both are prevented here by
 * construction, so a cancel can never fail on validation the crew can't see.
 *
 * This is deliberately a SUBSET of the enum: only void-shaped reasons belong on
 * a cancel. OWNER_MEAL / STAFF_MEAL / SERVICE_RECOVERY describe a comp (the
 * food was made and given away), not a cancellation, and belong to the
 * write-off flow. Eleven options would also slow the picker down at a busy
 * table — the whole point is that it costs one tap.
 */

export interface CancelReasonOption {
  code: CancelReasonCode;
  label: string;
  icon: string;
}

export const CANCEL_REASONS = [
  { code: 'WRONG_ITEM', label: 'Wrong item', icon: 'swap-horizontal-outline' },
  { code: 'CUSTOMER_CHANGED', label: 'Changed mind', icon: 'refresh-outline' },
  { code: 'OUT_OF_STOCK', label: 'Out of stock', icon: 'close-circle-outline' },
  { code: 'KITCHEN_ERROR', label: 'Kitchen error', icon: 'flame-outline' },
  { code: 'SPILLAGE_WASTE', label: 'Spilled / wasted', icon: 'water-outline' },
  { code: 'DUPLICATE', label: 'Duplicate', icon: 'copy-outline' },
  { code: 'TESTER_QA', label: 'Test order', icon: 'construct-outline' },
  { code: 'OTHER', label: 'Other', icon: 'ellipsis-horizontal' },
] as const satisfies readonly { code: string; label: string; icon: string }[];

export type CancelReasonCode = (typeof CANCEL_REASONS)[number]['code'];

/** Wire shape sent to the cancel endpoints. snake_case to match the API. */
export interface CancelReason {
  reason_code: CancelReasonCode;
  reason_text?: string;
}

/** Server caps the note at 500 chars; trim here so we never send a rejected value. */
export const REASON_TEXT_MAX = 500;
