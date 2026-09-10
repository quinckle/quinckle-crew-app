import { useWindowDimensions } from 'react-native';

/**
 * Single source of truth for responsive / tablet layout decisions.
 *
 * Breakpoints are based on the shortest side so a device is treated as a
 * "tablet" regardless of orientation (a 10" tablet in portrait is still a
 * tablet). `isLandscape` is derived from the live window so layouts can react
 * to rotation.
 *
 * Usage:
 *   const { isTablet, isLandscape, columns } = useResponsive();
 *   ...isTablet ? tabletStyle : phoneStyle
 */
export interface Responsive {
  /** Live window width. */
  width: number;
  /** Live window height. */
  height: number;
  /** true once the shortest side is tablet-sized (>= 600dp). */
  isTablet: boolean;
  /** true when width > height. */
  isLandscape: boolean;
  /** true on a tablet in landscape — the "full POS" layout target. */
  isWide: boolean;
  /**
   * Suggested column count for card/tile grids. Phones get 1, tablets scale
   * with available width. Callers can ignore this and compute their own.
   */
  columns: number;
  /**
   * Max content width for constrain-width screens (forms, detail panels) so
   * inputs/text don't stretch edge-to-edge on wide screens. `undefined` on
   * phones (use full width).
   */
  contentMaxWidth: number | undefined;
}

// dp thresholds
const TABLET_MIN_SHORT_SIDE = 600;

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  const shortSide = Math.min(width, height);
  const isTablet = shortSide >= TABLET_MIN_SHORT_SIDE;
  const isLandscape = width > height;
  const isWide = isTablet && isLandscape;

  let columns = 1;
  if (isTablet) {
    // ~320dp per card target, capped so cards don't get comically wide.
    columns = Math.max(2, Math.min(4, Math.floor(width / 320)));
  }

  const contentMaxWidth = isTablet ? 560 : undefined;

  return { width, height, isTablet, isLandscape, isWide, columns, contentMaxWidth };
}
