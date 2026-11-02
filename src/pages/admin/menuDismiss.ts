// A tap on empty space that closes the gear pop-up must not also fold the game card under it (new layout, Home).
let at = 0;
export const noteMenuDismissed = () => {
  at = Date.now();
};
export const menuJustDismissed = () => Date.now() - at < 600;
