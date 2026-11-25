// Zip 57 (🎾57.tourney3), "Tournaments" piece 3, the PLAYER side (mocks 16 to 19, 51 to 53). Part of the tournament card's own download
// (src/tournament/TournamentHome.tsx), so a phone without a tournament never fetches it.
//   Before the night: Your team, Your games (only theirs, each with its court), All teams; with pools (12 players and up), Pool A and Pool B with
//   where each team plays the first round, and The night's times.
//   Game night: the short card (the name, "Game 2 of 3", a slim bar), Up next with one Enter score button (Zip 72: the Final score sheet with
//   the two team names; a 5 second Undo on this phone, then it is the result: Zip 71, no confirming, the first score from any of the 4 players
//   counts), "Net Ninjas won 11 to 7" with Undo, the Time check, Your games ("Won 11–7"), Standings ("+4 pts") or the pools, Currently playing.
// No clock times except "Game 1 begins at" (and The night's times with pools, as mock 51 draws them). Names only.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { BreakLeft } from './parts';
import type { PlayerDayGame, PlayerDayView, PlayerTournamentView } from '../../shared/tournament';
import { api, ApiError, storageGet, storageSet, VIEW_ONLY_MESSAGE } from '../lib';
import { CourtMap } from '../GameDay';
import { Sheet, useToast } from '../ui';
import { diffLabel, groupName, MAX_SCORE, resultTag, scoreHint } from '../../shared/scores';
import { AlsoNowCard, PlayoffCard, TieCard, WheelPickedCard } from './TieCards';
import './gameday-tour.css';
import { StartsSoonCard } from './Reveal';

/** How long a score waits on the phone before it is sent (the card's Undo). */
export const UNDO_MS = 5000;

export function errorText(err: unknown): string {
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
export function useSeen(key: string | null): [boolean, () => void] {
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
export function DayHero({ t, day }: { t: PlayerTournamentView; day: { progress: PlayerDayView['progress'] } }) {
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
export function Court({ n, set }: { n: number | null; set: boolean }) {
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
function rowWords(g: PlayerDayGame): { title: string; sub: string } {
  if (g.skipped) return { title: g.opponent ? `vs ${g.opponent.name}` : g.label, sub: 'Not played' };
  if (!g.opponent) return { title: g.pending ?? 'Not decided yet', sub: g.stage === 'final' ? 'Against the other finalist' : g.stage === 'semi' ? 'Against the other group' : '' };
  const players = g.opponent.players.join(' + ');
  if (g.state === 'done' && g.won !== undefined) return { title: `vs ${g.opponent.name}`, sub: players };
  // Zip 74: a shorter game says so with the "Play to 9" pill beside the name (PlayToPill), not in this line.
  return { title: `vs ${g.opponent.name}`, sub: players };
}

export function GamesCard({ day }: { day: PlayerDayView }) {
  if (!day.games.length) return null;
  return (
    <section className="tc-gd-card" aria-label="Your games" data-tc-day-games>
      <h3 className="tc-gd-label">Your games</h3>
      <ul className="tc-gd-rows">
        {day.games.map((g) => {
          const w = rowWords(g);
          return (
            <li key={`${g.stage}-${g.num}`} className={`tc-gd-row tc-gd-game tc-gd-s-${g.state}${g.state === 'done' && g.won === false ? ' tc-gd-lost' : ''}`} data-tc-day-game={g.label} data-state={g.state}>
              <span className="tc-gd-left">
                <b>{g.label}</b>
                {g.opponent && <Court n={g.court} set={day.courtsSet} />}
              </span>
              <span className="tc-gd-main">
                <b>
                  <span className="tc-gd-with">{w.title}</span>
                  {g.state !== 'done' && g.opponent && !g.skipped && g.playTo < 11 && <PlayToPill to={g.playTo} />}
                  {g.state === 'done' && g.won !== undefined && (
                    <span className={g.won ? 'tc-gd-tag tc-gd-tag-won' : 'tc-gd-tag'} data-tc-day-result>
                      {resultTag(g.won, g.score)}
                    </span>
                  )}
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
            {r.tied ? (
              <span className="tc-gd-chip">Tied</span>
            ) : r.through ? (
              <span className="tc-gd-chip tc-gd-through" data-tc-day-through={r.through}>
                {r.through === 'semi' ? 'In the semis' : 'In the final'}
              </span>
            ) : r.diff !== undefined ? (
              <span className="tc-gd-chip tc-gd-pts" data-tc-day-diff={r.diff}>
                {diffLabel(r.diff)}
              </span>
            ) : r.me ? (
              <span className="tc-gd-chip">You</span>
            ) : (
              <span className="tc-gd-chip tc-gd-chip-empty" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Mocks 51 to 53: the Dink group and the Drive group, each team's record and (Zip 78) its points chip, like the one group's standings. */
function PoolsCards({ day }: { day: PlayerDayView }) {
  return (
    <>
      {day.standings.map((grp) => (
        <section key={grp.pool ?? 'all'} className="tc-gd-card" aria-label={groupName(grp.pool)} data-tc-day-pool={grp.pool}>
          <div className="tc-gd-head">
            <h3 className="tc-gd-label">{groupName(grp.pool)}</h3>
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
                {r.tied ? (
                  <span className="tc-gd-chip">Tied</span>
                ) : r.through ? (
                  <span className="tc-gd-chip tc-gd-through" data-tc-day-through={r.through}>
                    {r.through === 'semi' ? 'In the semis' : 'In the final'}
                  </span>
                ) : r.diff !== undefined ? (
                  <span className="tc-gd-chip tc-gd-pts" data-tc-day-diff={r.diff}>
                    {diffLabel(r.diff)}
                  </span>
                ) : null}
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
      {players.length > 0 && <span>{players.join(' + ')}</span>}
    </span>
  );
}

/**
 * Two teams (or two pairs) side by side with VS between them, each with its players under (Americano: names only). `lit` (the result motion):
 * 'mine' lights our side lime with a check (our side won); 'theirs' gives the winners a soft white glow and dims our side (picture 37: a loss).
 */
export function Matchup({ a, b, big, lit }: { a: { name: string; players: string[] }; b: { name: string; players: string[] }; big?: boolean; lit?: 'mine' | 'theirs' | null }) {
  return (
    <span className={`${big ? 'tc-gd-vs tc-gd-vs-big' : 'tc-gd-vs'}${lit === 'mine' ? ' tc-gd-vs-lit' : lit === 'theirs' ? ' tc-gd-vs-lost' : ''}`} data-tc-day-lit={lit ?? undefined}>
      <span className="tc-gd-side-a">
        {lit === 'mine' && (
          <span className="tc-gd-litcheck" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <path d="M5 10.5l3.2 3.2L15 7" />
            </svg>
          </span>
        )}
        <TeamName {...a} big={big} />
      </span>
      <span className="tc-gd-vs-mark">VS</span>
      <TeamName {...b} big={big} />
    </span>
  );
}

/**
 * Zip 74 (pictures pair-3 and pair-4): a game shorter than 11 says so. `big`: the Up next card's yellow "Play to 9 points", centered on its own
 * line under the kicker; else the small "Play to 9" pill beside the opponent in Your games / Your rounds. The Final and 3rd place are always to
 * 11, so they never get one.
 */
export function PlayToPill({ to, big }: { to: number; big?: boolean }) {
  return big ? (
    <p className="tc-gd-playto-row">
      <span className="tc-gd-playto tc-gd-playto-big" data-tc-play-to={to}>
        Play to {to} points
      </span>
    </p>
  ) : (
    <span className="tc-gd-playto" data-tc-play-to={to}>
      Play to {to}
    </span>
  );
}

const DICE = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <rect x="3" y="3" width="14" height="14" rx="3.5" />
    <circle cx="7" cy="7" r="1.2" />
    <circle cx="13" cy="13" r="1.2" />
    <circle cx="10" cy="10" r="1.2" />
  </svg>
);

/**
 * Your team (Alex's PM, under the ticket before the night): the name big, the two players under it. Zip 74 (pictures pair-1 and pair-2): while
 * the name can still change (Zip 88: until their team's first game has a score, the server's `canRename`; also on the night), one small secondary "Edit name" button on the right. It opens the
 * "Team name" sheet: a box with the name, "Need help? Randomize a name" (rolls a suggestion nobody else has into the box; nothing is saved),
 * and Save. Either partner; the last save wins; a name another team has is refused.
 */
function YourTeamCard({ t, day, onChanged }: { t: PlayerTournamentView; day: PlayerDayView; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  if (!day.team) return null;
  const team = day.team;
  async function save(name: string) {
    setBusy(true);
    try {
      await api('POST', '/api/tournament/team-name', { tournamentId: t.id, name });
      await onChanged();
      setEditing(false);
      toast('Team name saved', 'ok');
    } catch (err) {
      toast(errorText(err), 'error');
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) void onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function randomize() {
    setBusy(true);
    try {
      const r = await api<{ name: string }>('POST', '/api/tournament/team-name', { tournamentId: t.id, suggest: true, not: draft });
      setDraft(r.name);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tc-gd-card tc-gd-yourteam" aria-label={`Your team, ${team.name}`} data-tc-day-team-card>
      <h3 className="tc-gd-label">Your team</h3>
      <div className="tc-gd-yt-row">
        <TeamName name={team.name} players={team.players} big />
        {team.canRename && (
          <button
            type="button"
            className="tc-gd-yt-editbtn"
            disabled={busy}
            onClick={() => {
              setDraft(team.name);
              setEditing(true);
            }}
            data-tc-team-edit
          >
            Edit name
          </button>
        )}
      </div>
      <Sheet calmFocus open={editing && !!team.canRename} title="Team name" onClose={() => setEditing(false)} className="tc-gd-sheet">
        <form
          className="tc-gd-yt-sheet"
          data-tc-team-sheet
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void save(draft.trim());
          }}
        >
          <input className="tc-gd-yt-input" value={draft} maxLength={24} onChange={(e) => setDraft(e.target.value)} aria-label="Team name" autoComplete="off" data-tc-team-input />
          <button type="button" className="tc-gd-yt-random" disabled={busy} onClick={() => void randomize()} data-tc-team-random>
            {DICE}
            <span>Need help? Randomize a name</span>
          </button>
          <button type="submit" className="btn block big tc-gd-yt-save" disabled={busy || !draft.trim()} data-tc-team-save>
            Save
          </button>
        </form>
      </Sheet>
    </section>
  );
}

/** One side's number with − and + (44 px), and the number itself can be typed. */
function ScoreRow({ label, value, onChange, testId }: { label: string; value: number; onChange: (next: (n: number) => number) => void; testId: string }) {
  const clamp = (n: number) => Math.max(0, Math.min(MAX_SCORE, Math.round(n)));
  // − and + work on the number as it is now (quick taps all count); typing sets it.
  const set = (n: number) => onChange(() => clamp(n));
  const step = (d: number) => onChange((n) => clamp(n + d));
  return (
    <div className="tc-gd-score-row" data-tc-score-row={testId}>
      <span className="tc-gd-score-name">{label}</span>
      <span className="tc-gd-score-ctl">
        <button type="button" className="tc-gd-round tc-gd-step" aria-label={`${label}: one less`} onClick={() => step(-1)} disabled={value <= 0} data-tc-score-minus={testId} data-tap-repeat>
          −
        </button>
        <input
          className="tc-gd-score-num"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={`${label} score`}
          value={String(value)}
          onChange={(e) => set(Number(e.target.value.replace(/\D/g, '') || 0))}
          onFocus={(e) => e.target.select()}
          data-tc-score-num={testId}
        />
        <button type="button" className="tc-gd-round tc-gd-step" aria-label={`${label}: one more`} onClick={() => step(1)} disabled={value >= MAX_SCORE} data-tc-score-plus={testId} data-tap-repeat>
          +
        </button>
      </span>
    </div>
  );
}

/**
 * THE score sheet (picture 33, and Zip 72's picture pair-2): "Final score", each side with − and +, Submit score. Both styles: Locked doubles
 * names the two teams (ours first), Americano the two pairs ("You + Parker"). Equal scores cannot be sent (a game has a winner); an odd score
 * gets one gentle line under the numbers (Alex can fix it) and can still be sent.
 */
export function ScoreSheet({
  num,
  open,
  labels,
  playTo,
  busy,
  onClose,
  onSubmit,
}: {
  num: number | null;
  open: boolean;
  labels: [string, string];
  playTo: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (mine: number, theirs: number) => void;
}) {
  const [mine, setMine] = useState(playTo);
  const [theirs, setTheirs] = useState(0);
  const [key, setKey] = useState('');
  const k = `${num ?? ''}:${playTo}:${open}`;
  if (k !== key) {
    setKey(k);
    setMine(playTo);
    setTheirs(0);
  }
  const hint = scoreHint(mine, theirs, playTo);
  return (
    <Sheet calmFocus open={open && num !== null} title="Final score" onClose={onClose} className="tc-gd-sheet">
      {num !== null && (
        <div className="stack" data-tc-score-sheet={num}>
          <div className="tc-gd-score">
            <ScoreRow label={labels[0]} value={mine} onChange={setMine} testId="mine" />
            <ScoreRow label={labels[1]} value={theirs} onChange={setTheirs} testId="theirs" />
          </div>
          {hint && (
            <p className="tc-gd-score-hint" role="status" data-tc-score-hint>
              {hint}
            </p>
          )}
          <button type="button" className="btn big block" disabled={busy || mine === theirs} onClick={() => onSubmit(mine, theirs)} data-tc-score-submit>
            Submit score
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** How long the lit card (our side lime, "✓ Let's go!"; or their side's white glow, "Onto the next!") holds before it slides to the next game. */
export const LIT_MS = 1000;

/** A result held on this phone for its 5 seconds: which game, won or lost, and whether the card is still lit (the first second). */
export type Held = { num: number; won: boolean; lit: boolean };
/** Zip 72: a held result with its score (mine first), so Your games shows "Won 11–7" during the 5 seconds too. */
export type HeldScore = Held & { mine: number; theirs: number };

/**
 * Zip 74 (the 🎾73 audit, 320 px): a score ("11 to 7") and a clock time ("7:00 PM") never break across two lines: their spaces become
 * no-break spaces. Names around them still wrap between words.
 */
export const glue = (text: string): string => text.replace(/(\d+) to (\d+)/g, '$1\u00a0to\u00a0$2').replace(/(\d{1,2}(?::\d{2})?) ([AP]M)\b/g, '$1\u00a0$2');

/**
 * THE result motion, shared by Locked doubles and Americano (Submit score; Zip 72: both styles enter a score): zip 57's code, the one copy. The card
 * lights for a second (won: our side lime and "✓ Let's go!"; lost: their side's white glow and "Onto the next!"), then slides to the next game;
 * the bottom banner says who won with Undo and its 5 second countdown circle; the result is sent after 5 seconds unless Undo. Leaving Home or locking
 * the phone inside the 5 seconds still sends it. Reduced motion: no light and no slide (the card just changes).
 */
export function useHeldResult(t: PlayerTournamentView, onChanged: () => Promise<unknown>) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const litTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A result still in its 5 seconds when the card goes away (the player leaves Home, the page closes): it is sent then, not lost.
  const pending = useRef<Record<string, unknown> | null>(null);
  const sendNow = (body: Record<string, unknown>) => api('POST', '/api/tournament/game', { tournamentId: t.id, ...body }).catch(() => undefined);
  useEffect(() => {
    const leave = () => {
      const p = pending.current;
      if (p && document.visibilityState === 'hidden') {
        pending.current = null;
        clearTimeout(timer.current);
        void sendNow(p);
      }
    };
    document.addEventListener('visibilitychange', leave);
    return () => {
      document.removeEventListener('visibilitychange', leave);
      clearTimeout(timer.current);
      clearTimeout(litTimer.current);
      const p = pending.current;
      if (p) void sendNow(p);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await api('POST', '/api/tournament/game', { tournamentId: t.id, ...body });
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
  function undo() {
    clearTimeout(timer.current);
    clearTimeout(litTimer.current);
    pending.current = null;
    setHeld(null);
  }
  /** Hold a result: `banner` is the bottom banner's words ("Net Ninjas won Game 1", "You + Parker won 11 to 8"). */
  function hold(num: number, won: boolean, body: Record<string, unknown>, banner: string) {
    if (held) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lit = !reduced;
    setHeld({ num, won, lit });
    if (lit) litTimer.current = setTimeout(() => setHeld((h) => (h && h.num === num ? { ...h, lit: false } : h)), LIT_MS);
    pending.current = body;
    // Zip 71 (Alex): the countdown circle on Undo only; no draining line along the banner's foot (it repeated the circle).
    toast(glue(banner), 'ok', { action: { label: 'Undo', onClick: undo }, stayMs: UNDO_MS, keep: true });
    timer.current = setTimeout(() => {
      pending.current = null;
      void send(body).then(() => setHeld(null));
    }, UNDO_MS);
  }
  return { busy, held, hold, send };
}

/**
 * What the screen shows while a result is held for its 5 seconds (Alex's add-on, picture 04): the game is done (won or lost), the next game is
 * the one up next, and the bar counts it. Only on this phone, only until the result is sent or undone; the standings wait for the real answer.
 */
function withHeld(day: PlayerDayView, held: HeldScore | null): PlayerDayView {
  if (!held || held.lit) return day;
  let first = true;
  const games = day.games.map((g) => {
    if (g.num === held.num) return { ...g, state: 'done' as const, won: held.won, score: { mine: held.mine, theirs: held.theirs }, onNow: false };
    if (g.state === 'done') return g;
    const state = first ? ('next' as const) : ('later' as const);
    first = false;
    return { ...g, state };
  });
  const pool = games.filter((g) => g.stage === 'pool');
  const next = games.find((g) => g.state === 'next');
  const progress =
    day.pools || !next
      ? day.progress
      : { label: next.stage === 'pool' ? `${next.label} of ${pool.length}` : next.label, done: pool.filter((g) => g.state === 'done').length, total: Math.max(1, pool.length) };
  return { ...day, games, progress };
}

/**
 * The live view (Home, from 30 minutes before the start): the slim bar, one big card, Standings, Currently playing, Your games. Before the night:
 * Your team (pencil and dice), Your games, All teams (or the pools and the night's times).
 */
export function DayBody({ t, day: real, org, onChanged }: { t: PlayerTournamentView; day: PlayerDayView; org: string; onChanged: () => Promise<unknown> }) {
  const { busy, held, hold: holdResult } = useHeldResult(t, onChanged);
  const [score, setScore] = useState<{ mine: number; theirs: number } | null>(null);
  const day = withHeld(real, held && score ? { ...held, ...score } : null);
  const [noteSeen, hideNote] = useSeen(day.partnerNote?.key ?? null);
  // Zip 72: the Final score sheet, held to the game it was opened for (a refresh while it is open never moves it to another game).
  const [sheet, setSheet] = useState<PlayerDayGame | null>(null);
  const myName = day.team?.name ?? 'Your team';
  function submit(g: PlayerDayGame, mine: number, theirs: number) {
    setSheet(null);
    setScore({ mine, theirs });
    const won = mine > theirs;
    const winners = won ? myName : (g.opponent?.name ?? 'The other team');
    holdResult(g.num, won, { num: g.num, action: 'score', mine, theirs }, `${winners} won ${Math.max(mine, theirs)} to ${Math.min(mine, theirs)}`);
  }
  const litGame = held?.lit ? (real.games.find((g) => g.num === held.num) ?? null) : null;
  const next = litGame ?? day.games.find((g) => g.state === 'next') ?? null;
  const pools = day.pools;
  // Zip 58: a tie for a playoff place. Until it is spun (or picked): the standings and the tie card. Once spun: The wheel picked, the big card
  // for a team in Game A or B, and the Playoff card. A phone that did not see the spin plays it once (spun in the last 3 minutes).
  const tie = day.tie ?? null;
  const [spinSeen, markSpinSeen] = useSeen(tie ? `spin:${tie.key}` : null);
  const replay = !!tie && tie.state === 'playoff' && !!tie.bye && !!tie.spunAt && !spinSeen && Date.now() - Date.parse(tie.spunAt) < 3 * 60_000;
  const tiePhase: 'tie' | 'playoff' | null = !tie ? null : tie.state === 'playoff' && !replay ? 'playoff' : 'tie';
  if (!day.today) {
    return (
      <div className="tc-gd stack" data-tc-day="before">
        {/* Zip 88: game day, before the night: "Games start soon" (the countdown in the last half hour). */}
        {day.startsSoon && <StartsSoonCard startsAt={day.startsSoon.startsAt} />}
        <YourTeamCard t={t} day={day} onChanged={onChanged} />
        <GamesCard day={day} />
        {pools ? <PoolsCards day={day} /> : <TeamsCard day={day} />}
        {pools && <NightCard day={day} />}
      </div>
    );
  }
  return (
    <div className="tc-gd stack" data-tc-day="night">
      <DayHero t={t} day={day} />
      {day.startsSoon && <StartsSoonCard startsAt={day.startsSoon.startsAt} />}
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
          Paused.
        </p>
      )}
      {/* Zip 89 (Alex): the 5 minute break (nobody sits) with its countdown; Round 1's gray warm-up line. */}
      {day.breakNow ? (
        <section className="tc-gd-break" role="status" data-tc-day-break={day.breakNow.round}>
          <b className="tc-gd-break-title">5 min break</b>
          <BreakLeft b={day.breakNow} />
        </section>
      ) : (
        day.warmUp && (
          <p className="tc-gd-warm" data-tc-day-warmup>
            Warm up 5 to 10 min, then play.
          </p>
        )
      )}
      {tiePhase === 'tie' && tie && (
        <>
          {pools ? <PoolsCards day={day} /> : <StandingsCard day={day} />}
          <TieCard t={t} tie={tie} org={org} onChanged={onChanged} replay={replay} onSeen={markSpinSeen} />
        </>
      )}
      {tiePhase === 'playoff' && tie && <WheelPickedCard tie={tie} />}
      {next && (tiePhase === null || (tiePhase === 'playoff' && next.stage === 'tie')) && (
        <Slide k={next.num}>
          <UpNext
            g={next}
            day={day}
            first={!day.games.some((g) => g.state === 'done') && !held}
            busy={busy || (!!held && !litGame)}
            lit={litGame ? (held!.won ? 'mine' : 'theirs') : null}
            onEnter={() => setSheet(next)}
          />
        </Slide>
      )}
      {/* Zip 88: the name can change until their team's first game has a score, so Your team (Edit name) stays on the night until then. */}
      {day.team?.canRename && <YourTeamCard t={t} day={day} onChanged={onChanged} />}
      {/* Zip 58 (picture 22): the 3rd place game beside this player's Final. */}
      {tiePhase === null && day.alsoNow && next?.stage === 'final' && <AlsoNowCard a={day.alsoNow} />}
      {tiePhase === 'playoff' && day.playoff && <PlayoffCard rows={day.playoff} day={day} />}
      {/* Zip 74: the shorter games alert at the top of Home says it (picture pair-3), so the players' Time check line is not repeated here. */}
      {tiePhase === null && day.timeNote && !day.shortAlert && (
        <p className="tc-gd-tc" role="status" data-tc-day-time>
          <b>Time check.</b> {glue(day.timeNote)}
        </p>
      )}
      {tiePhase === null && <GamesCard day={day} />}
      {tiePhase === null && (pools ? <PoolsCards day={day} /> : <StandingsCard day={day} />)}
      {tiePhase === null && day.live.length > 0 && (
        <section className="tc-gd-card" aria-label="Currently playing" data-tc-day-live>
          <h3 className="tc-gd-label">Currently playing</h3>
          <ul className="tc-gd-rows">
            {day.live.map((x) => (
              <li key={`${x.round}-${x.court}-${x.a.name}`} className="tc-gd-row tc-gd-game tc-gd-liverow">
                <span className="tc-gd-left">
                  <b>{x.label ?? `Round ${x.round}`}</b>
                  <Court n={x.court} set={day.courtsSet} />
                </span>
                <Matchup a={x.a} b={x.b} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {tiePhase === null && pools && <NightCard day={day} />}
      <ScoreSheet
        num={sheet?.num ?? null}
        open={sheet !== null}
        labels={[myName, sheet?.opponent?.name ?? 'The other team']}
        playTo={sheet?.playTo ?? 11}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={(mine, theirs) => {
          if (sheet) submit(sheet, mine, theirs);
        }}
      />
    </div>
  );
}

/**
 * The big card's slide (picture 04): when the game changes, the old card slides out to the left and the new one in from the right. Reduced motion:
 * no slide, the card just changes (the site's global reduced-motion rule turns the animation off).
 */
export function Slide({ k, children }: { k: number | string; children: ReactNode }) {
  const prev = useRef<{ k: number | string; node: ReactNode }>({ k, node: children });
  const [leaving, setLeaving] = useState<{ k: number | string; node: ReactNode } | null>(null);
  if (prev.current.k !== k) {
    const old = prev.current;
    prev.current = { k, node: children };
    // Reduced motion: no slide, the card just changes.
    if (!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) setLeaving(old);
  } else prev.current.node = children;
  useEffect(() => {
    if (!leaving) return;
    const out = setTimeout(() => setLeaving(null), 420);
    return () => clearTimeout(out);
  }, [leaving]);
  return (
    <div className="tc-gd-slide" data-tc-day-slide>
      {leaving && (
        <div className="tc-gd-slide-out" aria-hidden="true">
          {leaving.node}
        </div>
      )}
      <div key={k} className={leaving ? 'tc-gd-slide-in' : undefined}>
        {children}
      </div>
    </div>
  );
}

/**
 * The one big card (mocks 17 and 18, Alex's PM; Zip 72's picture pair-1): the game being played now with ONE lime Enter score button, or Up next
 * with the court. The two teams side by side with VS, each with its players under. Game 1 says when it begins. After Submit score the card
 * lights for a second: a win lights our side lime and the button says "✓ Let's go!"; a loss gives the winners the soft white glow and the
 * button says "Onto the next!".
 */
function UpNext({
  g,
  day,
  first,
  busy,
  lit,
  onEnter,
}: {
  g: PlayerDayGame;
  day: PlayerDayView;
  first: boolean;
  busy: boolean;
  lit?: 'mine' | 'theirs' | null;
  onEnter: () => void;
}) {
  const court = g.court !== null ? ` · Court ${g.court}` : '';
  const kicker = first && !day.started ? `${g.label} · Begins at ${glue(day.beginsAt)}` : g.onNow || lit ? `${g.label}${court}` : `Up next · ${g.label}${court}`;
  const mine = day.team ?? { name: 'Your team', players: [] };
  return (
    <section className="tc-gd-next" aria-label={kicker} data-tc-day-next={g.num}>
      <p className="tc-gd-next-kicker">{kicker}</p>
      {g.opponent ? (
        <>
          {g.playTo < 11 && <PlayToPill to={g.playTo} big />}
          <Matchup a={{ name: mine.name, players: mine.players }} b={g.opponent} big lit={lit} />
          {(g.onNow || lit) && (
            <div className={lit === 'mine' ? 'tc-gd-next-btns tc-gd-next-lit' : lit === 'theirs' ? 'tc-gd-next-btns tc-gd-next-lost' : 'tc-gd-next-btns'}>
              <button type="button" className={lit === 'theirs' ? 'tc-gd-theywon' : 'tc-gd-wewon'} disabled={busy || !!lit} onClick={onEnter} data-tc-enter-score>
                {lit === 'mine' ? '✓ Let’s go!' : lit === 'theirs' ? 'Onto the next!' : 'Enter score'}
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
