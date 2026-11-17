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
import type { CrewLadder } from './api';
import { splitBillTax } from './billTax';

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
  /** The diner on this bill. Printed under the header on every bill, and again
   *  on a khata bill as the name the pay-later amount is recorded under. */
  customerName?: string | null;
  /** Printed masked (98xxxxx210) — a bill gets left on tables and binned. */
  customerPhone?: string | null;
  /** Venue logo as a data: URI, already black-on-white at print size (from
   *  /crew/print/bill-logo). Printed above the restaurant name. */
  logoDataUri?: string | null;
  /** Staff member producing the bill (the logged-in crew user). */
  billerName?: string | null;
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
  /** Named parts of `discount`. Printed one line each when they add up to it;
   *  otherwise the single "Discount" line is printed. */
  discountLines?: { name: string; amount: number }[];
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
  /** The venue's inclusive-pricing setting. false → all GST prints in the
   *  column as it always has; true → the GST inside the prices prints as a
   *  breakup under TOTAL (see billTax.ts). */
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
  /** Printer settings: whether a PAID bill still carries a QR, and which —
   *  'STATIC' (payee only) or 'AMOUNT'. Absent/'OFF' → no QR once paid. */
  paidUpiQr?: 'OFF' | 'STATIC' | 'AMOUNT';
  /** Printer settings: logo above the restaurant name (default) or at the
   *  foot of the bill, under the venue's own footer text. */
  logoPosition?: 'TOP' | 'BOTTOM';
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
  /** The table's live loyalty ladder (loyaltyApi.balance), loaded at print
   *  time. Preferred over `loyalty`'s snapshot, which only exists after payment. */
  liveLadder?: CrewLadder | null;
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
    /** Qualifying visits still needed after this one (0/absent = on the ladder). */
    visitsToUnlock?: number;
    /** The owner's minimum bill for a visit to count. */
    minBill?: number | null;
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

/** Data codewords per QR version at error-correction level L (ISO 18004 table 7). */
const QR_L_DATA_CODEWORDS = [0, 19, 34, 55, 80, 108, 136, 156, 194, 232, 274];

/**
 * The QR symbol's side in modules, as DantSu (zxing Encoder, ECC L, UTF-8 hint)
 * will build it: byte mode + a 12-bit ECI header + an 8/16-bit length.
 * Returns null past version 10 — far beyond any UPI intent. `data` is a
 * percent-encoded URI, so its length is its UTF-8 byte count.
 */
export function qrModuleCount(data: string): number | null {
  const bytes = data.length;
  for (let v = 1; v < QR_L_DATA_CODEWORDS.length; v++) {
    const bits = 12 + 4 + (v < 10 ? 8 : 16) + bytes * 8;
    if (bits <= QR_L_DATA_CODEWORDS[v] * 8) return 17 + 4 * v;
  }
  return null;
}

/**
 * The <qrcode size='…'> value (mm) for a payload.
 *
 * DantSu draws each QR module as round(sizePx / modules) printer dots, so a
 * fixed size shrinks the modules whenever the payload tips into the next QR
 * version. Baking `am=` into a UPI intent does exactly that: on 58mm paper a
 * 20mm code dropped from 5 to 4 dots per module (0.5mm, ECC L, no quiet zone)
 * and UPI apps stopped reading it, while the shorter static intent still
 * printed at 5. Sizing from the module count pins every module at the
 * static QR's proven ~0.63mm (5 dots at 203dpi) and only shrinks it to stay
 * within ~70% of the printable width. Not bigger: 6 dots made a ~6KB raster
 * the printer could not buffer, and the bill was cut off mid-QR.
 */
function qrSizeMm(data: string, profile: PaperProfile): number {
  const modules = qrModuleCount(data);
  if (!modules) return profile.qrSize;
  const dotsPerMm = profile.dpi / 25.4;
  const maxDots = Math.floor(profile.printableWidthMM * 0.7 * dotsPerMm);
  const dotsPerModule = Math.max(1, Math.min(Math.round(0.625 * dotsPerMm), Math.floor(maxDots / modules)));
  return Number(((modules * dotsPerModule) / dotsPerMm).toFixed(2));
}

/** Pre-disconnect wait that printed a 58mm bill in full on 2026-10-03, with a
 *  QR raster of up to VERIFIED_QR_RASTER_BYTES. KOTs keep their own 320ms. */
export const BILL_END_WAIT_MS = 2500;
/** 185px × 24 bytes/row — the largest 5-dot raster of a v4/v5 code. */
export const VERIFIED_QR_RASTER_BYTES = 4440;

/**
 * How long the socket must stay open after a bill is sent. DantSu closes it
 * after the end-feed wait whether or not the printer has drained, and the QR
 * raster is the one part the printer cannot buffer — a 320ms wait cut a bill
 * off mid-QR. A larger QR (a long VPA/payee name) scales the proven wait.
 */
export function billEndWaitMs(text: string, profile: PaperProfile): number {
  const size = text.match(/<qrcode size='([\d.]+)'>/)?.[1];
  if (!size) return BILL_END_WAIT_MS;
  const px = Math.round((parseFloat(size) * profile.dpi) / 25.4);
  const rasterBytes = Math.ceil(px / 8) * px;
  return Math.max(BILL_END_WAIT_MS, Math.ceil((BILL_END_WAIT_MS * rasterBytes) / VERIFIED_QR_RASTER_BYTES));
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
 * The ladder block (§22), kept simple:
 *
 *            LOYALTY REWARDS
 *     Next reward: 10% off your bill
 *       in 2 more visits
 *     Rewards up to: Free Thali
 *       on visit 8
 *     Visit more, earn more rewards!
 *
 * The next reward after this visit and how many visits away it is, then the
 * top reward the card builds to. Nothing about today's reward — the bill's own
 * lines already show it.
 *
 * Prefers the live ladder (loyaltyApi.balance), which the crew app loads at
 * print time. Its `step` is always THIS visit's step, paid or not — the
 * server leaves the current session out when counting — so "N more visits"
 * is right on every bill. Session.loyaltySnapshot (written at payment, no step
 * list) is the fallback when the live read failed.
 */
const LADDER_TITLE = '[C]<b>LOYALTY REWARDS</b>';
const VISIT_MORE = '[C]Visit more, earn more rewards!';

function wrapped(text: string, W: number): string[] {
  return wrapText(text, W).map((ln) => `[L]${ln}`);
}

function visitsAway(n: number): string {
  return n === 1 ? '  on your next visit' : `  in ${n} more visits`;
}

function unlockLines(visitsToUnlock: number, minBill: number | null | undefined, W: number): string[] {
  const out = [LADDER_TITLE];
  out.push(...wrapped(`${visitsToUnlock} more visit${visitsToUnlock === 1 ? '' : 's'} to unlock rewards`, W));
  if (minBill) out.push(...wrapped(`Visits count on bills of Rs.${Math.round(minBill)}+`, W));
  out.push(VISIT_MORE);
  return out;
}

/** Fallback: the payment-time snapshot, which only knows the next visit's reward. */
function ladderLines(ladder: NonNullable<LoyaltyNudge['ladder']>, W: number): string[] {
  const toUnlock = Math.max(0, Math.trunc(ladder.visitsToUnlock ?? 0));
  if (toUnlock > 0) return unlockLines(toUnlock, ladder.minBill, W);

  const out = [LADDER_TITLE];
  if (ladder.nextRewardName && !ladder.completesLadder) {
    out.push(...wrapped(`Next reward: ${ladder.nextRewardName}`, W));
    out.push(`[L]${visitsAway(1)}`);
  }
  out.push(VISIT_MORE);
  return out;
}

/** The live ladder. Nothing when not joined or this visit doesn't count. */
function liveLadderLines(ladder: CrewLadder, W: number): string[] {
  if (!ladder.optedIn) return [];
  const toUnlock = Math.max(0, Math.trunc(ladder.visitsToUnlock ?? 0));
  if (toUnlock > 0) return unlockLines(toUnlock, ladder.minBill, W);
  if (ladder.eligible === false) return [];

  const step = Math.max(1, Math.trunc(ladder.step ?? 1));
  const total = Math.max(step, Math.trunc(ladder.totalSteps ?? step));
  const rewarded = ladder.steps.filter((s) => s.rewardName);
  const top = rewarded[rewarded.length - 1];

  // The next reward after this visit. Later on this lap first; failing that,
  // the server's own next-visit reward (covers HOLD_LAST and CUSTOM); failing
  // that, under RESET only, the first reward of the next lap — counted across
  // the end of the card. Maniqueen (5 steps, 5 empty, RESET) needs the last.
  let next: { name: string; visits: number } | null = null;
  const ahead = rewarded.find((s) => s.position > step);
  if (ahead) next = { name: ahead.rewardName!, visits: ahead.position - step };
  else if (ladder.nextVisit?.rewardName) next = { name: ladder.nextVisit.rewardName, visits: 1 };
  else if (ladder.policy === 'RESET' && rewarded[0]) {
    next = { name: rewarded[0].rewardName!, visits: total - step + rewarded[0].position };
  }

  const out = [LADDER_TITLE];
  if (ladder.completesLadder) out.push(...wrapped(`You've completed the card!`, W));
  if (next) {
    out.push(...wrapped(`Next reward: ${next.name}`, W));
    out.push(`[L]${visitsAway(next.visits)}`);
  }
  // The reward the card builds to, while it's still ahead on this lap —
  // unless it's the one just named.
  if (top && top.position > step && top.position !== ahead?.position) {
    out.push(...wrapped(`Rewards up to: ${top.rewardName}`, W));
    out.push(`[L]  on visit ${top.position}`);
  }
  out.push(VISIT_MORE);
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

/**
 * 9876543210 → 98xxxxx210. Only a longer-than-10-digit number is treated as
 * carrying a country code: a real 10-digit number can itself start with 91.
 */
export function maskPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 10) digits = digits.slice(-10);
  if (digits.length < 6) return digits;
  return `${digits.slice(0, 2)}${'x'.repeat(digits.length - 5)}${digits.slice(-3)}`;
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
  // DantSu wants an image alone on its line, with a single alignment tag.
  // The blank line after it keeps the big restaurant name off the logo's
  // bottom edge — printed flush, they touched.
  const logoAtBottom = bill.logoPosition === 'BOTTOM';
  if (bill.logoDataUri && !logoAtBottom) {
    lines.push(`[C]<img>${bill.logoDataUri}</img>`);
    lines.push('[L]');
  }
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
  if (bill.restaurantAddress) {
    for (const ln of wrapText(bill.restaurantAddress, W)) lines.push(`[C]${ln}`);
  }
  if (bill.restaurantPhone) lines.push(`[C]Phone: ${bill.restaurantPhone}`);
  if (bill.restaurantEmail) lines.push(`[C]Email: ${bill.restaurantEmail}`);
  if (bill.fssaiLicenseNumber) lines.push(`[C]FSSAI: ${bill.fssaiLicenseNumber}`);
  if (bill.gstRegistered && bill.gstin) lines.push(`[C]GSTIN: ${bill.gstin}`);
  lines.push(`[L]${d}`);

  // ── When + who ────────────────────────────────────────────────────────────
  // Its own ruled section, laid out like the customer block below it.
  lines.push(`[L]Order:   ${formatDateTime(orderTime)}`);
  lines.push(`[L]Printed: ${formatDateTime(now)}`);
  if (bill.billerName?.trim()) {
    // Wrap only the name so it stays aligned under the Order/Printed values.
    wrapText(bill.billerName.trim(), W - 9).forEach((ln, i) => {
      lines.push(`[L]${i === 0 ? 'Biller:  ' : '         '}${ln}`);
    });
  }
  lines.push(`[L]${d}`);

  // ── Customer ──────────────────────────────────────────────────────────────
  const customerName = bill.customerName?.trim();
  const customerPhone = bill.customerPhone?.trim() ? maskPhone(bill.customerPhone) : '';
  if (customerName || customerPhone) {
    if (customerName) {
      for (const ln of wrapText(`Customer: ${customerName}`, W)) lines.push(`[L]${ln}`);
    }
    if (customerPhone) lines.push(`[L]Phone: ${customerPhone}`);
    lines.push(`[L]${d}`);
  }

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
    // One line per named discount, so a free item and a membership don't print
    // as one unexplained figure. A name too long for the paper takes its own
    // line with the amount under it, rather than being cut to "Loyalty: Fre..".
    const parts = (bill.discountLines ?? []).filter((l) => Number(l.amount) >= 0.01);
    const partsSum = parts.reduce((n, l) => n + Number(l.amount), 0);
    if (parts.length > 0 && Math.abs(partsSum - bill.discount!) < 0.01) {
      for (const l of parts) {
        const value = `-${fmt(Number(l.amount))}`;
        if (l.name.length <= W - value.length - 1) {
          lines.push(`[L]${leftRight(l.name, value, W)}`);
        } else {
          lines.push(`[L]${l.name.slice(0, W)}`);
          lines.push(`[L]${leftRight('', value, W)}`);
        }
      }
    } else {
      lines.push(`[L]${leftRight('Discount', `-${fmt(bill.discount!)}`, W)}`);
    }
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
  const gstRows = (): string[] => {
    const out: string[] = [];
    if (rateLines.length > 0) {
      for (const l of rateLines) {
        if (bill.taxDisplayMode === 'split') {
          out.push(`[L]${leftRight(`CGST (${half(l.rate)}%)`, fmt2(l.cgst), W)}`);
          out.push(`[L]${leftRight(`SGST (${half(l.rate)}%)`, fmt2(l.sgst), W)}`);
        } else {
          out.push(`[L]${leftRight(`GST (${l.rate}%)`, fmt2(l.amount), W)}`);
        }
      }
    } else if (bill.tax > 0) {
      if (bill.gstRegistered && bill.taxDisplayMode === 'split' && bill.taxRate) {
        // Legacy bills (whole-rupee stored tax, no rate lines) keep the old
        // round-then-halve split so a reprint matches the paper the diner got.
        const cgst = Math.round(bill.tax / 2);
        out.push(`[L]${leftRight(`CGST (${half(bill.taxRate)}%)`, fmt(cgst), W)}`);
        out.push(`[L]${leftRight(`SGST (${half(bill.taxRate)}%)`, fmt(bill.tax - cgst), W)}`);
      } else {
        const taxLabel = bill.gstRegistered
          ? (bill.taxRate ? `GST (${bill.taxRate}%)` : 'GST')
          : 'Tax';
        out.push(`[L]${leftRight(taxLabel, fmt(bill.tax), W)}`);
      }
    }
    return out;
  };
  // Inclusive prices: that GST is already inside the lines above, so it must
  // not sit in the column that sums to TOTAL. Only the part actually added
  // (e.g. an exclusive charge at an inclusive venue) goes in the column; the
  // full breakup prints under TOTAL. All-exclusive bills print exactly as before.
  const taxSplit = splitBillTax({
    subtotal: bill.subtotal,
    discount: bill.discount,
    charges: bill.charges,
    tip: bill.tip,
    roundOff: bill.roundOff,
    tax: bill.tax,
    total: bill.grandTotal,
    pricesIncludeTax: bill.pricesIncludeTax,
  });
  const taxIncluded = taxSplit.included > 0;
  if (!taxIncluded) {
    lines.push(...gstRows());
  } else if (taxSplit.added > 0) {
    lines.push(`[L]${leftRight('GST added', fmt2(taxSplit.added), W)}`);
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
  lines.push(`[L]${D}`);
  lines.push(`[L]<b>${leftRight('TOTAL', fmt(bill.grandTotal), W)}</b>`);
  lines.push(`[L]${D}`);

  // ── GST breakup (inclusive prices) ────────────────────────────────────────
  // Informational: none of this is added — it is the tax inside TOTAL.
  if (taxIncluded) {
    lines.push(`[L]${taxSplit.added > 0 ? 'GST breakup' : 'GST included in total'}`);
    const taxable = rateLines.reduce((n, l) => n + l.taxableValue, 0);
    if (taxable > 0) lines.push(`[L]${leftRight('Taxable value', fmt2(taxable), W)}`);
    lines.push(...gstRows());
    if (taxSplit.added > 0) {
      lines.push(`[L]${leftRight('Incl. in prices', fmt2(taxSplit.included), W)}`);
    }
  }

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

  // ── Scan-to-pay UPI QR (configured VPA only) ──────────────────────────────
  // Unpaid bills: `upiOmitAmount` prints the restaurant's static QR (payee
  // only, diner enters the amount); otherwise the exact bill amount is baked
  // into the intent. Paid bills carry one only when the venue chose to
  // (Printer settings → QR on paid bills), and then the kind it chose.
  const paidQr = bill.paidUpiQr ?? 'OFF';
  if (bill.upiVpa && (!bill.isPaid || paidQr !== 'OFF')) {
    const staticQr = bill.isPaid ? paidQr === 'STATIC' : bill.upiOmitAmount === true;
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
    lines.push(`[C]<qrcode size='${qrSizeMm(upiString, profile)}'>${upiString}</qrcode>`);
    lines.push('[C] '); // quiet zone — DantSu prints the QR with no white border
  }

  // ── Loyalty nudge (§2.1) ──────────────────────────────────────────────────
  // Prints only for restaurants running an active program, and only when the
  // diner actually has something to be told.
  // The live ladder when the crew app loaded one; else the payment-time
  // snapshot (points programmes, or a ladder read that failed).
  {
    const nudge = bill.liveLadder
      ? liveLadderLines(bill.liveLadder, W)
      : bill.loyalty ? loyaltyLines(bill.loyalty, W) : [];
    if (nudge.length > 0) {
      // No dashed rule straight under the TOTAL's closing rule.
      if (!lines[lines.length - 1]?.startsWith(`[L]${D}`)) lines.push(`[L]${d}`);
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
  // Logo at the foot: under the venue's own words, above Quinckle's lines.
  if (bill.logoDataUri && logoAtBottom) {
    lines.push('[L]');
    lines.push(`[C]<img>${bill.logoDataUri}</img>`);
    lines.push('[L]');
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
