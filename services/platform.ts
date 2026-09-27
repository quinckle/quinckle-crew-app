/**
 * Where is this running? — native (Android / iOS).
 *
 * The gate for every place the desktop build should look or behave differently
 * from the phone. Metro swaps in platform.web.ts for the desktop bundle, so a
 * screen writes `isDesktop() ? … : …` once and the phone path is not merely
 * false at runtime — on a phone it is the only code that ships.
 *
 * Use this for DESIGN divergence. For "can this device do X" (USB, camera),
 * ask the capability instead, so a feature is gated on the capability rather
 * than on a guess about the platform.
 */

export function isDesktop(): boolean {
  return false;
}
