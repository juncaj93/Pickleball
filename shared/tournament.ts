// Zip 55 (Nov 2026): TOURNAMENTS ("Tournaments"), ships OFF. A doubles tournament, built in 4 pieces; this is PIECE 1:
//   1. the organizer creates a tournament (Settings > Schedule > Create tournament): name, the dates to offer (Zip 56 dropped the players
//      expected and the court plan: the plan follows the players, 6 to 16), the ticket price and the champion credit (both only STORED in piece 1), and who can see it;
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

import type { NotSignedUpView } from './tournamentNudge';

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
  { value: 340, label: '3.4', short: '3.4', text: "Steady dinks. Drop shots don’t always land. Misses easy ones sometimes." },
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

export const SIZES = [6, 8, 10, 12, 14, 16] as const;
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
  /** Zip 57: the Courts row starts on this (the tournament's courts field: 2 until the organizer picks 1). */
  courts: number;
  /** Zip 64: "Plays" starts on these: the start (minutes after midnight Eastern) and the length in minutes (7:30 PM to 10:00 PM). */
  start: number;
  minutes: number;
}

/** "Locked doubles 3, Americano 6, Either 2" (the organizer's card). */
export const voteCountsLine = (c: VoteCounts): string => `Locked doubles ${c.locked}, Americano ${c.americano}, Either ${c.either}`;

/**
 * Zip 80: "Most players" is true only when the format won more than half of everyone who could vote (the sign-ups who can make the date; an
 * Either or no vote counts for neither side). 2 Locked doubles votes of 10 won the vote, but most players did not vote for it.
 */
export const mostPlayersVoted = (counts: VoteCounts, format: TournamentFormat): boolean =>
  2 * (format === 'doubles' ? counts.locked : counts.americano) > counts.locked + counts.americano + counts.either;

/**
 * The player's alert once the date is locked (Home, the site's alert card): the title and the second line. `source` says whether to claim a vote;
 * Zip 80: `counts` (the votes of those who can make the date) must also show a real majority, else it says the format only. Zip 93: `tomorrow`
 * (the day before the night, Eastern) says "is tomorrow." instead of the date.
 */
export function formatAlertWords(name: string, dayKeyOfDate: string, format: TournamentFormat, source: FormatSource, counts?: VoteCounts, tomorrow = false): { title: string; sub: string } {
  const s = stubParts(dayKeyOfDate);
  const day = `${s.weekday.charAt(0)}${s.weekday.slice(1).toLowerCase()} ${s.month.charAt(0)}${s.month.slice(1).toLowerCase()} ${s.day}`;
  const most = source === 'vote' && (!counts || mostPlayersVoted(counts, format));
  return {
    // Zip 93 (Alex): the day before, "The Cold Open is tomorrow." (same card, same second line).
    title: tomorrow ? `${name} is tomorrow.` : `${name} is scheduled for ${day}.`,
    sub: most ? `Most players voted ${formatName(format)}.` : `Format: ${formatName(format)}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 64 (🎾64.finalize): the tournament style rules. Players see "Tournament style TBD" until tickets close (Pay by). Then the style is decided
// from who is locked in: an EVEN number plays the vote's winner (or the organizer's own pick); an ODD number plays Americano (Locked doubles
// needs teams of two). After that, a back out that makes the count odd switches it to Americano by itself (once; the organizer gets a Telegram
// alert and a card); a late join that makes it even again never switches back by itself: the organizer gets "Switch back to Locked doubles?".
// No new column: tournaments.format holds the style in play, and tournaments.format_source (no CHECK) says why, with two new values that carry
// the moment they were set: 'odd:<ISO time>' (switched to Americano for an odd count; the vote or the pick was Locked doubles) and
// 'back:<ISO time>' (the organizer switched back to Locked doubles). Code from before Zip 64 reads either as "the organizer's own" (sourceOf).
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Zip 92 (Alex): THE STYLE RULE at Pay by, from THE FAIRNESS RULE (shared/tournamentFairness.ts: everyone gets the same number of regular games,
 * give or take 1, at least 3 in Locked doubles, and nobody's night ends early). Every odd count plays Americano (Locked doubles needs teams of
 * two), and so do 12 and 14: their Locked doubles nights are pools with a group of three (2 regular games for those teams, whatever the court
 * time). 8, 10 and 16 keep the style picked. Used where tickets close (the switch, its guards, the money and fit lines before close); nightPlan
 * stays the plain shape a count of teams can play.
 */
export const AMERICANO_EVEN: readonly number[] = [12, 14];
export const playsAmericano = (players: number): boolean => players % 2 === 1 || AMERICANO_EVEN.includes(players);
/** The style was switched to Americano for an odd number locked in. */
export const isOddSource = (v: string | null | undefined): boolean => typeof v === 'string' && v.startsWith('odd:');
/** The organizer switched back to Locked doubles after an odd switch. */
export const isBackSource = (v: string | null | undefined): boolean => typeof v === 'string' && v.startsWith('back:');
/**
 * The style in play once tickets have closed: Americano when an odd number (or 12 or 14, Zip 92) is locked in (whatever was picked); otherwise what
 * is stored (the winner, the organizer's pick, or an earlier switch that the organizer has not switched back).
 */
export function styleAtClose(format: TournamentFormat, lockedIn: number): TournamentFormat {
  return playsAmericano(lockedIn) ? 'americano' : format;
}
/** The players' one short banner when the style changes after tickets close (Alex reviews the words in the preview). */
export function styleBannerWords(source: string | null | undefined): string | null {
  if (isOddSource(source)) return 'Tournament style is now Americano.';
  if (isBackSource(source)) return 'Tournament style is back to Locked doubles.';
  return null;
}
/** The organizer's Telegram alert and card when the style switches to Americano. */
const evenSwitch = (n: number | undefined): n is number => n !== undefined && AMERICANO_EVEN.includes(n);
export const oddSwitchWords = (name: string, lockedIn?: number): string =>
  `${name} switched to Americano (${evenSwitch(lockedIn) ? `${lockedIn} players` : 'odd number of players'}).`;
/** The card's second line under it ("9 locked in. Locked doubles needs an even number." / Zip 92: "12 locked in. 12 players play Americano."). */
export const oddSwitchSub = (lockedIn: number): string =>
  evenSwitch(lockedIn) ? `${lockedIn} locked in. ${lockedIn} players play Americano.` : `${lockedIn} locked in. Locked doubles needs an even number.`;
/** Zip 92: why Locked doubles cannot be picked (or switched back to) for this many locked in, the same words as the odd count's. */
export const doublesRefusal = (lockedIn: number): string =>
  evenSwitch(lockedIn) ? `${lockedIn} players play Americano. ${lockedIn} are locked in.` : `Locked doubles needs an even number. ${lockedIn} are locked in.`;

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
    plan(2, 180, 19 * 60, 'Dink group of 3 and Drive group of 3, then semifinals, the Final and 3rd place. Call the venue to hold 2 courts.', true),
    plan(2, 120, 20 * 60, 'Two pools of 3 with games to 9. Tight.'),
  ],
  // Zip 57 (mocks 52 and 53, the game plan table): 14 and 16 have their own plan, 2 courts for 3 hours from 7:00 PM.
  14: [plan(2, 180, 19 * 60, 'Dink group of 4 and Drive group of 3, then semifinals, the Final and 3rd place. Call the venue to hold 2 courts.', true)],
  16: [plan(2, 180, 19 * 60, 'Two pools of 4 with pool games to 9, then semifinals, the Final and 3rd place. Call the venue to hold 2 courts.', true)],
};

/**
 * Zip 57: the game plan table's STARTING SUGGESTION (the organizer card's "Plan:" line until Finalize sets the real courts and hours): 6 and 7 = 1
 * court 2.5 hours, 8 = 2 courts 2 hours, 9 to 11 = 2 courts 2.5 hours, 12 to 16 = 2 courts 3 hours; 7:30 PM, 7:00 PM for 3 hours. The one place
 * these numbers live (shared/tournamentPlan.ts re-exports it; PLANS' best plans match it, tests/zip57-plan.test.ts checks).
 */
export function suggestedPlan(players: number): { courts: number; minutes: number; start: number } {
  const n = Math.min(MAX_SPOTS, Math.max(6, players));
  const [courts, minutes] = n <= 7 ? [1, 150] : n === 8 ? [2, 120] : n <= 11 ? [2, 150] : [2, 180];
  return { courts, minutes, start: minutes >= 180 ? 19 * 60 : 19 * 60 + 30 };
}

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
/** The size Create stores in the old NOT NULL size column (no screen reads it). Zip 57: 14 and 16 have plans of their own now. */
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

/**
 * Zip 64 part 8: how many players the organizer's plan is sized for. Before tickets open nobody has paid, so the plan follows the players
 * SIGNED UP; once tickets are open, whichever is larger: the players signed up who can make the picked date, or the players locked in. The
 * same count feeds the organizer's card, the Finalize screen's plan line and the "Call the venue" reminder, so all three agree.
 */
export function planCount(o: { signedUp: number; going: number; locked: number; ticketsOpen: boolean }): number {
  return Math.max(o.ticketsOpen ? o.going : o.signedUp, o.locked);
}

/**
 * The plan for a count (the planned size: 6 = 1 court 2.5 hours, 8 = 2 courts 2 hours, 10 = 2 courts 2.5 hours, 12, 14 and 16 = 2 courts 3 hours).
 * Zip 57: from the game plan table's suggestion (suggestedPlan), so 14 and 16 say "2 courts · 3 hours" from the same one source.
 */
export function smartPlan(locked: number): SmartPlan {
  const size = plannedSize(locked);
  return { size, ...suggestedPlan(size) };
}

/** The court bill for a plan: courts x hours x $24. */
export const courtCentsOf = (p: Pick<SmartPlan, 'courts' | 'minutes'>): number => Math.round((p.courts * p.minutes * COURT_CENTS_PER_HOUR) / 60);

/** The winners' credits: Locked doubles, the champion credit for each of the 2 winners (no 2nd place, ever: Zip 83); Americano, 1st place plus 2nd place. */
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

/** Zip 70: "10 PM", "9:30 PM" (the pictures' short clock: no ":00"). */
export function shortClock(mins: number): string {
  const c = clockParts(mins);
  return `${c.text} ${c.half}`;
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
/** Zip 77: 'ended' reaches a player only for an Americano night just revealed (its board, then the final standings, on that night). */
export type TournamentStatus = 'signup' | 'date_picked' | 'tickets' | 'rescheduled' | 'canceled' | 'ended';
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
  /** This player's ticket price: the tournament's flat price, $0 for the organizer (who pays the venue, not the group). Zip 94: the price their
   *  next tap locks in (early before the early deadline; a ticket with money on it keeps its own). */
  priceCents: number;
  /** Zip 94: this tournament's early bird (Early bird pricing on, both set): the regular price, the early price and when it ends (ISO). */
  early?: { regularCents: number; earlyCents: number; until: string };
  /** When ticket money is due (ISO), or null when tickets are not open right now (after a Reschedule). */
  payBy: string | null;
  /**
   * Tickets are closed for this player (Zip 59): the night has started, it is 3 hours before the start, or Pay by has passed and no freed spot
   * is left to claim (a player already on the waitlist, or waiting on an I paid, can still finish).
   */
  closed: boolean;
  /** Zip 59: the tournament night has started (the words under "Tickets closed"). */
  started: boolean;
  /** Zip 70: Drop out is over (3 hours before the start, the moment tickets close): players text the organizer instead. */
  dropClosed?: true;
  /** Zip 70: the late drop rule applies to this player right now (after Pay by, 2 courts, locked in, 8 or fewer locked in): no credit back
   *  unless someone takes the spot. The Drop out sheet says so. */
  dropKeeps?: true;
  /** Zip 59: spots freed by a back out since Pay by that nobody has claimed (only counted after Pay by). */
  freed: number;
  /** Locked in, in the order they paid: every spot, and (Zip 63, the trust rule) every I paid for a spot still waiting for the organizer. */
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
  /** Zip 63: once a date is picked, who on the list can make it, in sign-up order (the card's pickleballs and See who's in: one per player
   *  who can make that date). Names only (their own row says `me`), never anyone's dates or money. Left out before a date is picked (then the
   *  card draws one ball per sign-up). */
  going?: { name: string; me?: true }[];
  /** This player's own sign-up (null: not on the list). Their own pick only, never the organizer's level. `formatVote`: their own format vote
   *  (Zip 60; only while the vote is open, never anyone else's). */
  me: { level: number; dates: string[]; formatVote?: FormatVote } | null;
  /** Zip 60: the vote decides the format and the date is not locked: the card says "Tournament style TBD" and the sign-up asks "Format you'd like". */
  formatTbd?: true;
  /** Zip 64: the organizer finalized the date with a real start and end ("Plays 7:30 PM to 10:00 PM"): `start` and `minutes` are those, and
   *  the stub shows the start with no "~". Left out: `start` is the plan's estimate. */
  startSet?: true;
  /** Zip 64: the date is finalized but tickets have not closed (Pay by): the card still says "Tournament style TBD" (the vote is over, so the
   *  sign-up does not ask "Format you'd like"). */
  styleTbd?: true;
  /** Zip 70 (picture 6): the organizer moved the start or the end: one card at the top of Home for everyone on the list, dismissed per player. */
  timeNote?: { key: string; title: string; sub: string };
  /** Zip 64: the style changed after tickets closed: one short banner on Home, dismissed per player ("Tournament style is now Americano."). */
  styleNote?: { key: string; text: string };
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
  /** Zip 57: Locked doubles teams and game day, once the organizer published the teams (and the style is Locked doubles). Zip 61: the Americano
   *  night (`kind: 'americano'`), once tickets close on Americano, for a player in it. */
  day?: PlayerDayView | PlayerRoundsView;
  /**
   * Zip 77: an Americano night the organizer just revealed (status 'ended', for the players in it, on that night): when the organizer tapped
   * Reveal standings (server clock, ms) and how many rows the board has. Every phone draws the board from these two and the server's clock.
   */
  reveal?: { tapMs: number; players: number };
  /**
   * Zip 79: an ended tournament's final board, for everyone who can see the tournament, from the end (Americano: after the reveal) until midnight
   * Eastern of the day after its date. The card becomes one row (the name and Standings); a tap opens this board in its final state. Names,
   * records and Americano points only: never money or levels. `night`: still the night (Your rounds / Your games show under the row).
   */
  results?: { night: boolean; rows: ResultBoardRow[] };
  /**
   * Zip 79: a player who played a tournament before: the level agreed for them at their LAST tournament (the organizer's level if he changed
   * it, else their own pick). Sign up starts with it picked ("PREVIOUS RATING"); picking higher plays the level up. Only on a sign-up still open
   * to them, and never with `lockedLevel` (that one skips the level step).
   */
  previousLevel?: number;
}

/** Zip 79: one row of the final board (Americano: a player; Locked doubles: a team, with its two players). */
export interface ResultBoardRow {
  rank: number;
  name: string;
  /** Locked doubles: the team's players. */
  players?: string[];
  /** "5-0" (wins-losses). */
  record: string;
  /** Americano only: total points. */
  points?: number;
  /** This phone's player (or their team). */
  me?: true;
  /** The gold medal: Americano 1st, Locked doubles the Final's winners (no other medals). */
  medal?: true;
  /** Left the night: no place. */
  out?: true;
}

/** Zip 74: a game night alert at the top of a player's Home (the site's alert card, dismissed per phone by its key). */
export interface DayAlert {
  key: string;
  title: string;
  sub: string;
}

/**
 * Zip 74 (picture pair-3): the shorter games alert, from the games as stored. The newest shortening is the shortest length below the plan's
 * (lengths only ever go down), and its round is the first round played at that length, so the words never move while the night goes on
 * ("Starting Round 2, all games go to 9 points."). Shown while a shortened game is still to be played; the Final and 3rd place are never
 * shortened (only pool games are), so they are not part of it.
 */
export function shortAlertOf(tournamentId: string, games: readonly { round: number; playTo: number; pool: boolean; decided: boolean }[], planTo: number): DayAlert | undefined {
  const low = games.filter((g) => g.pool && g.playTo < planTo);
  if (!low.some((g) => !g.decided)) return undefined;
  const to = Math.min(...low.map((g) => g.playTo));
  const from = Math.min(...low.filter((g) => g.playTo === to).map((g) => g.round));
  return { key: `short:${tournamentId}:${from}:${to}`, title: `Starting Round ${from}, all games go to ${to} points.`, sub: 'We’re running behind, so games are shorter.' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 57 (🎾57.tourney3): teams and game day (server/tournamentDay.ts). Names only for everyone else; a player sees only their own games (plus
// the games being played now, by team name), the standings and the night's times.
// ---------------------------------------------------------------------------------------------------------------------

export type DayStage = 'pool' | 'semi' | 'final' | 'third' | 'tie';

/** One of this player's games (mocks 16 to 18). */
export interface PlayerDayGame {
  num: number;
  /** "Game 1", "Semifinal", "Final", "3rd place". */
  label: string;
  stage: DayStage;
  round: number;
  /** The venue's court number (or 1 and 2 until the organizer sets them). Null: not known yet (a playoff not decided; Zip 88: a game not on
   *  a court yet, its court is known when it starts). */
  court: number | null;
  /** The other team's name and players, or null while a playoff is not decided ("If you finish in the top 2"). */
  opponent: { name: string; players: string[] } | null;
  /** While the other team is not known: what decides it. */
  pending?: string;
  /** done (a result counts), next (the first one not done), later. */
  state: 'done' | 'next' | 'later';
  /** Their team won it (done games only). */
  won?: boolean;
  /** Zip 72: the score from their side (mine first), done games with a score: "Won 11–7", "Lost 7–11". */
  score?: { mine: number; theirs: number };
  /** Played to this (the Time check can make pool games shorter). */
  playTo: number;
  /** Never played (a team left). */
  skipped?: boolean;
  /** Its round is being played now: Enter score shows on it (Zip 72). */
  onNow?: boolean;
}

/** Zip 58: the two sides of a team, as every screen names them. */
export interface TeamSide {
  name: string;
  players: string[];
}

/**
 * Zip 58: a tie for a playoff place, as a player sees it (pictures 20 and 21). `state`: 'spin' (three teams tied, the wheel not spun yet),
 * 'playoff' (the wheel picked: Game A and Game B decide it), 'pick' (four or more tied, or two that never played: the organizer picks).
 */
export interface PlayerTieView {
  key: string;
  state: 'spin' | 'playoff' | 'pick';
  /** What the tie is for. */
  target: 'final' | 'semi' | 'third';
  /** The tied teams, in seat order (the wheel's slices). */
  teams: TeamSide[];
  /** The team that spins (the best record outside the tie); null: the organizer spins. */
  spinner: TeamSide | null;
  /** This player is on the team that spins: the button works on this phone. */
  canSpin?: true;
  /** The wheel's answer: the team that gets the bye. */
  bye?: TeamSide & { index: number };
  /** When the wheel was spun (a phone that has not shown it yet plays the spin once). */
  spunAt?: string;
}

/** Zip 58: one row of the Playoff card (picture 21): Game A, Game B, then the games the tie feeds. */
export interface PlayoffRow {
  label: string;
  court: number | null;
  title: string;
  sub: string;
  state: 'done' | 'next' | 'later';
}

export interface PlayerDayView {
  /** Zip 88: game day, before the night starts: the "Games start soon" card (the countdown in the last 30 minutes before `startsAt`). */
  startsSoon?: { startsAt: string };
  /** Zip 61: never set on a Locked doubles night (the Americano night says 'americano'). */
  kind?: undefined;
  /** Their own team (null: not on a team, e.g. not locked in). `canRename`: either partner can type a name or roll the dice (until Game 1). */
  team: { name: string; players: string[]; seat: number; canRename?: true } | null;
  /** Every team (All teams), names and players only, in seat order. */
  teams: { name: string; players: string[]; me?: true; out?: true }[];
  /** Two pools (12 players and up). */
  pools: boolean;
  /** Their games in order (pool games, then the playoff games they may reach). */
  games: PlayerDayGame[];
  /** The night has started (results can be given). */
  started: boolean;
  /** The live window (from 30 minutes before the start through the night): the live view replaces the ticket at the top of Home, and the
   *  week's game cards below fold into "Show future games". */
  today: boolean;
  /** "7:30 PM": when game 1 begins. */
  beginsAt: string;
  /** The organizer set the venue's court numbers: a court opens the court map. */
  courtsSet: boolean;
  /** The header: "Game 2 of 3", "Final", "Pool play · Round 1 of 3", "Done". And the bar (0 to 1). */
  progress: { label: string; done: number; total: number };
  /** Games being played now that are not theirs. */
  /** Zip 70: `label` names the game: "Round 2" for a pool game, else "Semifinal", "Final", "3rd place" (or a tie's "Game A"). */
  live: { round: number; label?: string; court: number | null; a: { name: string; players: string[] }; b: { name: string; players: string[] } }[];
  /** Standings: one group, or Pool A and Pool B. Each row: record, theirs, a tie, and (pools) where the team plays this round. Zip 58: `through`,
   *  the team is already in the Final (or the semifinals) while a tie is being settled ("In the final"). Zip 72: `diff`, the point difference
   *  ("+4 pts"), on every row once any pool game has a score (it then takes the place of `where`). */
  standings: {
    pool: 'A' | 'B' | null;
    rows: { rank: number; name: string; players: string[]; record: string; diff?: number; me?: true; tied?: true; out?: true; where?: string; through?: 'final' | 'semi' }[];
  }[];
  /** Zip 58: a tie for a playoff place (the first one still being settled). */
  tie?: PlayerTieView;
  /** Zip 58: the Playoff card while the wheel's games are played (Game A, Game B, then the games they feed). */
  playoff?: PlayoffRow[];
  /** Zip 58: the other game being played at the same time as this player's Final (picture 22: "Also now · Court 2 · 3rd place"). */
  alsoNow?: { label: string; court: number | null; a: TeamSide; b: TeamSide };
  /** The night's times (pools): pool play, semifinals, Final and 3rd place, shifted by the real start and the rounds' lengths. */
  night: { label: string; time: string }[];
  /** The Time check banner (only when shorter games are in force or suggested). */
  timeNote?: string;
  /** Zip 74 (picture pair-3): shorter games are in force: the amber alert at the top of Home ("Starting Round 2, all games go to 9 points."),
   *  dismissed per phone; a second shortening (to 7) has a new key, so a new alert shows. */
  shortAlert?: DayAlert;
  /** Zip 74 (picture pair-5): this player's team is in the Final (both teams known, not played yet): "You're in the Final! It goes to 11
   *  points." / "Head to Court 1.". Only the 4 players in it. */
  finalAlert?: DayAlert;
  /** The organizer paused game day. */
  paused?: true;
  /** Zip 89: Round 1 is being played: one gray line "Warm up 5 to 10 min, then play." */
  warmUp?: true;
  /** Zip 89: a 5 minute break is on (nobody sits): the round after it, when it ends, the server's clock (the countdown). */
  breakNow?: BreakNow;
  /** A partner changed after the teams were published: a one-time note ("Your new partner is Rowan."). */
  partnerNote?: { key: string; text: string };
}

/** Zip 57: one team on the organizer's screens (levels shown to the organizer only). */
export interface AdminDayTeam {
  id: string;
  seat: number;
  name: string;
  players: { id: string | null; name: string; level: number; gone?: true }[];
  total: number;
  pool: 'A' | 'B' | null;
  out: boolean;
}

/** Zip 57: one game on the organizer's screens. */
/** Zip 88 (rolling courts): each court of the night now: the game on it (null: it waits), and the last game it finished (shown Done while it waits). */
export interface CourtNow {
  court: number;
  num: number | null;
  last: number | null;
}

export interface AdminDayGame {
  num: number;
  round: number;
  court: number;
  courtNumber: number | null;
  stage: DayStage;
  pool: 'A' | 'B' | null;
  a: { seat: number; name: string; players: string[] } | null;
  b: { seat: number; name: string; players: string[] } | null;
  /** What decides an empty side ("1st of Pool A", "Tied"). */
  waitA?: string;
  waitB?: string;
  playTo: number;
  /** The result: who won (Zip 71: the first answer counts; nothing waits). */
  winner: 'a' | 'b' | null;
  /** Zip 72: the score (null on a result from before Zip 72, or none yet). */
  scoreA: number | null;
  scoreB: number | null;
  skipped: boolean;
  resultBy: string | null;
  /** The player who entered the result (a player's score). */
  by?: string;
  /** Zip 58: a tie playoff game: 'Game A' or 'Game B'. */
  tieLabel?: string;
  /** Zip 88: on a court (now, or it was: a score that was cleared): it can be scored. Its `court` is then the court it is really on. */
  started?: boolean;
  /** Zip 89: a best of 3 Final: which game of it this is (1, 2 or 3; game 3 shows only at 1-1). */
  finalGame?: number;
}

/** Zip 89 (🎾89.smart pacing): the bonus offer on the organizer's night card (shared/smartPacing.ts). `key` goes back with the tap. */
/** Zip 89: a break on now. */
export interface BreakNow {
  round: number;
  until: string;
  serverNow: string;
}

export interface BonusOffer {
  kind: 'round' | 'semis' | 'bestOf3';
  key: string;
}

/** Zip 58: a tie the organizer sees (the first card on game night until it is settled). */
export interface AdminTieView {
  key: string;
  mode: 'wheel' | 'pick';
  target: 'final' | 'semi' | 'third';
  pool: 'A' | 'B' | null;
  teams: (TeamSide & { seat: number })[];
  /** The team whose players spin (the organizer can always spin too); null: only the organizer. */
  spinner: TeamSide | null;
  /** The wheel's answer. */
  bye?: TeamSide & { seat: number; index: number };
  spunAt?: string;
  /** Picks: how many places are still to pick, and who is picked so far (in order). */
  needPicks: number;
  picked: string[];
  /** The picks as stored (sent back with the next pick, so a change in between is caught). */
  picks: number[];
}

/** Zip 57: the organizer's teams and game day (AdminTournamentView.day). */
export interface AdminDayView {
  /** none: no teams yet; draft: drafted, not published; published. */
  phase: 'none' | 'draft' | 'published';
  /** Draft teams can be tapped now, or why not. */
  canDraft: boolean;
  why?: string;
  /** Players locked in (the draft's pool). */
  lockedIn: number;
  teams: AdminDayTeam[];
  courtNumbers: number[] | null;
  courts: number;
  games: AdminDayGame[];
  /** The plan the games follow (length of pool games, rounds, fits). */
  plan: { gameTo: number; rounds: number; fits: boolean; minutesUsed: number } | null;
  /** The round being played (null: not started, or over). */
  round: number | null;
  /** Some game has a result (the teams then stay; a player leaving is "Player left"). */
  anyResult: boolean;
  started: boolean;
  over: boolean;
  paused: boolean;
  /** Time check: the words and what Apply does. */
  timeCheck?: { text: string; fromRound: number; to: number; key: string } | null;
  /** Shorter games already in force (the players' banner). */
  timeNote?: string;
  /** After publishing: the teams no longer match the players locked in (a back out, a late join). */
  fix?: { gone: string[]; spare: string[]; text: string } | null;
  /** Swap in candidates for "Player left": locked in but on no team, then paid standby. */
  spares: { id: string; name: string; standby: boolean }[];
  /** Zip 58: ties for a playoff place still being settled. */
  ties?: AdminTieView[];
  /** Zip 88: each court now (rolling courts) and who is not on a court now (names), once the games exist. */
  courtsNow?: CourtNow[];
  sittingNow?: string[];
  /** Zip 88: the night card's Standings sheet (organizer): each group's table as players see it (THE TIE RULE), the point difference chip. */
  standings?: { pool: 'A' | 'B' | null; rows: EndStanding[] }[];
  /** Zip 89: "Ahead of time" + Add a round (organizer only; absent when there is no offer). */
  bonus?: BonusOffer;
  /** Zip 89: the Final is best of 3 (its games carry finalGame); the series so far ("1-0"), from the first team's side. */
  bestOf3?: { wins: [number, number]; winner: 'a' | 'b' | null };
  /** Zip 89: Round 1 is being played: one gray line "Warm up 5 to 10 min, then play." */
  warmUp?: true;
  /** Zip 89: a 5 minute break is on (nobody sits): the round after it, when it ends, the server's clock (the countdown). */
  breakNow?: BreakNow;
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 61 (🎾61.americano): the Americano night (server/americanoDay.ts). Every round a new partner; everyone plays for their own points. A player
// sees only their own rounds, the games being played now, and the points table (names only, never a level).
// ---------------------------------------------------------------------------------------------------------------------

/** One of a player's rounds (pictures 31 and 32): a game with a partner and two opponents, or a break. */
export interface PlayerRound {
  round: number;
  /** The game (null: a break). `key` is what the screen sends back with a score, so a schedule that changed in between is caught. */
  num: number | null;
  key?: string;
  /** The venue's court number (or 1 and 2 until the organizer sets them); null on a break, and (Zip 88, rolling courts) on a game not on a
   *  court yet: its court is known only when it starts. */
  court: number | null;
  partner: string | null;
  opponents: [string, string] | null;
  /** done (a score counts, or the break is over), next (the first one not done), later. */
  state: 'done' | 'next' | 'later';
  /** Their side won (done games with a score). */
  won?: boolean;
  /** The score from their side (mine first). */
  score?: { mine: number; theirs: number };
  playTo: number;
  /** Never played (someone left). */
  skipped?: true;
  /** Its round is being played now: Enter score shows on it. */
  onNow?: true;
  /** A break: the others sitting that round (names). */
  alsoOff?: string[];
}

export interface PlayerRoundsView {
  kind: 'americano';
  /** Zip 88: game day, before the night starts: the "Games start soon" card (the countdown in the last 30 minutes before `startsAt`). */
  startsSoon?: { startsAt: string };
  /** This player's own name (the cards say "You + Parker"). */
  me: string;
  rounds: PlayerRound[];
  /** The night has started (scores can be entered). */
  started: boolean;
  /** The live window (from 30 minutes before the start through the night): the live view takes the ticket's place on Home. */
  today: boolean;
  beginsAt: string;
  courtsSet: boolean;
  /** "Round 3 of 6" (or "Done") and the bar. */
  progress: { label: string; done: number; total: number };
  /** Games being played now that are not theirs (every court while they sit). */
  live: { round: number; court: number; a: string[]; b: string[] }[];
  /** The points table: rank, name, wins-losses, points. Zip 77: empty for players until the reveal (the server never sends it before). */
  standings: { rank: number; name: string; record: string; points: number; me?: true; tied?: true; out?: true }[];
  /** Zip 77: the standings are kept for the reveal (players during the night): no Standings card, one line at the bottom instead. */
  standingsHidden?: true;
  /** Zip 77: every game is in and the organizer has not revealed yet: the "Final standings coming soon" card (phones check every 2 s). */
  waiting?: true;
  /** Zip 77: the final standings (after the reveal): no Live chip, no kicker, the bar is a thin divider. */
  final?: true;
  timeNote?: string;
  /** Zip 74: shorter games are in force (as PlayerDayView.shortAlert). */
  shortAlert?: DayAlert;
  paused?: true;
  /** Zip 89: Round 1 is being played: one gray line "Warm up 5 to 10 min, then play." */
  warmUp?: true;
  /** Zip 89: a 5 minute break is on (nobody sits): the round after it, when it ends, the server's clock (the countdown). */
  breakNow?: BreakNow;
  /** Someone left: a plain note for each player whose later game is off ("Zoe left. Your Round 5 game is off."). */
  leftNote?: { key: string; text: string };
}

/** Zip 61: one Americano game on the organizer's screens. */
export interface AdminRoundGame {
  num: number;
  round: number;
  court: number;
  courtNumber: number | null;
  a: { ids: string[]; names: string[] };
  b: { ids: string[]; names: string[] };
  playTo: number;
  scoreA: number | null;
  scoreB: number | null;
  /** done (the score stands: Zip 71, the first score counts), playing, later, skipped. */
  status: 'done' | 'playing' | 'later' | 'skipped';
  /** Who entered the score (or who left, on a skipped game). */
  by?: string;
  /** Late: playing past the round's time. The words say how long ("8 min over"). */
  late?: string;
  /** What the screen showed (sent back with Fix, so a change in between is caught). */
  stamp: string;
}

/** Zip 61: the organizer's Americano night (AdminTournamentView.rounds). */
export interface AdminRoundsView {
  kind: 'americano';
  lockedIn: number;
  /** Every player in the night (Player left picks from it). */
  players: { id: string; name: string; left?: true }[];
  courts: number;
  courtNumbers: number[] | null;
  plan: { gameTo: number; rounds: number; fits: boolean; onCourt: number };
  games: AdminRoundGame[];
  /** Who sits each round. */
  sits: { round: number; names: string[] }[];
  /** The round being played (null: not started, or over). */
  round: number | null;
  started: boolean;
  over: boolean;
  paused: boolean;
  anyResult: boolean;
  timeCheck?: { text: string; fromRound: number; to: number; key: string } | null;
  timeNote?: string;
  /** Every game is in and players are still level on every rule: "Tied" (the names). */
  tied?: string[];
  /** Players have played different numbers of games (a sit-out, someone left): the table ranks by win percentage, then total points. */
  byPercent: boolean;
  /** Zip 82: the standings as they stand (the reveal board's rows, server/americanoDay.ts standingsOf). Organizer only. */
  standings: PlayerRoundsView['standings'];
  /** Zip 89: "Ahead of time" + Add a round (organizer only; absent when there is no offer), and the rounds the plan had (later ones are bonus). */
  bonus?: BonusOffer;
  plannedRounds?: number;
  /** Zip 89: Round 1 is being played: one gray line "Warm up 5 to 10 min, then play." */
  warmUp?: true;
  /** Zip 89: a 5 minute break is on (nobody sits): the round after it, when it ends, the server's clock (the countdown). */
  breakNow?: BreakNow;
  /** Zip 88: each court now (rolling courts) and who is not on a court now (names). */
  courtsNow: CourtNow[];
  sittingNow: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 58 (🎾58.tourney4): End tournament, the awards, the winners banner, medals and the saved results (server/tournamentEnd.ts).
// ---------------------------------------------------------------------------------------------------------------------

/** How long the winners banner stays up, in weeks (Edit awards: 1 to 4; 1 to start). */
export const BANNER_WEEKS = [1, 2, 3, 4] as const;
export const DEFAULT_BANNER_WEEKS = 1;
export const bannerLabel = (weeks: number): string => (weeks === 1 ? '1 week' : `${weeks} weeks`);

/** A winner the End card shows: a team (Locked doubles, `key` its seat) or a player (Americano, `key` the player). */
export interface AwardPick {
  key: string;
  name: string;
  players?: string[];
}

/** Zip 58 (pictures 37, 41 to 43): the organizer's End tournament card, once the Final (or the last round) is in. */
export interface AdminEndView {
  format: TournamentFormat;
  /** The slim bar's words ("Final", "Round 6 of 6"). */
  hero: string;
  /** The big green card: "Final is done" / "Net Ninjas won" / "Vic + Wren beat Kitchen Crew (Rowan + Zoe)." */
  done: { kicker: string; title: string; sub: string };
  /** Locked doubles: the winning team (each gets a medal and the credit). Americano: 1st place (medal and credit). */
  first: AwardPick;
  /** 2nd place (credit, no medal). Americano: a player; Locked doubles (Zip 82): the Final's runner-up team, the credit for each. */
  second: AwardPick | null;
  /** Locked doubles: the 3rd place team (shown only: no medal, no credit, no banner). */
  third: AwardPick | null;
  championCents: number;
  secondCents: number;
  weeks: number;
  /** Who Change can pick: every team (Locked doubles) or every player in table order (Americano). */
  choices: AwardPick[];
  /** The organizer is a winner: a medal, but no credit (the organizer pays the venue and never holds credit). */
  noCredit?: string;
  /** Why it cannot end yet (an I paid still waits for the organizer's answer). */
  blocked?: string;
  /** What the card showed, sent back with Confirm (a change in between is caught). */
  seen: string;
  /**
   * Zip 82 (picture 1): the final standings, only for the organizer until the reveal. Americano: the reveal board's rows (standingsOf);
   * Locked doubles: the teams in End's saved order (shared/results.ts boardRows), with the point difference.
   */
  standings: EndStanding[];
  /** Zip 82: the night's real money for the prize suggestion: tickets in (as Totals counts them) and the courts (final time and courts). */
  money: { ticketsCents: number; courtCents: number };
}

/** Zip 82: one row of the End card's standings. */
export interface EndStanding {
  name: string;
  /** Locked doubles: the team's two players. */
  players?: string[];
  /** "5-0". */
  record: string;
  /** "55 pts" (Americano points) or "+4 pts" (Locked doubles point difference). */
  chip: string;
  /** The gold medal (1st place only). */
  medal?: true;
  /** Left the night. */
  out?: true;
}

/** Zip 58: the slim winners ticker at the top of a player's Home, for the banner length after End tournament (pictures 38 to 40). */
export interface TickerView {
  key: string;
  name: string;
  format: TournamentFormat;
  /** Locked doubles: the team and both winners. */
  champions?: { team: string; players: { name: string; medals: number }[] };
  /** Americano: the winner, then the runner-up. */
  winner?: { name: string; medals: number };
  runnerUp?: { name: string; medals: number };
}

/** Zip 90: what the prize reveal needs (the player's own award, from the row End saved; nothing new is stored). */
export interface CongratsView {
  key: string;
  tournamentId: string;
  title: string;
  sub: string;
  award: 'champion' | 'second';
  format: TournamentFormat;
  /** The tournament's name ("The Cold Open"). */
  tournament: string;
  /** Locked doubles: the partner's name ("Congrats, you and Wren won!"). */
  partner?: string;
  /** The award's credit (paid at End; 0: no credit card). */
  creditCents: number;
  /** 1st place: the gold medal card. */
  medal: boolean;
  /** The medal counts in the medals by name (a tournament everyone could see), so the header holds it back until the slam. */
  medalCounted: boolean;
  /** This player's other unclaimed prizes (their cards come after this one's Nice): held back from the header too. Left out at 0. */
  laterCreditCents?: number;
  laterMedals?: number;
}

/** Zip 58: what a player's Home gets after a tournament ends (GET /api/group `tourAwards`). Left out when there is nothing. */
export interface TourAwardsView {
  ticker?: TickerView;
  /** The one-time congratulations card (a winner, or the Americano runner-up), until Nice. Zip 90: the prize reveal (src/TourAwards.tsx
   *  PrizeReveal): a champion (either style), or a 2nd place (either style) who got credit; `title` and `sub` stay for a page still open
   *  from before the deploy. */
  congrats?: CongratsView;
  /** Gold medals per player name (only players with at least one), for the name at the top and the game cards. */
  medals?: Record<string, number>;
}

/** Zip 58 (picture 46): History > Tournaments. */
export interface TournamentHistoryView {
  tournaments: { id: string; name: string; date: string | null; format: TournamentFormat; players: number; first: { name: string; players?: string[] } | null; second: { name: string } | null }[];
  wins: { name: string; wins: number; played: number; medals: number }[];
}

/** Zip 58 (picture 47): the admin Players sheet's TOURNAMENTS card (read only; levels are never shown to players). */
export interface PlayerTournamentsView {
  played: number;
  won: number;
  runnerUp: number;
  /** Zip 82: the gold medals players see next to the name (a tap opens the wins sheet). */
  medals?: number;
  rows: { name: string; date: string | null; finish: string }[];
}

/** Zip 82 (pictures 5 and 6): a tap on a medal: the name's wins, newest first (GET /api/tournament/wins, /api/admin/tournament-wins). No money. */
export interface WinsView {
  name: string;
  wins: { tournament: string; date: string | null; format: TournamentFormat; partner?: string }[];
}

/** "1st", "2nd", "3rd", "4th". */
export const placeWord = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

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
  /** Zip 66: this player's format vote (organizer only; sent with the vote counts, so the card's Votes row can list names). */
  vote?: FormatVote;
}

/** What the organizer's screens get (GET /api/admin/dashboard `tournament`), only while the switch is on. */
export interface AdminTournamentView {
  id: string;
  name: string;
  /** Zip 88: game day, before the start, teams set (Locked doubles) and the courts' numbers set: the card's pill is "Start now". */
  startNow?: true;
  /** Zip 88: the organizer tapped Start now at this time (the night started then; the planned start and end stay). */
  startedEarly?: string;
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
  /** Zip 56 (Alex): the organizer's cost for that plan. `paidNow`: players who have paid (the organizer's own seat is not one). Zip 70: for the
   *  Plan's expected players (the money line, turned around: a cost is above 0). */
  cost?: { courtCents: number; ifFillsCents: number; nowCents: number; paidNow: number; /** Zip 94: what those tickets really cost (some early). */ paidNowCents?: number };
  /** Zip 94: the price a new lock in pays right now (early before the deadline). Missing: ticketCents. */
  priceNowCents?: number;
  /** Zip 94: the gear sheet's Early price rows (Early bird pricing on, or this phone's private link): the saved early bird and whether anyone
   *  has locked in (then it stays as it is). `cents` null: none set. */
  early?: { cents: number | null; until: string | null; locked: boolean; on: boolean };
  /** Zip 70: the spots players see ("Locked in 6 of 8"), from the players locked in. */
  spots?: number;
  /** Zip 70: the Plan's expected players (the saved Expect number, else the suggestion, never fewer than locked in; 6 to 16). */
  expected?: number;
  /** Zip 70: the site's own suggestion (the real count), what Expect shows until a number is saved. */
  suggested?: number;
  /** Zip 70: the organizer saved an Expect number (and the courts). */
  expectSaved?: boolean;
  /** Zip 70: THE money line for the expected players, the courts and the hours. */
  money?: import('./tournamentMoney').MoneyLine;
  /** Zip 70: the start and end can still move (finalized, tickets open, before the teams are published and the night window opens). */
  timeOpen?: boolean;
  /** Zip 70: the Plan box can still be saved (the same moment). */
  planOpen?: boolean;
  ticketCents: number;
  /** Doubles: each of the 2 winners. Americano: 1st place (plus a medal). */
  championCreditCents: number;
  /** Americano: 2nd place (no medal). Doubles ignores it. */
  secondCreditCents: number;
  /** Zip 87: both styles' prize boxes (shared/tournamentPrizes.ts): the night pays the box of the style played. */
  prizes?: import('./tournamentPrizes').StylePrizes;
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
  /** Zip 64: the date is finalized: `start` and `minutes` are the real times ("Plays"), not the plan's estimate. */
  startSet?: boolean;
  /** Zip 64: tickets have closed (Pay by passed): the style is decided from who is locked in. */
  styleDecided?: boolean;
  /** Zip 64: players locked in (every spot, and every I paid for one waiting for the organizer: what players see as locked in). */
  lockedIn?: number;
  /** Zip 64: the style was switched to Americano for an odd count (the card "switched to Americano"); `key` changes with each switch. */
  oddSwitch?: { key: string } | null;
  /** Zip 64: the count is even again after an odd switch: "Switch back to Locked doubles?" (the organizer's Switch or Not now). */
  switchBack?: { key: string } | null;
  /** Zip 66: the "Not signed up" row (shared/tournamentNudge.ts). Left out when it does not apply (tickets closed, canceled). */
  notSignedUp?: NotSignedUpView;
  /** Zip 57: the courts and hours the organizer chose on Finalize (the plan line and the venue card use them once the date is finalized). */
  chosenCourts?: number;
  /** Zip 57: the check when tickets close, with the players actually locked in (amber): too tight, a court no longer needed, under 6. */
  closeCheck?: { kind: 'tight' | 'extra_court' | 'few'; text: string } | null;
  /** Zip 57: teams and game day (Locked doubles). */
  day?: AdminDayView;
  /** Zip 61: the Americano night (once tickets close on Americano). */
  rounds?: AdminRoundsView;
  /** Zip 58: End tournament (once the Final, or the last round, is in). */
  end?: AdminEndView;
}

/**
 * Zip 64 (mock 03): the organizer's heat map. Each offered date's tile is shaded by how many can play: the brightest green for the most, the
 * palest for the fewest, in even steps between (a straight line in sRGB between the two ends, measured from the mock). One text color across
 * each ramp (dark ink on the light ramp, white on the dark one). All the same count: every tile is the brightest (nothing to compare).
 */
export const HEAT_RAMP = {
  light: { bg: ['#d3f1e1', '#3fd68a'], edge: ['#bae1cc', '#2fbf79'], ink: '#10231a' },
  dark: { bg: ['#153322', '#1f8a53'], edge: ['#285539', '#3fb87a'], ink: '#ffffff' },
} as const;
function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}
/** Where a count sits on the ramp, 0 (palest) to 1 (brightest). */
export function heatStep(n: number, min: number, max: number): number {
  if (max <= min) return max > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, (n - min) / (max - min)));
}
export function heatColors(n: number, min: number, max: number): { light: { bg: string; edge: string }; dark: { bg: string; edge: string } } {
  const t = heatStep(n, min, max);
  const side = (r: (typeof HEAT_RAMP)['light' | 'dark']) => ({ bg: mixHex(r.bg[0], r.bg[1], t), edge: mixHex(r.edge[0], r.edge[1], t) });
  return { light: side(HEAT_RAMP.light), dark: side(HEAT_RAMP.dark) };
}

/** For each offered date, who can make it (from the players on the list). */
export function dateCounts(offered: readonly string[], signups: readonly Pick<TournamentSignupView, 'name' | 'dates'>[]): { day: string; names: string[] }[] {
  return offered.map((day) => ({ day, names: signups.filter((s) => s.dates.includes(day)).map((s) => s.name) }));
}

/** Zip 85: one ticket a player owes after the organizer said Didn't pay on the night (shared/tournamentTickets.ts OWED_MARK): their You owe card. */
export interface OwedTicketView {
  tournamentId: string;
  name: string;
  /** The night's date (YYYY-MM-DD). */
  date: string | null;
  cents: number;
}

/** Zip 85: the organizer's view of one ticket owed after a Didn't pay on the night (`waiting`: the player tapped I paid on it since). */
export interface AdminOwedTicket {
  tournamentId: string;
  name: string;
  date: string | null;
  playerId: string;
  playerName: string;
  cents: number;
  waiting: boolean;
}
