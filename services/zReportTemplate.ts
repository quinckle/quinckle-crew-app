/**
 * Day-end Z-report → ESC/POS text for any paper width. Mirrors invoiceTemplate.
 */
import { profileFromWidth, type PaperProfile } from './paperProfile';
import type { ZReport } from './api';

function divider(w: number, ch = '-') { return ch.repeat(w); }
function fmt(n: number) { return `Rs.${Number(n || 0).toFixed(0)}`; }
function leftRight(left: string, right: string, width: number): string {
  const maxLeft = Math.max(0, width - right.length - 1);
  const l = left.length > maxLeft ? left.slice(0, maxLeft - 2) + '..' : left;
  return l.padEnd(maxLeft) + ' ' + right;
}
function dt(iso: string) {
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  catch { return '--'; }
}

export function buildZReportText(z: ZReport, paper: PaperProfile | number = 58): string {
  const profile = typeof paper === 'number' ? profileFromWidth(paper) : paper;
  const W = profile.charsPerLine;
  const D = divider(W, '=');
  const d = divider(W, '-');
  const L: string[] = [];

  L.push('[C]<b><font size="big">DAY-END REPORT (Z)</font></b>');
  L.push(`[C]<b>${z.restaurantName}</b>`);
  L.push(`[C]${z.date}`);
  L.push(`[C]${D}`);

  L.push('[C]<b>TOTAL COLLECTED</b>');
  L.push(`[C]<b><font size="big">${fmt(z.collected.total)}</font></b>`);
  L.push(`[L]${d}`);

  L.push('[L]<b>Collected by method</b>');
  L.push(`[L]${leftRight(`Cash (${z.collected.cashCount})`, fmt(z.collected.cash), W)}`);
  L.push(`[L]${leftRight(`UPI direct (${z.collected.upiCount})`, fmt(z.collected.upiDirect), W)}`);
  L.push(`[L]${leftRight(`Card/online (${z.collected.gatewayCount})`, fmt(z.collected.gateway), W)}`);
  L.push(`[L]${d}`);

  L.push('[L]<b>Sales</b>');
  L.push(`[L]${leftRight('Orders', String(z.sales.orders), W)}`);
  L.push(`[L]${leftRight('Tables/sessions', String(z.sales.sessions), W)}`);
  L.push(`[L]${leftRight('Gross sales', fmt(z.sales.grossSales), W)}`);
  L.push(`[L]${leftRight('Discounts', `-${fmt(z.sales.discounts)}`, W)}`);
  L.push(`[L]${leftRight('GST collected', fmt(z.sales.gstCollected), W)}`);
  L.push(`[L]<b>${leftRight('Net billed', fmt(z.sales.netSales), W)}</b>`);

  if (z.adjustments.voidCount > 0 || z.adjustments.compCount > 0) {
    L.push(`[L]${d}`);
    L.push('[L]<b>Voids & comps</b>');
    L.push(`[L]${leftRight(`Voided (${z.adjustments.voidCount})`, fmt(z.adjustments.voidAmount), W)}`);
    L.push(`[L]${leftRight(`Comped (${z.adjustments.compCount})`, fmt(z.adjustments.compAmount), W)}`);
  }

  L.push(`[L]${d}`);
  L.push('[L]<b>Cash drawer</b>');
  if (z.drawer.state === 'CLOSED') {
    L.push(`[L]${leftRight('Opening float', fmt(z.drawer.openingFloat), W)}`);
    L.push(`[L]${leftRight('Cash sales', fmt(z.drawer.cashSales), W)}`);
    // Between cash sales and expected, because it is what explains the gap:
    // a delivered COD order counts as a cash sale but the money is still with
    // the rider. Omitted at zero so a non-delivery venue's slip is unchanged.
    if ((z.drawer.cashWithRiders ?? 0) > 0) {
      L.push(`[L]${leftRight('Less: with riders', `-${fmt(z.drawer.cashWithRiders ?? 0)}`, W)}`);
    }
    L.push(`[L]${leftRight('Expected', fmt(z.drawer.expected), W)}`);
    L.push(`[L]${leftRight('Counted', fmt(z.drawer.counted), W)}`);
    // After the maths, not inside it — this cash IS in the till. Printed
    // because it is the only float on the slip that one person both carried
    // and received. Omitted at zero, which is almost every venue.
    if ((z.drawer.selfSettledCash ?? 0) > 0) {
      L.push(`[L]${leftRight('Of which self-settled', fmt(z.drawer.selfSettledCash ?? 0), W)}`);
    }
    const v = z.drawer.variance;
    const sign = v < 0 ? '-' : v > 0 ? '+' : '';
    L.push(`[L]<b>${leftRight('Variance', `${sign}${fmt(Math.abs(v))}`, W)}</b>`);
    L.push(`[C]${v === 0 ? 'Balanced' : v < 0 ? 'Drawer SHORT' : 'Drawer OVER'}`);
  } else if (z.drawer.state === 'OPEN') {
    L.push('[L]Drawer still open - not reconciled');
  } else {
    L.push('[L]No cash drawer opened');
  }

  L.push(`[C]${D}`);
  L.push(`[C]Printed ${dt(z.generatedAt)}`);
  L.push('[C]Powered by Quinckle');
  L.push('[L] ');
  L.push('[L] ');
  L.push('[C]<cut/>');
  return L.join('\n');
}
