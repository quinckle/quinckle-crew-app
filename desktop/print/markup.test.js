/**
 * Renderer tests — run with `node --test desktop/print/`.
 *
 * These guard the contract between the shared templates and the desktop
 * transport. The templates are written once and printed on both Android (via
 * DantSu) and desktop (via this renderer), so a regression here means desktop
 * tickets silently diverge from Android ones.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const e = require('./escpos');
const { render, parseRuns, runsWidth } = require('./markup');

const P80 = { widthMM: 80, printableWidthMM: 72, dpi: 203, charsPerLine: 48, qrSize: 28 };

const has = (buf, ...bytes) => buf.includes(Buffer.from(bytes));

test('emphasis and double-size emit the right ESC/POS', () => {
  const out = render('[C]<b><font size="big">T07</font></b>', P80);
  assert.ok(has(out, 0x1b, 0x45, 0x01), 'bold on (ESC E 1)');
  assert.ok(has(out, 0x1d, 0x21, 0x11), 'double width+height (GS ! 0x11)');
  assert.ok(has(out, 0x1b, 0x45, 0x00), 'bold off restored');
  assert.ok(has(out, 0x1d, 0x21, 0x00), 'size restored');
});

test('alignment tokens map to ESC a', () => {
  assert.ok(has(render('[L]x', P80), 0x1b, 0x61, 0x00));
  assert.ok(has(render('[C]x', P80), 0x1b, 0x61, 0x01));
  assert.ok(has(render('[R]x', P80), 0x1b, 0x61, 0x02));
});

test('<cut/> produces a cut and is never printed as text', () => {
  const out = render('[L]hello\n[C]<cut/>', P80);
  assert.ok(has(out, 0x1d, 0x56, 0x42), 'GS V 66 partial cut');
  assert.ok(!out.includes(Buffer.from('cut')), 'no literal "cut" on paper');
});

test('<qrcode> emits a native QR with the payload intact', () => {
  const upi = 'upi://pay?pa=maniqueen@ybl&pn=Hotel%20Maniqueen&am=1250.00&cu=INR';
  const out = render(`[C]<qrcode size='28'>${upi}</qrcode>`, P80);
  assert.ok(out.includes(Buffer.from(upi, 'utf8')), 'payload present');
  assert.ok(has(out, 0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30), 'QR print command');
  assert.ok(!out.includes(Buffer.from('qrcode')), 'tag not printed as text');
});

test('<img> is skipped, never dumped as base64 text', () => {
  const out = render('[C]<img>data:image/png;base64,iVBORw0KGgoAAAA</img>', P80);
  assert.ok(!out.includes(Buffer.from('iVBOR')), 'base64 payload not on paper');
});

test('CP437 replacements preserve character width', () => {
  // The templates pad against charsPerLine; a multi-char substitution would
  // shift every column on the line.
  for (const s of ['─', '—', '…', '₹', 'café', '→ § −']) {
    assert.strictEqual(e.encodeText(s).length, Array.from(s).length, `width of ${s}`);
  }
  assert.strictEqual(e.encodeText('─')[0], 0xc4);
  assert.strictEqual(e.encodeText('—')[0], 0x2d);
});

test('double-width text counts as two columns', () => {
  assert.strictEqual(runsWidth(parseRuns('<font size="big">AB</font>')), 4);
  assert.strictEqual(runsWidth(parseRuns('AB')), 2);
});

test('ticket opens with init + codepage and ends with a cut', () => {
  const out = render('[L]line', P80, { autoCut: true });
  assert.ok(out.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])), 'starts with ESC @');
  assert.ok(has(out, 0x1b, 0x74, 0x00), 'selects CP437');
  assert.strictEqual(out[out.length - 4], 0x1d, 'ends with the cut command');
});

test('cash drawer kick only when asked', () => {
  assert.ok(has(render('[L]x', P80, { openCashbox: true }), 0x1b, 0x70, 0x00));
  assert.ok(!has(render('[L]x', P80, { openCashbox: false }), 0x1b, 0x70, 0x00));
});
