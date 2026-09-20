/**
 * Low-level ESC/POS command builders.
 *
 * On Android the DantSu library turns our markup into these bytes for us. On
 * desktop there is no DantSu, so this module is the replacement: every command
 * the templates can produce, emitted as raw bytes.
 *
 * Reference: Epson ESC/POS Command Reference. Every printer we target is
 * Epson-compatible at this level — the differences between brands show up in
 * image/QR handling, not in these basics.
 */

const ESC = 0x1b;
const GS = 0x1d;

const b = (...bytes) => Buffer.from(bytes);

/** Reset the printer: clears alignment, emphasis and character size. */
const init = () => b(ESC, 0x40);

/**
 * Select code page 437. The templates are pure ASCII apart from one character
 * — the box-drawing dash U+2500 used by divider() — which is 0xC4 in CP437.
 */
const codepage437 = () => b(ESC, 0x74, 0x00);

/** 0 = left, 1 = center, 2 = right. */
const align = (n) => b(ESC, 0x61, n);

const bold = (on) => b(ESC, 0x45, on ? 1 : 0);

/**
 * Character size. ESC/POS packs width and height into one byte as
 * (width-1) << 4 | (height-1), so double-both — DantSu's `<font size="big">` —
 * is 0x11.
 */
const size = (widthMul, heightMul) =>
  b(GS, 0x21, (((widthMul - 1) & 0x07) << 4) | ((heightMul - 1) & 0x07));

const normalSize = () => size(1, 1);
const bigSize = () => size(2, 2);

/** Feed n blank lines. */
const feed = (n) => (n > 0 ? b(ESC, 0x64, Math.min(255, n)) : Buffer.alloc(0));

/**
 * Partial cut, after feeding n lines so the cut lands clear of the last text.
 * GS V 66 is the "feed then partial cut" form supported by every cutter-equipped
 * printer we have seen; printers without a cutter ignore it.
 */
const cut = (feedLines = 4) => b(GS, 0x56, 0x42, Math.min(255, feedLines));

/** Cash drawer kick on pin 2. Harmless when no drawer is attached. */
const openCashDrawer = () => b(ESC, 0x70, 0x00, 0x19, 0xfa);

// ── Text encoding ────────────────────────────────────────────────────────────

/**
 * Unicode → CP437, for characters the templates (or venue/item names) can
 * realistically contain.
 *
 * INVARIANT: every replacement is exactly ONE character wide. The templates lay
 * themselves out against profile.charsPerLine and pad with padStart/padEnd, so
 * a two-character substitution would silently shift every column on that line.
 * That rules out the obvious "₹" → "Rs." and "…" → "...".
 */
const CP437 = new Map([
  [0x2500, 0xc4], // ─ box drawing, used by divider()
  [0x2502, 0xb3], // │
  [0x2014, 0x2d], // — em dash — emitted by the KOT notes line and "PAY LATER — ON KHATA"
  [0x2013, 0x2d], // – en dash
  [0x2212, 0x2d], // − minus sign
  [0x2018, 0x27], [0x2019, 0x27], // ‘ ’
  [0x201c, 0x22], [0x201d, 0x22], // “ ”
  [0x2026, 0x2e], // … ellipsis → single dot (width!)
  [0x2022, 0x2a], // • bullet
  [0x2192, 0x3e], // → ASCII '>' rather than CP437 0x1A, which some firmware
                  //   treats as a control byte
  [0x00a7, 0x15], // §
  [0x20b9, 0x52], // ₹ → 'R'. Templates always use "Rs." so this only guards
                  //   against a venue name; one char is all we may spend.
  // Latin-1 letters CP437 does have — venue and item names do carry these.
  [0x00e9, 0x82], [0x00e8, 0x8a], [0x00ea, 0x88], [0x00e0, 0x85], [0x00e1, 0xa0],
  [0x00e2, 0x83], [0x00ed, 0xa1], [0x00f3, 0xa2], [0x00fa, 0xa3], [0x00f1, 0xa4],
  [0x00d1, 0xa5], [0x00fc, 0x81], [0x00f6, 0x94], [0x00e4, 0x84], [0x00e7, 0x87],
  [0x00c9, 0x90], [0x00b0, 0xf8], // °
]);

/**
 * Encode a string to CP437 bytes, one byte per input character.
 *
 * Anything with no single-width CP437 equivalent degrades to '?' — visible and
 * width-preserving, rather than a byte the printer renders as garbage.
 */
function encodeText(str) {
  const chars = Array.from(str); // codepoint-aware, so astral chars count once
  const out = Buffer.alloc(chars.length);
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].codePointAt(0);
    if (code < 0x80) out[i] = code;
    else if (CP437.has(code)) out[i] = CP437.get(code);
    else out[i] = 0x3f; // '?'
  }
  return out;
}

// ── QR code ──────────────────────────────────────────────────────────────────

/**
 * Estimate how many modules wide a QR holding `dataLen` bytes will be.
 *
 * We need this because DantSu's `size` attribute is a width in MILLIMETRES
 * while ESC/POS wants dots-per-module. Converting between them requires knowing
 * the module count, which depends on the QR version the printer picks. Rather
 * than re-implement QR version selection, we bracket it: these are the module
 * counts for versions 4/6/8/10/12 at error-correction level M, which covers
 * every UPI string we generate (typically 80–130 bytes).
 */
function estimateQrModules(dataLen) {
  if (dataLen <= 25) return 33;   // v4
  if (dataLen <= 47) return 41;   // v6
  if (dataLen <= 77) return 49;   // v8
  if (dataLen <= 114) return 57;  // v10
  return 65;                      // v12
}

/**
 * Native ESC/POS QR. `widthMM` is DantSu's size attribute (see paperProfile.ts,
 * which scales it per paper width); we convert it to the closest module size
 * that fits, clamped to the 1–16 the command allows.
 */
function qrcode(data, widthMM, dpi = 203) {
  const payload = Buffer.from(data, 'utf8');
  const targetDots = (widthMM * dpi) / 25.4;
  const modules = estimateQrModules(payload.length);
  const moduleSize = Math.max(1, Math.min(16, Math.round(targetDots / modules)));

  // Store-data length includes the two bytes of the 'store' function itself.
  const len = payload.length + 3;
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;

  return Buffer.concat([
    b(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00), // model 2
    b(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize), // module size
    b(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31),       // error correction M
    b(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30),           // store data
    payload,
    b(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30),       // print
  ]);
}

module.exports = {
  init, codepage437, align, bold, size, normalSize, bigSize,
  feed, cut, openCashDrawer, encodeText, qrcode, estimateQrModules, CP437,
};
