/**
 * KOT Template builder (KOT_PRINTER_PLAN.md Phase 5)
 *
 * Converts an order into ESC/POS text commands for any thermal printer width
 * (58 / 72 / 80 / 112 mm). Layout is driven entirely by the PaperProfile's
 * computed charsPerLine, so a new width needs no template changes.
 * Uses react-native-thermal-printer's text command format.
 *
 * Output: array of text-format strings passed to ThermalPrinter.printText().
 */

import { profileFromWidth, type PaperProfile } from './paperProfile';
import { isOffPremise, channelLabel } from '../constants/channel';

export interface KotItem {
  name: string;
  quantity: number;
  notes?: string | null;
  modifiersSummary?: string | null;
  category?: string;
  modifiers?: Array<{ name: string; priceAdjustment?: string }>;
}

export interface KotOrder {
  id: string;
  sessionId?: string;
  /** Human-readable session ref (e.g. "TK-070726-ABC-001"), same value the bill prints. Preferred over the id-derived fallback. */
  sessionRef?: string | null;
  tableNumber: number | string;
  /** Sequential day-counter (e.g. 1, 2, 42). Takes priority over id-derived suffix. */
  orderNumber?: string | number;
  restaurantName: string;
  createdAt: string; // ISO string
  items: KotItem[];
  isAddOn?: boolean;
  channel?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  pickupToken?: string;
  /** Who placed it (backend `orderedBy`). Prints the "By:" line; omitted when unknown. */
  orderedBy?: KotOrderedBy | null;
  /** Present on a reprint: when it was asked for (ms or ISO) and by whom. */
  reprint?: { at?: number | string | null; by?: string | null } | null;
}

export interface KotOrderedBy {
  source: 'qr' | 'staff';
  name: string | null;
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function divider(width: number, char = '-'): string {
  return char.repeat(width);
}

/** `left` flush left, `right` flush right, exactly `width` chars. */
function leftRight(left: string, right: string, width: number): string {
  const maxLeft = Math.max(0, width - right.length - 1);
  const l = left.length > maxLeft ? left.slice(0, Math.max(0, maxLeft - 2)) + '..' : left;
  return l.padEnd(maxLeft) + ' ' + right;
}

/** Word-wrap to `width`; words longer than a line are hard-split. */
function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > w) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(rest.slice(0, w));
      rest = rest.slice(w);
    }
    if (!cur) cur = rest;
    else if ((cur + ' ' + rest).length <= w) cur += ' ' + rest;
    else { out.push(cur); cur = rest; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

/** "By: Rahul (crew)" / "By: Priya · Customer (QR)" / "By: Customer (QR)". */
export function orderedByLabel(by: KotOrderedBy): string {
  const name = by.name?.trim();
  if (by.source === 'staff') return name ? `By: ${name} (crew)` : 'By: Crew';
  return name ? `By: ${name} · Customer (QR)` : 'By: Customer (QR)';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

function toSessionRef(sessionId: string | null | undefined): string {
  const v = String(sessionId ?? '');
  const tail = v.slice(-8).toUpperCase();
  return `S-${tail || 'UNKNOWN'}`;
}

// ── buildKotText ───────────────────────────────────────────────────────────────

/**
 * Returns the full KOT as a single ESC/POS text string
 * (react-native-thermal-printer `text` format — uses [C] center, [L] left, etc.)
 *
 * `paper` accepts a full PaperProfile, or a bare width in mm (back-compat) which
 * is resolved to a profile via profileFromWidth().
 */
export function buildKotText(order: KotOrder, paper: PaperProfile | number = 58): string {
  const profile = typeof paper === 'number' ? profileFromWidth(paper) : paper;
  const W = profile.charsPerLine;
  const lines: string[] = [];
  const D = divider(W, '=');
  const d = divider(W);

  // ── Where + which ticket ──────────────────────────────────────────────────
  // Line 1 (bold, double height — "tall" keeps normal width so leftRight's
  // maths holds): table or token flush left, channel flush right.
  // Off-premise covers takeaway AND delivery; a tokenless one still must not
  // claim to be a table.
  const offPremise = isOffPremise(order.channel);
  const where = offPremise
    ? (order.pickupToken?.trim() || '')
    : `T${String(order.tableNumber).padStart(2, '0')}`;
  const channel = offPremise ? channelLabel(order.channel).toUpperCase() : 'DINE-IN';
  lines.push(`[L]<b><font size="tall">${where ? leftRight(where, channel, W) : channel}</font></b>`);

  // Line 2: KOT number + time the order was placed (a reprint keeps both, so
  // the kitchen can match it to the first ticket).
  const ordNum = order.orderNumber != null
    ? `#${order.orderNumber}`
    : `#${order.id.slice(-6).toUpperCase()}`;
  lines.push(`[L]<b>${leftRight(`KOT ${ordNum}`, formatTime(order.createdAt), W)}</b>`);
  lines.push(`[L]${D}`);

  // ── Band: REPRINT / ADD-ON, before anything gets cooked ──────────────────
  if (order.reprint || order.isAddOn) {
    const band = order.reprint ? (order.isAddOn ? 'REPRINT · ADD-ON' : 'REPRINT') : 'ADD-ON';
    lines.push(`[C]<b><font size="tall">${band}</font></b>`);
    if (order.reprint) {
      const at = order.reprint.at != null ? new Date(order.reprint.at) : new Date();
      const when = formatTime(Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString());
      const by = order.reprint.by?.trim();
      for (const ln of wrapText(`Reprinted ${when}${by ? ` by ${by}` : ''}`, W)) lines.push(`[C]${ln}`);
    }
    lines.push(`[L]${d}`);
  }

  // ── Who placed it ─────────────────────────────────────────────────────────
  if (order.orderedBy) {
    for (const ln of wrapText(orderedByLabel(order.orderedBy), W)) lines.push(`[L]<b>${ln}</b>`);
    lines.push(`[L]${d}`);
  }

  // ── Items — grouped by category, quantity in its own column ───────────────
  const categoryOrder: string[] = [];
  const categoryMap = new Map<string, KotItem[]>();
  for (const item of order.items) {
    const cat = item.category?.trim() || '';
    if (!categoryMap.has(cat)) {
      categoryOrder.push(cat);
      categoryMap.set(cat, []);
    }
    categoryMap.get(cat)!.push(item);
  }
  const hasCategories = categoryOrder.some(c => c !== '');

  // " 2  Paneer Tikka": qty right-aligned in its column, names (and their
  // wrapped lines, add-ons, notes) all start at the same indent.
  const qtyW = Math.max(2, ...order.items.map(i => String(i.quantity).length));
  const indent = ' '.repeat(qtyW + 2);
  const textW = Math.max(8, W - indent.length);

  for (const cat of categoryOrder) {
    if (hasCategories && cat) lines.push(`[L]<b>${cat.toUpperCase()}</b>`);
    for (const item of categoryMap.get(cat) ?? []) {
      wrapText(item.name, textW).forEach((ln, i) => {
        const lead = i === 0 ? `${String(item.quantity).padStart(qtyW)}  ` : indent;
        lines.push(`[L]<b>${lead}${ln}</b>`);
      });
      // Variant / modifier summary (e.g. "Medium, Extra Shot")
      const mods = item.modifiersSummary
        ? [item.modifiersSummary]
        : (item.modifiers ?? []).map(m => m.name);
      for (const mod of mods) {
        wrapText(`+ ${mod}`, textW).forEach((ln, i) => lines.push(`[L]${indent}${i === 0 ? '' : '  '}${ln}`));
      }
      if (item.notes?.trim()) {
        for (const ln of wrapText(`Note: ${item.notes.trim()}`, textW)) lines.push(`[L]${indent}${ln}`);
      }
    }
  }

  // ── Count, so the pass can check nothing's missing ────────────────────────
  const itemCount = order.items.length;
  const qtyTotal = order.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  lines.push(`[L]${d}`);
  lines.push(`[L]${leftRight(`${itemCount} ${itemCount === 1 ? 'item' : 'items'}`, `${qtyTotal} qty`, W)}`);
  lines.push(`[L]${d}`);

  // ── Footer: venue + session, small ────────────────────────────────────────
  if (order.restaurantName?.trim()) {
    for (const ln of wrapText(order.restaurantName.trim(), W)) lines.push(`[C]${ln}`);
  }
  const ref = order.sessionRef || (order.sessionId ? toSessionRef(order.sessionId) : '');
  if (ref) lines.push(`[C]${ref}`);

  // Blank lines + cut
  lines.push('[L] ');
  lines.push('[L] ');
  lines.push('[C]<cut/>');

  return lines.join('\n');
}
