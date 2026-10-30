// "Never interrupt something the person is doing." Anything in progress holds
// the live updates back (a sheet open, a button saving, a finger on the
// screen, typing in a box). The update is applied right after the last hold lets go.

let holds = 0;
let pointerDown = false;
let typing = false;
const waiting = new Set<() => void>();

const quiet = () => holds === 0 && !pointerDown && !typing;

function maybeIdle() {
  if (!quiet()) return;
  for (const cb of [...waiting]) cb();
}

/** Something is in progress. Call the returned function when it ends (calling it twice is fine). */
export function holdLive(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    maybeIdle();
  };
}

export const liveIsBusy = () => !quiet();

/** Called whenever the screen goes from busy to quiet. */
export function onLiveQuiet(cb: () => void): () => void {
  waiting.add(cb);
  return () => {
    waiting.delete(cb);
  };
}

if (typeof document !== 'undefined') {
  let letGo: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener(
    'pointerdown',
    () => {
      clearTimeout(letGo);
      pointerDown = true;
    },
    true,
  );
  const up = () => {
    clearTimeout(letGo);
    // The click that follows a tap starts its own hold; this covers the gap.
    letGo = setTimeout(() => {
      pointerDown = false;
      maybeIdle();
    }, 300);
  };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  const isField = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  document.addEventListener('focusin', (e) => {
    if (isField(e.target)) typing = true;
  });
  document.addEventListener('focusout', (e) => {
    if (isField(e.target)) {
      typing = false;
      maybeIdle();
    }
  });
}
