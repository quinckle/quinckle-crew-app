import { QuinckleColors } from './Colors';

/**
 * How urgent a table's remaining time is, and what colour says so.
 *
 * ── Why not a fixed threshold ──────────────────────────────────────────────
 * This used to be a hardcoded 10 minutes, copy-pasted into the floor grid and
 * the table detail screen. Venues don't share a turn time: a 25-minute counter
 * slot spends 40% of its life inside a 10-minute warning, which turns the
 * warning into wallpaper.
 *
 * ── Why not a pure percentage either ──────────────────────────────────────
 * 15% of a 4-hour session is 36 minutes of red. Staff learn within one shift
 * that red means nothing, and then it means nothing when it matters. Worse than
 * no warning at all.
 *
 * There is also a hard floor on usefulness that percentages can't see: the
 * action this colour triggers — walk over, offer an extension, decide to turn
 * the table — costs roughly the same couple of minutes whether the slot was 45
 * minutes or 4 hours. "Ten minutes left" means "go now" at every scale.
 *
 * ── So: percentage, with absolute clamps ──────────────────────────────────
 *   danger  = clamp(15% of the slot, 5 min, 20 min)
 *   warning = 2 × danger
 *
 *   25 min slot →  5.0 min danger (floor)   |  2 h slot → 18 min danger
 *   45 min slot →  6.8 min danger           |  4 h slot → 20 min danger (ceiling)
 *
 * Scales with the venue, never becomes wallpaper, never fires too late.
 *
 * One known edge: on a very short slot the 5-minute floor makes the amber band
 * a large fraction of the session (a 20-minute slot goes amber at the halfway
 * mark). Left alone deliberately — at that slot length the session really is
 * half gone, and amber is the soft signal. Worth a third tunable only if a venue
 * actually runs locks that short.
 */

export type ExpiryLevel = 'normal' | 'warning' | 'danger' | 'overdue';

const MIN = 60_000;
const DANGER_FRACTION = 0.15;
const DANGER_FLOOR_MS = 5 * MIN;
const DANGER_CEILING_MS = 20 * MIN;
/** Fallback slot length when we can't tell when the session opened. */
const ASSUMED_SLOT_MS = 90 * MIN;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * The danger threshold for one session, in ms.
 *
 * `openedAt` is optional: without it we can't measure the slot, so we assume a
 * middling 90 minutes rather than silently falling back to a fixed number that
 * would be wrong for exactly the venues this function exists to serve.
 *
 * NOTE on extensions: extending a session moves `expiresAt` but not `openedAt`,
 * so the measured slot GROWS each time. A long-staying table therefore earns a
 * slightly longer runway — defensible, and the 20-minute ceiling caps how far
 * the drift can go. Basing this on the venue's configured duration instead would
 * need that value plumbed through to the crew app, which it currently is not.
 */
export function dangerThresholdMs(expiresAt: string | Date, openedAt?: string | Date | null): number {
  const end = new Date(expiresAt).getTime();
  const start = openedAt ? new Date(openedAt).getTime() : NaN;
  const slot = Number.isFinite(start) && end > start ? end - start : ASSUMED_SLOT_MS;
  return clamp(slot * DANGER_FRACTION, DANGER_FLOOR_MS, DANGER_CEILING_MS);
}

/**
 * Urgency for a session. `msLeft` may be negative — a table past its time is
 * `overdue`, which is deliberately its OWN level rather than more red: "five
 * minutes over" is a different situation from "five minutes left", and the old
 * code let an expired table fall back to a calm grey elapsed counter, relaxing
 * at the exact moment it should escalate.
 */
export function expiryLevel(msLeft: number, expiresAt: string | Date, openedAt?: string | Date | null): ExpiryLevel {
  if (msLeft <= 0) return 'overdue';
  const danger = dangerThresholdMs(expiresAt, openedAt);
  if (msLeft <= danger) return 'danger';
  if (msLeft <= danger * 2) return 'warning';
  return 'normal';
}

/** Foreground colour for a level — text and icon share it. */
export function expiryColor(level: ExpiryLevel): string {
  switch (level) {
    case 'overdue':
    case 'danger':
      return QuinckleColors.danger;
    case 'warning':
      return QuinckleColors.warning;
    default:
      return QuinckleColors.textSecondary;
  }
}

/**
 * Chip fill + border. Overdue is the only FILLED state: at a glance across a
 * floor of tables, "past its time" has to separate from "nearly there" by more
 * than hue — which also keeps it legible to red/green colour-blind staff, who
 * are ~8% of men.
 */
export function expiryChipStyle(level: ExpiryLevel): { backgroundColor: string; borderColor: string } {
  switch (level) {
    case 'overdue':
      return { backgroundColor: QuinckleColors.dangerSoft, borderColor: QuinckleColors.danger };
    case 'danger':
      return { backgroundColor: QuinckleColors.surfaceMuted, borderColor: QuinckleColors.dangerBorder };
    case 'warning':
      return { backgroundColor: QuinckleColors.surfaceMuted, borderColor: QuinckleColors.warningBorder };
    default:
      return { backgroundColor: QuinckleColors.surfaceMuted, borderColor: QuinckleColors.border };
  }
}
