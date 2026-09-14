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
import { isOffPremise, channelLabel } from '../constants/channel';

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
  /** Recipient (buyer) GSTIN for a B2B tax invoice. Prints a "Bill To" block when present. */
  buyerGstin?: string | null;
  /** Recipient business/legal name printed alongside the buyer GSTIN. */
  buyerName?: string | null;
  /** Khata: the customer the pay-later amount is recorded under. */
  customerName?: string | null;
  tableNumber: number | string;
  /** DINE_IN (default) prints "Table TNN"; off-premise channels print their own
   *  banner + order token. */
  channel?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  pickupToken?: string | null;
  /** Sequential tax-invoice number (e.g. "INV/2026-27/000123"). Printed in place of the internal session ref when present. */
  invoiceNumber?: string | null;
  sessionRef?: string | null;
  items: InvoiceItem[];
  subtotal: number;
  /** Discount total applied before charges/tax. Printed as its own negative line. */
  discount?: number;
  /** Service / packaging / cover charges total. Printed as its own line only
   *  when `chargeLines` is absent (legacy payloads and negative adjustments). */
  charges?: number;
  /** Itemised charges carrying the partner's own names, e.g.
   *  [{ name: 'Packaging', amount: 20 }]. Preferred over the collapsed
   *  `charges` total, which cannot tell a parcel charge from a service charge
   *  and so printed everything as "Service charge". */
  chargeLines?: { name: string; amount: number }[];
  tax: number;
  /** GST rate as a percentage integer (5, 12, or 18). Used for the label. */
  taxRate?: number;
  /** 'split' prints CGST + SGST (each half the rate); 'combined' (default) prints one GST line. */
  taxDisplayMode?: 'combined' | 'split';
  /** Rate-wise GST grouping (Phase 2). When present, one GST block is printed per
   *  rate; falls back to the single `tax`/`taxRate` line when absent (legacy). */
  taxLines?: Array<{ rate: number; taxableValue: number; cgst: number; sgst: number; amount: number }>;
  /** When true, menu prices already include GST — a note clarifies the tax is
   *  shown for information and not added on top (Phase 4). */
  pricesIncludeTax?: boolean;
  /** Signed rupee rounding that reconciles the paise-precision GST lines to the
   *  whole-rupee `grandTotal` (e.g. -0.30). Printed as its own line when non-zero
   *  — without it the bill visibly doesn't add up. */
  roundOff?: number;
  /** Tip, added after tax and never charged or taxed. It has its own line
   *  because callers previously smuggled it through `charges`, which printed a
   *  customer's tip as "Service charge". */
  tip?: number;
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
  /** Owner's custom "thank you" line (Bill Settings). Replaces the default
   *  "Thank you for dining with us." / "Thank you for your order." when set. */
  thankYouMessage?: string | null;
  /** Owner's custom free-text footer note (Bill Settings), printed below the
   *  thank-you line. Word-wrapped to the paper width. */
  footerNote?: string | null;
  /** Loyalty bill nudge (LOYALTY_POINTS_PLAN.md §2.1, §8.6). Comes verbatim
   *  from Session.loyaltySnapshot via finalize-invoice — a SNAPSHOT taken when
   *  the points were earned, never recomputed here. Absent/null for every
   *  restaurant without an active loyalty program, in which case the block
   *  simply does not print. */
  loyalty?: LoyaltyNudge | null;
}

/** Mirror of the backend's LoyaltyBillSnapshot (services/loyalty/bill-nudge.service.ts).
 *  Every field is treated as possibly-absent: old sessions were snapshotted by
 *  earlier versions, and a bill must still print if the shape is unfamiliar. */
export interface LoyaltyNudge {
  pointsEarned?: number;
  balanceAfter?: number;
  pointsLabel?: string;
  nextGoal?: {
    name: string;
    gap: number;
    target: number;
    kind: 'REWARD' | 'TIER';
    ready: boolean;
  } | null;
  /**
   * Step ladder (§22), present only for a STEP_LADDER programme. Absent on every
   * bill written before the ladder existed and on every points programme since,
   * which is exactly why loyaltyLines branches on it rather than replacing the
   * points lines — an old session must still reprint the way it always did.
   */
  ladder?: {
    step: number;
    totalSteps: number;
    rewardName: string | null;
    nextRewardName: string | null;
    completesLadder: boolean;
  } | null;
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
 * Paise-precision money. Used ONLY for the GST lines and the round-off, which
 * legally must show the exact amount charged — everything else on the bill is
 * whole rupees. A tax line printed at 0dp is what forced the old bill to split
 * ₹5 into an invalid CGST 3 / SGST 2.
 */
function fmt2(amount: number): string {
  return `Rs.${amount.toFixed(2)}`;
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

/**
 * The ladder block (§22).
 *
 *     Chaarpai Club
 *     Step 3 of 5
 *     [######----] 60%
 *     Free cappuccino - on us today
 *     Next visit: 8% off
 *
 * Uses the SAME [#####-----] bar the points nudge below already prints, rather
 * than the filled circles the screens use. That bar is proven on this hardware
 * and is pure ASCII; ● and ○ depend on the printer's active codepage and would
 * become mojibake on anything that does not carry them. A diner's bill is the
 * wrong place to discover which printers those are.
 *
 * Width-aware like everything else here: this prints at 32, 42, 48 and 69
 * characters depending on the roll the partner loaded.
 */
function ladderLines(ladder: NonNullable<LoyaltyNudge['ladder']>, W: number): string[] {
  const total = Math.max(1, Math.trunc(ladder.totalSteps ?? 1));
  const step = Math.max(1, Math.min(total, Math.trunc(ladder.step ?? 1)));

  const out: string[] = [];
  out.push(`[C]<b>Rewards</b>`);
  out.push(`[L]${leftRight('Your progress', `Step ${step} of ${total}`, W)}`);

  const barW = Math.min(20, Math.max(8, W - 8));
  const pct = Math.max(0, Math.min(100, Math.round((step / total) * 100)));
  const filled = Math.round((pct / 100) * barW);
  out.push(`[L][${'#'.repeat(filled)}${'-'.repeat(barW - filled)}] ${pct}%`);

  // What they got today. An empty step prints nothing here rather than a line
  // saying nothing happened — they still advanced, which the bar already shows.
  if (ladder.rewardName) {
    for (const ln of wrapText(`${ladder.rewardName} - on us today`, W)) out.push(`[L]${ln}`);
  }

  // Finishing wins over "next visit": under RESET the next step is 1 again, and
  // "Next visit: 2% off" would bury the fact that they just completed a lap.
  if (ladder.completesLadder) {
    for (const ln of wrapText(`You've finished the ladder!`, W)) out.push(`[L]${ln}`);
  } else if (ladder.nextRewardName) {
    for (const ln of wrapText(`Next visit: ${ladder.nextRewardName}`, W)) out.push(`[L]${ln}`);
  }

  return out;
}

/**
 * The three loyalty lines (LOYALTY_POINTS_PLAN.md §2.1) — the highest
 * impact-to-effort feature in the plan, and the one thing a bolt-on loyalty
 * vendor physically cannot do without deep POS integration.
 *
 *     Rewards
 *     Points earned this visit      +42
 *     Your points balance           138
 *     120 more -> Free Cappuccino
 *     [######----] 53%
 *
 * Everything here is READ from the snapshot, never computed from today's
 * catalog (§7.7): a reprint issued after the reward was renamed or repriced
 * must still show what was true at the time of sale.
 *
 * Returns [] when there is nothing worth saying, so the caller prints no
 * divider and no heading either.
 */
function loyaltyLines(nudge: LoyaltyNudge, W: number): string[] {
  // A step ladder is a different programme, not a different skin on points:
  // there is no balance to report and nothing to spend. Branch first, and leave
  // the points path below untouched for every bill that predates the ladder.
  if (nudge.ladder) return ladderLines(nudge.ladder, W);

  const earned = Math.max(0, Math.trunc(nudge.pointsEarned ?? 0));
  const balance = Math.max(0, Math.trunc(nudge.balanceAfter ?? 0));

  // Nothing earned and nothing banked — printing "+0 / 0" is noise, not a nudge.
  if (earned <= 0 && balance <= 0) return [];

  // The owner renames points ("beans", "stars"); the snapshot carries the label
  // that was in force at the time of sale.
  const rawLabel = (nudge.pointsLabel ?? 'points').trim() || 'points';
  const Label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);

  const out: string[] = [];
  out.push(`[C]<b>Rewards</b>`);
  if (earned > 0) out.push(`[L]${leftRight(`${Label} earned this visit`, `+${earned}`, W)}`);
  out.push(`[L]${leftRight(`Your ${rawLabel} balance`, String(balance), W)}`);

  const goal = nudge.nextGoal;
  if (goal && goal.name) {
    if (goal.ready) {
      for (const ln of wrapText(`Ready to redeem: ${goal.name}`, W)) out.push(`[L]${ln}`);
    } else if (goal.gap > 0) {
      for (const ln of wrapText(`${goal.gap} more -> ${goal.name}`, W)) out.push(`[L]${ln}`);
      // Progress reads identically for both goal kinds because gap is always
      // (target - current): a REWARD measures balance against its cost, a TIER
      // measures lifetime earned against its threshold. Guard the divide — a
      // malformed snapshot must not print "NaN%" on a customer's bill.
      if (goal.target > 0 && goal.gap <= goal.target) {
        const barW = Math.min(20, Math.max(8, W - 8));
        const pct = Math.max(0, Math.min(100, Math.round(((goal.target - goal.gap) / goal.target) * 100)));
        const filled = Math.round((pct / 100) * barW);
        out.push(`[L][${'#'.repeat(filled)}${'-'.repeat(barW - filled)}] ${pct}%`);
      }
    }
  }

  return out;
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
  if (isOffPremise(bill.channel)) {
    lines.push(`[C]<b>*** ${channelLabel(bill.channel).toUpperCase()} ***</b>`);
    if (bill.pickupToken) {
      lines.push(`[C]<b><font size="big">${bill.pickupToken}</font></b>`);
    }
  } else {
    lines.push(`[C]Table T${tableStr}`);
  }
  // A finalized bill carries the real invoice number; the session ref is only an
  // internal fallback for not-yet-numbered (e.g. offline first-print) bills.
  if (bill.invoiceNumber) {
    lines.push(`[C]<b>Invoice No: ${bill.invoiceNumber}</b>`);
  } else if (bill.sessionRef) {
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

  // ── Bill To (recipient GSTIN, B2B only) ───────────────────────────────────
  if (bill.buyerGstin) {
    lines.push('[L]<b>Bill To:</b>');
    if (bill.buyerName) {
      for (const ln of wrapText(bill.buyerName, W - 2)) lines.push(`[L]  ${ln}`);
    }
    lines.push(`[L]  GSTIN: ${bill.buyerGstin}`);
    lines.push(`[L]${d}`);
  }

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
  // Print each charge under the name the partner gave it. Falling back to the
  // collapsed total labelled "Service charge" is only correct for bills written
  // before charge names were snapshotted — and under CCPA 2022 a service charge
  // is specifically the optional one, so labelling a mandatory packaging fee as
  // one misrepresents it on the customer's only physical record.
  const namedCharges = (bill.chargeLines ?? []).filter((c) => Number(c.amount) !== 0);
  if (namedCharges.length > 0) {
    for (const c of namedCharges) {
      const amt = Number(c.amount);
      const value = amt < 0 ? `-${fmt(Math.abs(amt))}` : fmt(amt);
      lines.push(`[L]${leftRight(c.name, value, W)}`);
    }
  } else if ((bill.charges ?? 0) !== 0) {
    const chargeAmount = Number(bill.charges ?? 0);
    const chargeLabel = chargeAmount > 0 ? 'Service charge' : 'Adjustment';
    const chargeValue = chargeAmount < 0 ? `-${fmt(Math.abs(chargeAmount))}` : fmt(chargeAmount);
    lines.push(`[L]${leftRight(chargeLabel, chargeValue, W)}`);
  }
  // GST lines. Prefer the rate-wise breakdown (Phase 2): one block per rate,
  // each optionally split into CGST + SGST. Falls back to the single combined
  // line when no per-rate data is present (legacy bills).
  const rateLines = (bill.taxLines ?? []).filter((l) => l.amount > 0);
  const half = (rate: number) => (rate / 2).toFixed(1).replace(/\.0$/, '');
  if (rateLines.length > 0) {
    for (const l of rateLines) {
      if (bill.taxDisplayMode === 'split') {
        lines.push(`[L]${leftRight(`CGST (${half(l.rate)}%)`, fmt2(l.cgst), W)}`);
        lines.push(`[L]${leftRight(`SGST (${half(l.rate)}%)`, fmt2(l.sgst), W)}`);
      } else {
        lines.push(`[L]${leftRight(`GST (${l.rate}%)`, fmt2(l.amount), W)}`);
      }
    }
  } else if (bill.tax > 0) {
    if (bill.gstRegistered && bill.taxDisplayMode === 'split' && bill.taxRate) {
      // Legacy bills (whole-rupee stored tax, no rate lines) keep the old
      // round-then-halve split so a reprint matches the paper the diner got.
      const cgst = Math.round(bill.tax / 2);
      lines.push(`[L]${leftRight(`CGST (${half(bill.taxRate)}%)`, fmt(cgst), W)}`);
      lines.push(`[L]${leftRight(`SGST (${half(bill.taxRate)}%)`, fmt(bill.tax - cgst), W)}`);
    } else {
      const taxLabel = bill.gstRegistered
        ? (bill.taxRate ? `GST (${bill.taxRate}%)` : 'GST')
        : 'Tax';
      lines.push(`[L]${leftRight(taxLabel, fmt(bill.tax), W)}`);
    }
  }
  // Tip sits after tax: it is never taxed and never charged on.
  if ((bill.tip ?? 0) > 0) {
    lines.push(`[L]${leftRight('Tip', fmt(bill.tip!), W)}`);
  }
  // Rupee rounding — printed between GST and TOTAL so the column adds up on
  // paper. Rendered with an explicit sign; it is usually negative.
  const roundOff = Number(bill.roundOff ?? 0);
  if (Math.abs(roundOff) >= 0.005) {
    const shown = roundOff < 0 ? `-${fmt2(Math.abs(roundOff))}` : `+${fmt2(roundOff)}`;
    lines.push(`[L]${leftRight('Round off', shown, W)}`);
  }
  // Inclusive pricing: the GST above is embedded in the prices, not added — say
  // so, otherwise the unchanged TOTAL reads like a mistake (Phase 4).
  if (bill.pricesIncludeTax && bill.tax > 0) {
    lines.push('[L](GST included in the prices above)');
  }
  lines.push(`[L]${D}`);
  lines.push(`[L]<b>${leftRight('TOTAL', fmt(bill.grandTotal), W)}</b>`);
  lines.push(`[L]${D}`);

  // ── Khata (pay later) ─────────────────────────────────────────────────────
  // The bill is settled at the table but the money is owed on the customer's
  // khata — say so on paper, with the name it's recorded under, so a walked
  // copy matches the ledger.
  if (bill.paymentMethod === 'due') {
    lines.push(`[C]<b>PAY LATER — ON KHATA</b>`);
    if (bill.customerName) lines.push(`[C]Recorded for ${bill.customerName}`);
    lines.push(`[L]${D}`);
  } else if (bill.paymentMethod === 'waived') {
    lines.push(`[C]<b>BILL WAIVED</b>`);
    lines.push(`[L]${D}`);
  }

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

  // ── Loyalty nudge (§2.1) ──────────────────────────────────────────────────
  // Prints only for restaurants running an active program, and only when the
  // diner actually has something to be told.
  if (bill.loyalty) {
    const nudge = loyaltyLines(bill.loyalty, W);
    if (nudge.length > 0) {
      lines.push(`[L]${d}`);
      for (const ln of nudge) lines.push(ln);
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push(`[L]${d}`);
  // Owner's custom thank-you line overrides the channel default when configured.
  const thankYou = bill.thankYouMessage?.trim()
    || (isOffPremise(bill.channel) ? 'Thank you for your order.' : 'Thank you for dining with us.');
  for (const ln of wrapText(thankYou, W)) lines.push(`[C]${ln}`);
  // Owner's custom free-text footer note (e.g. "No returns on cooked food",
  // "WiFi: guest123"), printed below the thank-you line when set.
  if (bill.footerNote?.trim()) {
    for (const ln of wrapText(bill.footerNote.trim(), W)) lines.push(`[C]${ln}`);
  }
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
