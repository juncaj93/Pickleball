// The on-screen keyboard. On an iPhone the keyboard does not shrink the page: it covers the bottom of it, so a sheet
// that sits at the bottom of the screen ends up under the keyboard, with its Save button hidden. This tells the page how
// tall the keyboard is (the --kb variable and html[data-kb]) so a sheet can sit above it. Phones that shrink the page
// themselves report no keyboard here (the visible area equals the page), so nothing changes for them.

/** Below this the visual area is just the browser's own bars changing, not a keyboard. */
const MIN_KEYBOARD_PX = 100;

export function keyboardHeight(innerHeight: number, vvHeight: number, vvOffsetTop: number, vvScale: number): number {
  // Pinched in (zoomed): the visible area is smaller too, but that is not a keyboard.
  if (vvScale > 1.01) return 0;
  const kb = Math.round(innerHeight - vvHeight - vvOffsetTop);
  return kb > MIN_KEYBOARD_PX ? kb : 0;
}

export function watchKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    const kb = keyboardHeight(window.innerHeight, vv.height, vv.offsetTop, vv.scale);
    if (kb > 0) {
      root.style.setProperty('--kb', `${kb}px`);
      root.dataset.kb = 'on';
    } else {
      root.style.removeProperty('--kb');
      delete root.dataset.kb;
    }
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  // Turning the phone changes the page height and the visible area at slightly different moments.
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  update();
}
