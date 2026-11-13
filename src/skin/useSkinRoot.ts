import { useEffect, useLayoutEffect } from 'react';
import { SERVER_KEY } from '../../shared/christmasSkin';
import { api, storageGet, storageRemove } from '../lib';
import { resetSkin, setSkinAvailable } from './store';

/**
 * Zip 38: the player Home screen tells the skin what the server said. `available` is the answer's "christmasSkin" flag (or the saved
 * last screen's, so the logo does not flicker on a repeat visit); `demo` is the organizer's View as. On the way out (admin, another page)
 * everything is put back, so no admin screen ever carries the theme.
 */
export function useSkinRoot(available: boolean, demo: boolean, forced = false) {
  useLayoutEffect(() => {
    setSkinAvailable(available, demo, forced);
  }, [available, demo, forced]);
  // A layout cleanup runs before the next screen paints, so no admin screen can show a frame of the theme.
  useLayoutEffect(() => resetSkin, []);
}

/**
 * The private link (?christmasskin=on / =off) was just opened on this phone: tell the server once, as soon as a name is picked, so the
 * organizer's own player gets (or loses) the test mode on every phone, a Home Screen app included. The server ignores anyone else. Never in
 * View as. If the call fails the note stays and the next open tries again.
 */
export function useSkinTesterSync(meId: string | null, viewAs: boolean, refresh: () => void) {
  useEffect(() => {
    if (!meId || viewAs) return;
    const want = storageGet(SERVER_KEY);
    if (want !== 'on' && want !== 'off') return;
    void api('POST', '/api/christmas-skin-tester', { on: want === 'on' })
      .then(() => {
        storageRemove(SERVER_KEY);
        // The answer on screen was drawn before the server knew: draw it again now (the link turns the skin on or off at once).
        refresh();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, viewAs]);
}
