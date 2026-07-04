/**
 * Paper profile — universal printer width support.
 *
 * Thermal/POS printers come in a handful of standard roll widths (58/72/80/112mm)
 * and print heads are almost always 203 dpi (some 4-inch heads are 300). The
 * templates and the native print call both need two derived numbers:
 *
 *   - charsPerLine       — how many monospace Font-A characters fit on one line
 *   - printableWidthMM   — the actual printable dot area (roll width minus margins)
 *
 * A Font-A character cell is ~12 dots wide at 203 dpi, so:
 *   charsPerLine = floor(printableWidthMM * dpi / 25.4 / 12)
 *
 * The preset table carries the known-good values for the standard widths so 58mm
 * and 80mm output stays byte-identical to the old hard-coded behaviour; genuinely
 * custom widths / dpi are derived from the formula.
 */

/** Font-A dot cell width at 203 dpi (used to derive characters-per-line). */
const CHAR_DOT_WIDTH = 12;

export interface PaperProfile {
  /** Nominal roll width the partner selected (58, 72, 80, 112, …). */
  widthMM: number;
  /** Printable dot area in mm (roll width minus the unprintable margins). */
  printableWidthMM: number;
  /** Print-head density. 203 for virtually all thermal heads; 300 for some 4". */
  dpi: number;
  /** Monospace characters per line — what every template lays out against. */
  charsPerLine: number;
  /** DantSu <qrcode size='…'> module size, scaled to the paper width. */
  qrSize: number;
}

export interface PaperPreset {
  widthMM: number;
  label: string;
  printableWidthMM: number;
  /** Known-good chars/line at 203 dpi (keeps 58/80 output byte-identical). */
  charsPerLine: number;
  qrSize: number;
}

/**
 * Standard receipt-roll widths. 82.5mm collapses into the 80mm preset (identical
 * ~72mm printable area). "100mm" in the field is almost always a 4-inch/112mm roll.
 */
export const PAPER_PRESETS: PaperPreset[] = [
  { widthMM: 58,  label: '58 mm (2 inch)',  printableWidthMM: 48,  charsPerLine: 32, qrSize: 20 },
  { widthMM: 72,  label: '72 mm',           printableWidthMM: 64,  charsPerLine: 42, qrSize: 24 },
  { widthMM: 80,  label: '80 mm (3 inch)',  printableWidthMM: 72,  charsPerLine: 48, qrSize: 28 },
  { widthMM: 112, label: '112 mm (4 inch)', printableWidthMM: 104, charsPerLine: 69, qrSize: 32 },
];

/** Default width used when a device has no stored pairing yet. */
export const DEFAULT_PAPER_WIDTH = 58;
export const DEFAULT_DPI = 203;

/** Characters that fit on a line for an arbitrary printable width + dpi. */
export function charsForWidth(printableWidthMM: number, dpi: number): number {
  const dots = (printableWidthMM * dpi) / 25.4;
  return Math.max(24, Math.floor(dots / CHAR_DOT_WIDTH));
}

/**
 * Resolve a full PaperProfile from a nominal width (+ optional dpi).
 * Standard widths at 203 dpi use the preset's known-good numbers; anything else
 * is derived from the physical dot geometry.
 */
export function profileFromWidth(widthMM: number = DEFAULT_PAPER_WIDTH, dpi: number = DEFAULT_DPI): PaperProfile {
  const preset = PAPER_PRESETS.find((p) => p.widthMM === widthMM);

  if (preset && dpi === DEFAULT_DPI) {
    return {
      widthMM,
      printableWidthMM: preset.printableWidthMM,
      dpi,
      charsPerLine: preset.charsPerLine,
      qrSize: preset.qrSize,
    };
  }

  // Custom width or non-standard dpi — derive everything from geometry.
  const printableWidthMM = preset?.printableWidthMM ?? Math.max(30, Math.round(widthMM * 0.9));
  const qrSize = preset?.qrSize ?? (widthMM >= 112 ? 32 : widthMM >= 80 ? 28 : widthMM >= 72 ? 24 : 20);
  return {
    widthMM,
    printableWidthMM,
    dpi,
    charsPerLine: charsForWidth(printableWidthMM, dpi),
    qrSize,
  };
}
