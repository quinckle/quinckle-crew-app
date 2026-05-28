/**
 * Diner Invoice / Bill Template builder
 *
 * Converts a session bill into ESC/POS text commands for 58mm or 80mm thermal printers.
 * Uses react-native-thermal-printer's text command format.
 *
 * Output: a single ESC/POS text string passed to ThermalPrinter.printText().
 */

export interface InvoiceItem {
  name: string;
  qty: number;
  unitPrice: number; // price per unit
  modifiersSummary?: string | null;
}

export interface InvoiceBill {
  restaurantName: string;
  restaurantAddress?: string | null;
  restaurantPhone?: string | null;
  restaurantEmail?: string | null;
  fssaiLicenseNumber?: string | null;
  tableNumber: number | string;
  sessionRef?: string | null;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  /** GST rate as a percentage integer (5, 12, or 18). Used for the label. */
  taxRate?: number;
  grandTotal: number;
  isPaid: boolean;
  paymentMethod?: 'cash' | 'upi_direct' | 'mixed' | string | null;
  splits?: Array<{ method: string; amount: number }>;
  generatedAt?: string; // ISO string — defaults to now
  orderDateTime?: string; // ISO string of order/session time
}

// ── Character widths ───────────────────────────────────────────────────────────

const WIDTH_58 = 32;
const WIDTH_80 = 48;

function lineWidth(paperWidth: 58 | 80): number {
  return paperWidth === 80 ? WIDTH_80 : WIDTH_58;
}

function divider(width: number, char = '─'): string {
  return char.repeat(width);
}

/**
 * Two-column left-right layout: pads `left` so `right` lands at the edge.
 * Truncates `left` with ellipsis if too long.
 */
function leftRight(left: string, right: string, width: number): string {
  const maxLeft = Math.max(0, width - right.length - 1);
  const trimmed = left.length > maxLeft ? left.slice(0, maxLeft - 2) + '..' : left;
  return trimmed.padEnd(maxLeft) + ' ' + right;
}

function fmt(amount: number): string {
  return `Rs.${amount.toFixed(0)}`;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${date}  ${time}`;
  } catch {
    return '--';
  }
}

// ── buildInvoiceText ───────────────────────────────────────────────────────────

/**
 * Returns the full diner invoice as a single ESC/POS text string.
 */
export function buildInvoiceText(bill: InvoiceBill, paperWidth: 58 | 80 = 58): string {
  const W = lineWidth(paperWidth);
  const lines: string[] = [];
  const D = divider(W, '=');
  const d = divider(W, '-');

  const now = bill.generatedAt ?? new Date().toISOString();
  const orderTime = bill.orderDateTime ?? now;
  const tableStr = String(bill.tableNumber).padStart(2, '0');

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push('[C]<b><font size="big">QUINCKLE</font></b>');
  lines.push(`[C]<b>${bill.restaurantName}</b>`);
  lines.push(`[C]${D}`);
  lines.push('[C]<b>TAX INVOICE</b>');
  lines.push(`[C]Table T${tableStr}`);
  if (bill.sessionRef) {
    lines.push(`[C]Session ${bill.sessionRef}`);
  }
  lines.push(`[C]Order: ${formatDateTime(orderTime)}`);
  if (bill.restaurantAddress) lines.push(`[C]${bill.restaurantAddress}`);
  if (bill.restaurantPhone) lines.push(`[C]Phone: ${bill.restaurantPhone}`);
  if (bill.restaurantEmail) lines.push(`[C]Email: ${bill.restaurantEmail}`);
  if (bill.fssaiLicenseNumber) lines.push(`[C]FSSAI: ${bill.fssaiLicenseNumber}`);
  lines.push(`[C]Printed: ${formatDateTime(now)}`);
  lines.push(`[L]${d}`);

  // ── Column header ─────────────────────────────────────────────────────────
  lines.push(`[L]${leftRight('ITEM', 'AMT', W)}`);
  lines.push(`[L]${d}`);

  // ── Items ─────────────────────────────────────────────────────────────────
  for (const item of bill.items) {
    const total = item.unitPrice * item.qty;
    const label = item.qty > 1 ? `${item.qty}x ${item.name}` : item.name;
    lines.push(`[L]${leftRight(label, fmt(total), W)}`);
    if (item.modifiersSummary) {
      // Indent modifier on next line
      lines.push(`[L]   * ${item.modifiersSummary}`);
    }
  }

  lines.push(`[L]${d}`);

  // ── Totals ────────────────────────────────────────────────────────────────
  lines.push(`[L]${leftRight('Subtotal', fmt(bill.subtotal), W)}`);
  // GST — only print if rate > 0
  if (bill.tax > 0) {
    const taxLabel = bill.taxRate ? `GST (${bill.taxRate}%)` : 'GST';
    lines.push(`[L]${leftRight(taxLabel, fmt(bill.tax), W)}`);
  }
  lines.push(`[L]${D}`);
  lines.push(`[L]<b>${leftRight('TOTAL', fmt(bill.grandTotal), W)}</b>`);
  lines.push(`[L]${D}`);

  // ── Payment status ────────────────────────────────────────────────────────
  if (bill.isPaid) {
    if (bill.paymentMethod === 'mixed' && bill.splits?.length) {
      lines.push('[C]<b>*** PAID — Split Payment ***</b>');
      for (const split of bill.splits) {
        const method =
          split.method === 'CASH'       ? 'Cash' :
          split.method === 'UPI_DIRECT' ? 'UPI'  : split.method;
        lines.push(`[C]${method}: ${fmt(split.amount)}`);
      }
    } else {
      const methodLabel =
        bill.paymentMethod === 'cash'       ? 'Cash' :
        bill.paymentMethod === 'upi_direct' ? 'UPI'  : 'Card';
      lines.push(`[C]<b>*** PAID via ${methodLabel} ***</b>`);
    }
  } else {
    lines.push('[C]<b>*** PAYMENT PENDING ***</b>');
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push(`[L]${d}`);
  lines.push('[C]Thank you! Visit again.');
  lines.push('[C]Powered by Quinckle');
  lines.push(`[C]${D}`);

  // Blank lines + cut
  lines.push('[L] ');
  lines.push('[L] ');
  lines.push('[C]<cut/>');

  return lines.join('\n');
}
