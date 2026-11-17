/**
 * Ask which invoice printer(s) a bill goes to — only when there's a choice.
 *
 *   const { chooseInvoicePrinters, invoicePrinterSheet } = useInvoicePrinterPicker();
 *   const targets = await chooseInvoicePrinters();
 *   if (targets === null) return;            // crew dismissed the sheet
 *   printBillFromHere({ ..., targets });     // undefined → old default behaviour
 *
 * Resolves:
 *   - undefined — nothing to ask (fewer than two invoice printers, or the list
 *     can't be read offline). The bill takes the old path, no extra tap.
 *   - null      — the sheet was dismissed; do not print.
 *   - a choice  — the printers picked, with their names for the result line.
 *
 * One implementation for every screen that prints a bill, so the three can't
 * drift into asking differently.
 */

import React, { useCallback, useRef, useState } from 'react';
import { InvoicePrinterSheet } from '../components/ui/InvoicePrinterSheet';
import {
  lastInvoiceChoice,
  listInvoicePrinters,
  type InvoicePrinterChoice,
  type InvoicePrinterOption,
} from '../services/billPrint';

export function useInvoicePrinterPicker() {
  // `open` is separate from the data so the list doesn't blank out while the
  // sheet slides away.
  const [open, setOpen] = useState(false);
  const [printers, setPrinters] = useState<InvoicePrinterOption[]>([]);
  const [lastChoice, setLastChoice] = useState<string[]>([]);
  const resolver = useRef<((choice: InvoicePrinterChoice | null) => void) | null>(null);

  const chooseInvoicePrinters = useCallback(async (): Promise<InvoicePrinterChoice | null | undefined> => {
    const list = await listInvoicePrinters();
    if (!list || list.length < 2) return undefined;
    const last = await lastInvoiceChoice();
    return new Promise<InvoicePrinterChoice | null>((resolve) => {
      // A second tap while the sheet is up supersedes the first, rather than
      // leaving the first caller waiting forever.
      resolver.current?.(null);
      resolver.current = resolve;
      setPrinters(list);
      setLastChoice(last);
      setOpen(true);
    });
  }, []);

  const finish = useCallback((choice: InvoicePrinterChoice | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOpen(false);
    resolve?.(choice);
  }, []);

  const invoicePrinterSheet = (
    <InvoicePrinterSheet
      visible={open}
      printers={printers}
      lastChoice={lastChoice}
      onPick={(ids) =>
        finish({ ids, names: Object.fromEntries(printers.map((p) => [p.id, p.name])) })
      }
      onClose={() => finish(null)}
    />
  );

  return { chooseInvoicePrinters, invoicePrinterSheet };
}
