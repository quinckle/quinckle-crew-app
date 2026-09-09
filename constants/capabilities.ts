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
  // Two delivery keys, and the split is about MONEY (DELIVERY_V2_PLAN §3).
  // The counter dispatches and receives cash back; the rider carries it. They
  // are mutually exclusive for staff — enforced on the backend, not here —
  // because stage 3 and stage 4 are meant to be two people saying the same
  // number. An owner/manager may hold both and self-settle, which is stamped.
  DELIVERY_COUNTER: 'DELIVERY_COUNTER',
  DELIVERY_RIDER: 'DELIVERY_RIDER',
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
  DELIVERY_COUNTER: 'Delivery counter',
  DELIVERY_RIDER: 'Deliveries (riding)',
  // A pre-split backend still sends the single key; label it rather than
  // showing a staffer a blank row in "Your access".
  DELIVERY: 'Deliveries & riding',
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
 * Which delivery view does this staffer get? (DELIVERY_V2_PLAN §3/§4)
 *
 * There is no rider APP and no rider STACK — there is one Delivery tab whose
 * contents follow from the capability held, the same rule that already governs
 * every other screen.
 *
 *   'COUNTER'  the whole board: phone orders, dispatch, cancel, fail, cash back
 *   'RIDER'    only their own runs: details, payment sheet, Completed
 *   null       no delivery access; the tab does not appear at all
 *
 * COUNTER WINS when someone holds both. That combination is only legal for an
 * owner (the §3 exception), and the counter board is a superset of the rider
 * view — an owner who rides can still collect and complete from it. Showing
 * them the cut-down view instead would hide their own cash position.
 *
 * Unknown capabilities mean an older backend, so we answer COUNTER: that is
 * the board this app has always shown, and hiding it would strand a working
 * staffer. Server-side checks are the real control either way.
 */
export type DeliveryView = 'COUNTER' | 'RIDER' | null;

export function deliveryViewFor(capabilities: string[] | undefined | null): DeliveryView {
  if (!Array.isArray(capabilities)) return 'COUNTER';
  // 'DELIVERY' is the pre-split key. A backend that has not been migrated yet
  // still sends it, and it always meant the counter.
  const counter =
    capabilities.includes(CAP.DELIVERY_COUNTER) || capabilities.includes('DELIVERY');
  if (counter) return 'COUNTER';
  return capabilities.includes(CAP.DELIVERY_RIDER) ? 'RIDER' : null;
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
