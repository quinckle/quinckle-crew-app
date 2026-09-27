/**
 * What to PRINT for a key, per platform.
 *
 * Captions only — every handler accepts the same events either way (Cmd or
 * Ctrl, `e.key === 'Enter'` for both keys). This decides what the operator
 * reads on the hint strips and key caps, nothing about what they do.
 *
 * The distinction that matters: on a Mac the key is labelled **return** and its
 * glyph is ↩. ↵ and "enter" are the Windows/Linux spelling of the same key.
 * Apple's ⌅ / "enter" means the keypad key, which is not what any of these
 * shortcuts are bound to, so it must not be used here.
 *
 * Read once at module load. A till does not change machines mid-session, and
 * on native `navigator` is absent, so everything falls back to the PC spelling
 * — which is fine, because every caption that uses this is behind the desktop
 * command rail.
 */

const isMac = (() => {
  try {
    const nav = (globalThis as any)?.navigator;
    // userAgentData is the supported one; platform is deprecated but is still
    // what Electron reports, so try both before giving up.
    const p: string = nav?.userAgentData?.platform ?? nav?.platform ?? '';
    return /mac/i.test(p);
  } catch {
    return false;
  }
})();

export const KeyLabels = {
  /** The accelerator prefix: `⌘` on a Mac, `Ctrl+` elsewhere. */
  accel: isMac ? '⌘' : 'Ctrl+',
  /** The glyph: `↩` return on a Mac, `↵` enter elsewhere. */
  enter: isMac ? '↩' : '↵',
  /** The word, lower case, for running text: "↩ return to print". */
  enterWord: isMac ? 'return' : 'enter',
};
