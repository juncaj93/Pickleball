// Telegram shows a raw address in full, and a signed /go/ link wraps over
// six lines. So right before sending, "Text the group: https://..." becomes
// "Text the group" as a tappable link to the same address (a Telegram
// text_link entity: no markup, so no text can break it). The words before
// the address become the link: the phrase after the last ". ", "? ", "! ",
// ": " or line break. Only the ": " and the address leave the visible text;
// every other word stays the same. Text with no address is sent as is.
// Addresses `plain` picks (the organizer's /admin page, which the Open site
// button already opens) are dropped and their words left as plain text, so
// a message links only where a tap does the job: the direct text, or
// CourtReserve.

export interface TextLink {
  type: 'text_link';
  /** In UTF-16 code units, as JavaScript strings count them (what Telegram expects). */
  offset: number;
  length: number;
  url: string;
}

/** The organizer's page: the Open site button under every message already goes there. */
export function isAdminPage(url: string): boolean {
  try {
    const u = new URL(url);
    // Zip 15: /admin?unpaid=<game> (Telegram 1's "Text the 2 who haven't paid") is a real link, not the plain Open site page.
    return u.pathname.replace(/\/$/, '') === '/admin' && !u.searchParams.has('unpaid');
  } catch {
    return false;
  }
}

const LINKED = /: (https?:\/\/[^\s"]+)/g;
const BOUNDARY = /(?:[.?!:] |\n)/g;

/**
 * `allowed`: only these addresses become links. Any other "words: address"
 * (say a player named "Bob: https://...") is left exactly as typed, so a
 * name can never turn into hidden link words.
 */
export function linkText(text: string, plain: (url: string) => boolean = () => false, allowed: (url: string) => boolean = () => true): { text: string; entities: TextLink[] } {
  const entities: TextLink[] = [];
  let out = '';
  let from = 0;
  for (const m of text.matchAll(LINKED)) {
    const at = m.index;
    const before = text.slice(from, at);
    // Where the phrase starts: just after the last boundary before the address, within this stretch.
    let phraseStart = 0;
    for (const b of before.matchAll(BOUNDARY)) phraseStart = b.index + b[0].length;
    if (phraseStart >= before.length) continue; // no words to link: leave the address as it is
    if (!plain(m[1]) && !allowed(m[1])) continue; // not one of our addresses: leave it as typed
    out += before;
    from = at + m[0].length;
    if (plain(m[1])) continue;
    entities.push({ type: 'text_link', offset: out.length - (before.length - phraseStart), length: before.length - phraseStart, url: m[1] });
  }
  return { text: out + text.slice(from), entities };
}

/**
 * The exact addresses alerts may link to, nothing looser: the site's own
 * /go/<signed token> direct text link and the two CourtReserve pages the
 * alerts are built with. Any other address (even one on the site, or one with
 * a backslash or an @ that parsers read differently) is left as typed.
 */
export function ourAddress(siteUrl: string, courtReserve: readonly string[]): (url: string) => boolean {
  const site = siteUrl.replace(/\/$/, '');
  const esc = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const go = new RegExp(`^${esc}/go/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`);
  // Zip 15: Telegram 1's link to the organizer's own page, which shows the unpaid players' text (sign-in needed; no phone in the link).
  const unpaid = new RegExp(`^${esc}/admin\\?unpaid=[0-9a-f-]{36}$`);
  return (url: string) => courtReserve.includes(url) || (/^https:\/\//.test(site) && (go.test(url) || unpaid.test(url)));
}
