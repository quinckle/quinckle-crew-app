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
  isUrgent?: boolean;
  channel?: 'DINE_IN' | 'TAKEAWAY';
  pickupToken?: string;
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function divider(width: number, char = '─'): string {
  return char.repeat(width);
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

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`[C]<b><font size="big">${order.restaurantName}</font></b>`);
  lines.push(`[C]${D}`);

  // ── Table / Takeaway + Order # ─────────────────────────────────────────────
  if (order.channel === 'TAKEAWAY' && order.pickupToken) {
    lines.push(`[C]<b><font size="big">${order.pickupToken}</font></b>`);
    lines.push('[C]Takeaway');
  } else {
    lines.push(`[C]<b><font size="big">T${String(order.tableNumber).padStart(2, '0')}</font></b>`);
    lines.push('[C]Dine In');
  }

  // Use sequential day-counter when available; fall back to last-6-chars of id
  const ordNum = order.orderNumber != null
    ? `#${order.orderNumber}`
    : `#${order.id.slice(-6).toUpperCase()}`;
  const timeStr = formatTime(order.createdAt);
  lines.push(`[C]Order ${ordNum}`);
  if (order.sessionRef) {
    lines.push(`[C]Session ${order.sessionRef}`);
  } else if (order.sessionId) {
    lines.push(`[C]Session ${toSessionRef(order.sessionId)}`);
  }
  lines.push(`[C]${timeStr}`);

  lines.push(`[L]${d}`);

  // ── Items — grouped by category ───────────────────────────────────────────
  // Build category buckets preserving insertion order
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

  for (const cat of categoryOrder) {
    const catItems = categoryMap.get(cat) ?? [];
    if (hasCategories && cat) {
      // Category header — small caps label
      lines.push(`[L]<b>${cat.toUpperCase()}</b>`);
    }
    for (const item of catItems) {
      lines.push(`[L]<b> ${item.quantity} x  ${item.name}</b>`);
      // Variant / modifier summary (e.g. "Medium, Extra Shot")
      if (item.modifiersSummary) {
        lines.push(`[L]       * ${item.modifiersSummary}`);
      } else if (item.modifiers?.length) {
        for (const mod of item.modifiers) {
          lines.push(`[L]       + ${mod.name}`);
        }
      }
      if (item.notes) {
        lines.push(`[L]       — ${item.notes}`);
      }
      lines.push('[L] ');
    }
  }

  lines.push(`[L]${d}`);

  // ── Special tags ──────────────────────────────────────────────────────────
  if (order.isAddOn) {
    lines.push('[C]<b> *** ADD-ON ORDER *** </b>');
  }
  if (order.isUrgent) {
    lines.push('[C]<b> *** URGENT *** </b>');
  }

  // Blank lines + cut
  lines.push('[L] ');
  lines.push('[L] ');
  lines.push('[C]<cut/>');

  return lines.join('\n');
}
