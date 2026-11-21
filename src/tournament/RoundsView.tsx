// Zip 61 (🎾61.americano), the Americano night, the PLAYER side (pictures 31 to 37). Part of the tournament card's own download
// (src/tournament/TournamentHome.tsx), like zip 57's GameDayView, and built from its pieces: the slim hero bar, the big green VS card, the rows,
// the Standings look, Currently playing, the sheets, and the one result motion (useHeldResult: lime "✓ Let's go!" on a win, the white glow and
// "Onto the next!" on a loss, the slide, the Undo banner).
//   Before the night (31): Your rounds under the ticket.
//   The night (32 to 36): the hero ("Round 3 of 6"), the VS card with Enter score (or the dark break card), the Time check, Your rounds,
//   Standings (wins, then points), Currently playing. Enter score is the shared Final score sheet (GameDayView's ScoreSheet, Zip 72); Zip 71:
//   the first score from any of the 4 players is the result.
// Names only. No clock times except "Begins at" on Round 1.
import { useState } from 'react';
import type { PlayerRound, PlayerRoundsView, PlayerTournamentView } from '../../shared/tournament';
import { resultTag } from '../../shared/scores';
import { Court, DayHero, glue, type HeldScore, Matchup, PlayToPill, ScoreSheet, Slide, useHeldResult, useSeen } from './GameDayView';
import './gameday-tour.css';
import { DoneHero, RevealNight, StandingsLater, WaitingCard } from './Reveal';

const pair = (a: string, b: string) => `${a} + ${b}`;

/**
 * While a score is held for its 5 seconds (and after its lit second), this phone shows the round as done and the next one up, and the bar moves
 * on. The table waits for the real answer.
 */
function withHeld(day: PlayerRoundsView, held: HeldScore | null): PlayerRoundsView {
  if (!held || held.lit) return day;
  let first = true;
  const rounds = day.rounds.map((r): PlayerRound => {
    if (r.num === held.num) return { ...r, state: 'done', won: held.won, score: { mine: held.mine, theirs: held.theirs }, onNow: undefined };
    if (r.state === 'done') return r;
    const state = first ? ('next' as const) : ('later' as const);
    first = false;
    return { ...r, state };
  });
  const next = rounds.find((r) => r.state === 'next');
  return { ...day, rounds, progress: next ? { ...day.progress, label: `Round ${next.round} of ${day.progress.total}`, done: next.round - 1 } : day.progress };
}

/** One row of Your rounds (pictures 31 and 32): "Round 1 / Court 1" left, "With Christopher" and "vs Wren + Sage" right; a break says Break. */
function RoundRow({ r, set, plain }: { r: PlayerRound; set: boolean; plain?: boolean }) {
  // Before the night (picture 31) every row is plain white; on the night done rows are green and the next one blue (picture 32).
  return (
    <li className={`tc-gd-row tc-gd-game${plain ? '' : ` tc-gd-s-${r.state}`}${!plain && r.state === 'done' && r.won === false ? ' tc-gd-lost' : ''}${r.num === null ? ' tc-gd-break' : ''}`} data-tc-round={r.round} data-state={r.state}>
      <span className="tc-gd-left">
        <b>Round {r.round}</b>
        {r.num !== null && <Court n={r.court} set={set} />}
      </span>
      <span className="tc-gd-main">
        {r.num === null ? (
          <b>Break</b>
        ) : (
          <>
            <b>
              <span className="tc-gd-with">With {r.partner}</span>
              {r.state !== 'done' && !r.skipped && r.playTo < 11 && <PlayToPill to={r.playTo} />}
              {r.state === 'done' && r.won !== undefined && (
                <span className={r.won ? 'tc-gd-tag tc-gd-tag-won' : 'tc-gd-tag'} data-tc-day-result>
                  {resultTag(r.won, r.score)}
                </span>
              )}
            </b>
            <span>{r.skipped ? 'Off' : `vs ${pair(r.opponents![0], r.opponents![1])}`}</span>
          </>
        )}
      </span>
    </li>
  );
}

function RoundsCard({ day }: { day: PlayerRoundsView }) {
  if (!day.rounds.length) return null;
  return (
    <section className="tc-gd-card" aria-label="Your rounds" data-tc-rounds>
      <h3 className="tc-gd-label">Your rounds</h3>
      <ul className="tc-gd-rows">
        {day.rounds.map((r) => (
          <RoundRow key={r.round} r={r} set={day.courtsSet} plain={!day.today} />
        ))}
      </ul>
    </section>
  );
}

/** Standings (picture 32): rank, name, wins-losses, the points chip; their own row highlighted; "Tied" once the night is in. */
function PointsCard({ day }: { day: PlayerRoundsView }) {
  // Zip 77: players get no table before the reveal (the server sends none): no card at all, not even blank rows.
  if (day.standingsHidden || !day.standings.length) return null;
  return (
    <section className="tc-gd-card" aria-label="Standings" data-tc-day-standings>
      <div className="tc-gd-head">
        <h3 className="tc-gd-label">Standings</h3>
        {day.started && !day.final && <span className="tc-gd-chip tc-gd-live">Live</span>}
      </div>
      <ol className="tc-gd-rows">
        {day.standings.map((r) => (
          <li key={r.name} className={r.me ? 'tc-gd-row tc-gd-stand tc-gd-me' : r.out ? 'tc-gd-row tc-gd-stand tc-gd-out' : 'tc-gd-row tc-gd-stand'} data-tc-day-stand={r.name}>
            <span className="tc-gd-rank">{r.rank}</span>
            <span className="tc-gd-name tc-gd-pname">
              <b>{r.name}</b>
              {r.tied && <span className="tc-gd-tag">Tied</span>}
            </span>
            <span className="tc-gd-rec">{r.record.replace('-', ' - ')}</span>
            <span className="tc-gd-chip tc-gd-pts">{r.points} pts</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Currently playing (pictures 32 and 35): the other courts this round ("Wren + Alex vs Rowan + Zoe"); every court while you sit. */
function LiveCard({ day }: { day: PlayerRoundsView }) {
  if (!day.live.length) return null;
  return (
    <section className="tc-gd-card" aria-label="Currently playing" data-tc-day-live>
      <h3 className="tc-gd-label">Currently playing</h3>
      <ul className="tc-gd-rows">
        {day.live.map((x) => (
          <li key={`${x.round}-${x.court}`} className="tc-gd-row tc-gd-game tc-gd-liverow">
            <span className="tc-gd-left">
              <b>Round {x.round}</b>
              <Court n={x.court} set={day.courtsSet} />
            </span>
            <Matchup a={{ name: pair(x.a[0], x.a[1]), players: [] }} b={{ name: pair(x.b[0], x.b[1]), players: [] }} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The big green card (picture 32): "Round 3 · Court 1", "You + Parker" VS "Quinn + Reese", Enter score while the round is on. */
function RoundCard({ r, day, busy, lit, onEnter }: { r: PlayerRound; day: PlayerRoundsView; busy: boolean; lit: 'mine' | 'theirs' | null; onEnter: () => void }) {
  const first = r.round === 1 && !day.started;
  const kicker = first ? `Round 1 · Begins at ${glue(day.beginsAt)}` : r.onNow || lit ? `Round ${r.round} · Court ${r.court}` : `Up next · Round ${r.round} · Court ${r.court}`;
  return (
    <section className="tc-gd-next" aria-label={kicker} data-tc-day-next={r.num ?? undefined} data-tc-round-card={r.round}>
      <p className="tc-gd-next-kicker">{kicker}</p>
      {r.playTo < 11 && <PlayToPill to={r.playTo} big />}
      <Matchup a={{ name: pair('You', r.partner!), players: [] }} b={{ name: pair(r.opponents![0], r.opponents![1]), players: [] }} big lit={lit} />
      {(r.onNow || lit) && (
        <div className={lit === 'mine' ? 'tc-gd-next-btns tc-gd-next-lit' : lit === 'theirs' ? 'tc-gd-next-btns tc-gd-next-lost' : 'tc-gd-next-btns'}>
          <button type="button" className={lit === 'theirs' ? 'tc-gd-theywon' : 'tc-gd-wewon'} disabled={busy || !!lit} onClick={onEnter} data-tc-enter-score>
            {lit === 'mine' ? '✓ Let’s go!' : lit === 'theirs' ? 'Onto the next!' : 'Enter score'}
          </button>
        </div>
      )}
    </section>
  );
}

/** On a break (picture 35): the dark card. "Round 4 · Your break" / "On break until Round 5" / who else sits (nothing when alone). */
function BreakCard({ r, total }: { r: PlayerRound; total: number }) {
  const others = r.alsoOff ?? [];
  const also = others.length === 0 ? '' : others.length === 1 ? `${others[0]} is on break too.` : `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]} are on break too.`;
  return (
    <section className="tc-gd-hero tc-gd-breakcard" aria-label={`Round ${r.round}, your break`} data-tc-break={r.round}>
      <p className="tc-gd-next-kicker">Round {r.round} · Your break</p>
      <h3 className="tc-gd-next-title">{r.round < total ? `On break until Round ${r.round + 1}` : 'On break for the last round'}</h3>
      {also && <p className="tc-gd-next-sub">{also}</p>}
    </section>
  );
}

/** Everything the Americano night shows on Home (pictures 31 to 37). */
export function RoundsBody({ t, day: real, onChanged }: { t: PlayerTournamentView; day: PlayerRoundsView; onChanged: () => Promise<unknown> }) {
  const { busy, held, hold } = useHeldResult(t, onChanged);
  const [score, setScore] = useState<{ mine: number; theirs: number } | null>(null);
  const shown = withHeld(real, held && score ? { ...held, ...score } : null);
  const [noteSeen, hideNote] = useSeen(shown.leftNote?.key ?? null);
  // The score sheet, held to the round it was opened for (a refresh while it is open never moves it to another round).
  const [sheet, setSheet] = useState<{ r: PlayerRound } | null>(null);
  const litRound = held?.lit ? (real.rounds.find((r) => r.num === held.num) ?? null) : null;
  const next = litRound ?? shown.rounds.find((r) => r.state === 'next') ?? null;

  function submit(r: PlayerRound, mine: number, theirs: number) {
    setSheet(null);
    setScore({ mine, theirs });
    const won = mine > theirs;
    const winners = won ? pair('You', r.partner!) : pair(r.opponents![0], r.opponents![1]);
    hold(r.num!, won, { num: r.num, key: r.key, action: 'score', mine, theirs }, `${winners} won ${Math.max(mine, theirs)} to ${Math.min(mine, theirs)}`);
  }

  // Zip 77: Alex revealed the standings: the board on every phone in step, then the night's final standings.
  if (t.reveal && shown.final) {
    return (
      <div className="tc-gd stack" data-tc-day="revealed" data-tc-americano>
        <RevealNight t={t} day={shown} rounds={<RoundsCard day={shown} />} after={<PointsCard day={shown} />} />
      </div>
    );
  }
  if (!shown.today) {
    return (
      <div className="tc-gd stack" data-tc-day="before" data-tc-americano>
        <RoundsCard day={shown} />
      </div>
    );
  }
  return (
    <div className="tc-gd stack" data-tc-day="night" data-tc-americano>
      {/* Zip 77: every game in, not revealed yet: no kicker, a thin divider, then the waiting card where Up next was. */}
      {shown.waiting ? <DoneHero name={t.name} /> : <DayHero t={t} day={shown} />}
      {shown.leftNote && !noteSeen && (
        <section className="tc-gd-note" role="status" data-tc-day-left>
          <span>{shown.leftNote.text}</span>
          <button type="button" className="tc-gd-x" aria-label="Close" onClick={hideNote}>
            ×
          </button>
        </section>
      )}
      {shown.paused && (
        <p className="tc-gd-paused" role="status" data-tc-day-paused>
          Paused.
        </p>
      )}
      {shown.waiting && !next && <WaitingCard />}
      {next && (
        <Slide k={`${next.round}`}>
          {next.num === null ? (
            <BreakCard r={next} total={shown.progress.total} />
          ) : (
            <RoundCard r={next} day={shown} busy={busy || (!!held && !litRound)} lit={litRound ? (held!.won ? 'mine' : 'theirs') : null} onEnter={() => setSheet({ r: next })} />
          )}
        </Slide>
      )}
      {/* Zip 74: the shorter games alert at the top of Home says it, so no Time check line here too. */}
      {shown.timeNote && !shown.shortAlert && (
        <p className="tc-gd-tc" role="status" data-tc-day-time>
          <b>Time check.</b> {glue(shown.timeNote)}
        </p>
      )}
      <RoundsCard day={shown} />
      <PointsCard day={shown} />
      <LiveCard day={shown} />
      {shown.standingsHidden && <StandingsLater />}
      <ScoreSheet
        num={sheet?.r.num ?? null}
        open={sheet !== null}
        labels={[pair('You', sheet?.r.partner ?? ''), sheet?.r.opponents ? pair(sheet.r.opponents[0], sheet.r.opponents[1]) : '']}
        playTo={sheet?.r.playTo ?? 11}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={(mine, theirs) => {
          if (sheet) submit(sheet.r, mine, theirs);
        }}
      />
    </div>
  );
}
