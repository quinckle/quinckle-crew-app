/**
 * DantSu markup → ESC/POS bytes.
 *
 * The crew app's three templates (kotTemplate, invoiceTemplate, zReportTemplate)
 * emit a text format that the Android library `react-native-thermal-printer`
 * interprets. On desktop nothing interprets it, so this module does.
 *
 * The templates are the single source of truth for ticket LAYOUT and they are
 * shared verbatim with Android — this file only reproduces how DantSu renders
 * that layout, so a desktop ticket and an Android ticket come out identical.
 *
 * Supported (the complete set the templates actually emit — verified by
 * scanning all three template files):
 *
 *   [L] [C] [R]             alignment; several per line = columns
 *   <b>…</b>                emphasis
 *   <font size="big">…</font>  double width + height
 *   <qrcode size='N'>…</qrcode>  native QR, N = width in mm
 *   <cut/>                  feed and cut
 *   <img>…</img>            IGNORED — see note below
 *
 * <img> note: the bill logo is already Android-only (billLogoFor() in
 * printer.ts returns null off Android), so no desktop ticket can contain one.
 * We skip the tag rather than print its base64 payload as text, so that if the
 * gate is ever relaxed the failure is a missing logo, not four screens of
 * garbage.
 */

const e = require('./escpos');

const ALIGN_CODE = { L: 0, C: 1, R: 2 };

/** Split a segment into styled runs, honouring nested <b> and <font>. */
function parseRuns(segment) {
  const runs = [];
  let bold = false;
  let big = false;
  let buf = '';

  const flush = () => {
    if (buf) runs.push({ text: buf, bold, big });
    buf = '';
  };

  let i = 0;
  while (i < segment.length) {
    if (segment[i] === '<') {
      const close = segment.indexOf('>', i);
      if (close === -1) { buf += segment[i++]; continue; }
      const tag = segment.slice(i, close + 1);
      const lower = tag.toLowerCase();

      if (lower === '<b>') { flush(); bold = true; }
      else if (lower === '</b>') { flush(); bold = false; }
      else if (lower.startsWith('<font')) { flush(); big = /size\s*=\s*['"]?big/i.test(lower); }
      else if (lower === '</font>') { flush(); big = false; }
      else if (lower.startsWith('<qrcode')) {
        flush();
        const end = segment.toLowerCase().indexOf('</qrcode>', close);
        const data = segment.slice(close + 1, end === -1 ? undefined : end);
        const m = /size\s*=\s*['"]?(\d+)/i.exec(tag);
        runs.push({ qr: data, widthMM: m ? Number(m[1]) : 20 });
        i = end === -1 ? segment.length : end + '</qrcode>'.length;
        continue;
      }
      else if (lower.startsWith('<img')) {
        flush();
        const end = segment.toLowerCase().indexOf('</img>', close);
        i = end === -1 ? segment.length : end + '</img>'.length;
        continue;
      }
      // Unknown tag — drop it rather than print angle brackets.
      i = close + 1;
      continue;
    }
    buf += segment[i++];
  }
  flush();
  return runs;
}

/** Printed width of a run list, counting double-width characters as two. */
function runsWidth(runs) {
  return runs.reduce((w, r) => (r.qr ? w : w + r.text.length * (r.big ? 2 : 1)), 0);
}

function renderRuns(runs, dpi) {
  const out = [];
  let bold = false;
  let big = false;
  for (const run of runs) {
    if (run.qr !== undefined) {
      out.push(e.qrcode(run.qr, run.widthMM, dpi));
      continue;
    }
    if (run.bold !== bold) { out.push(e.bold(run.bold)); bold = run.bold; }
    if (run.big !== big) { out.push(run.big ? e.bigSize() : e.normalSize()); big = run.big; }
    out.push(e.encodeText(run.text));
  }
  // Leave the printer in a known state for the next line.
  if (bold) out.push(e.bold(false));
  if (big) out.push(e.normalSize());
  return Buffer.concat(out);
}

/**
 * Render one line.
 *
 * A single alignment token (the common case — every line our templates emit)
 * uses the printer's own alignment, which positions double-width text correctly
 * without us having to reason about it. Multiple tokens on one line mean
 * columns, which the printer cannot do, so those are padded to charsPerLine by
 * hand the way DantSu does it.
 */
function renderLine(line, profile) {
  const parts = line.split(/(\[[LCR]\])/).filter((p) => p !== '');
  const segments = [];
  let current = { align: 'L', text: '' };
  let seen = false;

  for (const part of parts) {
    const m = /^\[([LCR])\]$/.exec(part);
    if (m) {
      if (seen) segments.push(current);
      current = { align: m[1], text: '' };
      seen = true;
    } else {
      current.text += part;
    }
  }
  segments.push(current);

  if (segments.length === 1) {
    const seg = segments[0];
    const runs = parseRuns(seg.text);
    return Buffer.concat([
      e.align(ALIGN_CODE[seg.align] ?? 0),
      renderRuns(runs, profile.dpi),
      Buffer.from('\n'),
    ]);
  }

  // Column layout — pad into one left-aligned line of charsPerLine columns.
  const W = profile.charsPerLine;
  const cols = segments.map((s) => ({ align: s.align, runs: parseRuns(s.text) }));
  const used = cols.reduce((w, c) => w + runsWidth(c.runs), 0);
  const slack = Math.max(0, W - used);

  const out = [e.align(0)];
  cols.forEach((col, idx) => {
    if (idx > 0) {
      // Right-most column hugs the right edge; middle columns get the slack
      // split evenly, matching DantSu's distribution.
      const gap = idx === cols.length - 1 ? slack - Math.floor(slack / 2) * (cols.length > 2 ? 1 : 0) : Math.floor(slack / (cols.length - 1));
      out.push(e.encodeText(' '.repeat(Math.max(0, gap))));
    }
    out.push(renderRuns(col.runs, profile.dpi));
  });
  out.push(Buffer.from('\n'));
  return Buffer.concat(out);
}

/**
 * Render a full ticket.
 *
 * `endFeedMM` mirrors the Android path's mmFeedPaper. There it also bought
 * flush time before the Bluetooth socket closed (see the KOT_END_FEED_MM note
 * in printer.ts); here the transport waits for a real drain, so this is purely
 * the paper feed it was always meant to be.
 */
function render(text, profile, opts = {}) {
  const { autoCut = true, openCashbox = false, endFeedMM = 40 } = opts;
  const chunks = [e.init(), e.codepage437()];

  if (openCashbox) chunks.push(e.openCashDrawer());

  let cutRequested = false;
  for (const raw of String(text).split('\n')) {
    if (/<cut\s*\/?>/i.test(raw)) {
      cutRequested = true;
      continue;
    }
    chunks.push(renderLine(raw, profile));
  }

  // ~8 dot-lines per mm at 203 dpi, 24-dot line spacing → ~3 lines per 10mm.
  const feedLines = Math.max(2, Math.round((endFeedMM / 25.4) * 203 / 24));
  if (autoCut || cutRequested) chunks.push(e.cut(feedLines));
  else chunks.push(e.feed(feedLines));

  return Buffer.concat(chunks);
}

module.exports = { render, renderLine, parseRuns, runsWidth };
