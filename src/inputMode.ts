// Zip 59 (focus ring): the green focus ring belongs to the keyboard. A tap with a finger or a click with a mouse must not leave a ring on a
// button (most often the X on a sheet, which the browser focuses when the sheet opens). The browser's own :focus-visible guess is not enough
// there, so the page notes how the last input came in: <html data-input="pointer"> after a tap or click, "keyboard" after a key press. The style
// (src/styles.css, next to the base :focus-visible rule) draws no ring while it says pointer. Keyboard users keep every ring, site wide.
let started = false;

export function watchInputMode(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  const root = document.documentElement;
  const set = (mode: 'pointer' | 'keyboard') => {
    if (root.getAttribute('data-input') !== mode) root.setAttribute('data-input', mode);
  };
  addEventListener('pointerdown', () => set('pointer'), true);
  addEventListener('mousedown', () => set('pointer'), true);
  addEventListener('touchstart', () => set('pointer'), { capture: true, passive: true });
  addEventListener(
    'keydown',
    (e) => {
      // A bare modifier is not a keyboard walk through the page; Tab, arrows, Enter, Space, Escape and the letters are.
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      set('keyboard');
    },
    true,
  );
}
