// Zip 55, PREVIEW BUILDS ONLY: Settings > Schedule > "Tournament test". This file is built only into a preview (SettingsTab.tsx loads it behind
// `__PREVIEW_BUILD__`, which is false in every live build), and its server half (POST /api/admin/tournament-test, server/tournamentTest.ts)
// answers Not found anywhere but a preview. One button per stage puts the fake tournament back to that stage with the preview's fixed names;
// "View as" opens the player page as one of them (the preview's ?as=Name link: real taps on the fake database) or goes back to Admin.
import { useState } from 'react';
import { api } from '../../lib';
import { Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { dayLong } from '../../../shared/tournament';
import './tournament-admin.css';

/**
 * Zip 83 (Alex, Nov 24; SITE_RULES "Tournament test list"): the page shows only the stages of the zip being tested. Every older stage, and the
 * older look tools (Ball look, Pools look), sit behind one small "All tests" link at the bottom. The next zip changes THIS_ZIP to its own.
 */
const THIS_ZIP: readonly string[] = ['history', 'zip83_none'];

const STAGES = [
  // Zip 83 (🎾83.champions): the gold cup and the Champions wall. "History with tournaments" (below) has three past winners: the cup on every
  // header, the wall (The Cold Open's Vic and Wren reigning; Summer Slam's Vic and Spring Fling's Parker below).
  { stage: 'history', label: 'Champions: three past winners (start here)', line: 'The Cold Open ended tonight (Net Ninjas: Vic + Wren), plus Summer Slam (Vic) and Spring Fling (Parker). The gold cup sits left of light/dark here and on every player’s Home: tap it for Champions. Also History > Tournaments; Players > Vic: TOURNAMENTS (two medals).' },
  { stage: 'zip83_none', label: 'Champions: none', line: 'The Cold Open as on live, tickets open, nobody has won yet: no cup on any header (Home, View as Vic).' },
  // Zip 82 (🎾82.night admin): standings before the reveal, the scoreboards, suggested prizes, tap a medal. Also: Americano: Round 3 (start
  // here), Americano: last round in, Final done: End tournament, History with tournaments (below).
  { stage: 'zip82_tie', label: 'Tie game on (All games)', line: 'Three teams level, the wheel already spun: Game A is on, Game B up next. Home: All games shows Needs a score and the Game A card.' },
  // Zip 81 (🎾81.venue hours): special venue hours (no tournament).
  { stage: 'venue_winter', label: 'Venue hours: winter set and holidays (start here)', line: 'The flyers’ hours: Winter hours Nov 23 to Jan 31, Thanksgiving 8 AM to noon, Christmas Eve, Christmas Closed, New Year’s Eve and Day. A game on Thu Nov 26 at 8 PM: Home shows “Thu Nov 26: the venue closes at noon.” with Cancel game. Settings > Schedule > Special venue hours > Change.' },
  { stage: 'venue_none', label: 'Venue hours: none', line: 'Normal hours only: no special entries, no amber card. Settings > Schedule > Special venue hours says None; Add special hours from there.' },
  // Zip 79 (🎾79.results skills): the results row (both styles; the row's time: the night and the whole next day) and the skills history.
  { stage: 'zip79_night', label: 'Results: the night after the reveal (start here)', line: 'Americano, revealed 30 minutes ago. View as Vic: the final board once (X closes it), then one row: The Cold Open and Standings, Your rounds under it. Tap Standings: the final board; X closes it.' },
  { stage: 'zip79_night_ld', label: 'Results: the night after End (Locked doubles)', line: 'Ended tonight by the real Confirm. View as Vic: the row with Your games under it. Standings lists the teams, Net Ninjas first with the gold medal. View as Reese (did not play): the row alone.' },
  { stage: 'zip79_next_day', label: 'Results: the day after', line: 'The same night, yesterday. View as Vic: the row alone at the top of Home, above THIS WEEK, until midnight tonight.' },
  { stage: 'zip79_next_day_ld', label: 'Results: the day after (Locked doubles)', line: 'The Locked doubles night, yesterday: the row alone at the top of Home; Standings lists the teams.' },
  { stage: 'zip79_gone', label: 'Results: two days after (gone)', line: 'The night two days ago: no row on Home. The winners ticker keeps its own week.' },
  { stage: 'zip79_skills', label: 'Skills history', line: 'Five finished tournaments over eight months. History > Skills: Most improved (Sage +0.7, Quinn +0.5, Wren +0.2), the Levels table (sort Level, Improved, Name). Tap a name: the trend.' },
  { stage: 'zip79_prev', label: 'Sign-up with a previous rating', line: 'Skills history plus Winter Classic, sign-up open. View as Vic, Sign up: 3.0 is picked, PREVIOUS RATING. Pick 3.4 and tap Next: the level up, then the dates.' },
  // Zip 77 (🎾77.reveal): Americano's hidden standings and the standings reveal, on the 10 player Americano night (Vic sits Round 4).
  { stage: 'zip77_last', label: 'Americano: last round (standings hidden)', line: 'Tonight, Rounds 1 to 5 in, Round 6 on. View as Vic: no Standings card, “Standings will be revealed at the end of the night.” at the bottom. Home: the scores as before.' },
  { stage: 'zip77_allin', label: 'Americano: all games in', line: 'Every round in, Vic first. View as Vic: no kicker, a thin divider, “Final standings coming soon” with three bouncing balls. Home: Edit awards, then Reveal standings (it plays on every phone).' },
  { stage: 'zip77_running', label: 'Americano: reveal running (as Vic)', line: 'Revealed by the real button, starting 6 seconds after this tap. View as Vic right away: the countdown, then last place up to Vic in 1st with the gold medal. Open it on a second phone: the same frame.' },
  { stage: 'zip77_revealed', label: 'Americano: revealed', line: 'Revealed 10 minutes ago. View as Vic: the final board once (the X closes it), then the final standings, the ticker, You won The Cold Open and the medal.' },
  // Zip 74 (🎾74.polish): game night polish. The team name, the Final alert and the back out sheet use the stages below (Teams published,
  // Final, Time and Plan, Late drop).
  { stage: 'zip74_short', label: 'Play to 9 (start here)', line: 'Tonight, Game 1 in, and from Round 2 on games go to 9. View as Vic: the amber alert at the top (X hides it), Play to 9 points on the Up next card, Play to 9 on Games 2 and 3. Also: Final (Vic: You’re in the Final!), Teams published (Edit name), Time and Plan and Late drop (Parker: Drop out).' },
  // Zip 72 (🎾72.scores): scores in Locked doubles, one tie rule everywhere.
  { stage: 'zip72_scores', label: 'Scores in Locked doubles', line: 'Tonight, Game 1 on both courts, no scores yet. View as Vic: Enter score, the team names, Submit score (5 seconds to Undo). Then view as Parker: Lost 7–11, Standings −4 pts. Home: Fix on any game, two numbers, Save.' },
  { stage: 'zip72_circle', label: 'Three-way circle, settled by points', line: 'Every round robin game in. Kitchen Crew 3-0; the other three 1-2 in a circle, ranked by point difference (0, −2, −9 pts). No wheel: the Final is Kitchen Crew vs Net Ninjas.' },
  // Zip 71 (🎾71.teams): the first answer counts (no confirming) and Projected teams on the Levels card.
  { stage: 'zip71_taps', label: 'First score counts', line: 'Tonight, Game 1, no scores yet. View as Vic: Enter score (5 seconds to Undo). Then view as Wren or Parker: Game 1 is in, no buttons, nothing to answer. Home: Done, Fix.' },
  { stage: 'zip71_am', label: 'First score counts: Americano', line: 'Tonight, Round 1, no scores yet. View as Vic: Enter score, Submit. Then view as anyone in his game: the score is in, no Enter score, nothing to answer.' },
  { stage: 'zip71_teams', label: 'Projected teams', line: 'The pictures’ 8 on the list, the vote open. Home: open the card, Edit, then the last row of Levels: Projected teams. Change a level with the pencil: the open list follows.' },
  // Zip 70 (🎾70.time): The Cold Open as it is on live ($18, credits $0, 2 courts, 7:30 to 10 PM, a Tuesday a week or more out). The format above does not apply.
  { stage: 'zip70_start', label: 'Time and Plan (start here)', line: 'Like live: 6 locked in of 8, Vic and Zoe unpaid. Home: open the card: Time 7:30 to 10 PM, Plan 8 players, You make if it fills +$6. Tap Time (move the end, Save), tap Plan (Expect, Courts, Save). View as Vic: 7:30 PM / to 10 PM on the ticket.' },
  { stage: 'zip70_loss', label: 'Time and Plan: it would cost you', line: 'The same, 7:00 to 10:00 PM (3 hours): Your cost if it fills, in red, no minus.' },
  { stage: 'zip70_moved', label: 'Time moved (players’ card)', line: 'The end moved to 9:30 PM. View as Vic: The Cold Open now ends at 9:30 PM (was 10 PM), with an X; the ticket says to 9:30 PM.' },
  { stage: 'zip70_late', label: 'Late drop (8 locked in, Pay by passed)', line: 'Pay by an hour ago, 8 locked in. View as Parker, Drop out: no credit back unless someone takes your spot (two lines). Dropping keeps the $18 until someone pays for the spot.' },
  { stage: 'zip70_finalize', label: 'Finalize for 9', line: 'Sign-up open, 9 can make one date. As you: Edit, Pick the date, tap it: Time, Courts, Pay by, Americano for 9 and the money line.' },
  // Zip 58 (🎾58.tourney4): ties, the Final, End tournament and the records. "The Cold Open", Locked doubles, the four teams (Net Ninjas Vic and
  // Wren, Third Shot Gang Parker and Quinn, Kitchen Crew Rowan and Zoe, Dill With It Sage and Christopher), tonight. The format above does not apply.
  { stage: 'tie3', label: 'Dead-level tie among three teams', line: 'Kitchen Crew 3-0, the other three 1-2 in a circle, every game 11 to 7 (level on every rule: the last resort). Home: the wheel, tap it to spin (or view as Rowan). Then Game A and Game B to 5. View as Vic: Tied for the final, then Playoff.' },
  { stage: 'final_on', label: 'Final', line: 'The Final (Net Ninjas vs Third Shot Gang) and 3rd place on court 2. View as Vic: Enter score and Also now · Court 2 · 3rd place. His score is the result at once: Home shows End tournament.' },
  { stage: 'final_done', label: 'Final done: End tournament', line: 'Net Ninjas won the Final, Dill With It 3rd place. Home: Final is done, End tournament, Edit awards, Confirm winners and end.' },
  { stage: 'ended', label: 'Tournament ended', line: 'Ended by the real Confirm: Vic and Wren each have $14 credit and a medal. View as Vic: the ticker, You won The Cold Open, the medal by the name.' },
  // History with tournaments: the Zip 83 row at the top (its own row; also History > Tournaments, Players > Vic: TOURNAMENTS, Vic's two medals).
  { stage: 'am_done', label: 'Americano: last round in', line: 'Every round in, Vic first. Home: Round 6 is done, End tournament with 1st and 2nd place, Edit awards.' },
  // Zip 61 (🎾61.americano): the Americano night. "The Cold Open", Americano, all 10 names locked in, courts 1 and 2, 2.5 hours (6 rounds to 11,
  // 2 sit each round). Vic plays Rounds 1 to 3, sits Round 4, plays 5 and 6. The format above does not apply.
  { stage: 'am_round3', label: 'Americano: Round 3 (start here)', line: 'Tonight, Round 3 on both courts; every Round 2 score is in. View as Vic: Enter score, Submit (the motion, Undo). Then view as one of Vic’s opponents: the score is in, nothing to answer.' },
  { stage: 'am_before', label: 'Americano: before the night', line: 'Two days from now. View as Vic: the ticket, then Your rounds (Round 4 is a break).' },
  { stage: 'am_round1', label: 'Americano: Round 1', line: 'Tonight, started a minute ago, nothing entered. View as Vic: Round 1 with Enter score.' },
  { stage: 'am_break', label: 'Americano: a break', line: 'Rounds 1 to 3 in, Round 4 on. View as Vic: On break until Round 5, who else sits, every court under Currently playing.' },
  { stage: 'am_standings', label: 'Americano: after Round 5', line: 'Rounds 1 to 5 in, Round 6 on: the points table after Round 5. Home: the scores, Fix, Player left.' },
  { stage: 'am_switched', label: 'Americano: switched from Locked doubles', line: 'Locked doubles, 9 locked in after Pay by (Reese did not pay), two days from now: it switches to Americano. View as Vic: Tournament style is now Americano, and Your rounds.' },
  // Zip 57 (🎾57.tourney3): teams and game day. "The Cold Open", Locked doubles, 8 locked in: Net Ninjas (Vic, Wren), Dill With It (Sage,
  // Christopher), Kitchen Crew (Rowan, Zoe), Third Shot Gang (Parker, Quinn); courts 1 and 2. The format above does not apply.
  { stage: 'day_ready', label: 'Game night, no teams yet', line: 'Tonight, started 10 minutes ago, 8 locked in. Home: Draft teams, then Publish teams. View as Vic: Game 1 with Enter score. View as Parker: Game 1 is in, nothing to answer.' },
  { stage: 'teams_drafted', label: 'Teams drafted', line: 'The four teams drafted, not published (mock 15). Swap, rename a team, Redo the draw, Publish teams.' },
  { stage: 'teams_published', label: 'Teams published (two days before)', line: 'Published, the night two days from now. View as Vic: Your team, Your games with courts, All teams (mock 16).' },
  { stage: 'game1', label: 'Game 1', line: 'Tonight, started a minute ago, no results. View as Vic: Game 1 with Enter score (mock 17).' },
  { stage: 'mid', label: 'Mid-tournament (running behind)', line: 'Started 45 minutes ago, 7:30 to 9:30 PM. Vic entered 11 to 7 in Game 1: it is in (view as Parker: Lost 7–11, nothing to answer). Home: the Time check with one tap (mock 48).' },
  { stage: 'pools_done', label: 'All group games done', line: 'Every round robin game in, with scores: final standings with pts; the Final and the 3rd place game are set.' },
  { stage: 'backed_out', label: 'Player dropped out (odd count)', line: 'Teams published, then Zoe dropped out after Pay by: 7 locked in. Home: switched to Americano with Copy text for the group. Players: Tournament style is now Americano, no teams.' },
  // Zip 66 (🎾66.admincard): the organizer's card (one closed line, Votes, Not signed up) and the in-or-out alert.
  { stage: 'zip66_start', label: 'Start: the card, Votes, Not signed up', line: 'The Cold Open, the vote open, 8 on the list (Vic and Reese are not). Home: the card is one closed line. Tap it open, tap Votes, tap Not signed up, Copy reminder text. Edit: Plan, Levels (a pencil shows the dates), Pick the date (folded), Settings.' },
  { stage: 'missed_date', label: 'Date picked, Sage missed it', line: 'Finalized on a date Sage did not pick. View as Sage: The Cold Open is that day, Can you make it? I’m in opens the pay sheet; Can’t make it takes her off. Home: Not signed up lists Sage.' },
  // Zip 64 (🎾64.finalize): the short ticket, the style rules and late paying. These build "The Cold Open" (the format above does not apply).
  { stage: 'zip64_start', label: 'Start: short ticket and Finalize', line: 'The Cold Open, the vote open, 8 on the list (Plan: 10 players · 2 courts · 2.5 hours on your card). View as Vic: one wide Sign up (mock 00). View as Parker: See who’s signed up, Edit, Drop out (mock 01). As you: the tournament page, Pick the date (heat map), tap a date: Style, Plays, Pay by, Finalize date, then the venue reminder on Home.' },
  { stage: 'vote_open', label: 'Format vote open (3 on the list)', line: '3 on the list with mixed votes. View as Vic, Sign up: Step 2 of 2 · Your dates and the new line.' },
  { stage: 'vote_majority', label: 'Date finalized, style TBD', line: 'The date is set, Pay by not passed: every card says Tournament style TBD. View as Vic: Lock my spot · $16, Pay by on the right.' },
  { stage: 'style_even', label: 'Tickets closed: 10 locked in (even)', line: 'Pay by passed an hour ago, all 10 locked in: Locked doubles (the vote’s winner) stays.' },
  { stage: 'style_odd', label: 'Tickets closed: 9 locked in (odd)', line: 'Pay by passed, 9 locked in: it switches to Americano. Home: the switched card. View as Parker: Tournament style is now Americano. Vic can still pay (a spot is open).' },
  { stage: 'style_back', label: 'Odd, then a late payer makes 10', line: 'Switched to Americano at 9, then Vic paid late: 10. Home: Switch back to Locked doubles? Switch, or Not now. It never switches by itself.' },
  { stage: 'late_open', label: 'Late paying (Pay by passed, spots open)', line: '6 locked in, Pay by an hour ago. View as Vic: red Your payment is late, Pay now opens the Pay sheet. No fees.' },
  { stage: 'late_cut', label: '3 hours before the start', line: 'Today, starting in 2 hours: tickets are closed for Vic (no Pay now). Parker stays locked in.' },
  // Zip 63 (🎾63.tickets): the pay countdown at the top of Vic's Home. Each is Tickets open (6 paid) with Pay by set from now; the tournament is
  // the day after Pay by. View as Vic to see the alert; Pay opens the same sheet as Lock my spot.
  { stage: 'pay_3d', label: 'Countdown: 3 days left', line: 'Pay by is 7:00 PM three days from today. View as Vic: amber 3 days left to pay.' },
  { stage: 'pay_2d', label: 'Countdown: 2 days left', line: 'Pay by is 7:00 PM two days from today: amber 2 days left to pay.' },
  { stage: 'pay_1d', label: 'Countdown: due tomorrow', line: 'Pay by is 7:00 PM tomorrow: amber Payment due tomorrow.' },
  { stage: 'pay_today', label: 'Countdown: due today', line: 'Pay by is tonight, 6.5 hours or more from now: red Payment due today.' },
  { stage: 'pay_hours', label: 'Countdown: due in 5 hours', line: 'Pay by is 5 hours 20 minutes from now: red Due in 5 hours.' },
  { stage: 'pay_minutes', label: 'Countdown: due in 42 minutes', line: 'Pay by is 42 minutes from now: red Due in 42 minutes, counting down while Home is open.' },
  { stage: 'pay_late', label: 'Countdown: late', line: 'Pay by passed an hour ago and Wren dropped out after it (a spot is free): red Your payment is late, Pay now.' },
  { stage: 'pay_closed', label: 'Countdown: late, spots open', line: 'Pay by passed an hour ago, no drop out: since Zip 64 a spot is still open, so Vic sees Your payment is late with Pay now.' },
  // Zip 62 (🎾62.speed): The Cold Open as it is on live, to feel the speed (the format above does not apply).
  { stage: 'speed_check', label: 'Speed check (like live)', line: 'The Cold Open as on live: Everyone, the vote open, 9 on the list (everyone but you). Open Home and View as Vic: the card draws with the rest.' },
  // Zip 60 (🎾60.formatvote): the players vote the format. These build "The Cold Open" on Let players vote; the format above does not apply.
  { stage: 'vote_tie', label: 'Date locked, tie', line: 'Locked 1, Americano 1, Either 2: a tie, so the first tournament is Locked doubles. The alert says only the format.' },
  { stage: 'signup', label: 'Sign-up open (sign-up finish)', line: 'Everyone can see it. 6 on the list; Vic, Zoe, Reese and Alex are not. View as Vic, Sign up, watch the ticket punch. Pick the format above first.' },
  // Alex: picking the date opens tickets.
  { stage: 'date_picked', label: 'Date picked, tickets open', line: '8 on the list, Sage set to 3.4, the date most can play picked. Nobody has paid yet. Vic is not on the list.' },
  // Zip 56, piece 2. The spots follow the players locked in (6 to 16 since Zip 63); with the 10 names standby (after 16) cannot be shown.
  { stage: 'tickets_open', label: 'Tickets open, 6 paid', line: '6 locked in, 6 of 8. Vic, Zoe and Reese have no ticket yet: view as Vic to Lock my spot.' },
  { stage: 'all_locked', label: 'All locked in', line: 'All 10 names locked in (your own seat is free), 10 of 12.' },
  { stage: 'odd', label: '7 locked in after Pay by', line: 'Pay by has passed with 7 locked in: Home shows the evens warning.' },
  { stage: 'canceled', label: 'Canceled', line: '6 paid, then canceled: every paid ticket is credit now. Players who were on the list see Canceled.' },
  { stage: 'rescheduled', label: 'Rescheduled', line: '6 paid, then rescheduled: tickets stay held, players pick their dates again.' },
  // Zip 59: the polish piece. 
  { stage: 'closed', label: 'Pay by passed (6 paid)', line: 'Pay by passed an hour ago: no standby, but spots are open, so Vic can still pay late (Zip 64).' },
  { stage: 'hidden', label: 'Canceled and hidden', line: 'Out of Home. Settings, Advanced, Hidden tournaments lists it with Restore. Cancel above, then Hide, does the same.' },
  { stage: 'none', label: 'No tournament', line: 'Nothing open, to try Create tournament.' },
] as const;

/** Zip 63: the ball looks the 10 names cannot make (total, gold): the brief's 3, 8, 10, 12 and 16, and 14. */
const BALL_LOOKS: [number, number][] = [
  [3, 1],
  [8, 5],
  [10, 3],
  [12, 7],
  [14, 9],
  [16, 12],
];

/** What the tournament is at now, in a few words. */
const nowWords: Record<string, string> = {
  signup: 'Sign-up open',
  date_picked: 'Date picked',
  tickets: 'Tickets open',
  rescheduled: 'Rescheduled',
  canceled: 'Canceled',
};

export default function TournamentTestRow({ ctx, home }: { ctx: AdminCtx; home?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={home ? 'set-row-wrap tm-test-home' : 'set-row-wrap'} data-row="tournament-test">
      <button type="button" className="set-row tm-set-row" onClick={() => setOpen(true)} data-tm-test-row={home ? 'home' : 'settings'}>
        <span className="set-label">
          <span className="set-name">Tournament test</span>
          <span className="set-hint">Preview only</span>
        </span>
      </button>
      <Sheet calmFocus open={open} title="Tournament test" onClose={() => setOpen(false)} className="tm-page">
        {open && <TestBody ctx={ctx} />}
      </Sheet>
    </div>
  );
}

function TestBody({ ctx }: { ctx: AdminCtx }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const t = ctx.d.tournament ?? null;
  // Which format the stage buttons build (starts on the open tournament's).
  const [format, setFormat] = useState<'doubles' | 'americano'>(t?.format ?? 'doubles');
  // Zip 83: older stages and look tools behind the "All tests" link (closed each time the page opens).
  const [allTests, setAllTests] = useState(false);
  const now = t
    ? `${t.formatPending ? 'Players vote' : t.format === 'americano' ? 'Americano' : 'Locked doubles'} · ${nowWords[t.status] ?? 'Sign-up open'}${t.finalDate && (t.status === 'date_picked' || t.status === 'tickets') ? `: ${dayLong(t.finalDate)}` : ''}`
    : 'No tournament';
  async function go(stage: string, label: string) {
    if (busy) return;
    setBusy(stage);
    try {
      await api('POST', '/api/admin/tournament-test', { stage, format });
      await ctx.reload();
      toast(`${label}: ready`);
    } catch {
      toast("That didn’t work. Try again.", 'error');
    } finally {
      setBusy(null);
    }
  }
  async function who(visibility: 'me' | 'all') {
    if (!t || busy) return;
    setBusy(visibility);
    try {
      await api('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility });
      await ctx.reload();
      toast(visibility === 'all' ? 'Everyone can see it' : 'Only you can see it');
    } catch {
      toast("That didn’t work. Try again.", 'error');
    } finally {
      setBusy(null);
    }
  }
  const names = ctx.d.players.filter((p) => p.isActive).map((p) => p.name);
  const stageRow = (s: (typeof STAGES)[number]) => (
    <div key={s.stage} className="tm-test-stage">
      <button type="button" className={`btn block${s.stage === 'none' ? ' secondary' : ''}`} disabled={!!busy} onClick={() => void go(s.stage, s.label)} data-tm-stage={s.stage}>
        {busy === s.stage ? 'Working…' : s.label}
      </button>
      <p className="tm-card-note">{s.line}</p>
    </div>
  );
  return (
    <div className="tm-form stack" data-tm-test>
      <section className="tm-card" aria-label="Stage">
        <div className="tm-card-head">
          <h3 className="tm-label">Stage</h3>
          <span className="tm-chip" data-tm-test-now>
            {now}
          </span>
        </div>
        <div className="segmented tm-seg" role="group" aria-label="Format" data-tm-test-format>
          <button type="button" aria-pressed={format === 'doubles'} disabled={!!busy} onClick={() => setFormat('doubles')} data-tm-test-fmt="doubles">
            Locked doubles
          </button>
          <button type="button" aria-pressed={format === 'americano'} disabled={!!busy} onClick={() => setFormat('americano')} data-tm-test-fmt="americano">
            Americano
          </button>
        </div>
        <div className="stack" data-tm-test-current>
          {STAGES.filter((s) => THIS_ZIP.includes(s.stage)).map(stageRow)}
        </div>
      </section>
      {allTests && (
        <section className="tm-card" aria-label="All tests" data-tm-test-all>
          <div className="tm-card-head">
            <h3 className="tm-label">All tests</h3>
          </div>
          <div className="stack">{STAGES.filter((s) => !THIS_ZIP.includes(s.stage)).map(stageRow)}</div>
        </section>
      )}
      {t && (
        <section className="tm-card" aria-label="Who can see it">
          <div className="tm-card-head">
            <h3 className="tm-label">Who can see it</h3>
          </div>
          <div className="segmented tm-seg" role="group" aria-label="Who can see it">
            <button type="button" aria-pressed={t.visibility === 'me'} disabled={!!busy} onClick={() => void who('me')} data-tm-test-vis="me">
              Only me
            </button>
            <button type="button" aria-pressed={t.visibility === 'all'} disabled={!!busy} onClick={() => void who('all')} data-tm-test-vis="all">
              Everyone
            </button>
          </div>
        </section>
      )}
      {allTests && (
        <>
      {/* Zip 63: the preview has 10 names, so a real card never shows 12 to 16 balls. These links draw that many on Vic's card (look only, that
          page only); every other word and button is the real one. */}
      <section className="tm-card" aria-label="Ball look" data-tm-test-balls>
        <div className="tm-card-head">
          <h3 className="tm-label">Ball look</h3>
        </div>
        <div className="name-grid">
          {BALL_LOOKS.map(([n, g]) => (
            <a key={n} className="btn secondary" href={`/?as=Vic&balls=${n},${g}`} data-tm-test-ball={n}>
              {n} ({g} gold)
            </a>
          ))}
          <a className="btn secondary" href="/?as=Vic&balls=off" data-tm-test-ball="off">
            Real count
          </a>
        </div>
        <p className="tm-card-note">Look only, as Vic on that page: the card draws that many balls with that many gold. Start from a Tickets open stage. Any other link shows the real card.</p>
      </section>
      {/* Zip 57: 12 players cannot be made with the 10 names: this draws the 12 players pools night as Vic (look only, that page). */}
      <section className="tm-card" aria-label="Pools look" data-tm-test-pools>
        <div className="tm-card-head">
          <h3 className="tm-label">12 players pools</h3>
        </div>
        <a className="btn secondary block" href="/?as=Vic&poolslook=12" data-tm-test-pools-link>
          Pools look (12 players)
        </a>
        <p className="tm-card-note">Look only, as Vic: the Dink group and the Drive group (3 teams each, points once a score is in), The night. Start from a Game night stage. The 6th team is Kai + Guest (no 12th name on the preview).</p>
      </section>
        </>
      )}
      <section className="tm-card" aria-label="View as">
        <div className="tm-card-head">
          <h3 className="tm-label">View as</h3>
        </div>
        <div className="name-grid">
          {names.map((n) => (
            <a key={n} className="btn secondary" href={`/?as=${encodeURIComponent(n.split(' ')[0])}`} data-tm-view-as={n}>
              {n}
            </a>
          ))}
          <a className="btn" href="/admin" data-tm-view-as="admin">
            Admin
          </a>
        </div>
        <p className="tm-card-note">A name opens the player page as that player on this phone (real taps, fake data). Alex sees Only me.</p>
      </section>
      {/* Zip 83: every older stage and look tool, one small link at the bottom. */}
      <button type="button" className="tm-test-all-link" aria-expanded={allTests} onClick={() => setAllTests((x) => !x)} data-tm-test-all-link>
        {allTests ? 'Hide older tests' : 'All tests'}
      </button>
    </div>
  );
}
