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
  { value: 250, label: '2.5', short: '2.5', text: 'Learning the rules and serve. Short rallies.' },
  { value: 275, label: '2.7', short: '2.7', text: 'Keeps short rallies going. Avoids the backhand.' },
  { value: 300, label: '3.0', short: '3.0', text: 'Steady rallies. Still learning to dink.' },
  { value: 320, label: '3.2', short: '3.2', text: 'Dinks work about half the time. Learning drop shots.' },
  { value: 340, label: '3.4', short: '3.4', text: "Steady dinks. Drop shots don't always land. Misses easy ones sometimes." },
  { value: 350, label: '3.5', short: '3.5', text: 'Steady dinks. Drop shots usually land. Smart about speed. Few easy misses.' },
  { value: 360, label: '3.6+', short: '3.6', text: 'Reliable dinks and drop shots. Smart about speed. Almost no easy misses.' },
];

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
/** The format's name, everywhere it shows (Alex: "Locked doubles" and "Americano"). */
export const formatName = (f: TournamentFormat): string => (f === 'americano' ? 'Americano' : 'Locked doubles');
/** Its one rule (the Create choice shows it under the name). */
export const formatRule = (f: TournamentFormat): string => (f === 'americano' ? 'New partner every round' : 'Same partner all night');
/** The one-line subtitle under the name on the cards (Alex, after testing piece 1): "Locked doubles (same partner all night)". */
export const formatLine = (f: TournamentFormat): string => `${formatName(f)} (${formatRule(f).toLowerCase()})`;
/** The progress strip on the player's card: Americano has no Teams step and ends with Winners. */
export const stepsFor = (f: TournamentFormat): string[] => (f === 'americano' ? ['Vote', 'Tickets', 'Games', 'Winners'] : ['Vote', 'Tickets', 'Teams', 'Games', 'Final']);
/** The format can change until tickets open (piece 2 adds that stage); piece 1's two stages are before it. */
export const formatLocked = (status: string): boolean => status !== 'signup' && status !== 'date_picked';
// ---------------------------------------------------------------------------------------------------------------------
// Zip 60: players vote the format. The Create/Edit choice has a third option, "Let players vote" (the default); the vote is decided when the
// organizer picks the date. Stored in two nullable columns (migrations/0025_format_vote.sql): tournaments.format_source and
// tournament_signups.format_vote. While the vote is open `format` holds a placeholder that no screen shows.
// ---------------------------------------------------------------------------------------------------------------------

/** What the Create and Edit screen's format choice can be: the two formats, or "Let players vote". */
export type FormatChoice = TournamentFormat | 'vote';
export const FORMAT_CHOICES = ['vote', 'doubles', 'americano'] as const;
/** New tournaments start on this choice. */
export const DEFAULT_FORMAT_CHOICE: FormatChoice = 'vote';
export const VOTE_LABEL = 'Let players vote';

/** A player's vote, as stored: 'locked' is Locked doubles. Left out (NULL) counts as 'either'. */
export type FormatVote = 'locked' | 'americano' | 'either';
export const FORMAT_VOTES = ['locked', 'americano', 'either'] as const;
export const DEFAULT_FORMAT_VOTE: FormatVote = 'either';
export const isFormatVote = (v: unknown): v is FormatVote => typeof v === 'string' && (FORMAT_VOTES as readonly string[]).includes(v);
/** The sign-up rows: the name and the short line under it (the existing words). */
export const VOTE_ROWS: readonly { vote: FormatVote; name: string; line: string }[] = [
  { vote: 'locked', name: 'Locked doubles', line: 'teams balanced by skill, same partner all night' },
  { vote: 'americano', name: 'Americano', line: 'new partner every round' },
  { vote: 'either', name: 'Either is fine', line: '' },
];

/**
 * How the format was set (tournaments.format_source). 'vote' and 'tie' are the vote at work (see the migration); 'admin' is the organizer
 * changing it by hand after the vote was open; NULL is the organizer choosing it when creating the tournament (no vote, and no date alert).
 */
export type FormatSource = 'vote' | 'tie' | 'admin';
export const sourceOf = (v: string | null | undefined): FormatSource | null => (v === 'vote' || v === 'tie' || v === 'admin' ? v : null);
/** The vote decides this tournament's format (open until the date is picked). */
export const isVoteSource = (v: string | null | undefined): boolean => v === 'vote' || v === 'tie';

export interface VoteCounts {
  locked: number;
  americano: number;
  either: number;
}

/** Count the votes. Anything that is not 'locked' or 'americano' (no vote, an odd value) counts as Either. */
export function tallyVotes(votes: readonly (string | null | undefined)[]): VoteCounts {
  const out: VoteCounts = { locked: 0, americano: 0, either: 0 };
  for (const v of votes) {
    if (v === 'locked') out.locked++;
    else if (v === 'americano') out.americano++;
    else out.either++;
  }
  return out;
}

/**
 * THE RULE (a pure function, so tests can check every case): the majority of the Locked and Americano votes wins; Either counts for neither
 * side. A tie, or nobody picking a side, goes by the tie rule: the first tournament ever (`previous` is null) is Locked doubles, otherwise the
 * OPPOSITE of the format of the most recent earlier tournament that was not canceled.
 */
export function decideFormat(counts: VoteCounts, previous: TournamentFormat | null): { format: TournamentFormat; rule: 'majority' | 'tie' } {
  if (counts.locked > counts.americano) return { format: 'doubles', rule: 'majority' };
  if (counts.americano > counts.locked) return { format: 'americano', rule: 'majority' };
  return { format: previous === null ? 'doubles' : previous === 'doubles' ? 'americano' : 'doubles', rule: 'tie' };
}

/**
 * Zip 60, the Finalize screen: what the plan fits for the players who can make a date, by the same smart plan the cards use (the players rounded
 * UP to an even number, plus 2 of room, at least 6, at most 16). `over`: the players beyond the most spots there are (16 since Zip 63): they
 * would start on standby once tickets open. (Below 16 the plan always has room: the spots grow as people lock in.)
 */
export function planFit(players: number): { fits: number; over: number } {
  const fits = plannedSize(players);
  return { fits, over: Math.max(0, players - Math.max(fits, MAX_SPOTS)) };
}

/** "Americano wins, 6 to 4." or the tie rule in words, naming the last tournament's format when it was used (the Finalize screen). */
export function winnerWords(counts: VoteCounts, d: { format: TournamentFormat; rule: 'majority' | 'tie' }, previous: TournamentFormat | null): string {
  if (d.rule === 'majority') {
    const hi = Math.max(counts.locked, counts.americano);
    const lo = Math.min(counts.locked, counts.americano);
    return `${formatName(d.format)} wins, ${hi} to ${lo}.`;
  }
  const start = counts.locked === 0 && counts.americano === 0 ? 'Nobody picked a side.' : `Tied ${counts.locked} to ${counts.americano}.`;
  return previous === null
    ? `${start} This is the first tournament, so ${formatName(d.format)}.`
    : `${start} The last tournament was ${formatName(previous)}, so ${formatName(d.format)}.`;
}

/** What GET /api/admin/tournament/:id/finalize sends for one date: the Finalize screen's facts (organizer only). */
export interface FinalizeView {
  date: string;
  /** Everyone on the list who picked this date, in sign-up order. */
  players: string[];
  fits: number;
  over: number;
  /** The votes of those same players. Null: the format was chosen by hand (no vote to count). */
  votes: VoteCounts | null;
  /** The vote's winner (a pure function of the votes), its rule, and the last tournament's format when the tie rule used it. Null with no vote. */
  winner: { format: TournamentFormat; rule: 'majority' | 'tie'; previous: TournamentFormat | null; words: string } | null;
  /** The format as it stands now (what the chooser starts on when no vote decides). */
  format: TournamentFormat;
  /** Players hold tickets: the format and the price stay. */
  locked: boolean;
  ticketCents: number;
  /** The usual Pay by for this date (ISO). */
  payBy: string;
}

/** "Locked 3, Americano 6, Either 2" (the organizer's card). */
export const voteCountsLine = (c: VoteCounts): string => `Locked ${c.locked}, Americano ${c.americano}, Either ${c.either}`;

/** The player's alert once the date is locked (Home, the site's alert card): the title and the second line. `source` says whether to claim a vote. */
export function formatAlertWords(name: string, dayKeyOfDate: string, format: TournamentFormat, source: FormatSource): { title: string; sub: string } {
  const s = stubParts(dayKeyOfDate);
  const day = `${s.weekday.charAt(0)}${s.weekday.slice(1).toLowerCase()} ${s.month.charAt(0)}${s.month.slice(1).toLowerCase()} ${s.day}`;
  return {
    title: `${name} is scheduled for ${day}.`,
    sub: source === 'vote' ? `Most players voted ${formatName(format)}.` : `Format: ${formatName(format)}`,
  };
}

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

// ---------------------------------------------------------------------------------------------------------------------
// The smart plan (Alex, after testing piece 1): Create and Edit no longer ask for the players expected or a court plan. The plan follows the
// players locked in, for the organizer only; the site never books anything.
// ---------------------------------------------------------------------------------------------------------------------

/** The most spots there are (Zip 63: a hidden cap of 16; it was 12): players lock in until 16 are in, then standby starts. Players never see the
 *  number; the database triggers (migration 0026) refuse a 17th spot whatever code path writes it. */
export const MAX_SPOTS = 16;
/** Zip 63: the largest court plan (PLANS stops at 12 players). From 13 to 16 locked in the plan stays the 12-player plan (2 courts, 3 hours). */
export const PLAN_MAX: Size = 12;
/** A court for an hour (SITE_RULES: $48 for 2 hours, $60 for 2.5, $72 for 3). */
export const COURT_CENTS_PER_HOUR = 24_00;
/**
 * The tournament night on the picked date, Eastern, for the site's own rules: from the earliest plan start (7:00 PM) to the venue's close (10:00
 * PM). Ticket taps stop at the start; a hold that never got a spot comes back as credit after the end.
 */
export const NIGHT_START_MINUTES = 19 * 60;
export const NIGHT_END_MINUTES = 22 * 60;
/** What Create stores in the size and plan columns, which no screen asks for any more (they are NOT NULL): the cap and the whole night. */
export const STORED_PLAN = { size: PLAN_MAX, courts: 2, minutes: 180, start: NIGHT_START_MINUTES } as const;

/** Planned size: the players locked in rounded UP to an even number, plus 2 spots of room; at least 6, at most the cap (16; 12 before Zip 63). */
export function plannedSize(locked: number): number {
  const even = Math.ceil(Math.max(0, locked) / 2) * 2;
  return Math.min(MAX_SPOTS, Math.max(6, even + 2));
}

export interface SmartPlan {
  /** The planned size, also the spots players see ("6 of 8"), 6 to 16. */
  size: number;
  courts: number;
  minutes: number;
  /** Start, minutes after midnight Eastern (each size's best plan: 7:30 PM, 7:00 PM for 3 hours). */
  start: number;
}

/** The plan for the players locked in: 6 = 1 court 2.5 hours, 8 = 2 courts 2 hours, 10 = 2 courts 2.5 hours, 12 = 2 courts 3 hours. */
export function smartPlan(locked: number): SmartPlan {
  const size = plannedSize(locked);
  // Zip 63: 14 and 16 have no court plan of their own: the courts and hours stay the 12-player plan's.
  const courts = PLANS[Math.min(size, PLAN_MAX) as Size];
  const p = courts.find((x) => x.best) ?? courts[0];
  return { size, courts: p.courts, minutes: p.minutes, start: p.start };
}

/** The court bill for a plan: courts x hours x $24. */
export const courtCentsOf = (p: Pick<SmartPlan, 'courts' | 'minutes'>): number => Math.round((p.courts * p.minutes * COURT_CENTS_PER_HOUR) / 60);

/** The winners' credits: Locked doubles, the champion credit for each of the 2 winners; Americano, 1st place plus 2nd place. */
export const prizeCentsOf = (format: TournamentFormat, championCents: number, secondCents: number): number =>
  format === 'americano' ? championCents + secondCents : WINNERS * championCents;

/**
 * The organizer's cost for the plan: the court bill, minus the tickets, plus the winners' credits (the organizer plays and pays no ticket).
 * `ifFills`: every planned spot but the organizer's paid; `now`: the `paidNow` players who have paid so far.
 */
export function organizerCost(plan: SmartPlan, ticketCents: number, prizeCents: number, paidNow: number): { courtCents: number; ifFillsCents: number; nowCents: number } {
  const court = courtCentsOf(plan);
  return { courtCents: court, ifFillsCents: court - (plan.size - 1) * ticketCents + prizeCents, nowCents: court - paidNow * ticketCents + prizeCents };
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

/**
 * Piece 1's stages, then piece 2's (Zip 56): 'tickets' (tickets open), 'rescheduled' (tickets had opened; the organizer went back to the date
 * step: sign-up is open again, every ticket stays as it is) and 'canceled' (players on the list see a plain Canceled card for a while).
 */
export type TournamentStatus = 'signup' | 'date_picked' | 'tickets' | 'rescheduled' | 'canceled';
export type Visibility = 'me' | 'all';

/** Zip 56: where a ticket stands (shared/tournamentTickets.ts has the rules). */
export type TicketPlaceView = 'spot' | 'line' | 'none';

/**
 * Zip 56, piece 2: the ticket part of a player's card, from the moment tickets open (and while a Reschedule holds tickets). Names only for
 * everyone else, the waitlist too (Alex: Paid / Not paid is on the organizer's screen only). Never anyone's amounts.
 */
export interface PlayerTicketsView {
  /** Spots players see: the planned size (6 to 16, from the players locked in; "6 of 8"). */
  size: number;
  /** Every spot is taken (16 locked in, Zip 63): standby is open. */
  full: boolean;
  /** This player's ticket price: the tournament's flat price, $0 for the organizer (who pays the venue, not the group). */
  priceCents: number;
  /** When ticket money is due (ISO), or null when tickets are not open right now (after a Reschedule). */
  payBy: string | null;
  /**
   * Tickets are closed for this player (Zip 59): the night has started, it is 3 hours before the start, or Pay by has passed and no freed spot
   * is left to claim (a player already on the waitlist, or waiting on an I paid, can still finish).
   */
  closed: boolean;
  /** Zip 59: the tournament night has started (the words under "Tickets closed"). */
  started: boolean;
  /** Zip 59: spots freed by a back out since Pay by that nobody has claimed (only counted after Pay by). */
  freed: number;
  /** Locked in, in the order they took their spots. */
  locked: { name: string; me?: true }[];
  /** The waitlist, in the order they joined it: names only (Alex: nobody's paid status but the player's own, which is in `mine`). */
  line: { name: string; me?: true }[];
  /** This player's own ticket (null: none yet). Their own money only. */
  mine: { place: TicketPlaceView; creditCents: number; paidCents: number; claimCents: number; owedCents: number } | null;
}

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
  /** Zip 63: once a date is picked, how many on the list can make it (the card's pickleballs: one per player who can make that date). A count
   *  only, never who. Left out before a date is picked (then the card draws one ball per sign-up). */
  going?: number;
  /** This player's own sign-up (null: not on the list). Their own pick only, never the organizer's level. `formatVote`: their own format vote
   *  (Zip 60; only while the vote is open, never anyone else's). */
  me: { level: number; dates: string[]; formatVote?: FormatVote } | null;
  /** Zip 60: the vote decides the format and the date is not locked: the card says "Tournament style TBD" and the sign-up asks "Format you'd like". */
  formatTbd?: true;
  /** Zip 60: the date was locked (the vote or the organizer set the format): the alert at the top of Home, dismissed per player. */
  formatAlert?: { key: string; title: string; sub: string };
  /** Off the list after signing up before: the level they picked first, which stays theirs (Alex: a level is picked once). */
  lockedLevel?: number;
  /** Only me is on: this is the organizer's own phone (the "Only you can see this" strip). */
  onlyMe?: true;
  /** Zip 56: tickets (only once tickets have opened; piece 1's two stages send exactly what they did). */
  tickets?: PlayerTicketsView;
  /** Zip 56: the canceled tournament's plain card (only for players who were on the list): what came back to this player. */
  canceled?: { backCents: number; claimCents: number };
}

/** Zip 56: one ticket on the organizer's tournament page and Home cards (the organizer sees everyone's money). */
export interface AdminTicketView {
  playerId: string;
  name: string;
  place: TicketPlaceView;
  placeAt: string | null;
  priceCents: number;
  creditCents: number;
  paidCents: number;
  claimCents: number;
  claimAt: string | null;
  /** No longer on the list (backed out or taken off) while an I paid still waits for the organizer's answer. */
  out: boolean;
  /** The organizer's own seat ($0). */
  organizer: boolean;
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
  /** Zip 60: the vote decides the format and the date is not locked ("Format: players vote"). */
  formatPending?: boolean;
  /** Zip 60: how the format was set (null: chosen when the tournament was created). */
  formatSource?: FormatSource | null;
  /** Zip 60: the votes of the players on the list who can make the picked date (all of them before a date is picked). Organizer only. */
  votes?: VoteCounts;
  status: TournamentStatus;
  visibility: Visibility;
  /** The smart plan for the players locked in now: the planned size (also the spots), courts, minutes and start. */
  size: number;
  courts: number;
  minutes: number;
  start: number;
  /** Zip 56 (Alex): the organizer's cost for that plan. `paidNow`: players who have paid (the organizer's own seat is not one). */
  cost?: { courtCents: number; ifFillsCents: number; nowCents: number; paidNow: number };
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
  /** Zip 56: tickets have been open (Pay by set): the price, the size and the format stay locked, also after a Reschedule. */
  settingsLocked?: boolean;
  /** Zip 56: when ticket money is due (set when the date is picked: the night before at 7:00 PM; the organizer can change it). */
  payBy?: string | null;
  /** Zip 56: the tournament night has started (ticket sales are over). */
  closed?: boolean;
  /** Zip 56: the tournament night is over (10:00 PM on the date): played, so it cannot be canceled or moved any more. */
  over?: boolean;
  /** Zip 56: every ticket, spots first (in the order they were taken), then the waitlist, then the rest. */
  tickets?: AdminTicketView[];
  /** Zip 56: when it was canceled (the Canceled card). */
  canceledAt?: string | null;
}

/** For each offered date, who can make it (from the players on the list). */
export function dateCounts(offered: readonly string[], signups: readonly Pick<TournamentSignupView, 'name' | 'dates'>[]): { day: string; names: string[] }[] {
  return offered.map((day) => ({ day, names: signups.filter((s) => s.dates.includes(day)).map((s) => s.name) }));
}
