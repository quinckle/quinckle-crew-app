/**
 * Printing a bill from a device that may or may not own a printer.
 *
 * Before the printer registry, printBill() only worked on the one device that
 * held the pairing — a steward standing at the table had no path to paper at
 * all. Now there are two paths, and the caller should not have to care which
 * one it is on:
 *
 *   - This device drives a bill printer → print locally, exactly as before. No
 *     round trip, no server dependency, same latency the counter has today.
 *   - It does not → ask the server, which builds the bill itself and dispatches
 *     it to whichever device drives the venue's bill printer.
 *
 * The remote path waits for the real result rather than reporting success on
 * send. Someone is standing at a table waiting to hand over paper; "sent" is
 * not the thing they need to know.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { printBill, billPrinter, findPrinter } from './printer';
import { printerApi, printersApi } from './api';
import { subscribeChannel } from './realtime';
import { getPrintDeviceId } from './printDevice';
import type { InvoiceBill } from './invoiceTemplate';

/** How long to wait for the host to report back before we stop claiming to know. */
const RESULT_TIMEOUT_MS = 25_000;

export interface BillPrintOutcome {
  status: 'printed' | 'failed' | 'unknown';
  /** true when another device did the printing. */
  remote: boolean;
  /** Printer the job went to, for "Printing at Counter…". */
  printerName?: string | null;
  /** Ready to show — already phrased for a person, not a code. */
  message?: string;
  /**
   * With several printers chosen: the ones that did NOT print, so Retry can
   * re-send to exactly those instead of putting a second copy on the ones that
   * worked.
   */
  failedPrinterIds?: string[];
}

// ── Invoice printers: which exist, and which this phone last chose ──────────

/** One printer the crew can choose for a bill. */
export interface InvoicePrinterOption {
  id: string;
  /** What staff call it — "Counter". */
  name: string;
  /** What the hardware calls itself, when that differs from `name`. */
  systemName: string | null;
  isDefault: boolean;
  /** This phone drives it — prints with no round trip. */
  here: boolean;
  /** Some device drives it. False → it cannot print until one does. */
  connected: boolean;
}

/** What the crew picked: the printers, and their names for the result line. */
export interface InvoicePrinterChoice {
  ids: string[];
  names: Record<string, string>;
}

const KEY_LAST_CHOICE = 'invoicePrinterChoice';
/** Short enough that a printer added at the counter shows up within a shift. */
const LIST_TTL_MS = 5 * 60_000;
let _invoicePrinters: { at: number; list: InvoicePrinterOption[] } | null = null;

/** Drop the cached list — called when the venue's printers change. */
export function invalidateInvoicePrinters(): void {
  _invoicePrinters = null;
}

/**
 * The venue's invoice printers (role Invoice or Both), default first.
 *
 * Cached, because this sits in front of every Print Invoice tap and a venue
 * with one printer must not pay a round trip for a question it never asks.
 * `printers_changed` drops the cache (see printSink.watchPrintDispatch).
 * Returns null when the list cannot be read (offline) — the caller then falls
 * back to the old single-printer behaviour rather than blocking the bill.
 */
export async function listInvoicePrinters(): Promise<InvoicePrinterOption[] | null> {
  if (_invoicePrinters && Date.now() - _invoicePrinters.at < LIST_TTL_MS) {
    return _invoicePrinters.list;
  }
  try {
    const [res, deviceId] = await Promise.all([printersApi.list(), getPrintDeviceId()]);
    const list: InvoicePrinterOption[] = (res?.data ?? [])
      .filter((p) => p.enabled !== false && (p.role === 'BILL' || p.role === 'BOTH'))
      .map((p) => ({
        id: p.id,
        name: p.name,
        systemName: p.systemName && p.systemName !== p.name ? p.systemName : null,
        isDefault: !!p.isDefaultBill,
        here: !!p.hostDeviceId && p.hostDeviceId === deviceId,
        connected: !!p.hostDeviceId,
      }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    _invoicePrinters = { at: Date.now(), list };
    return list;
  } catch {
    return _invoicePrinters?.list ?? null;
  }
}

/** The printers this phone printed its last bill on — preselected next time. */
export async function lastInvoiceChoice(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_CHOICE);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function rememberInvoiceChoice(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_LAST_CHOICE, JSON.stringify(ids));
  } catch { /* non-fatal — next time just preselects the default */ }
}

/** Whether a bill printed from here goes out on this device's own printer. */
export function printsBillLocally(): boolean {
  return billPrinter() !== null;
}

export async function printBillFromHere(params: {
  restaurantId: string;
  sessionId: string;
  /** Locally-assembled bill. Used ONLY on the local path — the server builds
   *  its own for the remote one, from the same sources, so the two agree. */
  bill: InvoiceBill;
  upiOmitAmount?: boolean;
  /** Called once the job is accepted and we know where it is printing. */
  onDispatched?: (printerName: string) => void;
  /**
   * The printers the crew picked. Absent → the old behaviour exactly: this
   * phone's own bill printer if it has one, else the venue default.
   */
  targets?: InvoicePrinterChoice;
}): Promise<BillPrintOutcome> {
  if (params.targets && params.targets.ids.length > 0) {
    return printOnChosen({ ...params, targets: params.targets });
  }

  if (printsBillLocally()) {
    const result = await printBill(params.bill);
    return {
      status: result === 'printed' ? 'printed' : 'failed',
      remote: false,
      message: result === 'printed'
        ? undefined
        : 'Could not print the invoice. Check that the printer is nearby and powered on.',
    };
  }

  // The remote path addresses a SESSION — the server rebuilds the bill from it.
  // A ticket with no session (some takeaway prints) can only print locally.
  if (!params.sessionId) {
    return {
      status: 'failed',
      remote: false,
      message: 'This device has no bill printer, and this ticket has no table session to print from.',
    };
  }

  let dispatched: { jobId: string; printerName: string };
  try {
    const res = await printerApi.requestBillPrint({
      sessionId: params.sessionId,
      upiOmitAmount: params.upiOmitAmount,
    });
    dispatched = { jobId: res.data.jobId, printerName: res.data.printerName };
  } catch (err: any) {
    return { status: 'failed', remote: true, message: explain(err) };
  }

  params.onDispatched?.(dispatched.printerName);

  // Listen BEFORE anything can come back... which it already might have, for a
  // fast printer. That race is harmless: a missed result degrades to the
  // timeout below, which tells the truth rather than guessing.
  const outcome = await waitForResult(params.restaurantId, dispatched.jobId);

  if (outcome === 'timeout') {
    return {
      status: 'unknown',
      remote: true,
      printerName: dispatched.printerName,
      message: `Sent to ${dispatched.printerName}, but it hasn't confirmed. Check the printer.`,
    };
  }

  return {
    status: outcome.status,
    remote: true,
    printerName: dispatched.printerName,
    message: outcome.status === 'printed'
      ? undefined
      : outcome.errorMessage
        ? `${dispatched.printerName}: ${outcome.errorMessage}`
        : `${dispatched.printerName} could not print the bill.`,
  };
}

/**
 * Print on exactly the printers the crew chose. Printers this phone drives
 * print here with no round trip; the rest go to the server in ONE request, so
 * the bill is built once and every copy carries the same invoice number.
 */
async function printOnChosen(params: {
  restaurantId: string;
  sessionId: string;
  bill: InvoiceBill;
  upiOmitAmount?: boolean;
  onDispatched?: (printerName: string) => void;
  targets: InvoicePrinterChoice;
}): Promise<BillPrintOutcome> {
  const { ids, names } = params.targets;
  const nameOf = (id: string) => names[id] ?? findPrinter(id)?.name ?? 'Printer';
  const local = ids.filter((id) => findPrinter(id));
  const remote = ids.filter((id) => !findPrinter(id));

  // id → what happened. Filled in as each printer reports.
  const results = new Map<string, { ok: boolean; reason?: string } | 'pending'>();

  params.onDispatched?.(ids.map(nameOf).join(', '));

  const localRun = Promise.all(
    local.map(async (id) => {
      const r = await printBill(params.bill, { printerId: id });
      results.set(id, r === 'printed' ? { ok: true } : { ok: false, reason: 'did not print — check it is on and has paper' });
    }),
  );

  const remoteRun = (async () => {
    if (remote.length === 0) return;
    if (!params.sessionId) {
      for (const id of remote) results.set(id, { ok: false, reason: 'this ticket has no table session to send' });
      return;
    }
    let dispatched: Awaited<ReturnType<typeof printerApi.requestBillPrint>>['data'];
    try {
      const res = await printerApi.requestBillPrint({
        sessionId: params.sessionId,
        printerIds: remote,
        upiOmitAmount: params.upiOmitAmount,
      });
      dispatched = res.data;
    } catch (err: any) {
      const reason = explain(err);
      for (const id of remote) results.set(id, { ok: false, reason });
      return;
    }

    for (const s of dispatched.skipped ?? []) {
      results.set(s.printerId, {
        ok: false,
        reason: s.reason === 'PRINTER_NO_HOST' ? 'not connected to any device' : 'not an invoice printer any more',
      });
    }

    // An older backend answers with one job and no `jobs` list.
    const jobs = dispatched.jobs ?? [{ jobId: dispatched.jobId, printerId: dispatched.printerId, printerName: dispatched.printerName }];
    for (const j of jobs) results.set(j.printerId, 'pending');

    const outcomes = await waitForResults(params.restaurantId, jobs.map((j) => j.jobId));
    for (const j of jobs) {
      const o = outcomes.get(j.jobId);
      if (!o) results.set(j.printerId, { ok: false, reason: "sent, but hasn't confirmed — check the printer" });
      else if (o.status === 'printed') results.set(j.printerId, { ok: true });
      else results.set(j.printerId, { ok: false, reason: o.errorMessage || 'could not print' });
    }
  })();

  await Promise.all([localRun, remoteRun]);

  const printed = ids.filter((id) => { const r = results.get(id); return r && r !== 'pending' && r.ok; });
  const failed = ids.filter((id) => !printed.includes(id));

  if (failed.length === 0) {
    rememberInvoiceChoice(ids);
    return { status: 'printed', remote: remote.length > 0, printerName: ids.map(nameOf).join(', ') };
  }

  // Reasons arrive as full sentences from explain(); strip their end mark so
  // the line below doesn't print "…device..".
  const clause = (t?: string) => (t ?? 'no answer').replace(/[.\s]+$/, '');
  const why = failed.map((id) => {
    const r = results.get(id);
    return `${nameOf(id)}: ${clause(r && r !== 'pending' ? r.reason : undefined)}`;
  });
  const message = printed.length > 0
    ? `Printed on ${printed.map(nameOf).join(', ')}. Not printed — ${why.join('; ')}.`
    : why.length === 1 ? `${why[0]}.` : `Nothing printed — ${why.join('; ')}.`;

  // Remember the choice even on a partial failure: the crew still wants those
  // printers next time; the fault is the printer's, not the choice.
  rememberInvoiceChoice(ids);
  return {
    status: 'failed',
    remote: remote.length > 0,
    printerName: ids.map(nameOf).join(', '),
    message,
    failedPrinterIds: failed,
  };
}

/** Wait for several dispatched jobs at once; a missing entry means it timed out. */
function waitForResults(
  restaurantId: string,
  jobIds: string[],
): Promise<Map<string, { status: 'printed' | 'failed'; errorMessage?: string | null }>> {
  return new Promise((resolve) => {
    const done = new Map<string, { status: 'printed' | 'failed'; errorMessage?: string | null }>();
    const wanted = new Set(jobIds);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(done);
    };
    const off = subscribeChannel(`partner:${restaurantId}`, 'bill_print_result', (data: any) => {
      if (!data?.jobId || !wanted.has(data.jobId)) return;
      done.set(data.jobId, { status: data.status === 'printed' ? 'printed' : 'failed', errorMessage: data.errorMessage });
      if (done.size === wanted.size) finish();
    });
    const timer = setTimeout(finish, RESULT_TIMEOUT_MS);
  });
}

function waitForResult(
  restaurantId: string,
  jobId: string,
): Promise<{ status: 'printed' | 'failed'; errorMessage?: string | null } | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(value);
    };

    const off = subscribeChannel(
      `partner:${restaurantId}`,
      'bill_print_result',
      (data: any) => {
        if (data?.jobId !== jobId) return;
        finish({ status: data.status === 'printed' ? 'printed' : 'failed', errorMessage: data.errorMessage });
      },
    );

    const timer = setTimeout(() => finish('timeout'), RESULT_TIMEOUT_MS);
  });
}

/** Server codes the crew can actually act on, said plainly. */
function explain(err: any): string {
  // The reason lives in `code`; the text is only a fallback. Reading the text
  // alone is how "no invoice printer" used to come out as "try again".
  const message = [err?.code, err?.message].filter((v) => typeof v === 'string').join(' ');
  if (message.includes('NO_BILL_PRINTER')) {
    return 'No printer is set to print bills. Add one in Printers, or set an existing printer to Invoice.';
  }
  if (message.includes('PRINTER_NO_HOST')) {
    return "The bill printer isn't connected to any device right now. Open the app on the counter device.";
  }
  if (message.includes('SESSION_NOT_FOUND')) return 'This table session no longer exists.';
  return 'Could not reach the bill printer. Try again.';
}
