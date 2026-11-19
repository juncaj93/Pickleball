// Zip 57 (🎾57.tourney3), "Tournaments" piece 3, the PLAYER side (mocks 16 to 19, 51 to 53). Part of the tournament card's own download
// (src/tournament/TournamentHome.tsx), so a phone without a tournament never fetches it.
//   Before the night: Your team, Your games (only theirs, each with its court), All teams; with pools (12 players and up), Pool A and Pool B with
//   where each team plays the first round, and The night's times.
//   Game night: the short card (the name, "Game 2 of 3", a slim bar), Up next with We won and "<other team> won" (a 5 second Undo, then the
//   other team is asked), "<team> won Game 1" with Undo, the Time check, Your games, Standings (or the pools), Currently playing, and the
//   other team's "Did you win?" sheet (Yes, they won / No, we won).
// No clock times except "Game 1 begins at" (and The night's times with pools, as mock 51 draws them). Names only.
import { useEffect, useRef, useState } from 'react';
import type { PlayerDayGame, PlayerDayView, PlayerTournamentView } from '../../shared/tournament';
import { api, ApiError, storageGet, storageSet, VIEW_ONLY_MESSAGE } from '../lib';
import { CourtMap } from '../GameDay';
import { Sheet, useToast } from '../ui';
import './gameday-tour.css';

/** How long We won waits before it is sent (the card's Undo). */
export const UNDO_MS = 5000;

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 && /view only/i.test(err.message) ? VIEW_ONLY_MESSAGE : err.message;
  return 'That did not work. Try again.';
}

/** Notes this phone has closed (a partner change, the Time check), by key. */
const SEEN_KEY = 'pb_tour_day_seen';
function seenList(): string[] {
  try {
    const v = JSON.parse(storageGet(SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function useSeen(key: string | null): [boolean, () => void] {
  const [list, setList] = useState(seenList);
  return [
    !!key && list.includes(key),
    () => {
      if (!key) return;
      const next = [...seenList().filter((x) => x !== key), key].slice(-30);
      try {
        storageSet(SEEN_KEY, JSON.stringify(next));
      } catch {
        /* shows again on this phone */
      }
      setList(next);
    },
  ];
}

/** The short card on game night (mocks 17 and 18): the name, where they are, a slim bar. Replaces the ticket on Home. */
export function DayHero({ t, day }: { t: PlayerTournamentView; day: PlayerDayView }) {
  const pct = day.progress.total ? Math.round((day.progress.done / day.progress.total) * 100) : 0;
  return (
    <section className="tc-gd-hero" aria-label={`${t.name}, ${day.progress.label}`} data-tc-day-hero>
      <div className="tc-gd-hero-top">
        <h2 className="tc-gd-hero-name">{t.name}</h2>
        <span className="tc-gd-kicker" data-tc-day-progress>
          {day.progress.label}
        </span>
      </div>
      <span className="tc-gd-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </section>
  );
}

/** "Court 9": a button that opens the court map once the organizer set the courts, else plain text. */
function Court({ n, set }: { n: number | null; set: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  if (n === null) return null;
  if (!set) return <span className="tc-gd-court">Court {n}</span>;
  return (
    <>
      <button ref={ref} type="button" className="tc-gd-court tc-gd-court-btn" aria-haspopup="dialog" aria-label={`Court ${n}, show it on the court map`} onClick={() => setOpen(true)} data-tc-day-court={n}>
        Court {n}
      </button>
      <CourtMap open={open} onClose={() => setOpen(false)} lit={n} anchor={ref} label={`Court map. This game is on Court ${n}.`} />
    </>
  );
}

/** The words of one game row (mock 16): "vs Third Shot Gang" and the players, or what decides a playoff. */
function rowWords(g: PlayerDayGame, org: string): { title: string; sub: string } {
  if (g.skipped) return { title: g.opponent ? `vs ${g.opponent.name}` : g.label, sub: 'Not played' };
  if (!g.opponent) return { title: g.pending ?? 'Not decided yet', sub: g.stage === 'final' ? 'Against the other finalist' : g.stage === 'semi' ? 'Against the other pool' : '' };
  const players = g.opponent.players.join(' + ');
  if (g.state === 'done' && g.won !== undefined) return { title: `${g.won ? 'Beat' : 'Lost to'} ${g.opponent.name}`, sub: players };
  return { title: `vs ${g.opponent.name}`, sub: g.disputed ? `Both teams say they won. ${org} decides.` : g.playTo !== 11 && g.stage === 'pool' ? `${players} · to ${g.playTo}` : players };
}

function GamesCard({ day, org }: { day: PlayerDayView; org: string }) {
  if (!day.games.length) return null;
  return (
    <section className="tc-gd-card" aria-label="Your games" data-tc-day-games>
      <h3 className="tc-gd-label">Your games</h3>
      <ul className="tc-gd-rows">
        {day.games.map((g) => {
          const w = rowWords(g, org);
          return (
            <li key={`${g.stage}-${g.num}`} className={`tc-gd-row tc-gd-game tc-gd-s-${g.state}`} data-tc-day-game={g.label} data-state={g.state}>
              <span className="tc-gd-left">
                <b>{g.label}</b>
                {g.opponent && <Court n={g.court} set={day.courtsSet} />}
              </span>
              <span className="tc-gd-main">
                <b>
                  {g.state === 'done' && g.won && <span className="tc-gd-tick" aria-hidden="true">✓ </span>}
                  {w.title}
                </b>
                {w.sub && <span>{w.sub}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StandingsCard({ day }: { day: PlayerDayView }) {
  const group = day.standings[0];
  if (!group) return null;
  return (
    <section className="tc-gd-card" aria-label="Standings" data-tc-day-standings>
      <div className="tc-gd-head">
        <h3 className="tc-gd-label">Standings</h3>
        {day.started && <span className="tc-gd-chip tc-gd-live">Live</span>}
      </div>
      <ol className="tc-gd-rows">
        {group.rows.map((r) => (
          <li key={r.name} className={r.me ? 'tc-gd-row tc-gd-stand tc-gd-me' : 'tc-gd-row tc-gd-stand'} data-tc-day-stand={r.name}>
            <span className="tc-gd-rank">{r.rank}</span>
            <span className="tc-gd-name">
              <TeamName name={r.name} players={r.players} />
            </span>
            <span className="tc-gd-rec">{r.record}</span>
            {r.tied ? <span className="tc-gd-chip">Tied</span> : r.me ? <span className="tc-gd-chip">You</span> : <span className="tc-gd-chip tc-gd-chip-empty" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Mocks 51 to 53: Pool A and Pool B, each team's record and where it plays this round (Court 9) or Sits. */
function PoolsCards({ day }: { day: PlayerDayView }) {
  return (
    <>
      {day.standings.map((grp) => (
        <section key={grp.pool ?? 'all'} className="tc-gd-card" aria-label={`Pool ${grp.pool}`} data-tc-day-pool={grp.pool}>
          <div className="tc-gd-head">
            <h3 className="tc-gd-label">Pool {grp.pool}</h3>
            <span className="tc-gd-chip tc-gd-chip-label">{grp.rows.length} teams</span>
          </div>
          <ol className="tc-gd-rows">
            {grp.rows.map((r) => (
              <li key={r.name} className={r.me ? 'tc-gd-row tc-gd-stand tc-gd-me' : 'tc-gd-row tc-gd-stand'} data-tc-day-stand={r.name}>
                <span className="tc-gd-rank">{r.rank}</span>
                <span className="tc-gd-name">
              <TeamName name={r.name} players={r.players} />
            </span>
                <span className="tc-gd-rec">{r.record}</span>
                {r.tied ? <span className="tc-gd-chip">Tied</span> : r.where ? <span className="tc-gd-chip">{r.where}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

function NightCard({ day }: { day: PlayerDayView }) {
  if (!day.night.length) return null;
  return (
    <section className="tc-gd-card" aria-label="The night" data-tc-day-night>
      <h3 className="tc-gd-label">The night</h3>
      <ul className="tc-gd-rows tc-gd-night">
        {day.night.map((n) => (
          <li key={n.label} className="tc-gd-row tc-gd-time">
            <span>{n.label}</span>
            <b>{n.time}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TeamsCard({ day }: { day: PlayerDayView }) {
  return (
    <section className="tc-gd-card" aria-label="All teams" data-tc-day-teams>
      <h3 className="tc-gd-label">All teams</h3>
      <ul className="tc-gd-rows">
        {day.teams.map((x) => (
          <li key={x.name} className={x.me ? 'tc-gd-row tc-gd-teamrow tc-gd-me' : 'tc-gd-row tc-gd-teamrow'} data-tc-day-team={x.name}>
            <span className="tc-gd-main">
              <b>{x.name}</b>
              <span>{x.players.join(' + ')}</span>
            </span>
            {x.me && <span className="tc-gd-you">You</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A team's name with its two players under it, smaller and grey (every place a team name shows). */
function TeamName({ name, players, big }: { name: string; players: string[]; big?: boolean }) {
  return (
    <span className={big ? 'tc-gd-tn tc-gd-tn-big' : 'tc-gd-tn'}>
      <b>{name}</b>
      <span>{players.join(' + ')}</span>
    </span>
  );
}

/** Two teams side by side with VS between them, each with its players under. */
function Matchup({ a, b, big }: { a: { name: string; players: string[] }; b: { name: string; players: string[] }; big?: boolean }) {
  return (
    <span className={big ? 'tc-gd-vs tc-gd-vs-big' : 'tc-gd-vs'}>
      <TeamName {...a} big={big} />
      <span className="tc-gd-vs-mark">VS</span>
      <TeamName {...b} big={big} />
    </span>
  );
}

const PENCIL = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M13.6 3.4l3 3L7 16H4v-3z" />
  </svg>
);
const DICE = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <rect x="3" y="3" width="14" height="14" rx="3.5" />
    <circle cx="7" cy="7" r="1.2" />
    <circle cx="13" cy="13" r="1.2" />
    <circle cx="10" cy="10" r="1.2" />
  </svg>
);

/**
 * Your team (Alex's PM, under the ticket before the night): the name big, the two players under it, and while Game 1 has not started a pencil (type
 * your own name: the name becomes a box with Save name) and a dice (roll a new suggestion). Either partner; the last save wins.
 */
function YourTeamCard({ t, day, onChanged }: { t: PlayerTournamentView; day: PlayerDayView; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  if (!day.team) return null;
  const team = day.team;
  async function save(name?: string) {
    setBusy(true);
    try {
      await api('POST', '/api/tournament/team-name', { tournamentId: t.id, ...(name !== undefined ? { name } : {}) });
      await onChanged();
      setEditing(false);
    } catch (err) {
      toast(errorText(err), 'error');
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) void onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tc-gd-card tc-gd-yourteam" aria-label={`Your team, ${team.name}`} data-tc-day-team-card>
      <h3 className="tc-gd-label">Your team</h3>
      {editing ? (
        <form
          className="tc-gd-yt-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void save(draft.trim());
          }}
        >
          <input className="tc-gd-yt-input" value={draft} maxLength={24} autoFocus onChange={(e) => setDraft(e.target.value)} aria-label="Team name" data-tc-team-input />
          <button type="submit" className="btn tc-gd-yt-save" disabled={busy || !draft.trim()} data-tc-team-save>
            Save name
          </button>
        </form>
      ) : (
        <div className="tc-gd-yt-row">
          <TeamName name={team.name} players={team.players} big />
          {team.canRename && (
            <span className="tc-gd-yt-btns">
              <button
                type="button"
                className="tc-gd-round"
                aria-label="Type a team name"
                disabled={busy}
                onClick={() => {
                  setDraft(team.name);
                  setEditing(true);
                }}
                data-tc-team-pencil
              >
                {PENCIL}
              </button>
              <button type="button" className="tc-gd-round" aria-label="Roll a new team name" disabled={busy} onClick={() => void save()} data-tc-team-dice>
                {DICE}
              </button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** Everything under the ticket (before the night) or the short card (game night). */
export function DayBody({ t, day, org, onChanged }: { t: PlayerTournamentView; day: PlayerDayView; org: string; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // We won (or "<other> won"): held for 5 seconds with Undo, then sent.
  const [held, setHeld] = useState<{ num: number; action: 'won' | 'lost'; label: string; vs: string; winner: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A We won still in its 5 seconds when the card goes away (the player leaves Home, the page closes): it is sent then, not lost.
  const pending = useRef<{ num: number; action: string } | null>(null);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const p = pending.current;
      if (p) void api('POST', '/api/tournament/game', { tournamentId: t.id, num: p.num, action: p.action }).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [noteSeen, hideNote] = useSeen(day.partnerNote?.key ?? null);
  async function send(num: number, action: string): Promise<boolean> {
    setBusy(true);
    try {
      await api('POST', '/api/tournament/game', { tournamentId: t.id, num, action });
      await onChanged();
      return true;
    } catch (err) {
      toast(errorText(err), 'error');
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) void onChanged();
      return false;
    } finally {
      setBusy(false);
    }
  }
  function hold(g: PlayerDayGame, action: 'won' | 'lost') {
    clearTimeout(timer.current);
    const mine = day.team?.name ?? 'Your team';
    const theirs = g.opponent?.name ?? 'the other team';
    setHeld({ num: g.num, action, label: g.label, vs: action === 'won' ? theirs : mine, winner: action === 'won' ? mine : theirs });
    pending.current = { num: g.num, action };
    timer.current = setTimeout(() => {
      pending.current = null;
      void send(g.num, action).then(() => setHeld(null));
    }, UNDO_MS);
  }
  const next = day.games.find((g) => g.state === 'next' && g.num !== held?.num) ?? null;
  const claimed = day.games.filter((g) => g.claimed).pop() ?? null;
  const ask = day.games.find((g) => g.askConfirm) ?? null;
  const [askSeen, setAskSeen] = useState<number | null>(null);
  const pools = day.pools;
  if (!day.today) {
    return (
      <div className="tc-gd stack" data-tc-day="before">
        <YourTeamCard t={t} day={day} onChanged={onChanged} />
        <GamesCard day={day} org={org} />
        {pools ? <PoolsCards day={day} /> : <TeamsCard day={day} />}
        {pools && <NightCard day={day} />}
      </div>
    );
  }
  return (
    <div className="tc-gd stack" data-tc-day="night">
      {day.partnerNote && !noteSeen && (
        <section className="tc-gd-note" role="status" data-tc-day-partner>
          <span>{day.partnerNote.text}</span>
          <button type="button" className="tc-gd-x" aria-label="Close" onClick={hideNote}>
            ×
          </button>
        </section>
      )}
      {day.paused && (
        <p className="tc-gd-paused" role="status" data-tc-day-paused>
          Paused. Hang tight.
        </p>
      )}
      {held ? (
        <WonCard title={`${held.winner} won ${held.label}`} sub={`vs ${held.vs}`} onUndo={() => {
            clearTimeout(timer.current);
            pending.current = null;
            setHeld(null);
          }} busy={false} />
      ) : (
        claimed && <WonCard title={`${day.team?.name ?? 'Your team'} won ${claimed.label}`} sub={`vs ${claimed.opponent?.name ?? ''}`} onUndo={() => void send(claimed.num, 'undo')} busy={busy} />
      )}
      {ask && !held && (
        <section className="tc-gd-ask" role="status" data-tc-day-ask={ask.num}>
          <span>
            {ask.opponent?.name} says they won {ask.label}.
          </span>
          <button type="button" className="tc-gd-ask-btn" onClick={() => setAskSeen(null)} data-tc-day-ask-open>
            Answer
          </button>
        </section>
      )}
      {next && <UpNext g={next} day={day} first={!day.games.some((g) => g.state === 'done') && !held} busy={busy || !!held} onWon={() => hold(next, 'won')} onLost={() => hold(next, 'lost')} />}
      {day.timeNote && (
        <p className="tc-gd-tc" role="status" data-tc-day-time>
          <b>Time check.</b> {day.timeNote}
        </p>
      )}
      <GamesCard day={day} org={org} />
      {pools ? <PoolsCards day={day} /> : <StandingsCard day={day} />}
      {day.live.length > 0 && (
        <section className="tc-gd-card" aria-label="Currently playing" data-tc-day-live>
          <h3 className="tc-gd-label">Currently playing</h3>
          <ul className="tc-gd-rows">
            {day.live.map((x) => (
              <li key={`${x.round}-${x.court}-${x.a.name}`} className="tc-gd-row tc-gd-game">
                <span className="tc-gd-left">
                  <b>Round {x.round}</b>
                  <Court n={x.court} set={day.courtsSet} />
                </span>
                <Matchup a={x.a} b={x.b} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {pools && <NightCard day={day} />}
      <Sheet calmFocus open={!!ask && askSeen !== ask.num && !held} title="Did you win?" onClose={() => ask && setAskSeen(ask.num)} className="tc-gd-sheet">
        {ask && (
          <div className="stack" data-tc-day-confirm={ask.num}>
            <p className="tc-gd-ask-text">{ask.opponent?.name} says they beat you. Right?</p>
            <div className="tc-gd-two">
              <button type="button" className="btn big" disabled={busy} onClick={() => void send(ask.num, 'confirm').then((ok) => ok && toast(`${ask.opponent?.name} won ${ask.label}`))} data-tc-day-yes>
                Yes, they won
              </button>
              <button type="button" className="btn big tc-gd-no" disabled={busy} onClick={() => void send(ask.num, 'dispute').then((ok) => ok && toast(`${org} will decide`))} data-tc-day-no>
                No, we won
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function WonCard({ title, sub, onUndo, busy }: { title: string; sub: string; onUndo: () => void; busy: boolean }) {
  return (
    <section className="tc-gd-won" role="status" data-tc-day-won>
      <span className="tc-gd-check" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <path d="M5 10.5l3.2 3.2L15 7" />
        </svg>
      </span>
      <span className="tc-gd-won-text">
        <b>{title}</b>
        <span>{sub}</span>
      </span>
      <button type="button" className="tc-gd-undo" disabled={busy} onClick={onUndo} data-tc-day-undo>
        Undo
      </button>
    </section>
  );
}

/**
 * The one big card (mocks 17 and 18, Alex's PM): the game being played now (with We won and "<other team> won"), or Up next with the court. The
 * two teams side by side with VS, each with its players under. Game 1 says when it begins.
 */
function UpNext({ g, day, first, busy, onWon, onLost }: { g: PlayerDayGame; day: PlayerDayView; first: boolean; busy: boolean; onWon: () => void; onLost: () => void }) {
  const court = g.court !== null ? ` · Court ${g.court}` : '';
  const kicker = first && !day.started ? `${g.label} · Begins at ${day.beginsAt}` : g.onNow ? `${g.label}${court}` : `Up next · ${g.label}${court}`;
  const mine = day.team ?? { name: 'Your team', players: [] };
  return (
    <section className="tc-gd-next" aria-label={kicker} data-tc-day-next={g.num}>
      <p className="tc-gd-next-kicker">{kicker}</p>
      {g.opponent ? (
        <>
          <Matchup a={{ name: mine.name, players: mine.players }} b={g.opponent} big />
          {g.onNow && (
            <div className="tc-gd-next-btns">
              <button type="button" className="tc-gd-wewon" disabled={busy} onClick={onWon} data-tc-day-wewon>
                We won
              </button>
              <button type="button" className="tc-gd-theywon" disabled={busy} onClick={onLost} data-tc-day-theywon>
                {g.opponent.name} won
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <h3 className="tc-gd-next-title">{g.pending}</h3>
          <p className="tc-gd-next-sub">{g.stage === 'final' ? 'Against the other finalist' : 'Waiting for the other games'}</p>
        </>
      )}
    </section>
  );
}
