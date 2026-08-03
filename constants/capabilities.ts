/**
 * Capability keys, mirrored from the backend (src/utils/capabilities.ts).
 * See STAFF_CAPABILITIES_HR_PLAN.md §2.
 *
 * THIS IS UX ONLY. Hiding a drawer item is a convenience, never a security
 * control — the backend enforces every one of these independently. Never rely
 * on this file to keep anyone out of anything.
 */

export const CAP = {
  TABLES: 'TABLES',
  ORDERS: 'ORDERS',
  ORDERS_LEDGER: 'ORDERS_LEDGER',
  PAYMENTS: 'PAYMENTS',
  CASH_DRAWER: 'CASH_DRAWER',
  DUES: 'DUES',
  OUTSTANDING: 'OUTSTANDING',
  KITCHEN: 'KITCHEN',
  MENU_EDIT: 'MENU_EDIT',
  STOCK: 'STOCK',
  EXPENSES: 'EXPENSES',
  MEMBERSHIPS: 'MEMBERSHIPS',
  ATTENDANCE_STATION: 'ATTENDANCE_STATION',
  WRITE_OFF: 'WRITE_OFF',
  ADJUSTMENTS: 'ADJUSTMENTS',
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];

/** Banner colour when a role has none set. Mirrors ROLE_COLOR_FALLBACK on the backend. */
export const ROLE_COLOR_FALLBACK = '#5F5E5A';

/** Human labels for the read-only "Your access" list. */
export const CAPABILITY_LABELS: Record<string, string> = {
  TABLES: 'Tables & floor',
  ORDERS: 'Take & modify orders',
  ORDERS_LEDGER: 'Order history',
  PAYMENTS: 'Collect payments',
  CASH_DRAWER: 'Cash drawer & Z-report',
  DUES: 'Khata / dues',
  OUTSTANDING: 'Outstanding receivables',
  KITCHEN: 'Kitchen display',
  MENU_EDIT: 'Edit menu & combos',
  STOCK: 'Stock & availability',
  EXPENSES: 'Record expenses',
  MEMBERSHIPS: 'Memberships',
  ATTENDANCE_STATION: 'Attendance station',
  WRITE_OFF: 'Write off bills',
  ADJUSTMENTS: 'Voids, comps & refunds',
};

/**
 * Does this staffer hold `capability`?
 *
 * **`undefined` means "unknown", and we answer YES.** That is deliberate. This
 * app ships by OTA and can run against a backend that predates the capability
 * rollout, and a restored session from before it has no list either. Answering
 * NO would blank out the drawer and strand a working staffer on an empty home
 * screen. Failing open is safe here precisely because this is UX only — the
 * server still refuses anything they genuinely lack.
 *
 * An EMPTY array is different: that is a real answer meaning "holds nothing".
 */
export function hasCapability(capabilities: string[] | undefined | null, capability: Capability): boolean {
  if (capabilities === undefined || capabilities === null) return true;
  return capabilities.includes(capability);
}

/** True if the staffer holds at least one of these. Same unknown-means-yes rule. */
export function hasAnyCapability(capabilities: string[] | undefined | null, wanted: Capability[]): boolean {
  if (capabilities === undefined || capabilities === null) return true;
  return wanted.some((c) => capabilities.includes(c));
}

/**
 * Which stack should this staffer land on? (plan §5)
 *
 * Replaces `staff.role === 'STEWARD' ? 'staff' : 'cook'`, which sent ADMINs and
 * CASHIERs to the kitchen because they simply weren't STEWARD.
 *
 * Capabilities decide when we know them; otherwise we keep the old role mapping
 * so an older backend behaves exactly as before.
 */
export function landingStackFor(
  capabilities: string[] | undefined | null,
  staffRole?: string | null
): 'staff' | 'cook' {
  if (Array.isArray(capabilities)) {
    // Kitchen-only staff go to the KDS; anyone with floor duties starts there.
    if (capabilities.includes(CAP.TABLES)) return 'staff';
    if (capabilities.includes(CAP.KITCHEN)) return 'cook';
    // Holds neither: the (staff) stack is the general shell, and its drawer
    // still shows whatever they do hold.
    return 'staff';
  }
  return staffRole === 'CHEF' ? 'cook' : 'staff';
}
