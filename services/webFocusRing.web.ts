/**
 * Web / desktop (Electron): switch off the browser's default focus ring.
 *
 * Chromium draws its own double outline (yellow + white) around whatever has
 * focus — text inputs, and buttons after a click or a key press — and
 * react-native-web does not remove it. In this app it read as a stray box: on the
 * phone-number field it sat inside the field's own orange focus border, and on
 * "Place Order" it outlined the button after Enter.
 *
 * Imported once, for its side effect, from app/_layout.tsx.
 *
 * Trade-off, deliberately accepted: this is a till used with a mouse or a
 * touchscreen, and the app has no keyboard-navigation design to replace the ring
 * with. Anyone tabbing through the UI gets no focus indicator until one is built.
 */

const STYLE_ID = 'quinckle-no-focus-ring';
// An earlier version of this module only covered text inputs, under this id.
const LEGACY_ID = 'quinckle-no-input-ring';

if (typeof document !== 'undefined') {
  document.getElementById(LEGACY_ID)?.remove();
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ':focus, :focus-visible { outline: none !important; }';
    document.head.appendChild(style);
  }
}
