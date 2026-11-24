// Zip 86 (🎾86.clean admin): the organizer's tournament card on Home, the pure parts (src/pages/admin/Tournament.tsx draws them): the 4 steps,
// the gray status line under the name, the prize words, and the Money sheet's numbers. Its own file so the unit tests read the very numbers
// the screen shows. Organizer only (the player download never imports it).
import { type AdminTournamentView, formatName, MAX_SPOTS, shortClock } from './tournament';
import { suggestionWords, tierCostCents, topTier } from './tournamentMoney';
import { payByLabel } from './tournamentTickets';
import { boxCostCents, boxWords, prizesOfRow, type StylePrizes } from './tournamentPrizes';
import { localParts } from './time';
import { shortDay, signupCloseDefault } from './tournamentNudge';
import { formatPrice } from './money';

/** The 4 steps, in order. */
export const STEPS = ['Sign up', 'Payments', 'Game night', 'Done'] as const;

/**
 * Where the tournament is: 0 Sign up, 1 Payments (tickets open, before game day), 2 Game night, 3 Done; null when canceled. Zip 87 (pictures 7 and
 * 8): Game night starts on the tournament's day (`gameDay`), before the night itself.
 */
export function stepOf(t: Pick<AdminTournamentView, 'status' | 'closed' | 'over'>, gameDay = false): 0 | 1 | 2 | 3 | null {
  if (t.status === 'canceled') return null;
  if (t.status === 'ended' || t.over) return 3;
  if (t.status !== 'tickets') return 0;
  return t.closed || gameDay ? 2 : 1;
}

/** 'YYYY-MM-DD' of a moment, Eastern. */
export const dayKeyOf = (ms: number, tz: string): string => {
  const p = localParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

/** Zip 87: it is the tournament's day (tickets open, the date finalized). */
export const isGameDay = (t: Pick<AdminTournamentView, 'status' | 'finalDate'>, nowIso: string, tz: string): boolean =>
  t.status === 'tickets' && !!t.finalDate && t.finalDate === dayKeyOf(Date.parse(nowIso), tz);

/** "Mon 7 PM" (no ":00"). */
export const clockShort = (s: string): string => s.replace(/:00(?=\s?[AP]M)/g, '');

/** The locked-in number every organizer row uses (the server's count). */
const lockedNumOf = (t: AdminTournamentView): number => t.lockedIn ?? (t.tickets ?? []).filter((k) => k.place === 'spot' && !k.out).length;

/**
 * The gray line under the name: "Payments · pay by Mon 7 PM" ("pay by today 7 PM" on the day), "Payments · Pay by passed", "Payments · all
 * paid" (Zip 87: nobody left to pay), "Sign up · ends Tue", "Game night · 7:30 PM", "Done", "Canceled". `due`: how many still have to pay
 * (dueOf); left out, as before Zip 87.
 */
export function statusWords(t: AdminTournamentView, nowIso: string, tz: string, due?: number): string {
  const step = stepOf(t, isGameDay(t, nowIso, tz));
  if (step === null) return 'Canceled';
  if (step === 3) return 'Done';
  if (step === 2) return t.startSet ? `Game night · ${shortClock(t.start)}` : 'Game night';
  if (step === 1) {
    // Review fix: nobody left to remind because every spot is taken is not "all paid".
    if (due === 0 && (t.tickets ?? []).filter((k) => k.place === 'spot' && !k.out).length >= MAX_SPOTS) return 'Payments · every spot taken';
    if (due === 0) return 'Payments · all paid';
    if (t.payBy && Date.parse(nowIso) < Date.parse(t.payBy)) {
      const today = dayKeyOf(Date.parse(t.payBy), tz) === dayKeyOf(Date.parse(nowIso), tz);
      return `Payments · pay by ${clockShort(today ? `today ${payByLabel(t.payBy, tz).split(' ').slice(1).join(' ')}` : payByLabel(t.payBy, tz, t.finalDate))}`;
    }
    if (t.payBy && due !== undefined) return 'Payments · Pay by passed';
    return `Payments · ${lockedNumOf(t)} locked in`;
  }
  if (t.status === 'rescheduled') return 'Sign up · rescheduled';
  if (t.status === 'date_picked') return 'Sign up · date picked';
  const close = t.notSignedUp?.closeAt ?? signupCloseDefault(Date.parse(nowIso), tz);
  return `Sign up · ends ${shortDay(close, tz).split(' ')[0]}`;
}

/** "$14 each to the winners" (Locked doubles), "1st $14 · 2nd $7" (Americano, or the vote), or null when no prize is set. */
export function prizeWords(t: Pick<AdminTournamentView, 'format' | 'formatPending' | 'championCreditCents' | 'secondCreditCents'>): string | null {
  return prizeWordsFor(t.format === 'doubles' && !t.formatPending ? 'doubles' : 'americano', t.championCreditCents, t.secondCreditCents);
}

/** The prize words for the style the money line prices by (Locked doubles never counts a 2nd place: Zip 83). */
export function prizeWordsFor(style: 'doubles' | 'americano', championCents: number, secondCents: number): string | null {
  if (style === 'doubles') return championCents > 0 ? `${formatPrice(championCents)} each to the winners` : null;
  if (championCents <= 0 && secondCents <= 0) return null;
  return secondCents > 0 ? `1st ${formatPrice(championCents)} · 2nd ${formatPrice(secondCents)}` : `1st ${formatPrice(championCents)}`;
}

/** The style words on the When block ("Locked doubles", "Players vote"). */
export const styleShort = (t: Pick<AdminTournamentView, 'format' | 'formatPending'>): string => (t.formatPending ? 'Players vote' : formatName(t.format));

export interface MoneySheet {
  /** RIGHT NOW: tickets paid (players with a spot and a price, the organizer's $0 seat not one), their money, the courts, the prizes set (null:
   *  none set), and So far (paid - courts - prizes). */
  paidCount: number;
  paidCents: number;
  courtCents: number;
  prizesNowCents: number | null;
  soFarCents: number;
  /** IF ALL N PAY: N (the Plan's expected players), the tickets (N - 1: the organizer plays free), whether the organizer has a free seat. */
  expected: number;
  ticketsAllCents: number;
  freeSeat: boolean;
  /** The prizes counted: the ones set, else the style's full tier (suggested, not set yet). */
  prizeAllCents: number;
  prizeAllWords: string;
  prizeSuggested: boolean;
  /** You keep: tickets - courts - those prizes. */
  keepCents: number;
  /** The Money button's line ("+$42 if all pay"): THE money line (prizes as set), what Totals' Projected card counts for the open tournament. */
  buttonCents: number;
}

/**
 * Zip 86 (picture 7): the Money sheet, from the server's money line (shared/tournamentMoney.ts planMoney) and cost only, so it matches the Time
 * box, the Plan box, Finalize, the card and Totals to the cent. Null when the server sent no money line.
 */
export function moneySheet(t: AdminTournamentView): MoneySheet | null {
  const m = t.money;
  const c = t.cost;
  if (!m || !c) return null;
  const style = m.style ?? t.format;
  const setCents = m.ticketsCents - m.courtCents - m.youCents;
  // Review fix: the words follow the style the money line prices by, so they always name the amount counted. Zip 87: from that style's box;
  // a saved box at $0 is set too ("Medals only").
  const prizes = prizesOf(t);
  const box = prizes[style];
  const set = prizes.saved || setCents > 0;
  const words = boxWords(style, box, formatPrice);
  const full = topTier(style);
  const fullCents = tierCostCents(full, style);
  const prizeAllCents = set ? setCents : fullCents;
  return {
    paidCount: c.paidNow,
    paidCents: c.paidNow * t.ticketCents,
    courtCents: m.courtCents,
    prizesNowCents: set ? setCents : null,
    soFarCents: -c.nowCents,
    expected: t.expected ?? t.size,
    ticketsAllCents: m.ticketsCents,
    freeSeat: (t.tickets ?? []).some((k) => k.organizer && !k.out),
    prizeAllCents,
    prizeAllWords: set ? words : suggestionWords(full, style).replace(/^Suggested: /, ''),
    prizeSuggested: !set,
    keepCents: m.ticketsCents - m.courtCents - prizeAllCents,
    buttonCents: m.youCents,
  };
}


// ---------------------------------------------------------------------------------------------------------------------
// Zip 87 (🎾87.card polish, pictures 1 and 3 to 8): the card's count, its four buttons over time, and the prize boxes.
// ---------------------------------------------------------------------------------------------------------------------

/** The prize boxes the view carries (an older server: from the columns, as before). */
export const prizesOf = (t: Pick<AdminTournamentView, 'prizes' | 'championCreditCents' | 'secondCreditCents'>): StylePrizes =>
  t.prizes ?? prizesOfRow({ champion_credit_cents: t.championCreditCents, second_credit_cents: t.secondCreditCents });

/** The style the plan prices by now (the box on top of the Prizes sheet, "Plan now"). */
export const plannedStyle = (t: Pick<AdminTournamentView, 'format' | 'money'>): 'doubles' | 'americano' => t.money?.style ?? t.format;

/**
 * Zip 87 (section 4): "6 of 10 locked in". The 10 is everyone on the list who can make the date (the organizer too), the same balls players see
 * (src/tournament/TournamentHome.tsx cardRows): every player locked in, plus everyone else who can make the date and is not on standby. The 6 is
 * the server's locked-in count, as before. Before a date is picked: everyone on the list.
 */
export function ticketCount(t: Pick<AdminTournamentView, 'finalDate' | 'signups' | 'tickets' | 'lockedIn'>): { locked: number; total: number } {
  const tickets = (t.tickets ?? []).filter((k) => !k.out);
  const gold = new Set(
    tickets.filter((k) => k.place === 'spot' || (k.place !== 'line' && k.claimCents > 0 && k.creditCents + k.paidCents + k.claimCents >= k.priceCents)).map((k) => k.playerId),
  );
  const line = new Set(tickets.filter((k) => k.place === 'line').map((k) => k.playerId));
  const going = t.finalDate ? t.signups.filter((s) => s.dates.includes(t.finalDate!)) : t.signups;
  const rest = going.filter((s) => !gold.has(s.playerId) && !line.has(s.playerId)).length;
  const locked = t.lockedIn ?? gold.size;
  return { locked, total: Math.max(locked, gold.size + rest) };
}

/** "6 of 10 locked in" or, once everyone who can make it is in, "All 10 locked in". */
export const ticketWords = (c: { locked: number; total: number }): string => (c.total > 0 && c.locked >= c.total ? `All ${c.total} locked in` : `${c.locked} of ${c.total} locked in`);

/**
 * Zip 87: who still has to pay: on the list, able to make the date, no spot, nothing paid in full, no I paid waiting, never the organizer; while
 * a spot can still be bought (tickets open, the night not started, a spot open). Before Pay by it is Zip 63's list (unpaidOf); after Pay by the
 * same people are past due.
 */
export function dueOf(t: AdminTournamentView): AdminTournamentView['signups'] {
  // No Pay by (a row from before tickets had one): nobody to remind (Remind says "No pay by set"), as before.
  if (t.status !== 'tickets' || !t.finalDate || !t.payBy || t.closed) return [];
  const tickets = t.tickets ?? [];
  if (tickets.filter((k) => k.place === 'spot' && !k.out).length >= MAX_SPOTS) return [];
  const byId = new Map(tickets.map((k) => [k.playerId, k]));
  return t.signups.filter((s) => {
    const k = byId.get(s.playerId);
    if (k?.organizer) return false;
    if (!s.dates.includes(t.finalDate!)) return false;
    return !k || (k.place !== 'spot' && k.creditCents + k.paidCents < k.priceCents && k.claimCents === 0);
  });
}

/** How a big button looks: solid green, soft green tint, amber tint, red tint, plain, or quiet (no fill, gray words, does nothing). */
export type ButtonTone = 'solid' | 'soft' | 'amber' | 'red' | 'plain' | 'quiet';
/** The second line's color (never bold, Zip 87). */
export type SubTone = 'green' | 'amber' | 'red' | 'gray' | 'white';

export interface CardButton {
  key: 'tickets' | 'remind' | 'teams' | 'rounds' | 'prizes' | 'money';
  title: string;
  sub: string;
  tone: ButtonTone;
  subTone: SubTone;
}

/**
 * Zip 87 (pictures 3 to 8): the four buttons during Payments and on game day before the night, by time:
 * Tickets: soft green "6 of 10 locked in" until everyone who can make it is in, then solid "All 10 locked in".
 * Remind: plain, amber words "4 haven't paid"; on the Pay by day an amber tint "2 left · due 7 PM"; after Pay by with someone unpaid a red tint
 *   "1 past due"; nobody to remind: quiet ("Everyone paid", "Every spot taken", "No pay by set"). On game day the spot is Teams (Locked doubles)
 *   or Rounds (Americano: always soft green "6 rounds ready", nothing to do). Locked doubles: amber "Draft before 7:30" until published, then
 *   soft green "5 teams set".
 * Prizes: plain "Not set yet"; on game day amber "Set before tonight"; once set soft green ("$14 each to winners"), never solid.
 * Money: plain; the line green at 0 or more ("+$42 if all pay"), red below ("−$6 if all pay"); on game day with prizes set "You keep +$14".
 */
export function cardButtons(t: AdminTournamentView, nowIso: string, tz: string): CardButton[] {
  const now = Date.parse(nowIso);
  const gameDay = isGameDay(t, nowIso, tz);
  const count = ticketCount(t);
  const all = count.total > 0 && count.locked >= count.total;
  const out: CardButton[] = [{ key: 'tickets', title: 'Tickets', sub: ticketWords(count), tone: all ? 'solid' : 'soft', subTone: all ? 'white' : 'green' }];
  const start = shortClock(t.start).replace(/ [AP]M$/, '');
  if (gameDay) {
    if (t.format === 'americano') {
      // Alex (round 2): Americano has no draft; the rounds are made by the site, so there is nothing to do: always soft, the real count.
      const n = t.rounds?.plan.rounds;
      out.push({ key: 'rounds', title: 'Rounds', sub: n ? `${n} rounds ready` : 'Rounds ready', tone: 'soft', subTone: 'green' });
    } else {
      const d = t.day;
      const done = !!d && d.phase === 'published';
      out.push(done ? { key: 'teams', title: 'Teams', sub: `${d!.teams.length} teams set`, tone: 'soft', subTone: 'green' } : { key: 'teams', title: 'Teams', sub: `Draft before ${start}`, tone: 'amber', subTone: 'amber' });
    }
  } else {
    const due = dueOf(t).length;
    const passed = !!t.payBy && now >= Date.parse(t.payBy);
    if (due === 0) {
      const why = !t.payBy ? 'No pay by set' : (t.tickets ?? []).filter((k) => k.place === 'spot' && !k.out).length >= MAX_SPOTS ? 'Every spot taken' : 'Everyone paid';
      out.push({ key: 'remind', title: 'Remind', sub: why, tone: 'quiet', subTone: 'gray' });
    } else if (passed) {
      out.push({ key: 'remind', title: 'Remind', sub: `${due} past due`, tone: 'red', subTone: 'red' });
    } else if (t.payBy && dayKeyOf(Date.parse(t.payBy), tz) === dayKeyOf(now, tz)) {
      out.push({ key: 'remind', title: 'Remind', sub: `${due} left · due ${clockShort(payByLabel(t.payBy, tz).split(' ').slice(1).join(' '))}`, tone: 'amber', subTone: 'amber' });
    } else {
      out.push({ key: 'remind', title: 'Remind', sub: `${due} ${due === 1 ? 'hasn’t' : 'haven’t'} paid`, tone: 'plain', subTone: 'amber' });
    }
  }
  const prizes = prizesOf(t);
  const style = plannedStyle(t);
  const box = prizes[style];
  const set = prizes.saved || boxCostCents(style, box) > 0;
  out.push(
    set
      ? { key: 'prizes', title: 'Prizes', sub: boxWords(style, box, formatPrice), tone: 'soft', subTone: 'green' }
      : gameDay
        ? { key: 'prizes', title: 'Prizes', sub: 'Set before tonight', tone: 'amber', subTone: 'amber' }
        : { key: 'prizes', title: 'Prizes', sub: 'Not set yet', tone: 'plain', subTone: 'gray' },
  );
  if (t.money) {
    const you = t.money.youCents;
    const amount = you >= 0 ? `+${formatPrice(you)}` : `−${formatPrice(-you)}`;
    out.push({ key: 'money', title: 'Money', sub: gameDay && set ? `You keep ${amount}` : `${amount} if all pay`, tone: 'plain', subTone: you >= 0 ? 'green' : 'red' });
  }
  return out;
}

/** The pill on the card's head: amber "4 unpaid" while anyone still has to pay (also past Pay by), else green "10 locked in". */
export function pillOf(t: AdminTournamentView): { words: string; unpaid: boolean } {
  const due = t.status === 'tickets' ? dueOf(t).length : 0;
  return due > 0 ? { words: `${due} unpaid`, unpaid: true } : { words: `${lockedNumOf(t)} locked in`, unpaid: false };
}
