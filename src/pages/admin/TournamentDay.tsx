// Zip 57 (🎾57.tourney3), "Tournaments" piece 3, the ORGANIZER side (server/tournamentDay.ts): Draft teams (mock 15) with Swap, a team's
// name, Redo the draw and Publish teams; the published teams with the venue's court numbers; the check when tickets close; Fix teams after a
// back out; and game night (mocks 48 to 50, for Locked doubles: who won, not scores): the round's results with Confirm and Fix, the Time
// check with one tap, Pause and Player left. Only drawn while the switch is on and a tournament has tickets open.
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import type { AdminDayGame, AdminDayTeam, AdminDayView, AdminTournamentView } from '../../../shared/tournament';
import { levelShort } from '../../../shared/tournament';
import { totalLabel } from '../../../shared/tournamentSchedule';
import { startMsOf } from '../../../shared/tournamentTickets';
import { api, ApiError, VIEW_ONLY_MESSAGE } from '../../lib';
import { AlertCard } from '../../AlertCard';
import { Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import './tournament-day.css';
import { AmericanoCards } from './AmericanoDay';

// The court picker (the site's court map) is loaded when the published card draws it, not with this file: a static import here would pull
// src/GameDay.tsx (and its styles) in ahead of the other organizer screens in the one-file build, changing the style order (tests/zip48-split).
const CourtRow = lazy(() => import('../../GameDay').then((m) => ({ default: m.CourtRow })));

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 && /view only/i.test(err.message) ? VIEW_ONLY_MESSAGE : err.message;
  return 'That did not work. Try again.';
}

function useSave(ctx: AdminCtx) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function save(fn: () => Promise<unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      await ctx.reload().catch(() => undefined);
      if (done) toast(done);
      return true;
    } catch (err) {
      toast(errText(err), 'error');
      if (err instanceof ApiError && err.status === 409) void ctx.reload();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, save };
}

const teamsCall = (t: AdminTournamentView, body: Record<string, unknown>) => api('POST', `/api/admin/tournament/${t.id}/teams`, body);
const gamesCall = (t: AdminTournamentView, body: Record<string, unknown>) => api('POST', `/api/admin/tournament/${t.id}/games`, body);

/** The night is on (or about to be): from 30 minutes before the real start. */
function nightOn(ctx: AdminCtx, t: AdminTournamentView): boolean {
  if (!t.finalDate || !t.startSet) return false;
  return Date.parse(ctx.d.now) >= startMsOf(t.finalDate, t.start, ctx.d.group.timezone) - 30 * 60_000;
}

/** Everything piece 3 adds to the organizer's Home, first on it (the cards of this zip). */
export function TournamentDayCards({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const d = t.day;
  return (
    <>
      {t.closeCheck && <CloseCheckCard ctx={ctx} t={t} />}
      {d && d.phase === 'none' && d.canDraft && <DraftPrompt ctx={ctx} t={t} d={d} />}
      {d && d.phase === 'draft' && <DraftCard ctx={ctx} t={t} d={d} />}
      {d && d.phase === 'published' && d.fix && <FixTeamsCard ctx={ctx} t={t} d={d} />}
      {d && d.phase === 'published' && t.format === 'doubles' && (nightOn(ctx, t) ? <NightControls ctx={ctx} t={t} d={d} /> : <PublishedCard ctx={ctx} t={t} d={d} />)}
      {/* Zip 61: the Americano night (the rounds before it; on the night the scores, the Time check, Pause, Player left). */}
      {t.format === 'americano' && t.rounds && <AmericanoCards ctx={ctx} t={t} />}
    </>
  );
}

/** When tickets close, with the players really locked in (amber): too tight, a court no longer needed, or under 6. */
function CloseCheckCard({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const { busy, save } = useSave(ctx);
  const c = t.closeCheck!;
  // One tap to the other court count (before the teams are published): 1 court is enough, or 2 courts make it fit.
  const to = c.kind === 'extra_court' ? 1 : c.kind === 'tight' && t.chosenCourts === 1 ? 2 : null;
  const canChange = to !== null && t.day?.phase !== 'published';
  return (
    <AlertCard
      as="section"
      tone="amber"
      icon={c.kind === 'extra_court' ? 'court' : 'info'}
      label="Plan check"
      title={c.text}
      sub={c.kind === 'few' ? 'Cancel or reschedule is on the card below.' : undefined}
      data={{ 'data-tm-close-check': c.kind }}
      action={
        canChange ? (
          <button type="button" className="ac-btn" disabled={busy} onClick={() => void save(() => teamsCall(t, { action: 'count', courts: to }), to === 1 ? 'Planned on 1 court' : 'Planned on 2 courts')} data-tm-close-courts={to}>
            Use {to} {to === 1 ? 'court' : 'courts'}
          </button>
        ) : undefined
      }
    />
  );
}

/** Tickets have closed with an even number on Locked doubles: one tap drafts the teams. */
function DraftPrompt({ ctx, t, d }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView }) {
  const { busy, save } = useSave(ctx);
  return (
    <AlertCard
      as="section"
      tone="green"
      icon="person"
      label="Teams"
      title={`${d.lockedIn} locked in. Draft the teams.`}
      data={{ 'data-tm-draft-prompt': true }}
      action={
        <button type="button" className="ac-btn" disabled={busy} onClick={() => void save(() => teamsCall(t, { action: 'draft' }), 'Teams drafted')} data-tm-draft>
          Draft teams
        </button>
      }
    />
  );
}


/**
 * Draft teams (Alex's add-on, pictures 01 to 03): each team's two players are buttons (name left, level right) with the team total on the right.
 * Tap a player: it turns lime and the chip asks "Swap Wren with…". Tap a player on another team: the two slide into each other's places, both
 * totals flash lime, and the swap is saved at once (the existing swap action). Tap the picked player again to unpick, or their teammate to pick
 * the teammate instead. Redo the draw or Publish teams clears the pick. Reduced motion: no slide, the names just change places.
 */
function DraftCard({ ctx, t, d }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView }) {
  const { busy, save } = useSave(ctx);
  const [pick, setPick] = useState<string | null>(null);
  // The teams as drawn now: the server's, or a swap already made on this screen that the server is saving.
  const [local, setLocal] = useState<AdminDayTeam[] | null>(null);
  const [flash, setFlash] = useState<string[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const moved = useRef<{ ids: string[]; rects: Map<string, DOMRect> } | null>(null);
  const teams = local ?? d.teams;
  const where = (id: string) => teams.findIndex((x) => x.players.some((p) => p.id === id));
  const pickedName = pick ? teams.flatMap((x) => x.players).find((p) => p.id === pick)?.name : null;
  // The slide: each moved name goes from where it was to where it is now (both are real buttons; only a transform moves).
  useLayoutEffect(() => {
    const m = moved.current;
    const list = listRef.current;
    if (!m || !list) return;
    moved.current = null;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const id of m.ids) {
      const el = list.querySelector<HTMLElement>(`[data-tm-player="${CSS.escape(id)}"]`);
      const before = m.rects.get(id);
      if (!el || !before || typeof el.animate !== 'function') continue;
      const now = el.getBoundingClientRect();
      el.animate([{ transform: `translate(${before.left - now.left}px, ${before.top - now.top}px)` }, { transform: 'translate(0, 0)' }], { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
  }, [local]);
  function tap(id: string | null) {
    if (!id || busy) return;
    if (!pick) return setPick(id);
    if (pick === id) return setPick(null);
    const a = where(pick);
    const b = where(id);
    if (a === b) return setPick(id);
    // Swap on screen first (with the slide), then save.
    const list = listRef.current;
    const rects = new Map<string, DOMRect>();
    for (const pid of [pick, id]) {
      const el = list?.querySelector<HTMLElement>(`[data-tm-player="${CSS.escape(pid)}"]`);
      if (el) rects.set(pid, el.getBoundingClientRect());
    }
    moved.current = { ids: [pick, id], rects };
    const next = teams.map((x) => ({ ...x, players: x.players.map((p) => ({ ...p })) }));
    const pa = next[a].players.findIndex((p) => p.id === pick);
    const pb = next[b].players.findIndex((p) => p.id === id);
    [next[a].players[pa], next[b].players[pb]] = [next[b].players[pb], next[a].players[pa]];
    for (const i of [a, b]) next[i].total = next[i].players.reduce((sum, p) => sum + p.level, 0);
    setLocal(next);
    setFlash([next[a].id, next[b].id]);
    setTimeout(() => setFlash([]), 900);
    const from = pick;
    setPick(null);
    void save(() => teamsCall(t, { action: 'swap', a: from, b: id }), '').then(() => setLocal(null));
  }
  return (
    <>
      <section className="tm-card tm-gd-card" aria-label="Draft teams" data-tm-draft-card={teams.length}>
        <div className="tm-card-head tm-head-line tm-gd-head">
          <h3 className="tm-label">Draft teams</h3>
          {pickedName ? (
            <span className="tm-chip tm-gd-pickchip" data-tm-draft-count="pick">
              Swap {pickedName} with…
            </span>
          ) : (
            <span className="tm-chip tm-chip-ok" data-tm-draft-count>
              {d.lockedIn} locked in
            </span>
          )}
        </div>
        <ol className="tm-gd-teams" ref={listRef}>
          {teams.map((team, i) => (
            <li key={team.id} className="tm-gd-team tm-gd-draftrow" data-tm-team={team.seat}>
              <span className="tm-gd-num">{i + 1}</span>
              <span className="tm-gd-two">
                {team.players.map((p) => (
                  <button
                    key={p.id ?? p.name}
                    type="button"
                    className="tm-gd-pbtn"
                    aria-pressed={pick === p.id}
                    disabled={!p.id || !d.canDraft}
                    onClick={() => tap(p.id)}
                    data-tm-player={p.id ?? ''}
                    data-tm-player-name={p.name}
                  >
                    <span className="tm-gd-pbtn-name">{p.name}</span>
                    <span className="tm-gd-pbtn-lvl">{p.level ? levelShort(p.level) : ''}</span>
                  </button>
                ))}
              </span>
              <span className={flash.includes(team.id) ? 'tm-gd-total tm-gd-flash' : 'tm-gd-total'} data-tm-team-total>
                {totalLabel(team.total)}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <button
        type="button"
        className="btn block big tm-gd-publish"
        disabled={busy || !d.canDraft}
        onClick={() => {
          setPick(null);
          void save(() => teamsCall(t, { action: 'publish' }), 'Teams published');
        }}
        data-tm-publish
      >
        Publish teams
      </button>
      <button
        type="button"
        className="btn block big secondary tm-gd-redo"
        disabled={busy || !d.canDraft}
        onClick={() => {
          setPick(null);
          void save(() => teamsCall(t, { action: 'redo' }), 'New draw');
        }}
        data-tm-redo
      >
        Redo the draw
      </button>
      {!d.canDraft && d.why && (
        <p className="tm-gd-note" role="status" data-tm-draft-why>
          {d.why}
        </p>
      )}
    </>
  );
}

function RenameSheet({ ctx, t, team, onClose }: { ctx: AdminCtx; t: AdminTournamentView; team: AdminDayTeam | null; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const [name, setName] = useState('');
  const [seen, setSeen] = useState<string | null>(null);
  if (team && seen !== team.id) {
    setSeen(team.id);
    setName(team.name);
  }
  return (
    <Sheet calmFocus open={!!team} title="Team name" onClose={onClose} className="tm-gd-sheet">
      {team && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await save(() => teamsCall(t, { action: 'rename', teamId: team.id, name }), 'Saved');
            if (ok) onClose();
          }}
          data-tm-rename-sheet
        >
          <input className="tm-name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Team name" data-tm-rename-input />
          <button type="submit" className="btn block big" disabled={busy || !name.trim()} data-tm-rename-save>
            Save
          </button>
        </form>
      )}
    </Sheet>
  );
}

/** After publishing, a back out or a late join left the teams out of step (before any result): pair the left-over players and publish again. */
function FixTeamsCard({ ctx, t, d }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView }) {
  const { busy, save } = useSave(ctx);
  const canPair = d.lockedIn % 2 === 0 && d.lockedIn >= 6;
  return (
    <AlertCard
      as="section"
      tone="amber"
      icon="person"
      label="Teams changed"
      title="Teams need a change."
      sub={d.fix!.text}
      data={{ 'data-tm-fix': true }}
      action={
        canPair ? (
          <button type="button" className="ac-btn" disabled={busy} onClick={() => void save(() => teamsCall(t, { action: 'fix' }), 'Teams updated. Both players see their new partner.')} data-tm-fix-go>
            Pair them
          </button>
        ) : undefined
      }
    />
  );
}

/** The published teams: each name with its players under it, and a pencil (the organizer renames any team, any time). */
function TeamList({ ctx, t, d }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView }) {
  const [rename, setRename] = useState<AdminDayTeam | null>(null);
  return (
    <>
      <ol className="tm-gd-teams" data-tm-team-list>
        {d.teams.map((team, i) => (
          <li key={team.id} className="tm-gd-team tm-gd-team-pub" data-tm-team={team.seat}>
            <span className="tm-gd-num">{i + 1}</span>
            <span className="tm-gd-team-text">
              <span className="tm-gd-tname">
                {team.name}
                {team.pool && <span className="tm-gd-poolmark"> · Pool {team.pool}</span>}
              </span>
              <span className="tm-gd-tplayers">{team.players.map((p) => p.name).join(' + ')}</span>
            </span>
            <button type="button" className="tm-gd-pencil" aria-label={`Rename ${team.name}`} onClick={() => setRename(team)} data-tm-rename={team.seat}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M13.6 3.4l3 3L7 16H4v-3z" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
      <RenameSheet ctx={ctx} t={t} team={rename} onClose={() => setRename(null)} />
    </>
  );
}

/** Published, before the night: the teams, the venue's court numbers and Edit teams (back to the draft, before any result). */
function PublishedCard({ ctx, t, d }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView }) {
  const { busy, save } = useSave(ctx);
  const [nums, setNums] = useState<(number | null)[]>(() => Array.from({ length: d.courts }, (_, i) => d.courtNumbers?.[i] ?? null));
  const setCourt = (i: number, n: number | null) => {
    const next = [...nums];
    next[i] = n;
    setNums(next);
    if (next.every((x): x is number => x !== null) && new Set(next).size === next.length) void save(() => teamsCall(t, { action: 'courts', numbers: next }), `Courts ${next.join(' and ')}`);
  };
  return (
    <section className="tm-card tm-gd-card" aria-label="Teams" data-tm-published={d.teams.length}>
      <div className="tm-card-head tm-head-line tm-gd-head">
        <h3 className="tm-label">Teams</h3>
        <span className="tm-chip tm-chip-ok">Published</span>
      </div>
      <TeamList ctx={ctx} t={t} d={d} />
      <div className="tm-gd-courts" data-tm-courts>
        <Suspense fallback={null}>
          {nums.map((n, i) => (
            <CourtRow key={i} value={n} onChange={(c) => setCourt(i, c)} />
          ))}
        </Suspense>
      </div>
      <p className="tm-card-note">
        {d.plan ? `${d.games.length} games. ${d.plan.fits ? '' : 'Too tight: games to 7. '}Pool games to ${d.plan.gameTo}.` : ''} Game 1 begins at the start time.
      </p>
      {!d.anyResult && (
        <button type="button" className="btn block secondary tm-gd-edit" disabled={busy} onClick={() => void save(() => teamsCall(t, { action: 'unpublish' }), 'Back to the draft')} data-tm-unpublish>
          Edit teams
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Game night (mocks 48 to 50)
// ---------------------------------------------------------------------------------------------------------------------

const sideName = (g: AdminDayGame, s: 'a' | 'b') => (s === 'a' ? (g.a?.name ?? g.waitA ?? 'Not decided') : (g.b?.name ?? g.waitB ?? 'Not decided'));
const sidePlayers = (g: AdminDayGame, s: 'a' | 'b') => (s === 'a' ? g.a?.players : g.b?.players)?.join(' + ') ?? '';
const where = (g: AdminDayGame) => (g.courtNumber ? `Court ${g.courtNumber}` : `Court ${g.court}`);
const stageName = (g: AdminDayGame) => (g.stage === 'semi' ? 'Semifinal' : g.stage === 'final' ? 'Final' : g.stage === 'third' ? '3rd place' : `Game ${g.num}`);

/** What a game row says and which button it has. */
function rowOf(g: AdminDayGame): { status: string; first: 'a' | 'b'; word: string; button: 'fix' | 'confirm' | 'set' | 'decide' | null } {
  if (g.skipped) return { status: 'Skipped', first: 'a', word: 'vs', button: 'fix' };
  if (g.winner) return { status: 'Done', first: g.winner, word: 'beat', button: 'fix' };
  if (g.disputed) return { status: 'Disputed', first: g.claim ?? 'a', word: 'or', button: 'decide' };
  if (g.claim) return { status: 'Waiting', first: g.claim, word: 'says they beat', button: 'confirm' };
  if (!g.a || !g.b) return { status: 'Later', first: 'a', word: 'vs', button: null };
  return { status: 'Playing', first: 'a', word: 'vs', button: 'set' };
}

function NightControls({ ctx, t, d }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView }) {
  const { busy, save } = useSave(ctx);
  const [fix, setFix] = useState<AdminDayGame | null>(null);
  const [all, setAll] = useState(false);
  const [left, setLeft] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [skipTc, setSkipTc] = useState<string | null>(null);
  const rounds = Math.max(1, ...d.games.map((g) => g.round));
  const round = d.round ?? (d.games.every((g) => g.winner || g.skipped) ? rounds : 1);
  const inRound = d.games.filter((g) => g.round === round);
  const disputedElsewhere = d.games.filter((g) => g.disputed && g.round !== round);
  const doneIn = inRound.filter((g) => g.winner || g.skipped).length;
  const tc = d.timeCheck && d.timeCheck.key !== skipTc ? d.timeCheck : null;
  return (
    <>
      <section className="tm-gd-hero" aria-label={`${t.name}, round ${round} of ${rounds}`} data-tm-night>
        <div className="tm-gd-hero-top">
          <h2 className="tm-gd-hero-name">{t.name}</h2>
          <span className="tm-gd-hero-kicker" data-tm-night-round>
            {d.over ? 'Done' : `Round ${round} of ${rounds}`}
          </span>
        </div>
        <span className="tm-gd-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(((round - 1 + (inRound.length ? doneIn / inRound.length : 0)) / rounds) * 100)}%` }} />
        </span>
      </section>
      {d.paused && (
        <AlertCard as="section" tone="blue" icon="clock" label="Paused" title="Paused. Players see it." data={{ 'data-tm-paused': true }} />
      )}
      {tc && (
        <section className="tm-gd-tc" role="status" data-tm-time-check={`${tc.fromRound}:${tc.to}`}>
          <p className="tm-gd-tc-title">{tc.text.split('. ')[0]}.</p>
          <p className="tm-gd-tc-sub">{tc.text.split('. ').slice(1).join('. ')}</p>
          <div className="tm-gd-tc-actions">
            <button type="button" className="btn tm-gd-tc-go" disabled={busy} onClick={() => void save(() => gamesCall(t, { action: 'apply', fromRound: tc.fromRound, to: tc.to }), `Play to ${tc.to} from Round ${tc.fromRound}`)} data-tm-time-apply>
              Play to {tc.to} from Round {tc.fromRound}
            </button>
            <button type="button" className="btn secondary" onClick={() => setSkipTc(tc.key)} data-tm-time-later>
              Not now
            </button>
          </div>
        </section>
      )}
      {!tc && d.timeNote && (
        <p className="tm-gd-tc tm-gd-tc-note" role="status" data-tm-time-note>
          <b>Time check.</b> {d.timeNote}
        </p>
      )}
      <section className="tm-card tm-gd-card" aria-label={`Round ${round} results`} data-tm-round={round}>
        <div className="tm-card-head tm-head-line tm-gd-head">
          <h3 className="tm-label">Round {round} · Results</h3>
          <span className="tm-chip tm-chip-ok" data-tm-round-in>
            {doneIn} of {inRound.length} in
          </span>
        </div>
        <ul className="tm-gd-results">
          {[...inRound, ...disputedElsewhere].map((g) => (
            <ResultRow key={g.num} g={g} busy={busy} onFix={() => setFix(g)} onConfirm={() => void save(() => gamesCall(t, { action: 'result', num: g.num, winner: g.claim, seen: { claim: g.claim, winner: g.winner } }), 'Confirmed')} />
          ))}
        </ul>
        <span className="tm-gd-links">
          <button type="button" className="tm-gd-all" onClick={() => setAll(true)} data-tm-all-games>
            All games
          </button>
          <button type="button" className="tm-gd-all" onClick={() => setTeamsOpen(true)} data-tm-teams-open>
            Teams
          </button>
        </span>
      </section>
      <div className="tm-gd-pair-btns">
        <button type="button" className="btn big secondary" disabled={busy} onClick={() => void save(() => gamesCall(t, { action: d.paused ? 'resume' : 'pause' }), d.paused ? 'Back on' : 'Paused')} data-tm-pause>
          {d.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn big secondary" disabled={busy} onClick={() => setLeft(true)} data-tm-player-left>
          Player left
        </button>
      </div>
      <FixSheet ctx={ctx} t={t} g={fix} onClose={() => setFix(null)} />
      <Sheet calmFocus open={all} title="All games" onClose={() => setAll(false)} className="tm-gd-sheet">
        <ul className="tm-gd-results" data-tm-all-sheet>
          {d.games.map((g) => (
            <ResultRow key={g.num} g={g} busy={busy} label onFix={() => setFix(g)} onConfirm={() => void save(() => gamesCall(t, { action: 'result', num: g.num, winner: g.claim, seen: { claim: g.claim, winner: g.winner } }), 'Confirmed')} />
          ))}
        </ul>
      </Sheet>
      <PlayerLeftSheet ctx={ctx} t={t} d={d} open={left} onClose={() => setLeft(false)} round={round} />
      <Sheet calmFocus open={teamsOpen} title="Teams" onClose={() => setTeamsOpen(false)} className="tm-gd-sheet">
        {teamsOpen && <TeamList ctx={ctx} t={t} d={d} />}
      </Sheet>
    </>
  );
}

function ResultRow({ g, busy, onFix, onConfirm, label }: { g: AdminDayGame; busy: boolean; onFix: () => void; onConfirm: () => void; label?: boolean }) {
  const r = rowOf(g);
  const other = r.first === 'a' ? 'b' : 'a';
  return (
    <li className={`tm-gd-result tm-gd-${r.status.toLowerCase()}`} data-tm-result={g.num} data-status={r.status}>
      <span className="tm-gd-court">
        <b>{label ? stageName(g) : where(g)}</b>
        <span>{label ? `${where(g)} · ${r.status}` : r.status}</span>
      </span>
      <span className="tm-gd-result-text">
        <span className="tm-gd-side">
          <b>{sideName(g, r.first)}</b>
          {sidePlayers(g, r.first) && <span>{sidePlayers(g, r.first)}</span>}
        </span>
        <span className="tm-gd-word">{r.status === 'Playing' ? `${r.word} · to ${g.playTo}` : r.word}</span>
        <span className="tm-gd-side">
          <b>{sideName(g, other)}</b>
          {sidePlayers(g, other) && <span>{sidePlayers(g, other)}</span>}
        </span>
      </span>
      {r.button === 'confirm' ? (
        <button type="button" className="btn tm-gd-confirm" disabled={busy} onClick={onConfirm} data-tm-confirm={g.num}>
          Confirm
        </button>
      ) : r.button ? (
        <button type="button" className="tm-gd-swap" disabled={busy} onClick={onFix} data-tm-fix-game={g.num}>
          {r.button === 'set' ? 'Set' : r.button === 'decide' ? 'Decide' : 'Fix'}
        </button>
      ) : null}
    </li>
  );
}

/** Mock 49 for Locked doubles: who won (no scores in piece 3). Clear takes the result off. */
function FixSheet({ ctx, t, g, onClose }: { ctx: AdminCtx; t: AdminTournamentView; g: AdminDayGame | null; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const [pick, setPick] = useState<'a' | 'b' | null>(null);
  const [seen, setSeen] = useState<number | null>(null);
  if (g && seen !== g.num) {
    setSeen(g.num);
    setPick(g.winner ?? g.claim ?? null);
  }
  return (
    <Sheet calmFocus open={!!g} title={g ? `Fix · ${g.courtNumber ? `Court ${g.courtNumber}` : stageName(g)}` : 'Fix'} onClose={onClose} className="tm-gd-sheet">
      {g && (
        <div className="stack" data-tm-fix-sheet={g.num}>
          {(['a', 'b'] as const).map((s) => (
            <button key={s} type="button" className="tm-gd-pick" aria-pressed={pick === s} disabled={!g[s]} onClick={() => setPick(s)} data-tm-fix-pick={s}>
              <span className="tm-gd-side">
                <b className="tm-gd-pick-name">{sideName(g, s)}</b>
                {sidePlayers(g, s) && <span>{sidePlayers(g, s)}</span>}
              </span>
              <span className="tm-gd-pick-mark">{pick === s ? 'Won' : 'Pick'}</span>
            </button>
          ))}
          <button
            type="button"
            className="btn block big"
            disabled={busy || !pick}
            onClick={async () => {
              const ok = await save(() => gamesCall(t, { action: 'result', num: g.num, winner: pick, seen: { claim: g.claim, winner: g.winner } }), 'Saved');
              if (ok) onClose();
            }}
            data-tm-fix-save
          >
            Save
          </button>
          {(g.winner || g.claim || g.skipped) && (
            <button
              type="button"
              className="btn block ghost"
              disabled={busy}
              onClick={async () => {
                const ok = await save(() => gamesCall(t, { action: 'result', num: g.num, winner: null, seen: { claim: g.claim, winner: g.winner } }), 'Result cleared');
                if (ok) onClose();
              }}
              data-tm-fix-clear
            >
              Clear the result
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Mock 50: who left, then Swap in (locked in on no team, or paid standby) or Remove (the team sits out its later games). */
function PlayerLeftSheet({ ctx, t, d, open, onClose, round }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView; open: boolean; onClose: () => void; round: number }) {
  const { busy, save } = useSave(ctx);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [swapIn, setSwapIn] = useState<string | null | undefined>(undefined);
  const close = () => {
    setWho(null);
    setSwapIn(undefined);
    onClose();
  };
  const players = d.teams.filter((x) => !x.out).flatMap((x) => x.players.filter((p) => p.id).map((p) => ({ id: p.id!, name: p.name })));
  const first = d.spares[0] ?? null;
  const choice = swapIn === undefined ? (first ? first.id : null) : swapIn;
  return (
    <Sheet calmFocus open={open} title={who ? `${who.name} left` : 'Who left?'} onClose={close} className="tm-gd-sheet">
      {!who ? (
        <ul className="tm-gd-who-list" data-tm-left-pick>
          {players.map((p) => (
            <li key={p.id}>
              <button type="button" className="tm-gd-swaprow" onClick={() => setWho(p)} data-tm-left-who={p.name}>
                <span className="tm-gd-swapname">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="stack" data-tm-left-sheet>
          {d.spares.map((s) => (
            <button key={s.id} type="button" className="tm-gd-option" aria-pressed={choice === s.id} onClick={() => setSwapIn(s.id)} data-tm-left-swap={s.name}>
              <span className="tm-gd-option-text">
                <b>Swap in {s.name}</b>
                <span>
                  {s.standby ? 'From standby. ' : ''}Takes over {who.name}'s games from Round {round}.
                </span>
              </span>
              <span className="tm-gd-option-mark">{choice === s.id ? 'Picked' : 'Pick'}</span>
            </button>
          ))}
          <button type="button" className="tm-gd-option" aria-pressed={choice === null} onClick={() => setSwapIn(null)} data-tm-left-remove>
            <span className="tm-gd-option-text">
              <b>Remove {who.name}</b>
              <span>Finished games stay. The team's later games are skipped.</span>
            </span>
            <span className="tm-gd-option-mark">{choice === null ? 'Picked' : 'Pick'}</span>
          </button>
          <button
            type="button"
            className="btn block big"
            disabled={busy}
            onClick={async () => {
              const ok = await save(() => gamesCall(t, { action: 'left', playerId: who.id, ...(choice ? { swapIn: choice } : {}) }), choice ? 'Swapped in' : `${who.name}'s team sits out`);
              if (ok) close();
            }}
            data-tm-left-confirm
          >
            Confirm
          </button>
        </div>
      )}
    </Sheet>
  );
}
