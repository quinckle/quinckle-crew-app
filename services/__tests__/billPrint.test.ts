/**
 * Guards for the printed bill's scan-to-pay QR. Both rules broke real bills
 * on 2026-10-03:
 *
 *  1. The amount QR stopped scanning — a fixed QR size let the longer `am=`
 *     payload drop to 4 printer dots per module.
 *  2. A bigger QR then cut the bill off mid-QR — DantSu closed the socket
 *     before the printer had drained the raster.
 *
 * Run (no npm script: anything in package.json moves the OTA fingerprint):
 *     npx tsx --test services/__tests__/billPrint.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvoiceText,
  billEndWaitMs,
  qrModuleCount,
  BILL_END_WAIT_MS,
  VERIFIED_QR_RASTER_BYTES,
} from '../invoiceTemplate';
import { endFeedMmForWait, profileFromWidth } from '../paperProfile';

// DantSu's own float maths (EscPosPrinterSize.mmToPx, QRCodeDataToBytes).
const f = Math.fround;
const mmToPx = (mm: number, dpi: number) => Math.round(f(f(f(mm) * f(dpi)) / f(25.4)));

const PAYEES: Array<[string, string]> = [
  ['98765@ybl', 'Cafe'],
  ['hotelmaniqueen@okaxis', 'Hotel Maniqueen'],
  ['chaarpai.family.restaurant.kolkata@okhdfcbank', 'Chaarpai Family Restaurant and Banquet Hall'],
];
const AMOUNTS = [1, 557, 99999.99];

function printedQr(paper: number, pa: string, pn: string, amount: number | null, dpi = 203) {
  const profile = profileFromWidth(paper, dpi);
  const text = buildInvoiceText({
    restaurantName: 'Test', tableNumber: 1, items: [], subtotal: 0, tax: 0,
    grandTotal: amount ?? 100, isPaid: false, createdAt: new Date().toISOString(),
    upiVpa: pa, upiName: pn, upiOmitAmount: amount == null,
  } as any, profile);
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes('<qrcode'));
  const [, size, payload] = lines[i].match(/<qrcode size='([\d.]+)'>(.*)<\/qrcode>/)!;
  const px = mmToPx(parseFloat(size), dpi);
  const modules = qrModuleCount(payload)!;
  return { text, profile, lines, i, px, modules, dots: Math.round(f(px) / f(modules)) };
}

test('every UPI QR prints at 5+ dots per module, static or amount', () => {
  for (const paper of [58, 80]) {
    for (const [pa, pn] of PAYEES) {
      for (const amount of [null, ...AMOUNTS]) {
        const { dots, px, profile } = printedQr(paper, pa, pn, amount);
        assert.ok(dots >= 5, `${paper}mm ${pa} am=${amount}: ${dots} dots/module`);
        assert.ok(px <= mmToPx(profile.printableWidthMM, profile.dpi), `${paper}mm ${pa}: QR wider than paper`);
      }
    }
  }
});

test('the module count matches zxing at the version boundaries', () => {
  // ECC L byte mode + 12-bit ECI header: v4 holds 77 bytes, v5 holds 105.
  assert.equal(qrModuleCount('x'.repeat(77)), 33);
  assert.equal(qrModuleCount('x'.repeat(78)), 37);
  assert.equal(qrModuleCount('x'.repeat(105)), 37);
  assert.equal(qrModuleCount('x'.repeat(106)), 41);
});

test('a blank line follows the QR (DantSu prints no quiet zone)', () => {
  const { lines, i } = printedQr(58, 'hotelmaniqueen@okaxis', 'Hotel Maniqueen', 557);
  assert.equal(lines[i + 1], '[C] ');
});

test('the bill end wait covers the QR raster it prints', () => {
  for (const [pa, pn] of PAYEES) {
    const { text, profile, px } = printedQr(58, pa, pn, 99999.99);
    const rasterBytes = Math.ceil(px / 8) * px;
    const wait = billEndWaitMs(text, profile);
    assert.ok(wait >= BILL_END_WAIT_MS);
    assert.ok(
      wait / rasterBytes >= BILL_END_WAIT_MS / VERIFIED_QR_RASTER_BYTES - 1e-9,
      `${pa}: ${rasterBytes}B raster but only ${wait}ms`,
    );
  }
});

test('the end feed keeps its 8mm while the wait grows', () => {
  for (const dpi of [203, 300]) {
    for (const wait of [320, BILL_END_WAIT_MS, 5000]) {
      const dots = mmToPx(endFeedMmForWait(wait, dpi), dpi);
      assert.ok(dots >= wait && dots < wait + 256, `${dpi}dpi wait ${wait}: ${dots} dots`);
      assert.equal(dots & 0xff, 64, `${dpi}dpi wait ${wait}: feed byte ${dots & 0xff}`);
    }
  }
});

// Takeaway/delivery header: one line, channel flush left, token flush right,
// no "*** ***" — the full paper width on both 58 and 80mm.
function offPremiseHeader(paper: number, channel: 'TAKEAWAY' | 'DELIVERY', pickupToken: string | null) {
  const profile = profileFromWidth(paper);
  const text = buildInvoiceText({
    restaurantName: 'Test', tableNumber: '', channel, pickupToken, items: [], subtotal: 0, tax: 0,
    grandTotal: 100, isPaid: true, createdAt: new Date().toISOString(),
  } as any, profile);
  const lines = text.split('\n');
  const i = lines.findIndex(l => l.includes('<font size="tall">'));
  return { text, line: lines[i], W: profile.charsPerLine };
}

for (const paper of [58, 80]) {
  test(`${paper}mm takeaway header puts TAKEAWAY left and the token right`, () => {
    const { text, line, W } = offPremiseHeader(paper, 'TAKEAWAY', 'TK-12');
    assert.ok(!text.includes('***'));
    const inner = line.match(/<font size="tall">(.*)<\/font>/)![1];
    assert.equal(inner.length, W);
    assert.ok(inner.startsWith('TAKEAWAY '));
    assert.ok(inner.endsWith(' TK-12'));
  });
  test(`${paper}mm tokenless takeaway prints just the label`, () => {
    const { line } = offPremiseHeader(paper, 'TAKEAWAY', null);
    assert.equal(line, '[L]<b><font size="tall">TAKEAWAY</font></b>');
  });
}

test('delivery uses the same one-line header', () => {
  const { line } = offPremiseHeader(58, 'DELIVERY', 'DL-4');
  assert.match(line, /^\[L\]<b><font size="tall">DELIVERY +DL-4<\/font><\/b>$/);
});
