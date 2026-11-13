import { useLayoutEffect } from 'react';
import { resetSkin, setSkinAvailable } from './store';

/**
 * Zip 38: the player Home screen tells the skin what the server said. `available` is the answer's "christmasSkin" flag (or the saved
 * last screen's, so the logo does not flicker on a repeat visit); `demo` is the organizer's View as. On the way out (admin, another page)
 * everything is put back, so no admin screen ever carries the theme.
 */
export function useSkinRoot(available: boolean, demo: boolean) {
  useLayoutEffect(() => {
    setSkinAvailable(available, demo);
  }, [available, demo]);
  // A layout cleanup runs before the next screen paints, so no admin screen can show a frame of the theme.
  useLayoutEffect(() => resetSkin, []);
}
