/**
 * Keyboard for a row of choice cards — the desktop till's second-level menus.
 *
 * A sheet that offers two cards (Print KOT / Print invoice, With amount /
 * Static QR) becomes: ← → to move, ↵ to take the highlighted one, Esc to back
 * out, plus optional letter accelerators that skip straight to a card.
 *
 * The selection it returns is meant to be DRAWN. A highlight nobody can see is
 * worse than no keyboard at all — the operator presses ↵ and finds out what was
 * selected from what came out of the printer.
 *
 * Web/Electron only: on a phone `document` does not exist and the hook is inert,
 * so a caller can pass `active` unconditionally.
 */

import { useEffect, useRef, useState } from 'react';

export function useCardKeyboard({
  active,
  count,
  initial = 0,
  onConfirm,
  onCancel,
  accelerators,
}: {
  /** Usually `visible && isDesktop()`. False makes the hook inert. */
  active: boolean;
  count: number;
  /** Which card is highlighted when the sheet opens. */
  initial?: number;
  onConfirm: (index: number) => void;
  onCancel: () => void;
  /** Lower-case key → card index, taken immediately. e.g. `{ i: 1, k: 0 }`. */
  accelerators?: Record<string, number>;
}): number | null {
  const [index, setIndex] = useState(initial);

  // Re-seed on each open, so a sheet never reopens on last time's choice.
  useEffect(() => { if (active) setIndex(initial); }, [active, initial]);

  // The listener is installed once per open; everything it reads changes on
  // every render, so it reads through a ref rather than closing over stale
  // props (the same reason BottomSheet keeps onCloseRef).
  const latest = useRef({ index, count, onConfirm, onCancel, accelerators });
  useEffect(() => {
    latest.current = { index, count, onConfirm, onCancel, accelerators };
  });

  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      // A letter typed into the GSTIN field is a letter, not an accelerator.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const s = latest.current;
      const hit = s.accelerators?.[e.key.toLowerCase()];
      if (hit != null) { e.preventDefault(); s.onConfirm(hit); return; }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault(); setIndex(i => Math.max(0, i - 1)); break;
        case 'ArrowRight':
          e.preventDefault(); setIndex(i => Math.min(s.count - 1, i + 1)); break;
        case 'Enter':
          e.preventDefault(); s.onConfirm(s.index); break;
        case 'Escape':
          e.preventDefault(); s.onCancel(); break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  return active ? index : null;
}
