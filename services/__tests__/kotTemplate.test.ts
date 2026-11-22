/**
 * The kitchen ticket layout (approved mockup 2026-11-22).
 * Run: npx tsx --test services/__tests__/kotTemplate.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKotText, orderedByLabel } from '../kotTemplate';
import { profileFromWidth } from '../paperProfile';

const base = {
  id: 'abc123def', orderNumber: 42, restaurantName: 'Hotel Maniqueen',
  sessionRef: 'DN-221126-HMQ-014', createdAt: '2026-11-22T14:44:00Z',
};
const plain = (t: string) => t.split('\n').map(l => l.replace(/^\[[LCR]\]/, '').replace(/<\/?b>|<\/?font[^>]*>/g, ''));

for (const paper of [58, 80]) {
  const W = profileFromWidth(paper).charsPerLine;

  test(`${paper}mm: header lines span the paper width`, () => {
    const out = plain(buildKotText({ ...base, tableNumber: 5, items: [{ name: 'Chicken 65', quantity: 1 }] }, profileFromWidth(paper)));
    assert.equal(out[0].length, W);
    assert.ok(out[0].startsWith('T05 ') && out[0].endsWith(' DINE-IN'));
    assert.ok(out[1].startsWith('KOT #42 ') && out[1].length === W);
  });

  test(`${paper}mm: takeaway token left, channel right`, () => {
    const out = plain(buildKotText({ ...base, tableNumber: 0, channel: 'TAKEAWAY', pickupToken: 'TK-12', items: [] }, profileFromWidth(paper)));
    assert.ok(out[0].startsWith('TK-12 ') && out[0].endsWith(' TAKEAWAY'));
  });

  test(`${paper}mm: no line runs past the paper`, () => {
    const out = plain(buildKotText({
      ...base, tableNumber: '12 · G2', isAddOn: true,
      reprint: { at: Date.now(), by: 'A Very Long Staff Member Name Indeed' },
      orderedBy: { source: 'qr', name: 'Someone With A Rather Long Name' },
      items: [{ name: 'Chicken Dum Biryani Full Plate With Extra Raita And Salad', quantity: 12, modifiersSummary: 'Large, extra gravy, no onion, no garlic', notes: 'pack the raita separately please' }],
    }, profileFromWidth(paper)));
    for (const l of out) assert.ok(l.length <= W, `"${l}" is ${l.length} > ${W}`);
  });
}

test('no stars anywhere, and the old URGENT tag is gone', () => {
  const t = buildKotText({ ...base, tableNumber: 5, isAddOn: true, items: [{ name: 'Naan', quantity: 2 }] }, 58);
  assert.ok(!t.includes('*'));
  assert.ok(!t.includes('URGENT'));
});

test('ADD-ON band sits above the items', () => {
  const out = plain(buildKotText({ ...base, tableNumber: 5, isAddOn: true, items: [{ name: 'Naan', quantity: 2 }] }, 58));
  assert.ok(out.indexOf('ADD-ON') < out.findIndex(l => l.includes('Naan')));
});

test('reprint band says when and who; reprinted add-on says both', () => {
  const at = Date.parse('2026-11-22T15:11:00Z');
  const out = plain(buildKotText({ ...base, tableNumber: 5, reprint: { at, by: 'Rahul' }, items: [] }, 58));
  assert.ok(out.includes('REPRINT'));
  assert.ok(out.some(l => /^Reprinted \d\d:\d\d by Rahul$/.test(l)));
  const both = plain(buildKotText({ ...base, tableNumber: 5, isAddOn: true, reprint: {}, items: [] }, 58));
  assert.ok(both.includes('REPRINT · ADD-ON'));
  assert.ok(both.some(l => /^Reprinted \d\d:\d\d$/.test(l)));
});

test('first order has no band', () => {
  const out = plain(buildKotText({ ...base, tableNumber: 5, items: [] }, 58));
  assert.ok(!out.some(l => l === 'ADD-ON' || l.startsWith('REPRINT')));
});

test('By line wording', () => {
  assert.equal(orderedByLabel({ source: 'staff', name: 'Rahul' }), 'By: Rahul (crew)');
  assert.equal(orderedByLabel({ source: 'staff', name: null }), 'By: Crew');
  assert.equal(orderedByLabel({ source: 'qr', name: 'Priya' }), 'By: Priya · Customer (QR)');
  assert.equal(orderedByLabel({ source: 'qr', name: '  ' }), 'By: Customer (QR)');
});

test('no By line when the backend did not say (old backend / local reprint)', () => {
  const t = buildKotText({ ...base, tableNumber: 5, items: [] }, 58);
  assert.ok(!t.includes('By:'));
});

test('quantity column: long names wrap under the name', () => {
  const out = plain(buildKotText({ ...base, tableNumber: 5, items: [{ name: 'Chicken Dum Biryani (Full Plate)', quantity: 1 }] }, 58));
  const i = out.findIndex(l => l.startsWith(' 1  Chicken'));
  assert.ok(i > 0);
  assert.ok(out[i + 1].startsWith('    ') && out[i + 1].trim().length > 0);
});

test('item and qty count', () => {
  const out = plain(buildKotText({ ...base, tableNumber: 5, items: [{ name: 'A', quantity: 2 }, { name: 'B', quantity: 3 }] }, 58));
  assert.ok(out.some(l => /^2 items +5 qty$/.test(l)));
});
