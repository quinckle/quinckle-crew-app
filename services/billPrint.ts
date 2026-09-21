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

import { printBill, billPrinter } from './printer';
import { printerApi } from './api';
import { subscribeChannel } from './realtime';
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
}): Promise<BillPrintOutcome> {
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
  const message = typeof err?.message === 'string' ? err.message : '';
  if (message.includes('NO_BILL_PRINTER')) {
    return 'No printer is set to print bills. Add one in Printers, or set an existing printer to Invoice.';
  }
  if (message.includes('PRINTER_NO_HOST')) {
    return "The bill printer isn't connected to any device right now. Open the app on the counter device.";
  }
  if (message.includes('SESSION_NOT_FOUND')) return 'This table session no longer exists.';
  return 'Could not reach the bill printer. Try again.';
}
