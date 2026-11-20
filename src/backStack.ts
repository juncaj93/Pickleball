// Zip 77 (the 🎾75 audit): Back (an iPhone edge swipe, Android's back) with a sheet open closes the sheet instead of leaving the site, on the
// player and organizer sides; on the organizer screens Back after a tab switch goes to the last tab.
//
// How: every open layer (a sheet, a confirm box, the court map) owns one browser history entry, pushed when it opens (same address, nothing in
// it but a marker). Back pops that entry and closes the top layer. A layer closed any other way (X, a tap outside, Escape, Save, a parent closing
// it) gives its entry back with history.go(-n). The entries are only COUNTED, never tied to one sheet: closing one sheet and opening another in
// the same moment (a sheet that hands over to the next) reuses the entry, so the history never fills up and no Back is wasted. Everything is
// lined up in one step after the current task (reconcile), so sheets inside sheets, a fast close and open, and a Back in the middle all settle
// to "one entry per open layer".
//
// The organizer's tabs: each switch adds one entry ({ pbTab }); Back lands on the entry before it and the Home screen follows it (onTabBack).
// A tab entry is only added while no layer is open.

interface Layer {
  id: number;
  close: () => void;
}

let layers: Layer[] = [];
/** History entries this page pushed for its layers that are still there. */
let owned = 0;
/** A history.go(-n) of ours is on its way (its popstate is ours, not a Back). */
let goingBack = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let goSeq = 0;
let nextId = 1;
const tabQueue: string[] = [];
const tabListeners = new Set<(tab: string) => void>();
let listening = false;

const hasWindow = () => typeof window !== 'undefined' && typeof history !== 'undefined';

function stateWith(extra: Record<string, unknown>): Record<string, unknown> {
  const base = history.state && typeof history.state === 'object' ? (history.state as Record<string, unknown>) : {};
  return { ...base, ...extra };
}

function schedule() {
  if (timer !== null || !hasWindow()) return;
  timer = setTimeout(reconcile, 0);
}

/** One entry per open layer: push the missing ones, give back the extra ones; then the organizer's waiting tab switches. */
function reconcile() {
  timer = null;
  if (goingBack) return;
  const want = layers.length;
  if (owned > want) {
    const n = owned - want;
    owned = want;
    goingBack = true;
    history.go(-n);
    // A browser that never answers the go (nothing to go back to) must not leave the page waiting for good.
    const mine = ++goSeq;
    setTimeout(() => {
      if (goingBack && goSeq === mine) {
        goingBack = false;
        schedule();
      }
    }, 2500);
    return;
  }
  while (owned < want) {
    owned++;
    history.pushState(stateWith({ pbLayer: owned }), '');
  }
  if (want === 0) {
    while (tabQueue.length) {
      const tab = tabQueue.shift()!;
      history.pushState(stateWith({ pbTab: tab, pbLayer: 0 }), '');
    }
  } else tabQueue.length = 0;
}

function onPop(e: PopStateEvent) {
  if (goingBack) {
    goingBack = false;
    schedule();
    return;
  }
  if (owned > 0) {
    // Back with a layer open: its entry is gone; close the top layer. If it stays open (busy), reconcile pushes its entry again. (A layer that
    // closed a moment ago, whose entry reconcile has not given back yet: this Back took it.)
    owned--;
    const top = layers[layers.length - 1];
    if (top) top.close();
    schedule();
    return;
  }
  // Back between the organizer's tabs.
  const tab = e.state && typeof e.state === 'object' ? (e.state as { pbTab?: unknown }).pbTab : undefined;
  if (typeof tab === 'string') tabListeners.forEach((l) => l(tab));
}

function listen() {
  if (listening || !hasWindow()) return;
  listening = true;
  window.addEventListener('popstate', onPop);
}

/** A layer opened: Back now closes it (`close`). Call the returned function when it closes, whichever way. */
export function openLayer(close: () => void): () => void {
  if (!hasWindow()) return () => undefined;
  listen();
  const layer: Layer = { id: nextId++, close };
  layers.push(layer);
  schedule();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    layers = layers.filter((l) => l.id !== layer.id);
    schedule();
  };
}

/** The organizer's tab switched (not by Back): one history entry, so Back returns to the last tab. */
export function pushTab(tab: string) {
  if (!hasWindow()) return;
  listen();
  tabQueue.push(tab);
  schedule();
}

/** The organizer's first tab: marked on the entry the page opened on (no new entry). */
export function markFirstTab(tab: string) {
  if (!hasWindow()) return;
  listen();
  history.replaceState(stateWith({ pbTab: tab }), '');
}

/** Back (or Forward) landed on a tab entry. */
export function onTabBack(cb: (tab: string) => void): () => void {
  listen();
  tabListeners.add(cb);
  return () => {
    tabListeners.delete(cb);
  };
}

/** Tests only: how many layers are open and entries owned. */
export const backStackState = () => ({ layers: layers.length, owned, goingBack });
