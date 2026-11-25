import type { Ctx } from './context';
import { HttpError } from './http';
import { newId } from './crypto';
import { OWED_MARK, startMsOf } from '../shared/tournamentTickets';
import { requireAdmin } from './auth';
import * as v from './validate';
import { hiddenTask, lockDate, setTournamentsForAll, type SignupRow, todayKey, type TournamentRow } from './tournament';
import { adminDayView, gamesFor, type GameRow, loadDay, playerDayView, spinTie, type TeamRow, writeBestOf3, writeSemis, writeTeamsAndGames } from './tournamentDay';
import { americanoNight, pairSlot } from '../shared/americanoSchedule';
import { previewSiteFor } from './secondChance';
import { type GroupRow, organizerIdOf } from './repo';
import { dayKey, dayParts, FORMATS, monthsBetween, monthStartPlus, NIGHT_START_MINUTES, STORED_PLAN } from '../shared/tournament';
import { localParts, zonedTimeToUtc } from '../shared/time';
import { defaultPayBy, tourReason } from '../shared/tournamentTickets';
import { ticketBackStatements, tournamentCanceled } from './tournamentMoney';
import { endPlan, type EndRow, readNight, writeEnd } from './tournamentEnd';
import { withPrizes } from '../shared/tournamentPrizes';

// Zip 55, PREVIEW ONLY: the "Tournament test" page's server half. POST /api/admin/tournament-test { stage } puts the fake tournament back to a
// stage, using only the preview's fixed fake names (docs/PREVIEW_FAKE_DB.md), and turns the Tournaments row on (a re-seed from another branch
// drops it). It answers Not found anywhere PREVIEW_CALM is not "on" (that var exists only in [env.preview.vars]; the live site has none, the
// same check the preview-only ?as=Name link uses), so on live this route does nothing at all. No new Cloudflare variable.
//   none         no tournament (to try Create from Settings > Schedule)
//   signup       "Winter Classic", Everyone, sign-up open, 6 on the list (Vic, Zoe, Reese and Alex are not)
//   date_picked  the same with 8 on the list, Sage's level set to 3.4, and the date most of them can make picked. Since Alex's changes, picking
//                the date opens tickets ($16, Pay by the night before at 7:00 PM): nobody has paid yet (Alex is not on the list, so no $0 seat)
// Zip 56 (piece 2), each from the date picked above, tickets open. The spots follow the players locked in (the smart plan: 6 to 12), so with
// the preview's 10 names the 16 spots (the cap since Zip 63) never fill: no stage can show standby (it starts after 16; no new names are allowed).
//   tickets_open   6 locked in (Parker, Rowan, Sage, Christopher, Wren, Quinn: Venmo confirmed, Sage with credit), "6 of 8"; Vic, Zoe and
//                  Reese on the list with no ticket: Vic sees Lock my spot ($16), the pictures' 07 to 10
//   all_locked     all 10 names locked in (Alex's own $0 seat and 9 paid), "10 of 12"; Vic sees You're in
//   odd            7 locked in and Pay by already passed: the organizer's card says "7 locked in. Need 1 more or 1 less."
//   canceled       tickets_open, then Cancel tournament (the real statements): every paid ticket is credit now; players on the list see Canceled
//   rescheduled    tickets_open, then Reschedule (the real statements): back to the date step, tickets held, "Rescheduled. Pick your dates again"
// Every ticket's money is real on the fake database (a confirmed Venmo payment, or credit the stage first gives as a "Ticket stage credit"
// adjustment), so the books read all zeros (scripts/integrity-checks-tournament.sql) at every stage. A new stage first takes out the last one's
// ticket credit rows and test credit (the fake database only).
// The page's own words and buttons live in src/pages/admin/TournamentTest.tsx, which only a preview build carries.

// Zip 59 (🎾59.polish), the stages for the polish piece:
//   closed         6 paid and Pay by passed an hour ago: new tickets and the waitlist are closed ("Tickets closed. Pay by was ...")
//   hidden         canceled, then Hidden: out of Home; Settings > Advanced > Hidden tournaments lists it with Restore
//   (canceled)     the Canceled card has Hide on the organizer's Home
//   (signup)       sign-up open: view as Vic, Sign up: the ticket punch
// Zip 60 (🎾60.formatvote): the players vote the format. The tournament is "The Cold Open", created on "Let players vote".
//   vote_open      sign-up open, the vote open: 3 on the list (Parker votes Locked doubles, Rowan Americano, Sage Either). View as Vic, Sign up, see
//                  "Format you'd like"; the card says "Tournament style TBD" and "~7:30 PM"
//   vote_majority  the date locked by the organizer's real Pick date: Americano wins 3 to 1 (Christopher Either; Zip 80: 3 of 5 is a real majority), the alert shows for Vic
//   vote_finalize  the Finalize screen (pass 2): all 10 names on the list and able to make the date, a 6 to 4 vote (Americano 6, Locked doubles 4,
//                  no Either); NOT locked. As Alex, tap the date on the tournament page: the Finalize screen opens. (The "over" line needs more than 12
//                  players, and the preview has 10 names, so it does not show here.)
//   vote_tie       the same with Locked 1, Americano 1, Either 2: a tie, the first tournament goes to Locked doubles, the alert says just the format
// Zip 63 (🎾63.tickets): the pay countdown. Each is Tickets open (6 paid; Vic, Zoe and Reese with no ticket) with Pay by set from now, and the
// tournament the day after Pay by (the usual: Pay by the night before). View as Vic: the alert at the top of Home.
//   pay_3d, pay_2d  Pay by 7:00 PM three or two days from today: amber "3 days left to pay" / "2 days left to pay"
//   pay_1d          Pay by 7:00 PM tomorrow: amber "Payment due tomorrow"
//   pay_today       Pay by tonight, at least 6.5 hours from now (7:00 PM when that is far enough): red "Payment due today"
//   pay_hours       Pay by 5 hours 20 minutes from now: red "Due in 5 hours"
//   pay_minutes     Pay by 42 minutes from now: red "Due in 42 minutes" (it counts down while the page is open)
//   pay_late        Pay by an hour ago, and Wren backed out after it (a freed spot, the existing late rule): red "Your payment is late"
//   pay_closed      Pay by an hour ago, no spot freed: tickets closed for Vic, so no countdown (the card says Tickets closed)
export const COUNTDOWN_STAGES = ['pay_3d', 'pay_2d', 'pay_1d', 'pay_today', 'pay_hours', 'pay_minutes', 'pay_late', 'pay_closed'] as const;
// Zip 64 (🎾64.finalize): the style rules and late paying. Each is Tickets open with Pay by an hour ago (tickets closed for the style), the vote's
// winner Locked doubles, Plays 7:30 to 10:00 PM.
//   style_even     all 10 names locked in: Locked doubles stays (an even number)
//   style_odd      9 locked in (Vic on the list, not paid): the first screen that reads it switches to Americano (History, the organizer's card
//                  "switched to Americano", a Telegram alert where alerts are connected); players see "Tournament style is now Americano."
//   style_back     switched to Americano for 9, then Vic paid late: 10 locked in, the organizer's "Switch back to Locked doubles?" (Switch, Not now)
//   late_open      6 locked in, Pay by an hour ago, spots open: Vic, Zoe and Reese can still pay (red "Your payment is late", Pay now works)
//   late_cut       the same tournament TODAY, starting in 2 hours: inside the last 3 hours, tickets are closed for Vic ("Tickets are closed.")
//   zip64_start    the preview's calm start: The Cold Open, the vote open, 8 on the list (everyone but Vic and Reese), all able to make the third
//                  Thursday of next month (part 8: the organizer's plan is for 10: 2 courts, 2.5 hours). Vic sees the short ticket before signing up (mock 00); Parker signed up (mock 01); Alex can Finalize.
export const STYLE_STAGES = ['style_even', 'style_odd', 'style_back', 'late_open', 'late_cut', 'zip64_start'] as const;
// Zip 66 (🎾66.admincard): the organizer's card and the in-or-out alert.
//   zip66_start    the preview's calm start: The Cold Open, the vote open, 8 on the list (everyone but Vic and Reese; the same as zip64_start).
//                  Organizer Home: the card is one closed line; open it, tap Votes (who voted what), tap Not signed up (the players who played
//                  lately and are not on the list: Vic and Reese on the preview), Copy reminder text.
//   missed_date    the same list, but Sage did NOT pick the date most can make, and the organizer finalized it (tickets open, nobody paid). View as
//                  Sage: "The Cold Open is <day>" / "Can you make it?" with I'm in · $16 and Can't make it, and no pay countdown. Organizer Home:
//                  Not signed up lists Sage.
export const ZIP66_STAGES = ['zip66_start', 'missed_date'] as const;
// Zip 57 (🎾57.tourney3): teams and game day. "The Cold Open", Locked doubles, 8 locked in (the brief's four teams: Net Ninjas Vic and Wren,
// Dill With It Sage and Christopher, Kitchen Crew Rowan and Zoe, Third Shot Gang Parker and Quinn), Pay by passed, courts 1 and 2.
//   day_ready        TODAY, the night started 10 minutes ago, no teams yet: Home says "8 locked in. Draft the teams." (the calm start)
//   teams_drafted    the same with the four teams drafted (mock 15), not published: Publish teams or Redo the draw
//   teams_published  published, the night two days from now: Vic sees Your team, Your games, All teams (mock 16)
//   game1            published, the night started a minute ago, no results: Vic sees Game 1 with Enter score (mock 17; Zip 72)
//   mid              started 45 minutes ago (7:30 to 9:30 PM): Vic entered Net Ninjas 11 to 7 in Game 1 (zip 71: it is in at once), Kitchen Crew
//                    vs Dill With It still playing, the night behind: the Time check on Home (mocks 18, 19, 48)
//   pools_done       every round robin game in (with scores): standings final, the Final and the 3rd place game set
//   backed_out       published before the night, then Zoe backed out after Pay by: 7 locked in, the style switched to Americano (the amber card
//                    with Copy text for the group); players see "Tournament style is now Americano." and no teams
// The 12 players pools look (mock 51) cannot be made with the 10 names: GET /api/tournament/pools-look draws it (look only, a preview link).
// Zip 71 (🎾71.teams), partner taps:
//   zip71_taps       Zip 71 (no confirming): game1's night, started 20 minutes ago, no answers yet. View as Vic: Enter score (5 second Undo);
//                    then view as Wren or Parker: Game 1 is in, no buttons, nothing to confirm. Organizer Home: Done with Fix.
// Zip 72 (🎾72.scores), scores in Locked doubles and one tie rule:
//   zip72_scores     THE CALM START. The same night as zip71_taps (Game 1 on both courts, no scores yet). View as Vic: Enter score, the Final
//                    score sheet with the two team names, Submit score ("✓ Let's go!", Undo). View as Parker: Game 1 "Lost 7–11", Standings
//                    "−4 pts". Organizer Home: Fix on any game (Fix Game 1 · Court 1, two numbers, Save).
//   zip72_circle     every round robin game in: Kitchen Crew 3-0, then Net Ninjas, Third Shot Gang and Dill With It 1-2 each in a circle, settled
//                    by point difference (0, −2, −9 pts): no wheel; the Final (Kitchen Crew vs Net Ninjas) and 3rd place are set.
// Zip 74 (🎾74.polish):
//   zip74_short      THE CALM START. mid's night (Game 1 in, Net Ninjas won 11 to 7), and Alex applied the Time check: from Round 2 on, play
//                    to 9 (the real apply's rows). View as Vic: the amber "Starting Round 2, all games go to 9 points." at the top (X hides
//                    it), "Play to 9 points" on the Up next card, "Play to 9" beside Games 2 and 3. The Final stays to 11. The other Zip 74
//                    screens are existing stages: final_on (Vic: "You're in the Final!"), teams_published (Your team: Edit name), zip70_start
//                    and zip70_late (Parker: Drop out, "Back out of The Cold Open?" before and after Pay by).
export const ZIP74_STAGES = ['zip74_short'] as const;
// Zip 77 (🎾77.reveal): the Americano standings reveal, on Zip 61's night (10 names, Vic sits Round 4).
//   zip77_last       Rounds 1 to 5 in, Round 6 on (THE CALM START): View as Vic: no Standings card, the line at the bottom; Home: the scores.
//   zip77_allin      every round in (Vic first): View as Vic: no kicker, the thin divider, "Final standings coming soon" with the bouncing
//                    balls (Home checks every 2 seconds). Home: Edit awards and Reveal standings.
//   zip77_running    zip77_allin, then Reveal standings by the real code, timed 6 seconds after the stage tap: View as Vic right away: the
//                    waiting card, then the countdown and the board in step with every other phone.
//   zip77_revealed   the same, revealed 10 minutes ago (the board is done): View as Vic: the final board once (X closes it), then the night's
//                    final standings, the ticker, You won The Cold Open and the medal.
export const ZIP77_STAGES = ['zip77_last', 'zip77_allin', 'zip77_running', 'zip77_revealed'] as const;
// Zip 79 (🎾79.results skills): the results row and the skills history.
//   zip79_night        Americano, tonight, revealed 30 minutes ago (THE CALM START): View as Vic: the final board once (X closes it), then the
//                      one row (The Cold Open, Standings) with Your rounds under it. Tap Standings: the final board; X closes it.
//   zip79_night_ld     Locked doubles, tonight, ended by the real Confirm: View as Vic: the one row with Your games under it; Standings lists the
//                      teams, Net Ninjas first with the gold medal.
//   zip79_next_day     the Americano night moved to yesterday: the row alone at the top of Home, above THIS WEEK (until midnight tonight).
//   zip79_next_day_ld  the same, Locked doubles.
//   zip79_gone         the Americano night two days ago: no row (the ticker keeps its own week).
//   zip79_skills       five finished tournaments over eight months, no tournament open: History > Skills (Sage 2.7 to 3.4, Quinn 2.5 to 3.0,
//                      Wren 3.0 to 3.2, Zoe 3.0 down to 2.7, Christopher missed one, Parker and Rowan steady; Vic picked 3.2 last time and
//                      Alex set 3.0).
//   zip79_prev         zip79_skills, plus Winter Classic with sign-up open (Vic not on the list): View as Vic, Sign up: 3.0 picked, "PREVIOUS
//                      RATING"; pick 3.4 and Next: the level up.
export const ZIP79_STAGES = ['zip79_night', 'zip79_night_ld', 'zip79_next_day', 'zip79_next_day_ld', 'zip79_gone', 'zip79_skills', 'zip79_prev'] as const;
type Zip79Stage = (typeof ZIP79_STAGES)[number];
const isZip79Stage = (s: string): s is Zip79Stage => (ZIP79_STAGES as readonly string[]).includes(s);
type Zip77Stage = (typeof ZIP77_STAGES)[number];
const isZip77Stage = (s: string): s is Zip77Stage => (ZIP77_STAGES as readonly string[]).includes(s);
export const DAY_STAGES = ['day_ready', 'teams_drafted', 'teams_published', 'game1', 'mid', 'pools_done', 'backed_out', 'zip71_taps', 'zip72_scores', 'zip72_circle'] as const;
type DayStage = (typeof DAY_STAGES)[number];
const isDayStage = (s: string): s is DayStage => (DAY_STAGES as readonly string[]).includes(s);
// Zip 61 (🎾61.americano): the Americano night. "The Cold Open", Americano, all 10 names locked in (Alex's own $0 seat), Pay by passed, courts 1
// and 2, 7:30 to 10:00 PM worth of court time (2.5 hours: 6 rounds to 11, 2 sit each round). The seats are drawn so Vic plays Rounds 1 to 3, sits
// Round 4 and plays 5 and 6 (as the pictures do); who plays with whom comes from the real schedule, never typed in.
//   am_before     two days from now: Vic sees the ticket, then Your rounds (picture 31)
//   am_round1     tonight, started a minute ago, nothing entered: Round 1 with Enter score
//   am_round3     rounds 1 and 2 in (zip 71: every score is in the moment it is entered); Round 3 is
//                 on, both courts (Enter score, picture 32). Alex's taps:
//                 view as Vic, Enter score, Submit (the motion and Undo); then view as one of Vic's opponents: the score is in
//   am_break      rounds 1 to 3 in, Round 4 on: Vic is on a break (picture 35)
//   am_standings  rounds 1 to 5 in, Round 6 on: the table after Round 5
//   am_switched   Locked doubles with 9 locked in (Reese did not pay) after Pay by, two days from now: the first screen that reads it switches to
//                 Americano (zip 64): players see "Tournament style is now Americano." and their new rounds
//   am_done       every round in (Vic wins every game he plays): the organizer's End tournament card (picture 37)
//   zip71_am      Zip 71 (no confirming): tonight, Round 1 started 20 minutes ago, no scores yet. View as Vic: Enter score; then view as any of
//                 the other three: the score is in, no Enter score, nothing to answer.
export const AM_STAGES = ['am_round3', 'am_before', 'am_round1', 'am_break', 'am_standings', 'am_switched', 'am_done', 'zip71_am'] as const;
// Zip 58 (🎾58.tourney4): ties, the Final, End tournament and the records. "The Cold Open", Locked doubles, the brief's four teams (zip 57's
// stage: Net Ninjas Vic and Wren, Third Shot Gang Parker and Quinn, Kitchen Crew Rowan and Zoe, Dill With It Sage and Christopher), tonight,
// started 100 minutes ago, courts 1 and 2. Every pool game in, as a player's first score writes it (Zip 72: with scores).
//   tie3        Kitchen Crew 3-0; Net Ninjas, Third Shot Gang and Dill With It each beat one of the others (1-2), every game 11 to 7, so point
//               difference and points scored are level too: tied for the final, the wheel's last resort (picture 20). Kitchen Crew spins (view
//               as Rowan or Zoe), or the organizer does on Home. Then Game A and Game B (picture 21).
//   final_on    Net Ninjas 3-0, Third Shot Gang 2-1, Kitchen Crew 1-2, Dill With It 0-3: the Final (Net Ninjas vs Third Shot Gang) and 3rd place
//               (Kitchen Crew vs Dill With It) on now (picture 22). View as Vic: Enter score: it is in at once (zip 71), Home shows End tournament.
//   final_done  the same with both games in (Net Ninjas won the Final, Dill With It 3rd place): Home shows End tournament (picture 43).
//   ended       final_done, then Confirm winners and end, the real code: the ticker, medals and credit (Vic and Wren get $14 each; pictures 38, 40).
//   history     ended, plus two older finished Americano nights (Summer Slam: Vic 1st, Parker 2nd; Spring Fling: Parker 1st, Vic 2nd): History >
//               Tournaments, the Players sheet's TOURNAMENTS card (pictures 46, 47), Vic with two medals.
//   zip82_tie   Zip 82: tie3, then the wheel spun by the real code (the organizer's spin): the tie's Game A is on, Game B up next. All games
//               shows them as "Game A · Court 1" cards.
export const ZIP58_STAGES = ['tie3', 'final_on', 'final_done', 'ended', 'history', 'zip82_tie'] as const;
type Zip58Stage = (typeof ZIP58_STAGES)[number];
const isZip58Stage = (s: string): s is Zip58Stage => (ZIP58_STAGES as readonly string[]).includes(s);
type AmStage = (typeof AM_STAGES)[number];
const isAmStage = (s: string): s is AmStage => (AM_STAGES as readonly string[]).includes(s);
// Zip 70 (🎾70.time): The Cold Open as it is on live (Locked doubles, $18, credits $0, 2 courts, 7:30 to 10:00 PM, a Tuesday at least a week
// out, Pay by the night before at 7:00 PM). 9 on the list: Alex, Parker, Rowan, Sage, Christopher, Wren, Vic and Zoe can make the date, Reese
// cannot (Not signed up 1). Alex's $0 seat and 5 paid: 6 locked in of 8; Vic and Zoe have not paid (2 unpaid).
//   zip70_start   the calm start (pictures 1, 2, 7): Time 7:30 to 10 PM, Plan 8 players, "You make if it fills +$6". Tap Time or Plan.
//   zip70_loss    the same, 7:00 to 10:00 PM (3 hours): "Your cost if it fills $18" in red (picture 3)
//   zip70_moved   the same, after Alex moved the end to 9:30 PM (the very rows the Time box writes): Vic sees "The Cold Open now ends at 9:30 PM
//                 (was 10 PM)." (picture 6) and "7:30 PM / to 9:30 PM" on the ticket
//   zip70_late    Pay by an hour ago, 8 locked in (Quinn on the list too, Vic paid late, Zoe not): view as Parker, Drop out: the two lines of the late drop rule
//   zip70_finalize sign-up open, 9 on the list who can make one date (Quinn too; Reese cannot): Alex taps it: Finalize says "Americano for 9" (picture 4)
export const ZIP70_STAGES = ['zip70_start', 'zip70_loss', 'zip70_moved', 'zip70_late', 'zip70_finalize'] as const;
type Zip70Stage = (typeof ZIP70_STAGES)[number];
const isZip70Stage = (s: string): s is Zip70Stage => (ZIP70_STAGES as readonly string[]).includes(s);
/**
 * Zip 81 (🎾81.venue hours), the preview's two venue hours stages (no tournament; every stage clears the tournament first):
 *   venue_winter  the hours from the venue's flyers (Winter hours Nov 23 2026 to Jan 31 2027, Thanksgiving, Christmas Eve, Christmas Closed,
 *                 New Year's Eve, New Year's Day) and a plain game on Thu Nov 26, 8 to 10 PM, on Home: the amber card "Thu Nov 26: the venue
 *                 closes at noon."
 *   venue_none    the normal hours only (no special entries, the normal week back to the built-in one).
 */
export const VENUE_STAGES = ['venue_winter', 'venue_none'] as const;
type VenueStage = (typeof VENUE_STAGES)[number];
const isVenueStage = (s: string): s is VenueStage => (VENUE_STAGES as readonly string[]).includes(s);
/**
 * Zip 83 (🎾83.champions): "Champions: none": The Cold Open as on live (zip70_start: tickets open, nobody has won anything yet): no medal
 * anywhere, so no cup on any header. "History with tournaments" (history) is the other side: three past winners on the Champions wall.
 */
export const ZIP83_STAGES = ['zip83_none'] as const;
/**
 * Zip 85 (🎾85.final fixes): "Americano: idle phone at the reveal" (zip85_idle): the night's last round playing (am_standings): leave a phone
 * on Home untouched for 10 minutes or more, enter the last scores, then Reveal standings: the board lands on time, then the cup and the ticker.
 * "Didn't pay after the night" (zip85_owed): every round in (am_done) and Parker's ticket as Alex's Didn't pay after the start leaves it
 * (shared/tournamentTickets.ts OWED_MARK): Parker still in the night, owing $16: View as Parker shows the You owe card; Money shows the
 * Tournament tickets card with Mark paid. End is not held up.
 */
export const ZIP85_STAGES = ['zip85_idle', 'zip85_owed'] as const;
/**
 * Zip 86 (🎾86.clean admin):
 *   zip86_payments  "Tournament card: payments": The Cold Open's numbers (pictures 5 to 7): 6 of 8 locked in (Alex free, 5 paid), 4 haven't paid
 *                   (Vic, Zoe, Quinn, Reese), 10 expected, 2 courts, 7:30 to 10 PM, $18, prizes not set: Money says 5 paid $90, courts $120, so
 *                   far -$30; if all 10 pay $162 - $120 - $28 suggested = +$14; the Money button +$42.
 *   zip86_home      "Admin Home: booked tonight + not booked" (picture 10): The Cold Open as above, a game tonight (tomorrow after 7 PM) booked,
 *                   court 4, Alex In with Parker, Sage and Christopher Vanderberg, all paid; the next day's game not booked, Rowan only, no court.
 *   zip86_next      "Tournament next week (row, no button)": The Cold Open on next week's Tuesday: the row under NEXT WEEK, no button.
 *   zip86_signup / zip86_lockin / zip86_whosin  "Tournament in 2 weeks": the week after next: View as Quinn (not on the list: Sign up), Vic (on the
 *                   list, not paid: Lock in), Parker (locked in: Who's in).
 */
/**
 * Zip 88 (🎾88.rolling courts): the night card (pictures 1 to 3) on real nights, rolling courts deciding what is on each court.
 *   zip88_early    the picture 2 moment (Court 1 started RD4 early, Court 2 at Play to 9). 10 players never get there (the fair schedule always
 *                  has someone of the next game still on the other court), so the test page draws it as a LOOK, and Home gets zip88_rd3.
 *   zip88_rd3      Americano tonight (Zip 61's night, 10 names): Rounds 1 and 2 in, Court 1's Round 3 game in (11 to 7), Court 2 still
 *                  playing: Court 1 waits (Done), "1 of 2 in", RD3 outlined.
 *   zip88_final    Locked doubles at the Final (final_on), the Final and 3rd place at Play to 7 (rows set to 7 for the look of picture 3).
 *   zip88_sitting  Americano: Rounds 1 to 3 in, Round 4 on, Vic sits it (view as Vic).
 */
//   zip88_ready    Game day: ready to start now. Locked doubles tonight, the start later today (about 2 hours from now), teams published,
//                  courts 1 and 2: the card's pill is "Start now"; tap it, "Are you sure?", Yes: the night card with "0 of 2 in", Game 1 and 2
//                  on the courts. Players can rename their team until their first game has a score.
//   zip88_soon     Player: 20 minutes before start. Americano tonight (Zip 61's 10 names), the start 20 minutes from now: View as Vic: "Games
//                  start soon" with "Starts in 20:00" ticking down each second, Your rounds under it.
export const ZIP88_STAGES = ['zip88_soon', 'zip88_ready', 'zip88_early', 'zip88_rd3', 'zip88_final', 'zip88_sitting'] as const;
/**
 * Zip 89 (🎾89.smart pacing), on the real rows and the real pacing rules (shared/smartPacing.ts):
 *   zip89_am_ahead  "Pacing: Americano ahead (offer showing)": Americano tonight (10 names), started about 32 minutes ago, Rounds 1 and 2 in at
 *                   14 minutes a round: the night card's "Ahead of time" line with Add a round. Yes adds Round 7 at once.
 *   zip89_ld_semis  "Pacing: Locked doubles ahead (semis offer)": the 4 teams tonight, started about 18 minutes ago, Round 1 in at 14 minutes:
 *                   "Ahead of time"; Add a round asks "Add semifinals?"; Yes: SEMIS between the round robin and the FINAL.
 *   zip89_bo3       "Pacing: best-of-3 Final in play": the round robin and the semifinals in (as the bonus wrote them), the Final best of 3:
 *                   Net Ninjas won Game 1 11 to 8, Game 2 on a court beside 3rd place: "Final · G2" and "Best of 3 · G1 11–8 · G2 –".
 */
//   zip89_break     "Pacing: 5 min break": the 4 teams tonight (nobody sits), Rounds 1 and 2 in, Round 2 a minute ago: the night card's "5 min
//                   break" with "Round 3 in 3:59" and Skip break; the phones show the same card.
export const ZIP89_STAGES = ['zip89_am_ahead', 'zip89_ld_semis', 'zip89_bo3', 'zip89_break'] as const;
/**
 * Zip 90 (🎾90.prize reveal), the night ended by the real End (endPlan and writeEnd) with the prizes the stage names:
 *   zip90_ld      "Prize: Locked doubles champs": Net Ninjas (Vic and Wren) won the Final, $14 each (Locked doubles 1st $14, 2nd $0): View as
 *                 Vic: two face-down cards (picture 1); the medal and the $14 held back from the header until each card is flipped.
 *   zip90_am      "Prize: Americano champion, no credit": Americano, every round in, Vic won, the prizes $0 (medals only), the reveal over: View
 *                 as Vic: one card, the medal (picture 4).
 *   zip90_second  "Prize: runner-up": as zip90_ld with Locked doubles 2nd $7 each: View as Parker (Third Shot Gang lost the Final): one
 *                 card, $7 credit, no medal (pictures 5 and 6).
 *   zip90_header  "Header: long names": zip90_ld with every card already claimed, plus an older win for Christopher Vanderberg and $14 of
 *                 test credit: the header with medals, the cup and credit (View as Vic, Christopher Vanderberg).
 */
//   zip90_replay  "Replay: medal and credit slam": Alex's look on his phone (the flight, the landing, the spacing; the buttons and the
//                 credit). Each pick puts the prize cards back to unclaimed (seen_at cleared, nothing else touched: same night, same money);
//                 the first pick (or one after another stage) builds zip90_ld. View as Vic.
//   zip90_counts  "Header: medal counts" (round 4): seven older finished tournaments (Everyone, banners long over, every prize claimed), so
//                 Vic has 1 medal, Wren 2, Parker 3, Quinn 4 (one medal and "×4") and Sage 7: View as each. No money rows.
/**
 * Zip 92 (🎾92.dry run fixes):
 *   zip92_twelve    "92: 12 players switch to Americano": the preview has only the 10 fixed names, so the real switch runs at 9 locked in (the
 *                   style_odd night: Pay by an hour ago, Locked doubles by vote, the first read switches it; players see "Tournament style is
 *                   now Americano."); the Tournament test page draws Alex's card as it reads at 12 with the same words the server uses. The
 *                   switch itself at 11, 12 and 13 is checked on the real server in tests/zip92-fixes.test.ts.
 *   zip92_ld_round  "92: Locked doubles one more round offer": the 4 teams tonight on 2.5 hours (the semifinals in the plan, written as Publish
 *                   writes them), started about 25 minutes ago, Round 1 in at 13 and 14 minutes after the warm-up: "Ahead of time", Add a
 *                   round asks "Add a round? Are you sure?"; Yes adds RD4 (Round 1's games again) before SEMIS.
 *   zip92_slow      "92: slow night time check": Americano tonight, Rounds 1 and 2 in at 26 minutes each, Round 3 on both courts: the Time
 *                   check asks for shorter games from Round 4 (Round 3 is on the courts and keeps its length); "Not now" or Play to 9 hides
 *                   it until Round 4 is the round being played.
 */
//   zip92_court_time "92: court time line": Zip 87's Pay by day (8 of 10 locked in, 7:30 to 10 PM, 2 courts): the card's gray line "8 locked in:
//                   9:30 is enough, you could cancel 30 min."; it follows the count as people lock in (a suggestion only).
export const ZIP92_STAGES = ['zip92_twelve', 'zip92_ld_round', 'zip92_slow', 'zip92_court_time'] as const;
type Zip92Stage = (typeof ZIP92_STAGES)[number];
const isZip92Stage = (s: string): s is Zip92Stage => (ZIP92_STAGES as readonly string[]).includes(s);
export const ZIP90_STAGES = ['zip90_ld', 'zip90_am', 'zip90_second', 'zip90_header', 'zip90_replay', 'zip90_counts'] as const;
type Zip90Stage = (typeof ZIP90_STAGES)[number];
const isZip90Stage = (s: string): s is Zip90Stage => (ZIP90_STAGES as readonly string[]).includes(s);
type Zip89Stage = (typeof ZIP89_STAGES)[number];
const isZip89Stage = (s: string): s is Zip89Stage => (ZIP89_STAGES as readonly string[]).includes(s);
type Zip88Stage = (typeof ZIP88_STAGES)[number];
const isZip88Stage = (s: string): s is Zip88Stage => (ZIP88_STAGES as readonly string[]).includes(s);
export const ZIP86_STAGES = ['zip86_payments', 'zip86_home', 'zip86_next', 'zip86_signup', 'zip86_lockin', 'zip86_whosin'] as const;
type Zip86Stage = (typeof ZIP86_STAGES)[number];
const isZip86Stage = (s: string): s is Zip86Stage => (ZIP86_STAGES as readonly string[]).includes(s);
/**
 * Zip 87 (🎾87.card polish): the organizer's tournament card before the night, by time, on Zip 86's The Cold Open (10 can make the date: Alex,
 * Parker, Rowan, Sage, Christopher Vanderberg, Wren, Vic, Zoe, Quinn, Reese; 10 expected; 2 courts; 7:30 to 10 PM; $18):
 *   zip87_early     "Card: early payments" (picture 3): 6 of 10 locked in, 4 haven't paid, pay by the night before at 7 PM.
 *   zip87_payday    "Card: Pay by day" (picture 4): the night tomorrow, Pay by today (7 PM, or 11:30 PM after 7 PM), Vic and Zoe paid: 8 of 10, 2 left.
 *   zip87_past      "Card: past Pay by" (picture 5): the night in 2 days, Pay by an hour ago, Vic and Zoe paid: 8 of 10, 2 past due (Quinn, Reese;
 *                   an even count, so the style stays Locked doubles: 9 would switch it to Americano by the odd-count rule).
 *   zip87_paid      "Card: everyone paid" (picture 6): the night in 2 days, everyone paid: All 10 locked in, Remind quiet.
 *   zip87_gameday   "Card: game day, prizes not set" (picture 7): the night today (7:30 PM, later when it is late), all 10 paid, no teams, no prizes.
 *   zip87_allset    "Card: game day, all set" (picture 8): as above, the 5 teams published, prizes $14 each (Locked doubles) and 14 / 7 (Americano).
 *   zip87_prizes    "Prizes: both styles" (picture 9): as early payments; tap Prizes: both boxes, Use these fills them ($14 / $0, $14 / $7).
 */
export const ZIP87_STAGES = ['zip87_early', 'zip87_payday', 'zip87_past', 'zip87_paid', 'zip87_gameday', 'zip87_allset', 'zip87_prizes'] as const;
type Zip87Stage = (typeof ZIP87_STAGES)[number];
const isZip87Stage = (s: string): s is Zip87Stage => (ZIP87_STAGES as readonly string[]).includes(s);
export const TEST_STAGES = [...ZIP92_STAGES, ...ZIP90_STAGES, ...ZIP89_STAGES, ...ZIP88_STAGES, ...ZIP87_STAGES, ...ZIP86_STAGES, ...ZIP85_STAGES, ...ZIP83_STAGES, ...VENUE_STAGES, ...ZIP79_STAGES, ...ZIP77_STAGES, ...ZIP74_STAGES, ...ZIP70_STAGES, ...ZIP58_STAGES, ...AM_STAGES, ...DAY_STAGES, 'none', 'signup', 'date_picked', 'tickets_open', 'all_locked', 'odd', 'canceled', 'rescheduled', 'closed', 'hidden', 'vote_open', 'vote_majority', 'vote_tie', 'vote_finalize', 'speed_check', ...COUNTDOWN_STAGES, ...STYLE_STAGES, ...ZIP66_STAGES, 'zip71_teams'] as const;
const isStyleStage = (s: string): boolean => (STYLE_STAGES as readonly string[]).includes(s);
type CountdownStage = (typeof COUNTDOWN_STAGES)[number];
const isCountdown = (s: string): s is CountdownStage => (COUNTDOWN_STAGES as readonly string[]).includes(s);

/** Zip 63: Pay by for a countdown stage, from now (Eastern). */
function countdownPayBy(stage: CountdownStage, nowMs: number, tz: string): number {
  const today = dayParts(todayKey(nowMs, tz));
  const at7 = (plusDays: number) => {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + plusDays));
    return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 19, 0, tz);
  };
  switch (stage) {
    case 'pay_3d':
      return at7(3);
    case 'pay_2d':
      return at7(2);
    case 'pay_1d':
      return at7(1);
    case 'pay_today': {
      // 7:00 PM tonight when that is 6.5 hours away or more; later tonight otherwise (on the half hour, before midnight when it can be).
      const want = nowMs + 6.5 * 3_600_000;
      if (at7(0) >= want) return at7(0);
      const half = Math.ceil(want / 1_800_000) * 1_800_000;
      return Math.min(half, at7(1) - 19 * 3_600_000 - 60_000);
    }
    case 'pay_hours':
      return nowMs + (5 * 60 + 20) * 60_000;
    case 'pay_minutes':
      return nowMs + 42 * 60_000 + 30_000;
    case 'pay_late':
    case 'pay_closed':
      return nowMs - 3_600_000;
  }
}

/** Zip 63: the day after a moment (Eastern), as 'YYYY-MM-DD': the tournament of a countdown stage. */
function dayAfter(ms: number, tz: string): string {
  const p = dayParts(todayKey(ms, tz));
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
type Stage = (typeof TEST_STAGES)[number];

/** The fixed names and their picks (Kai is not one of the preview's names, so Kai is not here). Levels in hundredths. */
const CAST: { name: string; level: number; stage: 'signup' | 'date_picked'; every: number; offset: number }[] = [
  { name: 'Parker', level: 360, stage: 'signup', every: 2, offset: 0 },
  { name: 'Rowan', level: 350, stage: 'signup', every: 1, offset: 0 },
  { name: 'Sage', level: 300, stage: 'signup', every: 3, offset: 1 },
  { name: 'Christopher Vanderberg', level: 300, stage: 'signup', every: 2, offset: 1 },
  { name: 'Wren', level: 320, stage: 'signup', every: 3, offset: 2 },
  { name: 'Quinn', level: 250, stage: 'signup', every: 2, offset: 0 },
  { name: 'Zoe', level: 275, stage: 'date_picked', every: 3, offset: 0 },
  { name: 'Reese', level: 340, stage: 'date_picked', every: 2, offset: 1 },
];
/** Zip 56: the two more names the ticket stages put on the list. */
const MORE_CAST: Record<string, number> = { Vic: 320, Alex: 340 };

/** Every Tuesday to Friday of next month and the first two weeks of the month after (no Christmas Eve, Christmas, New Year's Eve or Day). */
export function testDates(today: string): string[] {
  const from = monthStartPlus(today, 1);
  const to = monthStartPlus(today, 2);
  const skip = (d: string) => /-12-(24|25|31)$|-01-01$/.test(d);
  const out: string[] = [];
  for (const m of monthsBetween(from, to)) {
    for (const d of m.days) {
      const p = dayParts(d);
      if (p.weekday < 2 || p.weekday > 5 || skip(d)) continue;
      if (p.month === dayParts(to).month && p.day > 14) continue;
      out.push(d);
    }
  }
  return out;
}

/** Zip 56: who is on the list at each ticket stage, and their ticket: a spot, a place in line, or none; paid by Venmo, credit, $0 (Alex), or not. */
const TICKET_STAGES: Partial<Record<Stage, { name: string; place: 'spot' | 'line' | 'none'; pay: 'cash' | 'credit' | 'free' | 'none' }[]>> = {
  tickets_open: [
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'none', pay: 'none' },
    { name: 'Zoe', place: 'none', pay: 'none' },
    { name: 'Reese', place: 'none', pay: 'none' },
  ],
  all_locked: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Zoe', place: 'spot', pay: 'cash' },
    { name: 'Reese', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'spot', pay: 'cash' },
  ],
  style_even: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Zoe', place: 'spot', pay: 'cash' },
    { name: 'Reese', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'spot', pay: 'cash' },
  ],
  style_odd: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Zoe', place: 'spot', pay: 'cash' },
    { name: 'Reese', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'none', pay: 'none' },
  ],
  odd: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'none', pay: 'none' },
  ],
};

const TEST_CREDIT = 'adjusted:Ticket stage credit';

export async function tournamentTestStage(ctx: Ctx, body: Record<string, unknown>): Promise<unknown> {
  const group = await requireAdmin(ctx);
  if (!previewSiteFor(ctx)) throw new HttpError(404, 'not_found', 'Not found.');
  // Zip 92: the 12-player switch runs as style_odd on the preview's 10 names (see ZIP92_STAGES).
  if (body.stage === 'zip92_court_time') return { ...((await tournamentTestStage(ctx, { ...body, stage: 'zip87_payday' })) as Record<string, unknown>), stage: 'zip92_court_time' };
  if (body.stage === 'zip92_twelve') return { ...((await tournamentTestStage(ctx, { ...body, stage: 'style_odd' })) as Record<string, unknown>), stage: 'zip92_twelve' };
  const stage = v.oneOf(body.stage, 'stage', TEST_STAGES);
  // Either format at each stage (left out: Doubles). Americano has its own name and the 2nd place credit.
  const format = body.format === undefined ? 'doubles' : v.oneOf(body.format, 'format', FORMATS);
  await setTournamentsForAll(ctx.db, group.id, true, ctx.nowIso);
  // Zip 90: the replay stage only puts the last replay night's prize cards back to unclaimed (no money row is touched), so it can be picked
  // again and again.
  if (stage === 'zip90_replay') {
    const t = await ctx.db
      .prepare("SELECT id FROM tournaments WHERE group_id = ? AND status = 'ended' AND award_pick LIKE ? AND banner_until > ? ORDER BY ended_at DESC LIMIT 1")
      .bind(group.id, '%"stage":"zip90_replay"%', ctx.nowIso)
      .first<{ id: string }>();
    if (t) {
      await ctx.db.prepare('UPDATE tournament_results SET seen_at = NULL WHERE tournament_id = ? AND award IS NOT NULL').bind(t.id).run();
      return { ok: true, id: t.id, stage };
    }
  }
  // The fake database only: the last stage's ticket credit rows and test credit go, then every tournament of the (fake) group; its sign-ups,
  // level history and tickets go with it (ON DELETE CASCADE).
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM credit_ledger WHERE group_id = ? AND (reason LIKE 'tour:%' OR reason = ?)").bind(group.id, TEST_CREDIT),
    ctx.db.prepare('DELETE FROM tournaments WHERE group_id = ?').bind(group.id),
    ctx.db.prepare("DELETE FROM task_log WHERE group_id = ? AND kind = 'mark' AND task LIKE 'tournament_hidden:%'").bind(group.id),
    // Zip 70: the Plan's saved Expect number and the time card of the last stage's tournament.
    ctx.db.prepare("DELETE FROM task_log WHERE group_id = ? AND kind = 'mark' AND (task LIKE 'tournament_expect:%' OR task LIKE 'tournament_time:%' OR task LIKE 'tournament_start:%')").bind(group.id),
  ]);
  if (stage === 'none') return { ok: true, stage };
  if (isZip92Stage(stage)) return zip92Stage(ctx, group, stage);
  if (isZip90Stage(stage)) return zip90Stage(ctx, group, stage);
  if (isZip89Stage(stage)) return zip89Stage(ctx, group, stage);
  if (isZip88Stage(stage)) return zip88Stage(ctx, group, stage);
  if (isZip87Stage(stage)) return zip87Stage(ctx, group, stage);
  if (isZip86Stage(stage)) return zip86Stage(ctx, group, stage);
  if (stage === 'zip83_none') return { ...(await zip70Stage(ctx, group, 'zip70_start')), stage };
  if (stage === 'zip85_idle') return { ...(await americanoStage(ctx, group, 'am_standings')), stage };
  if (stage === 'zip85_owed') {
    const made = await americanoStage(ctx, group, 'am_done');
    // Parker's ticket exactly as "Didn't pay" after the start leaves it: the money not on it, the amount owed (OWED_MARK), still locked in.
    await ctx.db
      .prepare(
        `UPDATE tournament_tickets SET place = 'none', place_at = NULL, paid_cents = 0, paid_at = NULL, claim_cents = price_cents, claim_at = '${OWED_MARK}', updated_at = ?
         WHERE tournament_id = ? AND price_cents > 0 AND credit_cents = 0 AND player_id = (SELECT id FROM players WHERE group_id = ? AND display_name = 'Parker')`,
      )
      .bind(ctx.nowIso, made.id, group.id)
      .run();
    return { ...made, stage };
  }
  if (isVenueStage(stage)) return venueStage(ctx, group, stage);
  if (isZip70Stage(stage)) return zip70Stage(ctx, group, stage);
  if (isZip77Stage(stage)) return zip77Stage(ctx, group, stage);
  if (isZip79Stage(stage)) return zip79Stage(ctx, group, stage);
  if (isZip58Stage(stage)) return zip58Stage(ctx, group, stage);
  if (stage === 'zip72_circle') return dayStage(ctx, group, stage, TIE3, CIRCLE_SCORE);
  if (stage === 'zip74_short') {
    // mid's night, then the Time check's apply exactly as the organizer's tap writes it (server/tournamentDay.ts gamesAction 'apply').
    const made = await dayStage(ctx, group, 'mid');
    await ctx.db
      .prepare("UPDATE tournament_games SET play_to = 9, updated_at = ? WHERE tournament_id = ? AND stage = 'pool' AND round >= 2 AND play_to > 9 AND winner IS NULL AND claim IS NULL AND skipped = 0")
      .bind(ctx.nowIso, made.id)
      .run();
    return { ...made, stage };
  }
  if (isDayStage(stage)) return dayStage(ctx, group, stage);
  if (isAmStage(stage)) return americanoStage(ctx, group, stage);
  if (stage === 'vote_open' || stage === 'vote_majority' || stage === 'vote_tie' || stage === 'vote_finalize' || stage === 'speed_check' || stage === 'zip64_start' || stage === 'zip66_start' || stage === 'missed_date' || stage === 'zip71_teams') return voteStage(ctx, group, stage);

  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const dates = testDates(todayKey(ctx.nowMs, group.timezone));
  // The date everyone on the list can make: the third Thursday of next month (or the middle offered date).
  const thursdays = dates.filter((d) => dayParts(d).weekday === 4);
  // Zip 63: a countdown stage's tournament is the day after its Pay by.
  const countdownBy = isCountdown(stage) ? countdownPayBy(stage, ctx.nowMs, group.timezone) : null;
  // Zip 64: late_cut is today, starting 2 hours from now (inside the last 3 hours before the start).
  const nowLocal = localParts(ctx.nowMs, group.timezone);
  const cutStart = Math.min(23 * 60, Math.ceil((nowLocal.hour * 60 + nowLocal.minute + 120) / 5) * 5);
  const best =
    stage === 'late_cut' ? todayKey(ctx.nowMs, group.timezone) : countdownBy !== null ? dayAfter(countdownBy, group.timezone) : (thursdays[2] ?? dates[Math.floor(dates.length / 2)]);
  // Zip 64: a picked date has the real times (Plays): 7:30 to 10:00 PM, as Finalize starts on.
  const plays = stage === 'late_cut' ? { start: cutStart, minutes: Math.min(150, 24 * 60 - cutStart) } : { start: 19 * 60 + 30, minutes: 150 };
  const ticketKey: Stage =
    ['canceled', 'rescheduled', 'closed', 'hidden', 'late_open', 'late_cut'].includes(stage) || isCountdown(stage) ? 'tickets_open' : stage === 'style_back' ? 'style_even' : stage;
  const tickets = TICKET_STAGES[ticketKey] ?? null;
  // Alex: picking the date opens tickets, so every stage after Sign-up open has them open (Canceled and Rescheduled then run the real taps).
  const picked = stage !== 'signup';
  const id = newId();
  const t0 = Date.parse(ctx.nowIso) - 3 * 86_400_000;
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const payBy =
    countdownBy !== null
      ? new Date(countdownBy).toISOString()
      : stage === 'odd' || stage === 'closed' || isStyleStage(stage)
        ? new Date(ctx.nowMs - 3_600_000).toISOString()
        : defaultPayBy(best, NIGHT_START_MINUTES, group.timezone, ctx.nowMs);
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents, pay_by, format_source)
         VALUES (?, ?, ?, ${STORED_PLAN.size}, ${STORED_PLAN.courts}, ${picked ? plays.minutes : STORED_PLAN.minutes}, ${picked ? plays.start : STORED_PLAN.start}, 1600, 1400, ?, ?, ?, 'all', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        group.id,
        isStyleStage(stage) ? 'The Cold Open' : format === 'americano' ? 'Winter Americano' : 'Winter Classic',
        JSON.stringify([...new Set([...dates, best])].sort()),
        picked ? best : null,
        picked ? 'tickets' : 'signup',
        at(0),
        ctx.nowIso,
        picked ? ctx.nowIso : null,
        at(1),
        format,
        format === 'americano' || isStyleStage(stage) ? 700 : 0,
        picked ? payBy : null,
        isStyleStage(stage) ? 'vote' : null,
      ),
  ];
  // Who is on the list: piece 1's stages as before; a ticket stage exactly its own names.
  const listed = tickets
    ? tickets.map((s) => ({ name: s.name, level: CAST.find((c) => c.name === s.name)?.level ?? MORE_CAST[s.name] ?? 320, every: CAST.find((c) => c.name === s.name)?.every ?? 2, offset: CAST.find((c) => c.name === s.name)?.offset ?? 0 }))
    : CAST.filter((c) => c.stage === 'signup' || stage !== 'signup');
  let n = 0;
  for (const c of listed) {
    const pid = idOf.get(c.name);
    if (!pid) continue;
    n++;
    const picks = [...new Set([...dates.filter((_, i) => (i + c.offset) % c.every === 0), best])].sort();
    const approved = picked && c.name === 'Sage' ? 340 : null;
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at)
           VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, pid, c.level, approved, JSON.stringify(picks), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7)),
      ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, c.level, at(10 + n * 7)),
    );
    if (approved !== null) {
      statements.push(ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'organizer', ?)").bind(newId(), id, pid, approved, ctx.nowIso));
    }
  }
  // Zip 56: the tickets, with real money on the fake database: a confirmed Venmo payment, or credit (given first as a test adjustment, then used).
  const organizerId = await organizerIdOf(ctx.db, group);
  let k = 0;
  for (const s of tickets ?? []) {
    const pid = idOf.get(s.name);
    if (!pid || s.pay === 'none') continue;
    k++;
    const free = s.pay === 'free' || pid === organizerId;
    const price = free ? 0 : 1600;
    const paidAt = at(200 + k * 11);
    if (s.pay === 'credit' && !free) {
      statements.push(
        ctx.db.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) VALUES (?, ?, ?, 'kept', 1600, 0, NULL, ?, ?)").bind(newId(), group.id, pid, at(150), TEST_CREDIT),
        ctx.db.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) VALUES (?, ?, ?, 'used', 1600, 0, NULL, ?, ?)").bind(newId(), group.id, pid, paidAt, tourReason(id)),
      );
    }
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, paid_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, pid, s.place, paidAt, price, s.pay === 'credit' && !free ? 1600 : 0, s.pay === 'cash' && !free ? 1600 : 0, paidAt, paidAt, paidAt),
    );
  }
  await ctx.db.batch(statements);
  // Canceled and Rescheduled are made by the very statements the organizer's taps run (server/tournament.ts, server/tournamentTickets.ts).
  if (stage === 'canceled' || stage === 'hidden') {
    await ctx.db.batch([
      ctx.db.prepare("UPDATE tournaments SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?").bind(ctx.nowIso, ctx.nowIso, id),
      ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: id, playerId: null, why: 'cancel', endedReason: 'canceled', nowIso: ctx.nowIso, when: tournamentCanceled }),
    ]);
  }
  // Zip 63: the late stage's freed spot: the same History line a back out after Pay by writes (Wren held a spot since before Pay by and gave it
  // up), and Wren off the list with no ticket, so the spot count and the line agree.
  if (stage === 'pay_late') {
    const wren = idOf.get('Wren');
    if (wren) {
      const outAt = new Date(ctx.nowMs - 30 * 60_000).toISOString();
      await ctx.db.batch([
        ctx.db.prepare('DELETE FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').bind(id, wren),
        ctx.db.prepare("UPDATE credit_ledger SET ended_at = ?, ended_reason = 'dropped' WHERE player_id = ? AND reason = ? AND ended_at IS NULL").bind(outAt, wren, tourReason(id)),
        ctx.db.prepare("UPDATE tournament_signups SET status = 'out', updated_at = ? WHERE tournament_id = ? AND player_id = ?").bind(outAt, id, wren),
        ctx.db
          .prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) VALUES (?, ?, NULL, 'Wren', 'tournament_back_out', ?, ?)")
          .bind(newId(), group.id, JSON.stringify({ tournament: 'Winter Classic', tournamentId: id, freedSpot: true, player: 'Wren', playerId: wren }), outAt),
      ]);
    }
  }
  // Zip 64: style_back = the odd switch already happened (9 locked in, half an hour ago), then Vic paid late: 10 now.
  if (stage === 'style_back') {
    await ctx.db
      .prepare("UPDATE tournaments SET format = 'americano', format_source = ? WHERE id = ?")
      .bind(`odd:${new Date(ctx.nowMs - 30 * 60_000).toISOString()}`, id)
      .run();
    const vic = idOf.get('Vic');
    if (vic) await ctx.db.prepare('UPDATE tournament_tickets SET place_at = ?, paid_at = ?, updated_at = ? WHERE tournament_id = ? AND player_id = ?').bind(ctx.nowIso, ctx.nowIso, ctx.nowIso, id, vic).run();
  }
  // Zip 59: hidden = canceled, then the same one row a Hide tap writes (the tournament and its tickets stay).
  if (stage === 'hidden') {
    await ctx.db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), group.id, hiddenTask(id), ctx.nowIso).run();
  }
  if (stage === 'rescheduled') {
    await ctx.db.batch([
      ctx.db.prepare("UPDATE tournaments SET status = 'rescheduled', final_date = NULL, date_picked_at = NULL, updated_at = ? WHERE id = ?").bind(ctx.nowIso, id),
      ctx.db.prepare("UPDATE tournament_signups SET dates = '[]', updated_at = ? WHERE tournament_id = ?").bind(ctx.nowIso, id),
    ]);
  }
  return { ok: true, stage, format, id, signedUp: n, tickets: k, date: picked && stage !== 'rescheduled' ? best : null, firstDate: dates[0] ?? dayKey(2026, 1, 1) };
}


/**
 * Zip 60: the vote stages. The date is locked by the very code the organizer's Pick date runs (lockDate), so the count and the alert are the real ones.
 * Zip 62 (🎾62.speed): `speed_check` is The Cold Open as it is on live: Everyone, the vote open, every fixed name but the organizer on the list.
 */
type VoteStage = 'vote_open' | 'vote_majority' | 'vote_tie' | 'vote_finalize' | 'speed_check' | 'zip64_start' | 'zip66_start' | 'missed_date' | 'zip71_teams';
const ZIP64_VOTERS: { name: string; level: number; vote: 'locked' | 'americano' | 'either' }[] = [
  { name: 'Parker', level: 360, vote: 'locked' },
  { name: 'Rowan', level: 350, vote: 'americano' },
  { name: 'Sage', level: 300, vote: 'either' },
  { name: 'Christopher Vanderberg', level: 300, vote: 'locked' },
  { name: 'Wren', level: 320, vote: 'either' },
  { name: 'Quinn', level: 250, vote: 'locked' },
  { name: 'Zoe', level: 275, vote: 'either' },
  { name: 'Alex', level: 340, vote: 'americano' },
];
const VOTERS: Record<VoteStage, { name: string; level: number; vote: 'locked' | 'americano' | 'either' }[]> = {
  zip64_start: ZIP64_VOTERS,
  zip66_start: ZIP64_VOTERS,
  // Zip 71 (pictures pair-01 and pair-02): the 8 on the list and their levels, Doubles 2, Americano 0, Either 6.
  zip71_teams: [
    { name: 'Parker', level: 360, vote: 'locked' },
    { name: 'Rowan', level: 350, vote: 'either' },
    { name: 'Sage', level: 340, vote: 'either' },
    { name: 'Vic', level: 320, vote: 'locked' },
    { name: 'Wren', level: 320, vote: 'either' },
    { name: 'Christopher Vanderberg', level: 300, vote: 'either' },
    { name: 'Zoe', level: 275, vote: 'either' },
    { name: 'Quinn', level: 250, vote: 'either' },
  ],
  missed_date: ZIP64_VOTERS,
  vote_open: [
    { name: 'Parker', level: 360, vote: 'locked' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'either' },
  ],
  vote_majority: [
    { name: 'Parker', level: 360, vote: 'americano' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'locked' },
    // Zip 80: a real majority (3 of 5), so the alert may say "Most players voted Americano." (2 of 5 no longer claims it).
    { name: 'Wren', level: 320, vote: 'americano' },
    { name: 'Christopher Vanderberg', level: 300, vote: 'either' },
  ],
  vote_finalize: [
    { name: 'Parker', level: 360, vote: 'americano' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'americano' },
    { name: 'Wren', level: 320, vote: 'americano' },
    { name: 'Quinn', level: 250, vote: 'americano' },
    { name: 'Christopher Vanderberg', level: 300, vote: 'americano' },
    { name: 'Zoe', level: 275, vote: 'locked' },
    { name: 'Reese', level: 340, vote: 'locked' },
    { name: 'Vic', level: 320, vote: 'locked' },
    { name: 'Alex', level: 340, vote: 'locked' },
  ],
  vote_tie: [
    { name: 'Parker', level: 360, vote: 'locked' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'either' },
    { name: 'Wren', level: 320, vote: 'either' },
  ],
  speed_check: [
    { name: 'Parker', level: 360, vote: 'locked' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'either' },
    { name: 'Wren', level: 320, vote: 'americano' },
    { name: 'Quinn', level: 250, vote: 'locked' },
    { name: 'Christopher Vanderberg', level: 300, vote: 'either' },
    { name: 'Zoe', level: 275, vote: 'americano' },
    { name: 'Reese', level: 340, vote: 'locked' },
    { name: 'Vic', level: 320, vote: 'either' },
  ],
};

async function voteStage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: VoteStage) {
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const all = testDates(todayKey(ctx.nowMs, group.timezone));
  // Zip 64: the calm start offers next month only, like The Cold Open on live (the stub then reads "DEC", as in the mocks).
  const dates = stage === 'zip64_start' || stage === 'zip66_start' || stage === 'missed_date' || stage === 'zip71_teams' ? all.filter((d) => d.slice(0, 7) === all[0].slice(0, 7)) : all;
  const thursdays = dates.filter((d) => dayParts(d).weekday === 4);
  const best = thursdays[2] ?? dates[Math.floor(dates.length / 2)];
  const id = newId();
  const t0 = Date.parse(ctx.nowIso) - 3 * 86_400_000;
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, shown_at, format, second_credit_cents, format_source)
         VALUES (?, ?, 'The Cold Open', ${STORED_PLAN.size}, ${STORED_PLAN.courts}, ${STORED_PLAN.minutes}, ${STORED_PLAN.start}, 1600, 1400, ?, NULL, 'signup', 'all', ?, ?, ?, 'doubles', 700, 'vote')`,
      )
      .bind(id, group.id, JSON.stringify([...new Set([...dates, best])].sort()), at(0), ctx.nowIso, at(1)),
  ];
  // Every voter can make `best`; Zip 66's missed_date: Sage cannot (every other offered date she can).
  const picksFor = (name: string, n: number) =>
    stage === 'missed_date' && name === 'Sage' ? dates.filter((d) => d !== best) : [...new Set([...dates.filter((_, i) => i % 2 === n % 2), best])].sort();
  let n = 0;
  for (const c of VOTERS[stage]) {
    const pid = idOf.get(c.name);
    if (!pid) continue;
    n++;
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at, format_vote)
           VALUES (?, ?, ?, 'in', ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, pid, c.level, JSON.stringify(picksFor(c.name, n)), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7), c.vote),
      ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, c.level, at(10 + n * 7)),
    );
  }
  await ctx.db.batch(statements);
  const locks = stage === 'vote_majority' || stage === 'vote_tie' || stage === 'missed_date';
  if (locks) {
    const row = await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<TournamentRow>();
    await lockDate(ctx, group, row!, { date: best });
  }
  return { ok: true, stage, id, signedUp: n, date: locks ? best : null, firstDate: dates[0] ?? dayKey(2026, 1, 1) };
}


// ---------------------------------------------------------------------------------------------------------------------
// Zip 57: the game day stages (see DAY_STAGES above). Teams and games are written the way Publish writes them (tournamentDay.ts), results the way
// the players' and the organizer's taps write them.
// ---------------------------------------------------------------------------------------------------------------------

/** The brief's four teams, in seat order (seat 1 plays seat 2 in round 1: Net Ninjas vs Third Shot Gang, as mocks 16 and 17 draw it). */
const DAY_TEAMS: { name: string; a: string; b: string; la: number; lb: number }[] = [
  { name: 'Net Ninjas', a: 'Vic', b: 'Wren', la: 320, lb: 320 },
  { name: 'Third Shot Gang', a: 'Parker', b: 'Quinn', la: 360, lb: 250 },
  { name: 'Kitchen Crew', a: 'Rowan', b: 'Zoe', la: 350, lb: 275 },
  { name: 'Dill With It', a: 'Sage', b: 'Christopher Vanderberg', la: 340, lb: 300 },
];

/**
 * Zip 72: the score of a pool game the stages write (winner first). The usual: 11 to 3..9, made up from the game number (a re-run gives the same
 * table). `even`: every game 11 to 7 (tie3: a circle level on every rule, the wheel's last resort).
 */
type StageScore = (num: number, win: number, lose: number) => [number, number];
const USUAL_SCORE: StageScore = (num) => [11, 3 + ((num * 5) % 7)];
const EVEN_SCORE: StageScore = () => [11, 7];
/** zip72_circle: Kitchen Crew (3) 11-5 / 11-9 / 11-8; the circle Net Ninjas 11-3 Dill With It, Dill With It 11-9 Third Shot Gang, Third Shot Gang 11-9 Net Ninjas. */
const CIRCLE_SCORE: StageScore = (_num, win, lose) => {
  const k = `${win}>${lose}`;
  const table: Record<string, [number, number]> = { '3>1': [11, 5], '3>2': [11, 9], '3>4': [11, 8], '1>4': [11, 3], '4>2': [11, 9], '2>1': [11, 9] };
  return table[k] ?? [11, 7];
};

async function dayStage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: DayStage, win?: (a: number, b: number) => number, score: StageScore = USUAL_SCORE) {
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const tz = group.timezone;
  const nowLocal = localParts(ctx.nowMs, tz);
  const nowMin = nowLocal.hour * 60 + nowLocal.minute;
  const today = todayKey(ctx.nowMs, tz);
  const later = stage === 'teams_published' || stage === 'backed_out';
  const date = later ? dayAfter(ctx.nowMs + 86_400_000, tz) : today;
  // The night: started 10 minutes ago (45 for mid, a minute for game1), on the 5 minutes; 7:30 PM two days from now for the later ones.
  const ago = stage === 'mid' ? 45 : stage === 'game1' ? 1 : stage === 'zip71_taps' || stage === 'zip72_scores' ? 20 : stage === 'pools_done' || stage === 'zip72_circle' ? 100 : 10;
  const start = later ? 19 * 60 + 30 : Math.max(0, Math.floor((nowMin - ago) / 5) * 5);
  // The whole plan (2 hours, see below), also when that runs past midnight (a late test).
  // Zip 89 (Alex, "build in what fits"): the 4 teams' stages show a 2 hour night (the round robin, then the Final, as the pictures): on 2.5 hours
  // the plan would build in the semifinals.
  const minutes = 120;
  const id = newId();
  const t0 = ctx.nowMs - 3 * 86_400_000;
  const at = (m: number) => new Date(t0 + m * 60_000).toISOString();
  const payBy = new Date(ctx.nowMs - 3_600_000).toISOString();
  const published = stage !== 'day_ready' && stage !== 'teams_drafted';
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents, pay_by, format_source, teams_at, court_numbers)
         VALUES (?, ?, 'The Cold Open', ${STORED_PLAN.size}, 2, ?, ?, 1600, 1400, ?, ?, 'tickets', 'all', ?, ?, ?, ?, 'doubles', 0, ?, NULL, ?, '[1,2]')`,
      )
      .bind(id, group.id, minutes, start, JSON.stringify([date]), date, at(0), ctx.nowIso, at(5), at(1), payBy, published ? at(400) : null),
  ];
  let n = 0;
  for (const team of DAY_TEAMS) {
    for (const [name, level] of [
      [team.a, team.la],
      [team.b, team.lb],
    ] as [string, number][]) {
      const pid = idOf.get(name);
      if (!pid) continue;
      n++;
      statements.push(
        ctx.db
          .prepare(`INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at) VALUES (?, ?, ?, 'in', ?, NULL, ?, ?, ?, ?)`)
          .bind(newId(), id, pid, level, JSON.stringify([date]), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7)),
        ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, level, at(10 + n * 7)),
        ctx.db
          .prepare(
            `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, paid_at, created_at, updated_at)
             VALUES (?, ?, ?, 'spot', ?, 1600, 0, 1600, ?, ?, ?)`,
          )
          .bind(newId(), id, pid, at(200 + n * 11), at(200 + n * 11), at(200 + n * 11), at(200 + n * 11)),
      );
    }
  }
  await ctx.db.batch(statements);
  if (stage === 'day_ready') return { ok: true, stage, id, date };
  const row = (await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<TournamentRow>())!;
  const teams = DAY_TEAMS.map((x) => ({ id: newId(), name: x.name, a: idOf.get(x.a) ?? null, b: idOf.get(x.b) ?? null, pool: null, changed: false, out: null }));
  const plan = gamesFor(row, teams.length);
  // Draft (not published): the same rows Draft teams writes. Published: the same rows Publish writes, games and all.
  await ctx.db.batch(writeTeamsAndGames(ctx.db, row, teams, published ? plan.games : null, plan.playTo, ctx.nowIso, '1 = 1', []));
  const iso = (minsAgo: number) => new Date(ctx.nowMs - minsAgo * 60_000).toISOString();
  if (stage === 'mid') {
    // Game 1 (Net Ninjas, seat 1, side a): Vic entered 11 to 7 two minutes ago. Zip 71, no confirming: the first score is the result, written
    // the way Vic's Submit score writes it (the score, the winner, and who entered it in claim_by).
    const ago2 = 2;
    await ctx.db
      .prepare(
        "UPDATE tournament_games SET winner = 'a', score_a = 11, score_b = 7, claim_by = ?, result_at = ?, result_by = 'players', seat_a = CAST(substr(slot_a, 2) AS INTEGER), seat_b = CAST(substr(slot_b, 2) AS INTEGER), updated_at = ? WHERE tournament_id = ? AND num = 1",
      )
      .bind(idOf.get('Vic') ?? null, iso(ago2), iso(ago2), id)
      .run();
  }
  if (stage === 'pools_done' || stage === 'zip72_circle') {
    // Every round robin game in, as a player's first score writes it: seat 1 wins everything, seat 2 beats 3 and 4, seat 3 beats 4 (or `win`).
    const games = (await ctx.db.prepare("SELECT num, slot_a, slot_b FROM tournament_games WHERE tournament_id = ? AND stage = 'pool' ORDER BY num").bind(id).all<{ num: number; slot_a: string; slot_b: string }>()).results;
    const by = new Map(DAY_TEAMS.map((x, i) => [i + 1, idOf.get(x.a) ?? null]));
    await ctx.db.batch(
      games.map((g, i) => {
        const a = Number(g.slot_a.slice(1));
        const b = Number(g.slot_b.slice(1));
        const aWins = win ? win(a, b) === a : a < b;
        const [w, l] = score(g.num, aWins ? a : b, aWins ? b : a);
        return ctx.db
          .prepare("UPDATE tournament_games SET winner = ?, score_a = ?, score_b = ?, claim_by = ?, result_at = ?, result_by = 'players', seat_a = ?, seat_b = ?, updated_at = ? WHERE tournament_id = ? AND num = ?")
          .bind(aWins ? 'a' : 'b', aWins ? w : l, aWins ? l : w, by.get(aWins ? a : b) ?? null, iso(90 - i * 12), a, b, iso(90 - i * 12), id, g.num);
      }),
    );
  }
  if (stage === 'backed_out') {
    // Zoe backs out after Pay by (the real back out's rows: off the list, the ticket's cash back as one credit entry): 7 locked in. The first
    // screen that reads it switches the style to Americano (zip 64), as it would on the night.
    const zoe = idOf.get('Zoe');
    if (zoe) {
      const outAt = iso(20);
      await ctx.db.batch([
        ctx.db.prepare("UPDATE tournament_signups SET status = 'out', backed_out_at = ?, updated_at = ? WHERE tournament_id = ? AND player_id = ?").bind(outAt, outAt, id, zoe),
        ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: id, playerId: zoe, why: 'back', endedReason: 'dropped', nowIso: outAt, when: () => '1 = 1' }),
        ctx.db
          .prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) VALUES (?, ?, NULL, 'Zoe', 'tournament_back_out', ?, ?)")
          .bind(newId(), group.id, JSON.stringify({ tournament: 'The Cold Open', tournamentId: id, freedSpot: true, player: 'Zoe', playerId: zoe }), outAt),
      ]);
    }
  }
  return { ok: true, stage, id, date, signedUp: n };
}

/**
 * Zip 57, PREVIEW ONLY: GET /api/tournament/pools-look: the 12 players pools night (mock 51) as Vic would see it at round 1, drawn from made-up
 * rows by the real view code (server/tournamentDay.ts playerDayView). The preview has 10 names, so the 6th team is "Kai + Guest". Writes nothing;
 * Not found anywhere but a preview.
 */
export async function poolsLook(ctx: Ctx) {
  if (!previewSiteFor(ctx)) throw new HttpError(404, 'not_found', 'Not found.');
  const tz = 'America/Detroit';
  const nowLocal = localParts(ctx.nowMs, tz);
  const start = Math.max(0, Math.floor((nowLocal.hour * 60 + nowLocal.minute - 5) / 5) * 5);
  const pairs: [string, string, string][] = [
    ['Net Ninjas', 'Vic', 'Wren'],
    ['Third Shot Gang', 'Parker', 'Quinn'],
    ['Kitchen Crew', 'Rowan', 'Zoe'],
    ['Dill With It', 'Sage', 'Christopher'],
    ['Dink Dynasty', 'Reese', 'Alex'],
    ['Lob Stars', 'Kai', 'Guest'],
  ];
  const t = {
    id: 'look',
    group_id: 'look',
    name: 'The Cold Open',
    size: 12,
    courts: 2,
    minutes: 150,
    start_minutes: start,
    ticket_cents: 1600,
    champion_credit_cents: 1400,
    offered_dates: '[]',
    final_date: todayKey(ctx.nowMs, tz),
    status: 'tickets',
    visibility: 'all',
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
    date_picked_at: ctx.nowIso,
    shown_at: ctx.nowIso,
    canceled_at: null,
    format: 'doubles',
    second_credit_cents: 0,
    pay_by: ctx.nowIso,
    teams_at: ctx.nowIso,
    court_numbers: '[1,2]',
    paused_at: null,
  } as TournamentRow;
  const signups = pairs.flatMap(([, a, b]) => [a, b]).map((name) => ({ player_id: `p-${name}`, display_name: name }) as unknown as SignupRow);
  const teams: TeamRow[] = pairs.map(([name, a, b], i) => ({
    id: `team-${i}`,
    tournament_id: 'look',
    seat: i + 1,
    name,
    player_a: `p-${a}`,
    player_b: `p-${b}`,
    pool: i < 3 ? 'A' : 'B',
    out_at: null,
    changed_at: null,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
  }));
  const plan = gamesFor(t, 6);
  const games: GameRow[] = plan.games.map((g) => ({
    id: `g-${g.num}`,
    tournament_id: 'look',
    num: g.num,
    round: g.round,
    court: g.court,
    stage: g.stage,
    pool: g.pool,
    slot_a: g.a,
    slot_b: g.b,
    play_to: g.stage === 'pool' ? plan.playTo : 11,
    claim: null,
    claim_at: null,
    disputed_at: null,
    winner: null,
    result_at: null,
    result_by: null,
    skipped: 0,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
  }));
  return { day: playerDayView(t, signups, { teams, games }, 'p-Vic', tz, ctx.nowMs) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 61: the Americano stages (see AM_STAGES above). The rows are written the way the night's first save writes them (server/americanoDay.ts
// ensureRows), scores the way a player's Enter score and the other side's Yes write them.
// ---------------------------------------------------------------------------------------------------------------------

/** The 10 names of an Americano stage (the preview's fixed names; Kai is not on the small preview). */
const AM_NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];

async function americanoStage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: AmStage) {
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const org = await organizerIdOf(ctx.db, group);
  const tz = group.timezone;
  const nowLocal = localParts(ctx.nowMs, tz);
  const nowMin = nowLocal.hour * 60 + nowLocal.minute;
  const later = stage === 'am_before' || stage === 'am_switched';
  const date = later ? dayAfter(ctx.nowMs + 86_400_000, tz) : todayKey(ctx.nowMs, tz);
  // Rounds played before now: 0 (Round 1), 2 (Round 3), 3 (Round 4), 5 (Round 6); each round 23 minutes, plus a few minutes into the next one.
  const done = stage === 'am_round3' ? 2 : stage === 'am_break' ? 3 : stage === 'am_standings' ? 5 : stage === 'am_done' ? 6 : 0;
  const ago = later ? 0 : stage === 'zip71_am' ? 20 : done * 23 + (done ? 6 : 1);
  const start = later ? 19 * 60 + 30 : Math.max(0, Math.floor((nowMin - ago) / 5) * 5);
  const switched = stage === 'am_switched';
  const names = AM_NAMES.filter((n) => idOf.has(n) && !(switched && n === 'Reese'));
  const locked = names.map((n) => idOf.get(n)!);
  // Seats: a tournament id whose schedule has Vic playing Rounds 1 to 3, sitting Round 4 and playing 5 and 6 (the pictures' night).
  const vic = idOf.get('Vic');
  let id = newId();
  for (let i = 0; i < 4000 && vic && !switched; i++) {
    const night = americanoNight(locked, 2, 150, id);
    const sits = [...night.sits.entries()].filter(([, ids]) => ids.includes(vic)).map(([r]) => r);
    if (sits.length === 1 && sits[0] === 4) break;
    id = newId();
  }
  const t0 = ctx.nowMs - 3 * 86_400_000;
  const at = (m: number) => new Date(t0 + m * 60_000).toISOString();
  const payBy = new Date(ctx.nowMs - 3_600_000).toISOString();
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents, pay_by, format_source, court_numbers)
         VALUES (?, ?, 'The Cold Open', ${STORED_PLAN.size}, 2, 150, ?, 1600, 1400, ?, ?, 'tickets', 'all', ?, ?, ?, ?, ?, 700, ?, ?, '[1,2]')`,
      )
      .bind(id, group.id, start, JSON.stringify([date]), date, at(0), ctx.nowIso, at(5), at(1), switched ? 'doubles' : 'americano', payBy, switched ? 'vote' : null),
  ];
  let n = 0;
  for (const name of AM_NAMES) {
    const pid = idOf.get(name);
    if (!pid) continue;
    n++;
    const free = pid === org;
    const paid = !(switched && name === 'Reese');
    statements.push(
      ctx.db
        .prepare(`INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at) VALUES (?, ?, ?, 'in', 300, NULL, ?, ?, ?, ?)`)
        .bind(newId(), id, pid, JSON.stringify([date]), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7)),
      ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, 300, 'player', ?)").bind(newId(), id, pid, at(10 + n * 7)),
      ctx.db
        .prepare(
          `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, paid_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, pid, paid ? 'spot' : 'none', paid ? at(200 + n * 11) : null, free ? 0 : 1600, paid && !free ? 1600 : 0, paid && !free ? at(200 + n * 11) : null, at(200 + n * 11), at(200 + n * 11)),
    );
  }
  await ctx.db.batch(statements);
  if (later || done === 0) return { ok: true, stage, id, date, signedUp: n };
  // The night's rows (as the first save writes them), then the rounds before now in, as Enter score and the other side's Yes write them.
  const night = americanoNight(locked, 2, 150, id);
  const nowIso = ctx.nowIso;
  const startMs = ctx.nowMs - (nowMin - start) * 60_000;
  const rows = night.games.map((g) =>
    ctx.db
      .prepare(
        `INSERT INTO tournament_games (id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, skipped, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pool', NULL, ?, ?, ?, 0, ?, ?)`,
      )
      .bind(newId(), id, g.num, g.round, g.court, pairSlot(g.a), pairSlot(g.b), g.playTo, nowIso, nowIso),
  );
  // Scores: the winners 11, the others 3 to 9 (made up from the game number, so a re-run gives the same table).
  const scores = night.games
    .filter((g) => g.round <= done)
    .map((g) => {
      const lose = 3 + ((g.num * 5) % 7);
      // Zip 58 (am_done): Vic's side wins every game he plays (the End card's "Vic finished first").
      const aWins = stage === 'am_done' && vic && [...g.a, ...g.b].includes(vic) ? g.a.includes(vic) : g.num % 3 !== 0;
      const when = new Date(startMs + (g.round * 23 - 2) * 60_000).toISOString();
      // Zip 71, no confirming: every score is in the moment it was entered (who entered it in claim_by), as a player's Enter score writes it.
      const [sa, sb] = aWins ? [11, lose] : [lose, 11];
      return ctx.db
        .prepare("UPDATE tournament_games SET claim = NULL, claim_by = ?, claim_at = ?, score_a = ?, score_b = ?, winner = ?, result_at = ?, result_by = 'players', updated_at = ? WHERE tournament_id = ? AND num = ?")
        .bind(g.a[0], when, sa, sb, aWins ? 'a' : 'b', when, when, id, g.num);
    });
  await ctx.db.batch([...rows, ...scores]);
  return { ok: true, stage, id, date, signedUp: n };
}

/** Zip 92's night stages (ZIP92_STAGES above; zip92_twelve is style_odd, picked before this). */
async function zip92Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip92Stage) {
  const tz = group.timezone;
  const now = localParts(ctx.nowMs, tz);
  const nowMin = now.hour * 60 + now.minute;
  const iso = (ms: number) => new Date(ms).toISOString();
  if (stage === 'zip92_ld_round') {
    // zip 57's game1 night (4 teams), on 2.5 hours with the semifinals the plan builds in (written by the same code an offer uses, before the
    // night: nothing is a bonus), started about 25 minutes ago; Round 1's two games in at 13 and 14 minutes after the warm-up.
    const made = await dayStage(ctx, group, 'game1');
    const id = made.id!;
    const start = Math.max(0, Math.floor((nowMin - 25) / 5) * 5);
    const startMs = startMsOf(made.date!, start, tz);
    await ctx.db.prepare('UPDATE tournaments SET start_minutes = ?, minutes = 150, updated_at = ? WHERE id = ?').bind(start, ctx.nowIso, id).run();
    const t = (await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<TournamentRow>())!;
    if (!(await writeSemis(ctx.db, t, await loadDay(ctx.db, id), iso(startMs - 60 * 60_000)))) throw new HttpError(500, 'stage_failed', 'The semifinal rows were not written.');
    const { results } = await ctx.db.prepare('SELECT num, court, slot_a, slot_b FROM tournament_games WHERE tournament_id = ? AND round = 1').bind(id).all<{ num: number; court: number; slot_a: string; slot_b: string }>();
    await ctx.db.batch(
      results.map((g) => {
        const when = iso(startMs + (10 + 12 + g.court) * 60_000);
        return ctx.db
          .prepare("UPDATE tournament_games SET winner = 'a', score_a = 11, score_b = ?, result_at = ?, result_by = 'players', seat_a = ?, seat_b = ?, updated_at = ? WHERE tournament_id = ? AND num = ?")
          .bind(5 + g.court * 2, when, Number(g.slot_a.slice(1)), Number(g.slot_b.slice(1)), when, id, g.num);
      }),
    );
    return { ...made, stage };
  }
  // zip92_slow: Zip 61's night (Rounds 1 and 2 in), moved so it started about 72 minutes ago and each round took 26 minutes after the warm-up
  // (Court 2 a minute after Court 1); Round 3 went on both courts when Round 2 ended.
  const made = await americanoStage(ctx, group, 'am_round3');
  const start = Math.max(0, Math.floor((nowMin - 72) / 5) * 5);
  const startMs = startMsOf(made.date!, start, tz);
  const { results } = await ctx.db.prepare('SELECT num, round, court FROM tournament_games WHERE tournament_id = ? AND round <= 2').bind(made.id).all<{ num: number; round: number; court: number }>();
  await ctx.db.batch([
    ctx.db.prepare('UPDATE tournaments SET start_minutes = ?, updated_at = ? WHERE id = ?').bind(start, ctx.nowIso, made.id),
    ...results.map((g) => {
      const when = iso(startMs + (10 + g.round * 26 - 2 + g.court) * 60_000);
      return ctx.db.prepare('UPDATE tournament_games SET claim_at = ?, result_at = ?, updated_at = ? WHERE tournament_id = ? AND num = ?').bind(when, when, when, made.id, g.num);
    }),
  ]);
  return { ...made, stage };
}

/** Zip 89: the pacing stages (ZIP89_STAGES above). */
async function zip89Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip89Stage) {
  const tz = group.timezone;
  const now = localParts(ctx.nowMs, tz);
  const nowMin = now.hour * 60 + now.minute;
  const iso = (ms: number) => new Date(ms).toISOString();
  if (stage === 'zip89_am_ahead') {
    // Zip 61's night (Rounds 1 and 2 in), moved so it started about 32 minutes ago and each round took 14 minutes (Court 2 a minute after Court 1).
    const made = await americanoStage(ctx, group, 'am_round3');
    const start = Math.max(0, Math.floor((nowMin - 32) / 5) * 5);
    const startMs = startMsOf(made.date!, start, tz);
    const { results } = await ctx.db.prepare('SELECT num, round, court FROM tournament_games WHERE tournament_id = ? AND round <= 2').bind(made.id).all<{ num: number; round: number; court: number }>();
    await ctx.db.batch([
      ctx.db.prepare('UPDATE tournaments SET start_minutes = ?, updated_at = ? WHERE id = ?').bind(start, ctx.nowIso, made.id),
      ...results.map((g) => {
        const when = iso(startMs + (g.round * 14 - 2 + g.court) * 60_000);
        return ctx.db.prepare('UPDATE tournament_games SET claim_at = ?, result_at = ?, updated_at = ? WHERE tournament_id = ? AND num = ?').bind(when, when, when, made.id, g.num);
      }),
    ]);
    return { ...made, stage };
  }
  if (stage === 'zip89_ld_semis') {
    // The 4 teams tonight (zip 57's game1 night), started about 18 minutes ago; Round 1's two games in at 13 and 14 minutes, as Enter score writes them.
    const made = await dayStage(ctx, group, 'game1');
    const start = Math.max(0, Math.floor((nowMin - 18) / 5) * 5);
    const startMs = startMsOf(made.date!, start, tz);
    const { results } = await ctx.db.prepare('SELECT num, court, slot_a, slot_b FROM tournament_games WHERE tournament_id = ? AND round = 1').bind(made.id).all<{ num: number; court: number; slot_a: string; slot_b: string }>();
    await ctx.db.batch([
      ctx.db.prepare('UPDATE tournaments SET start_minutes = ?, updated_at = ? WHERE id = ?').bind(start, ctx.nowIso, made.id),
      ...results.map((g) => {
        const when = iso(startMs + (12 + g.court) * 60_000);
        return ctx.db
          .prepare("UPDATE tournament_games SET winner = 'a', score_a = 11, score_b = ?, result_at = ?, result_by = 'players', seat_a = ?, seat_b = ?, updated_at = ? WHERE tournament_id = ? AND num = ?")
          .bind(5 + g.court * 2, when, Number(g.slot_a.slice(1)), Number(g.slot_b.slice(1)), when, made.id, g.num);
      }),
    ]);
    return { ...made, stage };
  }
  if (stage === 'zip89_break') {
    const made = await dayStage(ctx, group, 'game1');
    const start = Math.max(0, Math.floor((nowMin - 45) / 5) * 5);
    const startMs = startMsOf(made.date!, start, tz);
    const { results } = await ctx.db.prepare('SELECT num, round, court, slot_a, slot_b FROM tournament_games WHERE tournament_id = ? AND round <= 2').bind(made.id).all<{ num: number; round: number; court: number; slot_a: string; slot_b: string }>();
    await ctx.db.batch([
      ctx.db.prepare('UPDATE tournaments SET start_minutes = ?, updated_at = ? WHERE id = ?').bind(start, ctx.nowIso, made.id),
      ...results.map((g) => {
        // Round 1 after the warm-up (about 25 minutes in), Round 2 a minute ago (Court 1) and a minute and a half ago (Court 2).
        const when = g.round === 1 ? iso(startMs + (23 + g.court) * 60_000) : iso(ctx.nowMs - (g.court === 1 ? 60_000 : 90_000));
        return ctx.db
          .prepare("UPDATE tournament_games SET winner = 'a', score_a = 11, score_b = ?, result_at = ?, result_by = 'players', seat_a = ?, seat_b = ?, updated_at = ? WHERE tournament_id = ? AND num = ?")
          .bind(5 + g.court * 2, when, Number(g.slot_a.slice(1)), Number(g.slot_b.slice(1)), when, made.id, g.num);
      }),
    ]);
    return { ...made, stage };
  }
  // zip89_bo3: the round robin in (pools_done, Net Ninjas 3-0 ... Dill With It 0-3), the semifinals and the best of 3 written by the bonus's own
  // code, the semifinals in (1st and 2nd win), the Final's Game 1 in (Net Ninjas 11 to 8, 5 minutes ago): Game 2 and 3rd place on the courts.
  const made = await dayStage(ctx, group, 'pools_done', BY_ORDER);
  const id = made.id!;
  const t = (await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<TournamentRow>())!;
  const wrote = (await writeSemis(ctx.db, t, await loadDay(ctx.db, id), iso(ctx.nowMs - 40 * 60_000))) && (await writeBestOf3(ctx.db, t, await loadDay(ctx.db, id), iso(ctx.nowMs - 25 * 60_000)));
  if (!wrote) throw new HttpError(500, 'stage_failed', 'The bonus rows were not written.');
  const day = await loadDay(ctx.db, id);
  const semis = day.games.filter((g) => g.stage === 'semi');
  const fin = day.games.filter((g) => g.stage === 'final').sort((a, b) => a.num - b.num)[0];
  const ago = (m: number) => iso(ctx.nowMs - m * 60_000);
  await ctx.db.batch([
    // Semifinals: 1st (Net Ninjas) beat 4th (Dill With It) 11 to 6; 2nd (Third Shot Gang) beat 3rd (Kitchen Crew) 11 to 9.
    ...semis.map((g) =>
      ctx.db
        .prepare("UPDATE tournament_games SET winner = 'a', score_a = 11, score_b = ?, result_at = ?, result_by = 'players', seat_a = ?, seat_b = ?, updated_at = ? WHERE id = ?")
        .bind(g.court === 1 ? 6 : 9, ago(g.court === 1 ? 22 : 21), g.court === 1 ? 1 : 2, g.court === 1 ? 4 : 3, ago(21), g.id),
    ),
    ctx.db
      .prepare("UPDATE tournament_games SET winner = 'a', score_a = 11, score_b = 8, result_at = ?, result_by = 'players', seat_a = 1, seat_b = 2, updated_at = ? WHERE id = ?")
      .bind(ago(5), ago(5), fin.id),
  ]);
  return { ...made, stage };
}

/** Zip 88: the night card's stages (ZIP88_STAGES above), on the existing nights. */
async function zip88Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip88Stage) {
  if (stage === 'zip88_soon') {
    const made = await americanoStage(ctx, group, 'am_before');
    const tz = group.timezone;
    const now = localParts(ctx.nowMs, tz);
    const start = Math.min(23 * 60 + 59, now.hour * 60 + now.minute + 20);
    const today = todayKey(ctx.nowMs, tz);
    await ctx.db.batch([
      ctx.db.prepare('UPDATE tournaments SET final_date = ?, offered_dates = ?, start_minutes = ?, updated_at = ? WHERE id = ?').bind(today, JSON.stringify([today]), start, ctx.nowIso, made.id),
      ctx.db.prepare('UPDATE tournament_signups SET dates = ? WHERE tournament_id = ?').bind(JSON.stringify([today]), made.id),
    ]);
    return { ...made, stage, date: today };
  }
  if (stage === 'zip88_ready') {
    // Teams published (the real Publish rows), then the night moved to later today: today's date, the start about 2 hours from now.
    const made = await dayStage(ctx, group, 'teams_published');
    const tz = group.timezone;
    const now = localParts(ctx.nowMs, tz);
    const start = Math.min(23 * 60 + 55, Math.ceil((now.hour * 60 + now.minute + 120) / 5) * 5);
    const today = todayKey(ctx.nowMs, tz);
    await ctx.db.batch([
      ctx.db.prepare('UPDATE tournaments SET final_date = ?, offered_dates = ?, start_minutes = ?, updated_at = ? WHERE id = ?').bind(today, JSON.stringify([today]), start, ctx.nowIso, made.id),
      ctx.db.prepare('UPDATE tournament_signups SET dates = ? WHERE tournament_id = ?').bind(JSON.stringify([today]), made.id),
    ]);
    return { ...made, stage, date: today };
  }
  if (stage === 'zip88_final') {
    const made = await zip58Stage(ctx, group, 'final_on');
    await ctx.db
      .prepare("UPDATE tournament_games SET play_to = 7, updated_at = ? WHERE tournament_id = ? AND stage IN ('final', 'third') AND winner IS NULL AND skipped = 0")
      .bind(ctx.nowIso, made.id)
      .run();
    return { ...made, stage };
  }
  if (stage === 'zip88_sitting') return { ...(await americanoStage(ctx, group, 'am_break')), stage };
  const made = await americanoStage(ctx, group, 'am_round3');
  // Court 1's Round 3 game in 3 minutes ago (as a player's Enter score writes it): rolling courts find no game Court 1 may start, so it waits.
  const g = await ctx.db
    .prepare("SELECT num, slot_a FROM tournament_games WHERE tournament_id = ? AND round = 3 ORDER BY court, num LIMIT 1")
    .bind(made.id)
    .first<{ num: number; slot_a: string }>();
  if (g) {
    const when = new Date(ctx.nowMs - 3 * 60_000).toISOString();
    await ctx.db
      .prepare("UPDATE tournament_games SET claim = NULL, claim_by = ?, claim_at = ?, score_a = 11, score_b = 7, winner = 'a', result_at = ?, result_by = 'players', updated_at = ? WHERE tournament_id = ? AND num = ?")
      .bind(g.slot_a.split('+')[0], when, when, when, made.id, g.num)
      .run();
  }
  return { ...made, stage };
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 58: ties, the Final, End tournament and the records (see ZIP58_STAGES above). Seats: 1 Net Ninjas, 2 Third Shot Gang, 3 Kitchen Crew,
// 4 Dill With It (zip 57's DAY_TEAMS).
// ---------------------------------------------------------------------------------------------------------------------

/** tie3: Kitchen Crew (3) beats everyone; Net Ninjas (1) beats Dill With It (4), Dill With It beats Third Shot Gang (2), Third Shot Gang beats Net Ninjas. */
const TIE3 = (a: number, b: number) => (a === 3 || b === 3 ? 3 : [a, b].sort().join() === '1,4' ? 1 : [a, b].sort().join() === '2,4' ? 4 : 2);
/** final_on: Net Ninjas 3-0, Third Shot Gang 2-1, Kitchen Crew 1-2, Dill With It 0-3 (picture 22's games for Vic). */
const ORDER = [1, 2, 3, 4];
const BY_ORDER = (a: number, b: number) => (ORDER.indexOf(a) < ORDER.indexOf(b) ? a : b);

async function zip58Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip58Stage) {
  const tie = stage === 'tie3' || stage === 'zip82_tie';
  // Zip 82: the night's 2nd place credit is $0 (as the tournament page saved it for Locked doubles before Zip 82, and as on live): Edit awards'
  // Suggested and Use these set it.
  const made = await dayStage(ctx, group, 'pools_done', tie ? TIE3 : BY_ORDER, tie ? EVEN_SCORE : USUAL_SCORE);
  const id = made.id!;
  if (stage === 'tie3' || stage === 'final_on') return { ...made, stage };
  if (stage === 'zip82_tie') {
    // The organizer's spin, the real code (the wheel's answer is random): Game A and Game B are written.
    const t = (await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<EndRow>())!;
    const night = await readNight(ctx, t);
    const key = adminDayView(t, 'doubles', night.signups, night.tickets, night.day, group.timezone, ctx.nowMs).ties?.[0]?.key;
    if (!key) throw new HttpError(500, 'stage_failed', 'No tie to spin.');
    await spinTie(ctx, group, t, night.day, key, 'organizer');
    return { ...made, stage };
  }
  // The Final (Net Ninjas beat Third Shot Gang 11 to 6) and 3rd place (Dill With It beat Kitchen Crew 11 to 8), as a first score writes them.
  const iso = (minsAgo: number) => new Date(ctx.nowMs - minsAgo * 60_000).toISOString();
  const day = (await ctx.db.prepare("SELECT num, stage FROM tournament_games WHERE tournament_id = ? AND stage IN ('final', 'third')").bind(id).all<{ num: number; stage: string }>()).results;
  await ctx.db.batch(
    day.map((g) =>
      ctx.db
        .prepare("UPDATE tournament_games SET winner = ?, score_a = ?, score_b = ?, result_at = ?, result_by = 'players', seat_a = ?, seat_b = ?, updated_at = ? WHERE tournament_id = ? AND num = ?")
        .bind(g.stage === 'final' ? 'a' : 'b', g.stage === 'final' ? 11 : 8, g.stage === 'final' ? 6 : 11, iso(4), g.stage === 'final' ? 1 : 3, g.stage === 'final' ? 2 : 4, iso(4), id, g.num),
    ),
  );
  if (stage === 'final_done') return { ...made, stage };
  // Confirm winners and end, by the real code (the awards as the card shows them: $14 each, a medal each, 1 week).
  const t = (await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<EndRow>())!;
  const night = await readNight(ctx, t);
  const plan = endPlan(t, 'doubles', night.signups, night.tickets, night.day, group.timezone, ctx.nowMs, await organizerIdOf(ctx.db, group));
  if (!plan) throw new HttpError(500, 'stage_failed', 'The Final is not in.');
  await writeEnd(ctx, group, t, night, plan);
  if (stage === 'ended') return { ...made, stage };
  // history: two older finished Americano nights (no money: the credit of a night long gone is not made up), their results and medals.
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const past = (days: number) => todayKeyMinus(ctx.nowMs, group.timezone, days);
  const old = [
    { name: 'Summer Slam', date: past(129), names: ['Vic', 'Parker', 'Rowan', 'Sage', 'Wren', 'Quinn', 'Zoe', 'Christopher Vanderberg', 'Reese', 'Alex'] },
    { name: 'Spring Fling', date: past(227), names: ['Parker', 'Vic', 'Rowan', 'Sage', 'Wren', 'Quinn', 'Zoe', 'Reese'] },
  ];
  const statements = [];
  for (const o of old) {
    const tid = newId();
    const at = `${o.date}T23:00:00.000Z`;
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date, status,
             visibility, created_at, updated_at, format, second_credit_cents, ended_at, end_key, banner_until)
           VALUES (?, ?, ?, ${STORED_PLAN.size}, 2, 150, 1170, 1600, 1400, ?, ?, 'ended', 'all', ?, ?, 'americano', 700, ?, ?, ?)`,
        )
        .bind(tid, group.id, o.name, JSON.stringify([o.date]), o.date, at, at, at, newId(), at),
    );
    o.names.forEach((name, i) => {
      const pid = idOf.get(name);
      if (!pid) return;
      statements.push(
        ctx.db
          .prepare(
            `INSERT INTO tournament_results (id, tournament_id, player_id, finish, wins, losses, points, picked_level, approved_level, medal, award, credit_cents, seen_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 300, NULL, ?, ?, 0, ?, ?)`,
          )
          .bind(newId(), tid, pid, i + 1, Math.max(0, 5 - i), Math.min(5, i), 60 - i * 4, i === 0 ? 1 : 0, i === 0 ? 'champion' : i === 1 ? 'second' : null, at, at),
      );
    });
  }
  await ctx.db.batch(statements);
  return { ...made, stage };
}

/** Zip 90's stages (see ZIP90_STAGES): the night as the stage left it, the prize boxes written in (both styles), then End by the real code. */
/** Round 4: how many gold medals each name gets on "Header: medal counts". */
const MEDAL_COUNTS: Record<string, number> = { Vic: 1, Wren: 2, Parker: 3, Quinn: 4, Sage: 7 };

async function zip90Counts(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>) {
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const names = ['Harvest Cup', 'Pumpkin Smash', 'Turkey Trot', 'Frost Open', 'Snow Slam', 'Maple Masters', 'Leaf Bash'];
  const statements = [];
  for (const [k, name] of names.entries()) {
    const tid = newId();
    const date = todayKeyMinus(ctx.nowMs, group.timezone, 30 + k * 14);
    const at = `${date}T23:00:00.000Z`;
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date, status,
             visibility, created_at, updated_at, format, second_credit_cents, ended_at, end_key, banner_until)
           VALUES (?, ?, ?, ${STORED_PLAN.size}, 2, 150, 1170, 1600, 0, ?, ?, 'ended', 'all', ?, ?, 'americano', 0, ?, ?, ?)`,
        )
        .bind(tid, group.id, name, JSON.stringify([date]), date, at, at, at, newId(), at),
    );
    let place = 0;
    for (const [who, n] of Object.entries(MEDAL_COUNTS)) {
      const pid = idOf.get(who);
      if (!pid || n <= k) continue;
      place++;
      statements.push(
        ctx.db
          .prepare(
            `INSERT INTO tournament_results (id, tournament_id, player_id, finish, wins, losses, points, picked_level, approved_level, medal, award, credit_cents, seen_at, created_at)
             VALUES (?, ?, ?, ?, 5, 0, 60, 300, NULL, 1, 'champion', 0, ?, ?)`,
          )
          .bind(newId(), tid, pid, place, at, at),
      );
    }
  }
  await ctx.db.batch(statements);
  return { ok: true, stage: 'zip90_counts' };
}

async function zip90Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip90Stage) {
  if (stage === 'zip90_counts') return zip90Counts(ctx, group);
  const am = stage === 'zip90_am';
  const made = am ? await americanoStage(ctx, group, 'am_done') : await zip58Stage(ctx, group, 'final_done');
  const id = made.id!;
  const boxes = am
    ? { doubles: { first: 0, second: 0 }, americano: { first: 0, second: 0 } }
    : { doubles: { first: 1400, second: stage === 'zip90_second' ? 700 : 0 }, americano: { first: 1400, second: 700 } };
  const row = (await ctx.db.prepare('SELECT award_pick FROM tournaments WHERE id = ?').bind(id).first<{ award_pick: string | null }>())!;
  // The replay night carries a marker in its award settings (read by nothing but the replay stage), so a later pick finds it.
  const pick = stage === 'zip90_replay' ? JSON.stringify({ ...JSON.parse(withPrizes(row.award_pick, boxes)), stage: 'zip90_replay' }) : withPrizes(row.award_pick, boxes);
  await ctx.db
    .prepare('UPDATE tournaments SET award_pick = ?, champion_credit_cents = ?, second_credit_cents = ? WHERE id = ?')
    .bind(pick, am ? 0 : 1400, am ? 0 : boxes.doubles.second, id)
    .run();
  const t = (await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<EndRow>())!;
  const night = await readNight(ctx, t);
  const plan = endPlan(t, am ? 'americano' : 'doubles', night.signups, night.tickets, night.day, group.timezone, ctx.nowMs, await organizerIdOf(ctx.db, group));
  if (!plan) throw new HttpError(500, 'stage_failed', 'The night is not over.');
  await writeEnd(ctx, group, t, night, plan);
  // Americano: the reveal's hold is over (Reveal tapped 10 minutes ago), so the card is there at once.
  if (am) await ctx.db.prepare('UPDATE tournaments SET ended_at = ? WHERE id = ?').bind(new Date(ctx.nowMs - 10 * 60_000).toISOString(), id).run();
  if (stage !== 'zip90_header') return { ...made, stage };
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const chris = idOf.get('Christopher Vanderberg');
  const date = todayKeyMinus(ctx.nowMs, group.timezone, 60);
  const at = `${date}T23:00:00.000Z`;
  const tid = newId();
  const statements = [ctx.db.prepare('UPDATE tournament_results SET seen_at = ? WHERE tournament_id = ? AND award IS NOT NULL').bind(ctx.nowIso, id)];
  if (chris) {
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date, status,
             visibility, created_at, updated_at, format, second_credit_cents, ended_at, end_key, banner_until)
           VALUES (?, ?, 'Pumpkin Smash', ${STORED_PLAN.size}, 2, 150, 1170, 1600, 1400, ?, ?, 'ended', 'all', ?, ?, 'americano', 700, ?, ?, ?)`,
        )
        .bind(tid, group.id, JSON.stringify([date]), date, at, at, at, newId(), at),
      ctx.db
        .prepare(
          `INSERT INTO tournament_results (id, tournament_id, player_id, finish, wins, losses, points, picked_level, approved_level, medal, award, credit_cents, seen_at, created_at)
           VALUES (?, ?, ?, 1, 5, 0, 60, 300, NULL, 1, 'champion', 0, ?, ?)`,
        )
        .bind(newId(), tid, chris, at, at),
      ctx.db
        .prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) VALUES (?, ?, ?, 'kept', 1400, 0, NULL, ?, ?)")
        .bind(newId(), group.id, chris, at, TEST_CREDIT),
    );
  }
  await ctx.db.batch(statements);
  return { ...made, stage };
}

/**
 * Zip 77's stages (see ZIP77_STAGES): Zip 61's night, then Reveal standings by the real code (endPlan and writeEnd, exactly what the organizer's
 * tap runs), moved in time only by its ended_at (the reveal's clock): 6 seconds after the stage tap, or 10 minutes before it.
 */
async function zip77Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip77Stage) {
  const made = await americanoStage(ctx, group, stage === 'zip77_last' ? 'am_standings' : 'am_done');
  if (stage === 'zip77_last' || stage === 'zip77_allin') return { ...made, stage };
  const t = (await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(made.id).first<EndRow>())!;
  const night = await readNight(ctx, t);
  const plan = endPlan(t, 'americano', night.signups, night.tickets, night.day, group.timezone, ctx.nowMs, await organizerIdOf(ctx.db, group));
  if (!plan) throw new HttpError(500, 'stage_failed', 'The last round is not in.');
  await writeEnd(ctx, group, t, night, plan);
  const tapMs = stage === 'zip77_running' ? ctx.nowMs + 6_000 : ctx.nowMs - 10 * 60_000;
  await ctx.db.prepare('UPDATE tournaments SET ended_at = ? WHERE id = ?').bind(new Date(tapMs).toISOString(), made.id).run();
  return { ...made, stage, tapMs };
}

/**
 * Zip 79's stages (see ZIP79_STAGES). The results stages are Zip 77's revealed night (Americano) or Zip 58's ended night (Locked doubles), made
 * by the real End, then moved back a day or two by their dates only (the date, the reveal's tap, the ticker's end a week after it).
 */
async function zip79Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip79Stage): Promise<{ ok?: boolean; id?: string; stage: string }> {
  if (stage === 'zip79_skills') {
    await pastLevels(ctx, group);
    return { ok: true, stage };
  }
  if (stage === 'zip79_prev') {
    const made = (await tournamentTestStage(ctx, { stage: 'signup' })) as { id?: string };
    await pastLevels(ctx, group);
    return { ...made, stage };
  }
  const ld = stage === 'zip79_night_ld' || stage === 'zip79_next_day_ld';
  const made = ld ? await zip58Stage(ctx, group, 'ended') : await zip77Stage(ctx, group, 'zip77_revealed');
  const id = made.id!;
  const back = stage === 'zip79_gone' ? 2 : stage === 'zip79_next_day' || stage === 'zip79_next_day_ld' ? 1 : 0;
  const tapMs = ctx.nowMs - back * 86_400_000 - (back ? 0 : 30 * 60_000);
  const date = todayKeyMinus(ctx.nowMs, group.timezone, back);
  await ctx.db
    .prepare('UPDATE tournaments SET final_date = ?, offered_dates = ?, ended_at = ?, banner_until = ? WHERE id = ?')
    .bind(date, JSON.stringify([date]), new Date(tapMs).toISOString(), new Date(tapMs + 7 * 86_400_000).toISOString(), id)
    .run();
  return { ...made, stage };
}

/** Zip 79: the five finished tournaments of the skills history, oldest first (days back) and each player's level (hundredths; null: missed it). */
const PAST = [
  { name: 'Spring Fling', days: 245 },
  { name: 'Summer Slam', days: 160 },
  { name: 'Harvest Cup', days: 100 },
  { name: 'Pumpkin Smash', days: 50 },
  { name: 'Turkey Trot', days: 16 },
];
const PAST_LEVELS: Record<string, (number | null)[]> = {
  Sage: [275, 300, 300, 320, 340],
  Quinn: [250, 250, 275, 300, 300],
  Wren: [300, 320, 320, 320, 320],
  Zoe: [300, 300, 275, 275, 275],
  'Christopher Vanderberg': [300, 300, null, 300, 300],
  Parker: [360, 360, 360, 360, 360],
  Rowan: [350, 350, 350, 350, 350],
  Vic: [300, 300, 300, 300, 300],
  Alex: [340, 340, 340, 340, 340],
  Reese: [null, null, null, null, 275],
};
/** Vic picked 3.2 at the last one and the organizer set 3.0 (so his previous rating is the organizer's 3.0, not his own pick). */
const PAST_PICKED: Record<string, number> = { Vic: 320 };

async function pastLevels(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>) {
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const statements = [];
  for (const [k, o] of PAST.entries()) {
    const tid = newId();
    const date = todayKeyMinus(ctx.nowMs, group.timezone, o.days);
    const at = `${date}T23:00:00.000Z`;
    // No medals, no awards and the ticker long over: these only feed the levels (and History > Tournaments).
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date, status,
             visibility, created_at, updated_at, format, second_credit_cents, ended_at, end_key, banner_until)
           VALUES (?, ?, ?, ${STORED_PLAN.size}, 2, 150, 1170, 1600, 1400, ?, ?, 'ended', 'all', ?, ?, 'americano', 700, ?, ?, ?)`,
        )
        .bind(tid, group.id, o.name, JSON.stringify([date]), date, at, at, at, newId(), at),
    );
    let place = 0;
    for (const [name, levels] of Object.entries(PAST_LEVELS)) {
      const pid = idOf.get(name);
      const level = levels[k];
      if (!pid || level === null) continue;
      place++;
      const last = k === PAST.length - 1;
      const picked = last && PAST_PICKED[name] ? PAST_PICKED[name] : level;
      const approved = picked === level ? null : level;
      statements.push(
        ctx.db
          .prepare(
            `INSERT INTO tournament_results (id, tournament_id, player_id, finish, wins, losses, points, picked_level, approved_level, medal, award, credit_cents, seen_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)`,
          )
          .bind(newId(), tid, pid, place, Math.max(0, 6 - place), Math.min(5, place - 1), 60 - place * 4, picked, approved, at, at),
      );
    }
  }
  await ctx.db.batch(statements);
}

/** The Eastern calendar day `days` before today, 'YYYY-MM-DD'. */
function todayKeyMinus(nowMs: number, tz: string, days: number): string {
  const p = dayParts(todayKey(nowMs, tz));
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - days));
  return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}


/** Zip 70: the first Tuesday at least 7 days from today (Eastern), as 'YYYY-MM-DD' (The Cold Open is a Tuesday). */
function tuesdayAhead(nowMs: number, tz: string): string {
  const t = dayParts(todayKey(nowMs, tz));
  for (let i = 7; i < 14; i++) {
    const d = new Date(Date.UTC(t.year, t.month - 1, t.day + i));
    if (d.getUTCDay() === 2) return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return todayKey(nowMs, tz);
}

/** Zip 70's stages (see ZIP70_STAGES): The Cold Open as on live, with real money rows on the fake database (confirmed cash, Alex's $0 seat). */
async function zip70Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip70Stage) {
  const tz = group.timezone;
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const date = tuesdayAhead(ctx.nowMs, tz);
  const p = dayParts(date);
  const offered = [-7, 0, 2, 7].map((n) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
    return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  });
  const finalize = stage === 'zip70_finalize';
  const plays = stage === 'zip70_loss' ? { start: 19 * 60, minutes: 180 } : { start: 19 * 60 + 30, minutes: 150 };
  const payBy = stage === 'zip70_late' ? new Date(ctx.nowMs - 3_600_000).toISOString() : defaultPayBy(date, plays.start, tz, ctx.nowMs);
  const id = newId();
  const t0 = ctx.nowMs - 3 * 86_400_000;
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents, pay_by, format_source)
         VALUES (?, ?, 'The Cold Open', ${STORED_PLAN.size}, 2, ?, ?, 1800, 0, ?, ?, ?, 'all', ?, ?, ?, ?, 'doubles', 0, ?, NULL)`,
      )
      .bind(
        id,
        group.id,
        finalize ? STORED_PLAN.minutes : plays.minutes,
        finalize ? STORED_PLAN.start : plays.start,
        JSON.stringify(offered),
        finalize ? null : date,
        finalize ? 'signup' : 'tickets',
        at(0),
        ctx.nowIso,
        finalize ? null : at(5),
        at(1),
        finalize ? null : payBy,
      ),
  ];
  // 8 can make the date (zip70_late adds Quinn, paid, so 8 are locked in there).
  const going = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Wren', 'Vic', 'Zoe', ...(stage === 'zip70_late' || stage === 'zip70_finalize' ? ['Quinn'] : [])];
  const listed = [...going, 'Reese'];
  let n = 0;
  for (const name of listed) {
    const pid = idOf.get(name);
    if (!pid) continue;
    n++;
    const level = CAST.find((c) => c.name === name)?.level ?? MORE_CAST[name] ?? 320;
    const dates = name === 'Reese' ? offered.filter((d) => d !== date) : [date];
    statements.push(
      ctx.db
        .prepare("INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at) VALUES (?, ?, ?, 'in', ?, NULL, ?, ?, ?, ?)")
        .bind(newId(), id, pid, level, JSON.stringify(dates), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7)),
      ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, level, at(10 + n * 7)),
    );
  }
  if (!finalize) {
    const organizerId = await organizerIdOf(ctx.db, group);
    // zip70_late: 8 locked in (Vic paid late, Zoe did not): a drop now takes it below 8.
    const paid = stage === 'zip70_late' ? going.filter((x) => x !== 'Zoe') : going.filter((x) => x !== 'Vic' && x !== 'Zoe');
    let k = 0;
    for (const name of paid) {
      const pid = idOf.get(name);
      if (!pid) continue;
      k++;
      const free = pid === organizerId;
      const paidAt = at(200 + k * 11);
      statements.push(
        ctx.db
          .prepare(
            `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, paid_at, created_at, updated_at)
             VALUES (?, ?, ?, 'spot', ?, ?, 0, ?, ?, ?, ?)`,
          )
          .bind(newId(), id, pid, paidAt, free ? 0 : 1800, free ? 0 : 1800, paidAt, paidAt, paidAt),
      );
    }
  }
  if (stage === 'zip70_moved') {
    // The very rows the Time box writes (server/tournament.ts moveTournamentTime): the new end, the players' card (was 10 PM), a History line.
    statements.push(
      ctx.db.prepare('UPDATE tournaments SET minutes = 120 WHERE id = ?').bind(id),
      ctx.db
        .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) VALUES (?, ?, NULL, ?, 'mark', ?, ?)")
        .bind(newId(), group.id, `tournament_time:${id}`, JSON.stringify({ fs: plays.start, fm: plays.minutes, ts: plays.start, tm: 120 }), ctx.nowIso),
      ctx.db
        .prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) VALUES (?, ?, NULL, 'organizer', 'tournament_time', ?, ?)")
        .bind(newId(), group.id, JSON.stringify({ tournament: 'The Cold Open', from: '7:30 to 10 PM', to: '7:30 to 9:30 PM' }), ctx.nowIso),
    );
  }
  await ctx.db.batch(statements);
  return { ok: true, stage, format: 'doubles', id, signedUp: n, date: finalize ? null : date, firstDate: offered[0] };
}

/** The flyers' hours (Zip 81). Fixed dates: they are the venue's real 2026 to 2027 dates. */
export const FLYER_HOURS = (() => {
  const week = (close: number) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: 8 * 60, close: d === 0 ? 19 * 60 : close }));
  return [
    { id: 'pv-winter', name: 'Winter hours', from: '2026-11-23', to: '2027-01-31', oneDay: false, week: week(23 * 60) },
    { id: 'pv-thanks', name: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26', oneDay: true, day: { open: 8 * 60, close: 12 * 60 } },
    { id: 'pv-xeve', name: 'Christmas Eve', from: '2026-12-24', to: '2026-12-24', oneDay: true, day: { open: 8 * 60, close: 14 * 60 } },
    { id: 'pv-xmas', name: 'Christmas', from: '2026-12-25', to: '2026-12-25', oneDay: true, day: null },
    { id: 'pv-nye', name: 'New Year’s Eve', from: '2026-12-31', to: '2026-12-31', oneDay: true, day: { open: 8 * 60, close: 23 * 60 } },
    { id: 'pv-nyd', name: 'New Year’s Day', from: '2027-01-01', to: '2027-01-01', oneDay: true, day: { open: 8 * 60, close: 23 * 60 } },
  ];
})();

async function venueStage(ctx: Ctx, group: GroupRow, stage: VenueStage) {
  const fresh = await ctx.db.prepare('SELECT settings_json FROM groups WHERE id = ?').bind(group.id).first<{ settings_json: string | null }>();
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(fresh?.settings_json || '{}') as Record<string, unknown>;
  } catch {
    obj = {};
  }
  obj.venueHours = { specials: stage === 'venue_winter' ? FLYER_HOURS : [] };
  await ctx.db.prepare('UPDATE groups SET settings_json = ? WHERE id = ?').bind(JSON.stringify(obj), group.id).run();
  if (stage === 'venue_none') return { ok: true, stage };
  // A plain game on Thu Nov 26 at 8 to 10 PM (Eastern), on the organizer's list: the one the amber card is about.
  const tz = group.timezone;
  const startsAt = new Date(zonedTimeToUtc(2026, 11, 26, 20, 0, tz)).toISOString();
  const endsAt = new Date(zonedTimeToUtc(2026, 11, 26, 22, 0, tz)).toISOString();
  const dayFrom = new Date(zonedTimeToUtc(2026, 11, 26, 0, 0, tz)).toISOString();
  const dayTo = new Date(zonedTimeToUtc(2026, 11, 27, 0, 0, tz)).toISOString();
  const games = (await ctx.db.prepare("SELECT id, starts_at, status FROM sessions WHERE group_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at").bind(group.id, dayFrom, dayTo).all<{ id: string; starts_at: string; status: string }>()).results;
  const live = games.find((g) => g.status !== 'canceled');
  let id = live?.id ?? null;
  if (live && live.starts_at !== startsAt) {
    await ctx.db.prepare('UPDATE sessions SET starts_at = ?, ends_at = ?, planned_starts_at = ?, updated_at = ? WHERE id = ?').bind(startsAt, endsAt, startsAt, ctx.nowIso, live.id).run();
  }
  if (!id) {
    id = newId();
    await ctx.db
      .prepare(
        `INSERT INTO sessions (id, group_id, starts_at, ends_at, planned_starts_at, cancellation_deadline_at, is_extra, note, shown_early, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)`,
      )
      .bind(id, group.id, startsAt, endsAt, startsAt, new Date(Date.parse(startsAt) - 12 * 3_600_000).toISOString(), ctx.nowIso, ctx.nowIso)
      .run();
  }
  // On the organizer's list (the calm preview hides empty games with the site's own "Hide from list" mark).
  await ctx.db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id = ? AND task = 'admin_hidden_game'").bind(group.id, id).run();
  return { ok: true, stage, id };
}

/** Zip 86: the Tuesday of the week `weeks` ahead (weeks start on Sunday, as the player's THIS WEEK / NEXT WEEK / LATER). */
function tuesdayOfWeek(nowMs: number, tz: string, weeks: number): string {
  const t = dayParts(todayKey(nowMs, tz));
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day - t.weekday + 7 * weeks + 2));
  return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Zip 86's stages (see ZIP86_STAGES), on Zip 70's The Cold Open (the real rows the screens read). */
async function zip86Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip86Stage) {
  const tz = group.timezone;
  const made = await zip70Stage(ctx, group, 'zip70_start');
  const id = (made as { id: string }).id;
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const t = await ctx.db.prepare('SELECT final_date FROM tournaments WHERE id = ?').bind(id).first<{ final_date: string }>();
  const was = t!.final_date;
  const at = (n: number) => new Date(ctx.nowMs - 86_400_000 + n * 60_000).toISOString();
  const statements: ReturnType<Ctx['db']['prepare']>[] = [];
  if (stage === 'zip86_payments' || stage === 'zip86_home') {
    // 4 haven't paid: Vic and Zoe (zip70_start), plus Quinn on the list and Reese able to make the date. 10 expected (the Plan's saved number).
    const quinn = idOf.get('Quinn');
    if (quinn) {
      statements.push(
        ctx.db
          .prepare("INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at) VALUES (?, ?, ?, 'in', 330, NULL, ?, ?, ?, ?)")
          .bind(newId(), id, quinn, JSON.stringify([was]), at(1), at(1), at(1)),
      );
    }
    statements.push(
      ctx.db.prepare("UPDATE tournament_signups SET dates = ? WHERE tournament_id = ? AND player_id = (SELECT id FROM players WHERE group_id = ? AND display_name = 'Reese')").bind(JSON.stringify([was]), id, group.id),
      ctx.db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) VALUES (?, ?, NULL, ?, 'mark', '10', ?)").bind(newId(), group.id, `tournament_expect:${id}`, ctx.nowIso),
    );
  } else {
    // The night moves to next week's Tuesday (zip86_next) or the week after next (the three 2-week stages); everyone on the list can make it.
    const day = tuesdayOfWeek(ctx.nowMs, tz, stage === 'zip86_next' ? 1 : 2);
    const offered = [day];
    statements.push(
      ctx.db.prepare('UPDATE tournaments SET final_date = ?, offered_dates = ?, pay_by = ? WHERE id = ?').bind(day, JSON.stringify(offered), defaultPayBy(day, 19 * 60 + 30, tz, ctx.nowMs), id),
      ctx.db.prepare('UPDATE tournament_signups SET dates = ? WHERE tournament_id = ?').bind(JSON.stringify(offered), id),
    );
  }
  if (statements.length) await ctx.db.batch(statements);
  if (stage === 'zip86_home') await zip86Games(ctx, group, idOf);
  return { ok: true, stage, id };
}

/** Zip 87's stages (see ZIP87_STAGES): Zip 86's payments card, then the date, Pay by, who paid, the teams and the prizes moved to the moment. */
async function zip87Stage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: Zip87Stage) {
  const tz = group.timezone;
  const made = await zip86Stage(ctx, group, 'zip86_payments');
  const id = made.id;
  if (stage === 'zip87_early' || stage === 'zip87_prizes') return { ...made, stage };
  const today = dayParts(todayKey(ctx.nowMs, tz));
  const plus = (n: number) => {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + n));
    return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  };
  const now = localParts(ctx.nowMs, tz);
  const nowMin = now.hour * 60 + now.minute;
  const gameDay = stage === 'zip87_gameday' || stage === 'zip87_allset';
  // Game day: 7:30 PM, or (later in the evening) the next half hour at least an hour away, so the night has not started; never past midnight.
  const start = gameDay ? Math.min(Math.max(19 * 60 + 30, Math.ceil((nowMin + 60) / 30) * 30), 23 * 60) : 19 * 60 + 30;
  const minutes = gameDay ? Math.min(150, 24 * 60 - start) : 150;
  const date = stage === 'zip87_payday' ? plus(1) : gameDay ? plus(0) : plus(2);
  const payByIso =
    stage === 'zip87_payday'
      ? new Date(zonedTimeToUtc(today.year, today.month, today.day, nowMin < 19 * 60 ? 19 : 23, nowMin < 19 * 60 ? 0 : 30, tz)).toISOString()
      : stage === 'zip87_paid'
        ? new Date(zonedTimeToUtc(today.year, today.month, today.day + 1, 19, 0, tz)).toISOString()
        : new Date(ctx.nowMs - 3_600_000).toISOString();
  const payers = stage === 'zip87_payday' || stage === 'zip87_past' ? ['Vic', 'Zoe'] : ['Vic', 'Zoe', 'Quinn', 'Reese'];
  const at = (n: number) => new Date(ctx.nowMs - 2 * 86_400_000 + n * 60_000).toISOString();
  const statements: ReturnType<Ctx['db']['prepare']>[] = [
    ctx.db.prepare('UPDATE tournaments SET final_date = ?, offered_dates = ?, pay_by = ?, start_minutes = ?, minutes = ? WHERE id = ?').bind(date, JSON.stringify([date]), payByIso, start, minutes, id),
    ctx.db.prepare("UPDATE tournament_signups SET dates = ? WHERE tournament_id = ? AND status = 'in'").bind(JSON.stringify([date]), id),
  ];
  payers.forEach((name, i) => {
    const paidAt = at(i + 1);
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, paid_at, created_at, updated_at)
           SELECT ?, ?, p.id, 'spot', ?, 1800, 0, 1800, ?, ?, ? FROM players p WHERE p.group_id = ? AND p.display_name = ?`,
        )
        .bind(newId(), id, paidAt, paidAt, paidAt, paidAt, group.id, name),
    );
  });
  if (stage === 'zip87_allset') {
    // The prizes as the Prizes sheet saves them (both boxes in the award settings, the planned style's in the columns).
    statements.push(
      ctx.db
        .prepare('UPDATE tournaments SET champion_credit_cents = 1400, second_credit_cents = 0, award_pick = ? WHERE id = ?')
        .bind(JSON.stringify({ prizes: { doubles: [1400, 0], americano: [1400, 700] } }), id),
    );
  }
  await ctx.db.batch(statements);
  if (stage === 'zip87_allset') {
    // The real organizer taps: Draft teams, then Publish.
    const day = await import('./tournamentDay');
    const on = { ...ctx, params: { id } } as Ctx;
    await day.teamsAction(on, { action: 'draft' });
    await day.teamsAction(on, { action: 'publish' });
  }
  return { ok: true, stage, id };
}

/**
 * Zip 86 (picture 10): two games this week on the organizer's Home, made with the real organizer actions (the same calls the screens send):
 * tonight at 8 PM (tomorrow when it is 7 PM or later) booked, court 4, Alex In with Parker, Sage and Christopher Vanderberg, all paid; the next day
 * at 8 PM not booked, Rowan only, no court. Each is shown on the list (the calm preview hides games with the site's own "Hide from list" mark).
 */
async function zip86Games(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, idOf: Map<string, string>) {
  const admin = await import('./admin');
  const tz = group.timezone;
  const now = localParts(ctx.nowMs, tz);
  const first = new Date(Date.UTC(now.year, now.month - 1, now.day + (now.hour >= 19 ? 1 : 0)));
  const ids: string[] = [];
  for (const add of [0, 1]) {
    const d = new Date(first.getTime() + add * 86_400_000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dd = d.getUTCDate();
    const startsAt = new Date(zonedTimeToUtc(y, m, dd, 20, 0, tz)).toISOString();
    const endsAt = new Date(zonedTimeToUtc(y, m, dd, 22, 0, tz)).toISOString();
    const dayFrom = new Date(zonedTimeToUtc(y, m, dd, 0, 0, tz)).toISOString();
    const dayTo = new Date(zonedTimeToUtc(y, m, dd, 23, 59, tz)).toISOString();
    const games = (await ctx.db.prepare('SELECT id, starts_at, status FROM sessions WHERE group_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at').bind(group.id, dayFrom, dayTo).all<{ id: string; starts_at: string; status: string }>()).results;
    // The day's other games (and any canceled one) leave the list, so the day shows just this one.
    for (const g of games) {
      await ctx.db.prepare("INSERT OR IGNORE INTO task_log (id, group_id, session_id, task, kind, detail, at) VALUES (?, ?, ?, 'admin_hidden_game', 'mark', NULL, ?)").bind(newId(), group.id, g.id, ctx.nowIso).run().catch(() => {});
    }
    const live = games.find((g) => g.status !== 'canceled');
    let id = live?.id ?? null;
    if (id) {
      // A fresh start: nobody on it, no court number.
      await ctx.db.batch([
        ctx.db.prepare('DELETE FROM session_players WHERE session_id = ?').bind(id),
        ctx.db.prepare("UPDATE sessions SET starts_at = ?, ends_at = ?, planned_starts_at = ?, status = 'planned', booking_status = 'needs_booking', updated_at = ? WHERE id = ?").bind(startsAt, endsAt, startsAt, ctx.nowIso, id),
      ]);
    } else {
      id = newId();
      await ctx.db
        .prepare(
          `INSERT INTO sessions (id, group_id, starts_at, ends_at, planned_starts_at, cancellation_deadline_at, is_extra, note, shown_early, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)`,
        )
        .bind(id, group.id, startsAt, endsAt, startsAt, new Date(Date.parse(startsAt) - 12 * 3_600_000).toISOString(), ctx.nowIso, ctx.nowIso)
        .run();
    }
    await ctx.db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id = ? AND task = 'admin_hidden_game'").bind(group.id, id).run();
    ids.push(id);
  }
  const on = (sid: string) => ({ ...ctx, params: { id: sid } }) as Ctx;
  const [tonight, next] = ids;
  // Each call is the real organizer action; one that the fake world refuses (a switch off, a rule) is skipped, so the stage still loads.
  const tryIt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      /* skipped */
    }
  };
  await tryIt(() => admin.setCourtStatus(on(tonight), { status: 'booked' }));
  await tryIt(() => admin.setCourtNumber(on(tonight), { court: 4 }));
  await tryIt(() => admin.organizerInOut(on(tonight), { in: true }));
  for (const name of ['Parker', 'Sage', 'Christopher Vanderberg']) {
    const pid = idOf.get(name);
    if (!pid) continue;
    await tryIt(() => admin.editRoster(on(tonight), { playerId: pid, action: 'confirm' }));
    await tryIt(() => admin.setPayment(on(tonight), { playerId: pid, paid: true }));
  }
  // Never Vic, Wren or Zoe on a game that ends before the next re-seed (docs/PREVIEW_FAKE_DB.md: their unpaid counts stay 1, 2 and 3).
  const rowan = idOf.get('Rowan');
  if (rowan) await tryIt(() => admin.editRoster(on(next), { playerId: rowan, action: 'confirm' }));
  await tryIt(() => admin.setCourtStatus(on(next), { status: 'not_booked' }));
}
