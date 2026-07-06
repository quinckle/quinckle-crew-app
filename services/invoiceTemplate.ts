/**
 * Diner Invoice / Bill Template builder
 *
 * Converts a session bill into ESC/POS text commands for any thermal printer
 * width (58 / 72 / 80 / 112 mm). Layout + QR size are driven by the PaperProfile.
 * Uses react-native-thermal-printer's text command format.
 *
 * Output: a single ESC/POS text string passed to ThermalPrinter.printText().
 */

import { profileFromWidth, type PaperProfile } from './paperProfile';

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
  /** Only a GST-registered restaurant may legally print "TAX INVOICE" + GSTIN. Unregistered restaurants print a plain "BILL". */
  gstRegistered?: boolean;
  gstin?: string | null;
  tableNumber: number | string;
  /** DINE_IN (default) prints "Table TNN"; TAKEAWAY prints the takeaway header + pickup token. */
  channel?: 'DINE_IN' | 'TAKEAWAY';
  pickupToken?: string | null;
  sessionRef?: string | null;
  items: InvoiceItem[];
  subtotal: number;
  /** Discount total applied before charges/tax. Printed as its own negative line. */
  discount?: number;
  /** Service / packaging / cover charges total. Printed as its own line. */
  charges?: number;
  tax: number;
  /** GST rate as a percentage integer (5, 12, or 18). Used for the label. */
  taxRate?: number;
  grandTotal: number;
  isPaid: boolean;
  paymentMethod?: 'cash' | 'upi_direct' | 'mixed' | string | null;
  splits?: Array<{ method: string; amount: number }>;
  /** Partner VPA. When present and the bill is unpaid, a scan-to-pay UPI QR is printed. */
  upiVpa?: string | null;
  /** Display name shown in the diner's UPI app. Falls back to restaurantName. */
  upiName?: string | null;
  /** Print the static restaurant QR (payee only, no amount) instead of the
   *  exact-amount QR. Diner types the amount in their UPI app. */
  upiOmitAmount?: boolean;
  generatedAt?: string; // ISO string — defaults to now
  orderDateTime?: string; // ISO string of order/session time
}

/**
 * Builds an NPCI-spec UPI intent string. When `am` is provided the exact amount
 * is baked in (dynamic QR); when omitted the intent carries only the payee, so
 * the diner types the amount themselves (the restaurant's "static" QR).
 * Mirrors the backend buildUpiDeepLink (upi-direct-checkout.service.ts): only
 * the widely-accepted fields (pa, pn, am, cu) — no tn/mc/tr, which raise
 * decline risk on personal/P2P VPAs.
 */
function buildUpiPayString(opts: { pa: string; pn: string; am?: number | null }): string {
  const enc = (v: string | number) => encodeURIComponent(String(v));
  const parts = [
    `pa=${enc(opts.pa)}`,
    `pn=${enc(opts.pn)}`,
  ];
  if (opts.am != null) parts.push(`am=${enc(opts.am.toFixed(2))}`);
  parts.push(`cu=INR`);
  return `upi://pay?${parts.join('&')}`;
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

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

/**
 * Greedy word-wrap so long centered lines (e.g. the address) break at spaces
 * instead of hard-wrapping mid-word at the paper edge. A single word longer
 * than the line is hard-split as a last resort.
 */
function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
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
 *
 * `paper` accepts a full PaperProfile, or a bare width in mm (back-compat) which
 * is resolved to a profile via profileFromWidth().
 */
export function buildInvoiceText(bill: InvoiceBill, paper: PaperProfile | number = 58): string {
  const profile = typeof paper === 'number' ? profileFromWidth(paper) : paper;
  const W = profile.charsPerLine;
  const lines: string[] = [];
  const D = divider(W, '=');
  const d = divider(W, '-');

  const now = bill.generatedAt ?? new Date().toISOString();
  const orderTime = bill.orderDateTime ?? now;
  const tableStr = String(bill.tableNumber).padStart(2, '0');

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`[C]<b><font size="big">${bill.restaurantName}</font></b>`);
  lines.push(`[C]${D}`);
  lines.push(bill.gstRegistered ? '[C]<b>TAX INVOICE</b>' : '[C]<b>BILL</b>');
  if (bill.channel === 'TAKEAWAY') {
    lines.push('[C]<b>*** TAKEAWAY ***</b>');
    if (bill.pickupToken) {
      lines.push(`[C]<b><font size="big">${bill.pickupToken}</font></b>`);
    }
  } else {
    lines.push(`[C]Table T${tableStr}`);
  }
  if (bill.sessionRef) {
    lines.push(`[C]Session ${bill.sessionRef}`);
  }
  lines.push(`[C]Order: ${formatDateTime(orderTime)}`);
  if (bill.restaurantAddress) {
    for (const ln of wrapText(bill.restaurantAddress, W)) lines.push(`[C]${ln}`);
  }
  if (bill.restaurantPhone) lines.push(`[C]Phone: ${bill.restaurantPhone}`);
  if (bill.restaurantEmail) lines.push(`[C]Email: ${bill.restaurantEmail}`);
  if (bill.fssaiLicenseNumber) lines.push(`[C]FSSAI: ${bill.fssaiLicenseNumber}`);
  if (bill.gstRegistered && bill.gstin) lines.push(`[C]GSTIN: ${bill.gstin}`);
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
  if ((bill.discount ?? 0) > 0) {
    lines.push(`[L]${leftRight('Discount', `-${fmt(bill.discount!)}`, W)}`);
  }
  if ((bill.charges ?? 0) !== 0) {
    const chargeAmount = Number(bill.charges ?? 0);
    const chargeLabel = chargeAmount > 0 ? 'Service charge' : 'Adjustment';
    const chargeValue = chargeAmount < 0 ? `-${fmt(Math.abs(chargeAmount))}` : fmt(chargeAmount);
    lines.push(`[L]${leftRight(chargeLabel, chargeValue, W)}`);
  }
  if (bill.tax > 0) {
    const taxLabel = bill.gstRegistered
      ? (bill.taxRate ? `GST (${bill.taxRate}%)` : 'GST')
      : 'Tax';
    lines.push(`[L]${leftRight(taxLabel, fmt(bill.tax), W)}`);
  }
  lines.push(`[L]${D}`);
  lines.push(`[L]<b>${leftRight('TOTAL', fmt(bill.grandTotal), W)}</b>`);
  lines.push(`[L]${D}`);

  // ── Scan-to-pay UPI QR (unpaid bills with a configured VPA only) ──────────
  // `upiOmitAmount` prints the restaurant's static QR (payee only, diner enters
  // the amount); otherwise the exact bill amount is baked into the intent.
  if (!bill.isPaid && bill.upiVpa) {
    const staticQr = bill.upiOmitAmount === true;
    const upiString = buildUpiPayString({
      pa: bill.upiVpa,
      pn: bill.upiName || bill.restaurantName,
      am: staticQr ? null : bill.grandTotal,
    });
    lines.push(`[L]${d}`);
    lines.push(staticQr
      ? `[C]<b>Scan to pay</b>`
      : `[C]<b>Scan to pay ${fmt(bill.grandTotal)}</b>`);
    lines.push('[C] '); // breathing room between the heading and the QR
    lines.push(`[C]<qrcode size='${profile.qrSize}'>${upiString}</qrcode>`);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push(`[L]${d}`);
  lines.push(bill.channel === 'TAKEAWAY'
    ? '[C]Thank you for your order.'
    : '[C]Thank you for dining with us.');
  lines.push('[C]Support & feedback:');
  lines.push('[C]quinckle.com/support');
  lines.push('[C]support@quinckle.com');
  lines.push('[C]Powered by Quinckle');
  lines.push(`[C]${D}`);

  // Blank lines + cut
  lines.push('[L] ');
  lines.push('[L] ');
  lines.push('[C]<cut/>');

  return lines.join('\n');
}
