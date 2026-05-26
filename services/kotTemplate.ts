/**
 * KOT Template builder (KOT_PRINTER_PLAN.md Phase 5)
 *
 * Converts an order into ESC/POS text commands for 58mm or 80mm thermal printers.
 * Uses react-native-thermal-printer's text command format.
 *
 * Output: array of text-format strings passed to ThermalPrinter.printText().
 */

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
  tableNumber: number | string;
  /** Sequential day-counter (e.g. 1, 2, 42). Takes priority over id-derived suffix. */
  orderNumber?: string | number;
  restaurantName: string;
  createdAt: string; // ISO string
  items: KotItem[];
  isAddOn?: boolean;
  isUrgent?: boolean;
}

// ── Character widths ───────────────────────────────────────────────────────────

const WIDTH_58 = 32; // ~32 chars on 58mm at 12pt
const WIDTH_80 = 48; // ~48 chars on 80mm at 12pt

function lineWidth(paperWidth: 58 | 80): number {
  return paperWidth === 80 ? WIDTH_80 : WIDTH_58;
}

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

function minutesAgo(iso: string): number {
  try {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  } catch {
    return 0;
  }
}

// ── buildKotText ───────────────────────────────────────────────────────────────

/**
 * Returns the full KOT as a single ESC/POS text string
 * (react-native-thermal-printer `text` format — uses [C] center, [L] left, etc.)
 */
export function buildKotText(order: KotOrder, paperWidth: 58 | 80 = 58): string {
  const W = lineWidth(paperWidth);
  const lines: string[] = [];
  const D = divider(W, '=');
  const d = divider(W);

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push('[C]<b><font size="big">QUINCKLE</font></b>');
  lines.push(`[C]<b>${order.restaurantName}</b>`);
  lines.push(`[C]${D}`);

  // ── Table + Order # ───────────────────────────────────────────────────────
  lines.push(`[C]<b><font size="big">*** TABLE ${String(order.tableNumber).padStart(2, '0')} ***</font></b>`);

  // Use sequential day-counter when available; fall back to last-6-chars of id
  const ordNum = order.orderNumber != null
    ? `#${order.orderNumber}`
    : `#${order.id.slice(-6).toUpperCase()}`;
  const timeStr = formatTime(order.createdAt);
  const ago = minutesAgo(order.createdAt);
  lines.push(`[C]Order ${ordNum}`);
  lines.push(`[C]${timeStr}  ·  ${ago} min ago`);

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

  // ── Footer ────────────────────────────────────────────────────────────────
  const now = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  lines.push('[C]*** END ***');
  lines.push(`[C]${now}`);
  lines.push(`[C]${D}`);

  // Blank lines + cut
  lines.push('[L] ');
  lines.push('[L] ');
  lines.push('[C]<cut/>');

  return lines.join('\n');
}
