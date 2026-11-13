import { useEffect, useLayoutEffect } from 'react';
import type { SkinMode } from '../../shared/christmasSkin';
import { api } from '../lib';
import { makeMeSaver } from './meSave';
import { resetSkin, setMePersist, setSkinAvailable } from './store';

/**
 * Zip 38: the player Home screen tells the skin what the server said. `mode` is 'all' (Everyone: the answer's "christmasSkin"), 'me' (Just me:
 * "christmasSkinMe", with `meOn`, the saved theme choice) or 'off'; `demo` is the organizer's View as. On the way out (admin, another page)
 * everything is put back, so no admin screen ever carries the theme.
 */
export function useSkinRoot(mode: SkinMode, demo: boolean, meOn = false) {
  useLayoutEffect(() => {
    setSkinAvailable(mode, demo, meOn);
  }, [mode, demo]); // eslint-disable-line react-hooks/exhaustive-deps
  // Just me: a tap on the logo saves the choice on the server (so a Home Screen app, which keeps its own storage, has it too). One request at a time, always ending on the latest choice (src/skin/meSave.ts); a failure is retried, then quiet.
  useEffect(() => {
    setMePersist(makeMeSaver((on) => api('POST', '/api/christmas-skin-me', { on })));
    return () => setMePersist(null);
  }, []);
  // A layout cleanup runs before the next screen paints, so no admin screen can show a frame of the theme.
  useLayoutEffect(() => resetSkin, []);
}
