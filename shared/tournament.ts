// Zip 55 (Nov 2026): TOURNAMENTS ("Tournaments"), ships OFF. A doubles tournament, built in 4 pieces; this is PIECE 1:
//   1. the organizer creates a tournament (Settings > Schedule > Create tournament): name, the dates to offer, players expected (6, 8, 10
//      or 12), the court plan for that size, the ticket price and the champion credit (both only STORED in piece 1), and who can see it;
//   2. players sign up from a pinned ticket card on Home: their level, then every date that works; they can edit or back out;
//   3. the organizer sees the level list (each player's pick, can change it) and how many can make each date, and picks the date.
// Piece 2 (tickets, waitlist), piece 3 (teams, game day, End tournament) and piece 4 (tie wheel, final) come later. No money moves here.
//
// Reusable every year with NO new code: the name ("Winter Classic" in the pictures is only an example), dates, size, plan, prices and credit
// are all typed on the Create screen.
//
// THE SWITCH: a wrangler.toml kill switch (allowed unless "off"; no line since Zip 45), a Settings > Feature switches row (one task_log row,
// ships OFF) and a private per-phone link (?tournaments=on, =off ends it). On top of that each tournament has its own "Who can see it":
// Only me (the start: only the organizer, signed in, on their own player page) or Everyone. While Only me, a player's phone gets NOTHING about
// it from the server (no card, no names, no count), not just a hidden card.

export const TOURNAMENTS = {
  task: 'tournaments_on',
  header: 'X-Tournaments',
  link: 'tournaments',
  env: 'TOURNAMENTS',
  name: 'Tournaments',
} as const;

/** The wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call (or the private link). */
export function tournamentsAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

// ---------------------------------------------------------------------------------------------------------------------
// Levels (copied word for word from the sign-up picture, mock 05). Stored in hundredths: 250 = 2.5, 360 = 3.6+.
// ---------------------------------------------------------------------------------------------------------------------

export interface Level {
  value: number;
  /** As the sign-up list shows it ("3.6+"). */
  label: string;
  /** As the organizer's level list shows it ("3.6"). */
  short: string;
  text: string;
}

export const LEVELS: readonly Level[] = [
  { value: 250, label: '2.5', short: '2.5', text: 'Just starting. Still learning the rules and how to serve.' },
  { value: 275, label: '2.75', short: '2.75', text: 'Can keep a short rally going most of the time.' },
  { value: 300, label: '3.0', short: '3.0', text: 'Can keep a steady rally. Still learning the soft shots at the net.' },
  { value: 320, label: '3.2', short: '3.2', text: 'Comfortable rallies. Soft shots at the net work about half the time.' },
  { value: 340, label: '3.4', short: '3.4', text: 'Mixes soft and hard shots on purpose. Still misses easy ones now and then.' },
  { value: 350, label: '3.5', short: '3.5', text: 'Mostly steady. Handles fast shots. Easy misses are not common.' },
  { value: 360, label: '3.6+', short: '3.6', text: 'Rarely makes a mistake. A level none of us have reached yet.' },
];

/** The note under the level list (mock 05). */

export const isLevel = (v: unknown): v is number => typeof v === 'number' && LEVELS.some((l) => l.value === v);
export const levelOf = (v: number): Level | null => LEVELS.find((l) => l.value === v) ?? null;
/** "3.6+" (the sign-up list), or the plain number for a value that is not on the list. */
export const levelLabel = (v: number): string => levelOf(v)?.label ?? (v / 100).toFixed(2).replace(/0$/, '');
/** "3.6" (the organizer's level list). */
export const levelShort = (v: number): string => levelOf(v)?.short ?? (v / 100).toFixed(2).replace(/0$/, '');

// ---------------------------------------------------------------------------------------------------------------------
// Sizes and court plans (the approved pictures 01, 02 and 03). The plan sets the court time; the ticket is the same for every size.
// ---------------------------------------------------------------------------------------------------------------------

export const SIZES = [6, 8, 10, 12] as const;
export type Size = (typeof SIZES)[number];
export const isSize = (v: unknown): v is Size => typeof v === 'number' && (SIZES as readonly number[]).includes(v);

export const DEFAULT_SIZE: Size = 8;
export const DEFAULT_TICKET_CENTS = 1600;
export const DEFAULT_CREDIT_CENTS = 1400;
/** Americano's 2nd place credit to start ($7, no medal). */
export const DEFAULT_SECOND_CREDIT_CENTS = 700;

/**
 * The format (Alex, before shipping piece 1): Doubles, fixed teams for the night; Americano, a new partner every round and everyone plays for
 * themselves. Everything else is the same for both (sign-up, levels, dates, tickets, price, waitlist).
 */
export type TournamentFormat = 'doubles' | 'americano';
export const FORMATS = ['doubles', 'americano'] as const;
export const DEFAULT_FORMAT: TournamentFormat = 'doubles';
export const formatName = (f: TournamentFormat): string => (f === 'americano' ? 'Americano' : 'Doubles');
/** The small label above the name on both Home cards. */
export const formatKicker = (f: TournamentFormat): string => (f === 'americano' ? 'Americano' : 'Doubles tournament');
/** The progress strip on the player's card: Americano has no Teams step and ends with Winners. */
export const stepsFor = (f: TournamentFormat): string[] => (f === 'americano' ? ['Vote', 'Tickets', 'Games', 'Winners'] : ['Vote', 'Tickets', 'Teams', 'Games', 'Final']);
/** The format can change until tickets open (piece 2 adds that stage); piece 1's two stages are before it. */
export const formatLocked = (status: string): boolean => status !== 'signup' && status !== 'date_picked';
/** The most a ticket or the credit can be set to ($200), so a typo cannot store a silly number. */
export const MAX_PRICE_CENTS = 20_000;
/** Winners per tournament: one team of two (the champion prize card says "2 players"). */
export const WINNERS = 2;
export const NAME_MAX = 32;
export const MAX_DATES = 60;

export interface Plan {
  /** Unique within a size: "2c-120". */
  key: string;
  courts: number;
  minutes: number;
  /** Start, minutes after midnight Eastern (1170 = 7:30 PM). */
  start: number;
  best?: true;
  /** The words after the time range ("Every team plays twice, ..."). */
  note: string;
}

const plan = (courts: number, minutes: number, start: number, note: string, best?: true): Plan => ({ key: `${courts}c-${minutes}`, courts, minutes, start, note, ...(best ? { best } : {}) });

/**
 * The plans per player count, best first. Words from the pictures: the Create screen's own words for 8 players (mock 03), mocks 01 and 02 for
 * the rest (and for the 2 courts, 2.5 hours row, which the tab bar hides in mock 03).
 */
export const PLANS: Record<Size, readonly Plan[]> = {
  6: [
    plan(1, 150, 19 * 60 + 30, 'Every team plays twice, then the top 2 play the final. With 3 teams, someone always plays back to back.', true),
    plan(1, 120, 20 * 60, 'Tighter, no room for a tie.'),
  ],
  8: [
    plan(2, 120, 19 * 60 + 30, 'Everyone plays every round. Room to run over, then awards.', true),
    plan(2, 150, 19 * 60 + 30, 'Same plan with a full buffer. Harder to book.'),
    plan(1, 180, 19 * 60, 'Cheapest, but teams play back to back.'),
  ],
  10: [
    plan(2, 150, 19 * 60 + 30, '5 rounds. One team rests each round, so no back to back. Call the venue to hold 2 courts.', true),
    plan(2, 120, 20 * 60, 'Very tight. No time for a tiebreak.'),
  ],
  12: [
    plan(2, 180, 19 * 60, 'Everyone plays everyone. Call the venue to hold 2 courts.', true),
    plan(2, 120, 20 * 60, 'Two groups of 3. Each group winner plays the final.'),
  ],
};

/** 2.5 and 3 hour plans only count while Booking hours is ON for everyone (SITE_RULES, Zip 24): the same gate the 2.5 and 3 hour prices use. */
export const planAllowed = (p: Pick<Plan, 'minutes'>, longGames: boolean): boolean => p.minutes <= 120 || longGames;

/** The plan a size starts on: the best one that is allowed, else the first allowed one. */
export function defaultPlan(size: Size, longGames: boolean): Plan {
  const list = PLANS[size];
  return list.find((p) => p.best && planAllowed(p, longGames)) ?? list.find((p) => planAllowed(p, longGames)) ?? list[0];
}

export function findPlan(size: Size, courts: number, minutes: number, start: number): Plan | null {
  return PLANS[size].find((p) => p.courts === courts && p.minutes === minutes && p.start === start) ?? null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "7:30" or "8" (no ":00"), and AM or PM. */
function clockParts(mins: number): { text: string; half: 'AM' | 'PM' } {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { text: min ? `${h12}:${pad2(min)}` : String(h12), half: h < 12 ? 'AM' : 'PM' };
}

/** "7:30 to 10 PM", "8 to 10 PM", "7:30 to 9:30 PM" (the pictures' way). */
export function planRange(start: number, minutes: number): string {
  const a = clockParts(start);
  const b = clockParts(start + minutes);
  return a.half === b.half ? `${a.text} to ${b.text} ${b.half}` : `${a.text} ${a.half} to ${b.text} ${b.half}`;
}

/** "7:30 PM", "7:00 PM" (the site's own time format, for the ticket stub and "Games start around"). */
export function startLabel(start: number): string {
  const h = Math.floor(start / 60) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(start % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2 hours", "2.5 hours". */
export const hoursLabel = (minutes: number): string => `${minutes / 60} hours`.replace(/^1 hours$/, '1 hour');

/** "2 courts · 2 hours". */
export const planTitle = (p: Pick<Plan, 'courts' | 'minutes'>): string => `${p.courts} court${p.courts === 1 ? '' : 's'} · ${hoursLabel(p.minutes)}`;

/** "7:30 to 9:30 PM. Everyone plays every round. ..." */
export const planLine = (p: Plan): string => `${planRange(p.start, p.minutes)}. ${p.note}`;

/** The prize in words (mock 24). $0: the medal only. Not shown in piece 1 (Alex took it off the sign-up); kept for piece 3's final. */
export function prizeLine(creditCents: number): string {
  if (creditCents <= 0) return 'Winners each get a medal.';
  const d = creditCents % 100 === 0 ? `$${creditCents / 100}` : `$${(creditCents / 100).toFixed(2)}`;
  return `Winners each get a medal and a ${d} game credit.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Calendar days: 'YYYY-MM-DD', an Eastern calendar day. Worked out on the calendar alone (no clock, no zone).
// ---------------------------------------------------------------------------------------------------------------------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A real calendar day written 'YYYY-MM-DD' (Feb 30 is not). */
export function isDayKey(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DAY_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2100) return false;
  const back = new Date(Date.UTC(y, mo - 1, d));
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d;
}

export const dayKey = (y: number, month: number, d: number): string => `${y}-${pad2(month)}-${pad2(d)}`;

export function dayParts(key: string): { year: number; month: number; day: number; weekday: number } {
  const m = DAY_RE.exec(key);
  if (!m) throw new Error(`not a day: ${key}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { year: y, month: mo, day: d, weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

/** "Dec 15". */
export function dayShort(key: string): string {
  const p = dayParts(key);
  return `${MONTHS[p.month - 1]} ${p.day}`;
}

/** "Thu, Dec 17". */
export function dayLong(key: string): string {
  const p = dayParts(key);
  return `${WEEKDAYS[p.weekday]}, ${MONTHS[p.month - 1]} ${p.day}`;
}

/** The ticket stub: "THU", "17", "DEC". */
export function stubParts(key: string): { weekday: string; day: string; month: string } {
  const p = dayParts(key);
  return { weekday: WEEKDAYS[p.weekday].toUpperCase(), day: String(p.day), month: MONTHS[p.month - 1].toUpperCase() };
}

/** "DEC" or "DEC–JAN": the months a list of days spans (for the stub before the date is picked). */
export function monthSpan(keys: readonly string[]): string {
  if (keys.length === 0) return '';
  const sorted = [...keys].sort();
  const a = MONTHS[dayParts(sorted[0]).month - 1].toUpperCase();
  const b = MONTHS[dayParts(sorted[sorted.length - 1]).month - 1].toUpperCase();
  return a === b ? a : `${a}–${b}`;
}

/** "December 2026". */
export const monthTitle = (year: number, month: number): string => `${MONTHS_LONG[month - 1]} ${year}`;

export interface CalMonth {
  year: number;
  month: number;
  /** Leading blanks (0 = the 1st is a Sunday). */
  lead: number;
  days: string[];
}

/** Whole months from the month of `from` to the month of `to`, inclusive (at most 24). */
export function monthsBetween(from: string, to: string): CalMonth[] {
  const a = dayParts(from);
  const b = dayParts(to);
  const out: CalMonth[] = [];
  let y = a.year;
  let mo = a.month;
  while ((y < b.year || (y === b.year && mo <= b.month)) && out.length < 24) {
    const count = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    out.push({ year: y, month: mo, lead: new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), days: Array.from({ length: count }, (_, i) => dayKey(y, mo, i + 1)) });
    mo++;
    if (mo > 12) {
      mo = 1;
      y++;
    }
  }
  return out;
}

/** The day `n` months after a day's month starts (for "the next 6 months" of the Create calendar): 'YYYY-MM-01'. */
export function monthStartPlus(key: string, n: number): string {
  const p = dayParts(key);
  const total = p.year * 12 + (p.month - 1) + n;
  return dayKey(Math.floor(total / 12), (total % 12) + 1, 1);
}

/** The Create calendar shows this many months, starting with this month. */
export const CREATE_MONTHS = 6;

/** A clean list of days: real days, no repeats, sorted. */
export function cleanDays(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  const out = new Set<string>();
  for (const x of list) {
    if (!isDayKey(x)) return null;
    out.add(x);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// The answers the screens get. Players only get theirs while the tournament is visible to them (never while Only me, unless they are the
// organizer on their own signed-in phone).
// ---------------------------------------------------------------------------------------------------------------------

export type TournamentStatus = 'signup' | 'date_picked';
export type Visibility = 'me' | 'all';

/** What a player's Home gets (GET /api/group `tournament`). Names only: never a level, a phone number or money of anyone else. */
export interface PlayerTournamentView {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  /** Start of the plan, minutes after midnight Eastern ("7:30 PM" on the stub, "Games start around 7:30 PM"). */
  start: number;
  minutes: number;
  /** The dates a player can pick now: every offered date while sign-up is open; only the picked one once the date is picked. */
  openDates: string[];
  finalDate: string | null;
  /** Everyone on the list, in sign-up order (names only), for "See who's signed up" and the count. */
  names: string[];
  /** This player's own sign-up (null: not on the list). Their own pick only, never the organizer's level. */
  me: { level: number; dates: string[] } | null;
  /** Only me is on: this is the organizer's own phone (the "Only you can see this" strip). */
  onlyMe?: true;
}

/** One player on the organizer's level list. */
export interface TournamentSignupView {
  playerId: string;
  name: string;
  pickedLevel: number;
  /** The level that counts: the organizer's when set, else the pick. */
  level: number;
  /** The organizer set (or kept) a level for this player. */
  reviewed: boolean;
  dates: string[];
  at: string;
}

/** What the organizer's screens get (GET /api/admin/dashboard `tournament`), only while the switch is on. */
export interface AdminTournamentView {
  id: string;
  name: string;
  format: TournamentFormat;
  /** Tickets are open (piece 2 on): the format cannot change any more. Always false in piece 1. */
  formatLocked: boolean;
  status: TournamentStatus;
  visibility: Visibility;
  size: number;
  courts: number;
  minutes: number;
  start: number;
  ticketCents: number;
  /** Doubles: each of the 2 winners. Americano: 1st place (plus a medal). */
  championCreditCents: number;
  /** Americano: 2nd place (no medal). Doubles ignores it. */
  secondCreditCents: number;
  offeredDates: string[];
  finalDate: string | null;
  createdAt: string;
  /** On the list now, in sign-up order. */
  signups: TournamentSignupView[];
  /** Backed out (names only), newest first. */
  backedOut: { playerId: string; name: string }[];
}

/** For each offered date, who can make it (from the players on the list). */
export function dateCounts(offered: readonly string[], signups: readonly Pick<TournamentSignupView, 'name' | 'dates'>[]): { day: string; names: string[] }[] {
  return offered.map((day) => ({ day, names: signups.filter((s) => s.dates.includes(day)).map((s) => s.name) }));
}
