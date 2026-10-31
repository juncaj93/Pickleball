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
    return new URL(url).pathname.replace(/\/$/, '') === '/admin';
  } catch {
    return false;
  }
}

const LINKED = /: (https?:\/\/[^\s"]+)/g;
const BOUNDARY = /(?:[.?!:] |\n)/g;

export function linkText(text: string, plain: (url: string) => boolean = () => false): { text: string; entities: TextLink[] } {
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
    out += before;
    from = at + m[0].length;
    if (plain(m[1])) continue;
    entities.push({ type: 'text_link', offset: out.length - (before.length - phraseStart), length: before.length - phraseStart, url: m[1] });
  }
  return { text: out + text.slice(from), entities };
}
