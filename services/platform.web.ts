/**
 * Where is this running? — desktop (Electron) and web.
 *
 * True only inside the Electron shell, which announces itself through the
 * preload bridge. A plain browser tab reports false and keeps the phone
 * layout, which is the right default for a narrow window.
 */

export function isDesktop(): boolean {
  return (globalThis as any)?.quinckle?.isDesktop === true;
}
