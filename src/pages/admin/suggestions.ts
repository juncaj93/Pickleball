// The text suggestions on the organizer's Home: one card per game that needs
// a text, each with one Text button. No React here, so tests can use it. The
// site never sends anything: the button only opens Messages with the words
// and the numbers ready.
//
// Which texts and what they say come from the Text menu (textMenu.ts); this
// file decides WHEN each one is worth suggesting, and which cards to show.
import type { AdminDashboard, AdminSessionView } from '../../../shared/api';
import { remindAllMessage, siteAddress } from '../../../shared/messages';
import { formatShortDate, formatTimeRange, localParts, zonedTimeToUtc } from '../../../shared/time';
import { owedGames, reminderText, sessionTexts, type TextItem } from './textMenu';

export type SuggestionKind = 'now6' | 'promoted' | 'down5' | 'need' | 'checkin' | 'pay';

export interface Suggestion {
  /** Names this card: the kind, the game, and for one person's text, who. */
  key: string;
  kind: SuggestionKind;
  sessionId: string;
  /** What the situation is right now (like the number of players). A hidden card comes back when this changes. */
  token: string;
  /** "Thu, Oct 29 · 8:00 to 10:00 PM" */
  when: string;
  body: string;
  /** The small gray words: "Group chat" or "4 players". */
  who: string;
  chat: boolean;
  phones: string[];
  /** Names with no number saved. */
  missing: string[];
}

/** Fewer than 4 in: suggested once the game is this close. */
export const NEED_WITHIN_HOURS = 48;
/** Check-in: from this hour (local) on the day before. */
export const CHECKIN_FROM_HOUR = 18;
/** An unpaid game is suggested for a reminder once it was this many calendar days ago. */
export const PAY_AFTER_DAYS = 7;

/** 6:00 PM on the calendar day before the game, in the group's time zone. */
export function checkInOpensMs(startsAt: string, tz: string): number {
  const p = localParts(Date.parse(startsAt), tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), CHECKIN_FROM_HOUR, 0, tz);
}

/** Whole calendar days from the game's date to today, in the group's time zone (not blocks of 24 hours). */
export function daysSince(startsAt: string, nowMs: number, tz: string): number {
  const g = localParts(Date.parse(startsAt), tz);
  const n = localParts(nowMs, tz);
  const num = (p: { year: number; month: number; day: number }) => Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
  return num(n) - num(g);
}

const people = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;

function from(s: AdminSessionView, tz: string, kind: SuggestionKind, item: Pick<TextItem, 'body' | 'chat' | 'phones' | 'missing'>, token: string, keyExtra = ''): Suggestion {
  const count = item.phones.length + item.missing.length;
  return {
    key: `${kind}:${s.id}${keyExtra}`,
    kind,
    sessionId: s.id,
    token,
    when: `${formatShortDate(s.startsAt, tz)} · ${formatTimeRange(s.startsAt, s.endsAt, tz)}`,
    body: item.body,
    who: item.chat ? 'Group chat' : people(count),
    chat: item.chat,
    phones: item.phones,
    missing: item.missing,
  };
}

const PRIORITY: SuggestionKind[] = ['now6', 'promoted', 'down5', 'need', 'checkin'];

/**
 * Every text worth suggesting right now, whether or not it was already
 * tapped. Upcoming games first (soonest first, and within a game the most
 * pressing text first), then payment reminders for games played a week ago or more.
 */
export function suggestions(d: AdminDashboard, nowMs: number): Suggestion[] {
  const tz = d.group.timezone;
  const upcoming: Suggestion[] = [];
  const pay: Suggestion[] = [];
  for (const s of d.sessions) {
    const start = Date.parse(s.startsAt);
    const canceled = s.state.flags.canceled;
    if (!canceled && start > nowMs) {
      const n = s.confirmedCount;
      const items = sessionTexts(d, s, nowMs);
      const one = (id: TextItem['id']) => items.find((i) => i.id === id);
      const here: Suggestion[] = [];
      const now6 = one('now6');
      if (now6) here.push(from(s, tz, 'now6', now6, now6.phones.concat(now6.missing).join(',')));
      for (const p of items.filter((i) => i.id === 'promoted')) {
        const card = from(s, tz, 'promoted', p, p.who, `:${p.label}`);
        card.who = `1 player (${p.label.replace(/^Spot opened: /, '')})`;
        here.push(card);
      }
      const down5 = one('down5');
      if (down5) here.push(from(s, tz, 'down5', down5, String(n)));
      const need = one('need');
      if (need && start - nowMs <= NEED_WITHIN_HOURS * 3600_000) here.push(from(s, tz, 'need', need, String(n)));
      const checkin = one('checkin');
      if (checkin && nowMs >= checkInOpensMs(s.startsAt, tz)) here.push(from(s, tz, 'checkin', checkin, `${n}+${s.waitlistCount}`));
      here.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
      upcoming.push(...here);
    } else if (!canceled && Date.parse(s.endsAt) <= nowMs && daysSince(s.startsAt, nowMs, tz) >= PAY_AFTER_DAYS) {
      const owing = s.roster.filter((r) => !r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null && owedGames(d, r.playerId).length > 0);
      if (owing.length === 0) continue;
      const phones = owing.filter((r) => r.phone).map((r) => r.phone!);
      const missing = owing.filter((r) => !r.phone).map((r) => r.name);
      const body = owing.length === 1 ? reminderText(d, owing[0].playerId, owing[0].name) : remindAllMessage(siteAddress(d.group.playerLink));
      const card = from(s, tz, 'pay', { body, chat: false, phones, missing }, owing.map((r) => r.playerId).sort().join(','));
      if (owing.length === 1) card.who = `1 player (${owing[0].name})`;
      pay.push(card);
    }
  }
  return [...upcoming, ...pay];
}

/** What the organizer already tapped Text on, on this device: card key to the situation it was in. */
export type Tapped = Record<string, string>;

/**
 * The cards to show: one per game (the most pressing text that was not just
 * tapped), then the payment reminders. A card tapped earlier stays hidden
 * while its situation is the same.
 */
export function visibleSuggestions(all: Suggestion[], tapped: Tapped): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const c of all) {
    if (c.kind !== 'pay' && seen.has(c.sessionId)) continue;
    if (tapped[c.key] === c.token) continue;
    if (c.kind !== 'pay') seen.add(c.sessionId);
    out.push(c);
  }
  return out;
}

/** Forget taps for cards that no longer apply, so a situation that comes back is suggested again. */
export function pruneTapped(all: Suggestion[], tapped: Tapped): Tapped {
  const keep: Tapped = {};
  for (const c of all) if (tapped[c.key] === c.token) keep[c.key] = c.token;
  return keep;
}

// ---------- Remembered on this device only ----------

const STORAGE_KEY = 'pb_text_tapped';

export function readTapped(get: (k: string) => string | null): Tapped {
  try {
    const v = JSON.parse(get(STORAGE_KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'string')) as Tapped;
  } catch {
    return {};
  }
}

export function writeTapped(set: (k: string, v: string) => void, tapped: Tapped) {
  try {
    set(STORAGE_KEY, JSON.stringify(tapped));
  } catch {
    /* storage can be off; the card then simply stays until the situation changes */
  }
}
