// "Good news, a spot opened up, so you're in." shows only the FIRST time this
// player sees it on this phone, then never again (Alex, Nov 1). Remembered in
// browser storage only; no server or database change.
//
// One promotion = player + game + the moment they moved in (the server sets the
// seat's sign-up time to the promotion time, and a fresh I'm in clears the
// promotion). So a new promotion, on another game or the same game later, shows
// once too.
//
// Within the visit where it first shows, it stays put (the 5-second refresh, a
// filter switch or a redraw does not make it blink away). A reload, a new visit
// or coming back later: gone.
//
// The organizer's "View as..." keeps its own memory in the page only, once per
// demo session (a new demo session starts again).

const KEY = 'pb_good_news_seen';
/** Plenty for a season of promotions; the oldest are forgotten first. */
const KEEP = 60;

/** Shown during this page visit: keeps showing until the page is closed or reloaded. */
const visit = new Set<string>();
/** Fallback memory when storage is blocked (lasts until the page closes). */
let blocked: string[] | null = null;
/** The organizer's View as: memory per demo session, never saved. */
let demo: { version: number; seen: Set<string> } = { version: -1, seen: new Set() };

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
    }
    return blocked ?? [];
  } catch {
    return blocked ?? [];
  }
}

function writeSeen(list: string[]) {
  blocked = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* blocked: the page memory still stops repeats until the page closes */
  }
}

export function goodNewsKey(playerId: string, sessionId: string, signupAt: string): string {
  return `${playerId}|${sessionId}|${signupAt}`;
}

/**
 * Should the note show now? The first sight of a promotion shows it and remembers it at once;
 * later in the same visit it keeps showing; after that, never. `demoVersion` is set in View as.
 */
export function seeGoodNews(key: string, demoVersion: number | null = null): boolean {
  if (demoVersion !== null) {
    if (demo.version !== demoVersion) demo = { version: demoVersion, seen: new Set() };
    const k = `demo:${demoVersion}:${key}`;
    if (visit.has(k)) return true;
    if (demo.seen.has(key)) return false;
    demo.seen.add(key);
    visit.add(k);
    return true;
  }
  if (visit.has(key)) return true;
  const seen = readSeen();
  if (seen.includes(key)) return false;
  writeSeen([...seen, key].slice(-KEEP));
  visit.add(key);
  return true;
}

/** Tests only: a fresh page (a reload). */
export function _newVisitForTests() {
  visit.clear();
  blocked = null;
  demo = { version: -1, seen: new Set() };
}
