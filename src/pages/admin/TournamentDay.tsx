// Zip 57 (🎾57.tourney3), "Tournaments" piece 3, the ORGANIZER side (server/tournamentDay.ts): Draft teams (mock 15) with Swap, a team's
// name, Redo the draw and Publish teams; the published teams with the venue's court numbers; the check when tickets close; Fix teams after a
// back out; and game night (mocks 48 to 50; Zip 72: every Locked doubles game has a score): the round's results ("Net Ninjas 11 to 7 Third Shot
// Gang") with Set and Fix (picture pair-5: the two team names with − and +, Save; any game, also when nobody in it has a phone), the Time check
// with one tap, Pause and Player left. Nothing waits for a Yes (Zip 71). Only drawn while the switch is on and a tournament has tickets open.
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import type { AdminDayGame, AdminDayTeam, AdminDayView, AdminTournamentView } from '../../../shared/tournament';
import { levelShort } from '../../../shared/tournament';
import { groupName, totalLabel } from '../../../shared/tournamentSchedule';
import { api, ApiError, VIEW_ONLY_MESSAGE } from '../../lib';
import { AlertCard } from '../../AlertCard';
import { Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import './tournament-day.css';
import { AmericanoCards, Stepper } from './AmericanoDay';
import { scoreHint } from '../../../shared/scores';
import { AdminTieCards, EndCards } from './TournamentEnd';
import { ScoreboardSheet } from './Scoreboard';
import { boardGame, firstOpenRound } from './scoreboardData';
import { NightCard as NightCardView } from './NightCard';
import { doublesNightModel, nightOnAt } from './nightCardData';
import { StandingsList } from './StandingsList';

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
  // Zip 88: also from Start now's tap (nightOnAt).
  return nightOnAt(t, ctx.d.now, ctx.d.group.timezone);
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
      {/* Zip 58: once the Final (or the last round) is in, End tournament replaces the round results, Pause and Player left. */}
      {t.end ? (
        <EndCards ctx={ctx} t={t} end={t.end} />
      ) : (
        <>
          {d && d.phase === 'published' && t.format === 'doubles' && (nightOn(ctx, t) ? <NightControls ctx={ctx} t={t} d={d} /> : <PublishedCard ctx={ctx} t={t} d={d} />)}
          {/* Zip 61: the Americano night (the rounds before it; on the night the scores, the Time check, Pause, Player left). */}
          {t.format === 'americano' && t.rounds && <AmericanoCards ctx={ctx} t={t} />}
        </>
      )}
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
                {team.pool && <span className="tm-gd-poolmark"> · {groupName(team.pool, true)}</span>}
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
        {d.plan ? `${d.games.length} games. ${d.plan.fits ? '' : 'Too tight: games to 7. '}Group games to ${d.plan.gameTo}.` : ''} Game 1 begins at the start time.
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
const where = (g: AdminDayGame) => (g.courtNumber ? `Court ${g.courtNumber}` : `Court ${g.court}`);
const stageName = (g: AdminDayGame) => (g.tieLabel ? g.tieLabel : g.stage === 'semi' ? 'Semifinal' : g.stage === 'final' ? (g.finalGame ? `Final · Game ${g.finalGame}` : 'Final') : g.stage === 'third' ? '3rd place' : `Game ${g.num}`);

/** What the organizer's screen showed for a game (sent back with Fix and Clear, so a change in between is caught). */
const seenOf = (g: AdminDayGame) => ({ winner: g.skipped ? null : g.winner, scoreA: g.scoreA, scoreB: g.scoreB });

/**
 * Game night. Zip 88 (picture 3): ONE card (src/pages/admin/NightCard.tsx): the name, the round bars (then SEMIS / FINAL), one box per court
 * (rolling courts: the game on each court now), who sits now, All rounds and Standings, Pause and Player left. Above it, as before: Paused, a
 * tie's cards and the Time check.
 */
function NightControls({ ctx, t, d }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView }) {
  const { busy, save } = useSave(ctx);
  const [fix, setFix] = useState<AdminDayGame | null>(null);
  const [all, setAll] = useState<number | null>(null);
  const [left, setLeft] = useState(false);
  const [standingsOpen, setStandingsOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [skipTc, setSkipTc] = useState<string | null>(null);
  const rounds = Math.max(1, ...d.games.map((g) => g.round));
  const round = d.round ?? (d.games.every((g) => g.winner || g.skipped) ? rounds : 1);
  const tc = d.timeCheck && d.timeCheck.key !== skipTc ? d.timeCheck : null;
  const m = doublesNightModel(d);
  return (
    <>
      {d.paused && (
        <AlertCard as="section" tone="blue" icon="clock" label="Paused" title="Paused. Players see it." data={{ 'data-tm-paused': true }} />
      )}
      {/* Zip 58: a tie for a playoff place (the wheel, or the organizer's picks), first. */}
      <AdminTieCards ctx={ctx} t={t} d={d} />
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
      <NightCardView
        name={t.name}
        m={m}
        busy={busy}
        paused={d.paused}
        onScore={(num) => setFix(d.games.find((g) => g.num === num) ?? null)}
        onBar={(n) => setAll(n)}
        onAll={() => setAll(0)}
        onStandings={() => setStandingsOpen(true)}
        onPause={() => void save(() => gamesCall(t, { action: d.paused ? 'resume' : 'pause' }), d.paused ? 'Back on' : 'Paused')}
        onLeft={() => setLeft(true)}
        bonus={d.bonus}
        warmUp={!!d.warmUp}
        breakNow={d.breakNow ?? null}
        onSkipBreak={() => void save(() => gamesCall(t, { action: 'skipBreak' }), 'Break skipped')}
        holdBonus={left || !!d.fix}
        onBonus={(key) => void save(() => gamesCall(t, { action: 'bonus', key }), d.bonus?.kind === 'semis' ? 'Semifinals added' : d.bonus?.kind === 'bestOf3' ? 'The Final is best of 3' : 'Round added')}
      />
      <FixSheet ctx={ctx} t={t} g={fix} onClose={() => setFix(null)} />
      {/* Zip 82 (picture 3): every game as a scoreboard; Enter score and Fix open the same score sheet. Zip 88: "All rounds" on both styles. */}
      <ScoreboardSheet
        title="All rounds"
        open={all !== null}
        focusRound={all || undefined}
        onClose={() => setAll(null)}
        games={d.games.map((g) => boardGame(g, d, firstOpenRound(d.games)))}
        busy={busy}
        onScore={(num) => {
          const g = d.games.find((x) => x.num === num);
          if (g) setFix(g);
        }}
        data="ld"
      />
      <PlayerLeftSheet ctx={ctx} t={t} d={d} open={left} onClose={() => setLeft(false)} round={round} />
      <Sheet calmFocus open={standingsOpen} title="Standings" onClose={() => setStandingsOpen(false)} className="tm-gd-sheet">
        {standingsOpen && (
          <div className="stack" data-tm-ld-standings>
            {(d.standings ?? []).map((grp) => (
              <StandingsList key={grp.pool ?? 'P'} rows={grp.rows} note={grp.pool ? `${groupName(grp.pool)} · W-L, then point difference.` : 'W-L, then point difference.'} data={`ld-${grp.pool ?? 'P'}`} />
            ))}
            <button
              type="button"
              className="tm-gd-all"
              onClick={() => {
                setStandingsOpen(false);
                setTeamsOpen(true);
              }}
              data-tm-teams-open
            >
              Teams
            </button>
          </div>
        )}
      </Sheet>
      <Sheet calmFocus open={teamsOpen} title="Teams" onClose={() => setTeamsOpen(false)} className="tm-gd-sheet">
        {teamsOpen && <TeamList ctx={ctx} t={t} d={d} />}
      </Sheet>
    </>
  );
}

/**
 * Zip 72 (picture pair-5): "Fix Game 1 · Court 1", the two team names with − and + (the organizer's steppers, as on an Americano night), Save.
 * Any game whose two teams are known, with or without a result (Set on a game nobody in it entered, for a court with no phones). The score is
 * the result. Clear takes it off (the game is to play again). An odd score gets one gentle line and can still be saved.
 */
function FixSheet({ ctx, t, g, onClose }: { ctx: AdminCtx; t: AdminTournamentView; g: AdminDayGame | null; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const [a, setA] = useState(11);
  const [b, setB] = useState(0);
  const [seen, setSeen] = useState<string | null>(null);
  const stamp = g ? `${g.num}:${g.winner ?? ''}:${g.scoreA ?? ''}:${g.scoreB ?? ''}:${g.skipped ? 1 : 0}` : null;
  if (g && seen !== stamp) {
    setSeen(stamp);
    // The score as it stands; with none, the winner (or side a) at the game's length.
    const won = g.winner ?? 'a';
    setA(g.scoreA ?? (won === 'a' ? g.playTo : 0));
    setB(g.scoreB ?? (won === 'b' ? g.playTo : 0));
  }
  const ready = !!g?.a && !!g?.b;
  // Zip 72 (review): a result saved before scores existed has a winner and no score: say so, so Save is never an accidental 11 to 0.
  const noScore = !!g && !!g.winner && !g.skipped && g.scoreA === null;
  const hint = g && ready ? (noScore ? 'No score was saved for this game. Enter it, then Save.' : scoreHint(a, b, g.playTo)) : null;
  return (
    // Zip 77 (the 🎾75 audit): a game with no result yet is Set (the button said Set); Fix once it has one. The 11 to 0 start stays (Alex).
    <Sheet calmFocus open={!!g} title={g ? `${g.winner || g.skipped ? 'Fix' : 'Set'} ${stageName(g)} · ${where(g)}` : 'Fix'} onClose={onClose} className="tm-gd-sheet">
      {g && (
        <div className="stack" data-tm-fix-sheet={g.num}>
          {ready ? (
            <>
              <Stepper label={sideName(g, 'a')} value={a} onChange={setA} id="a" />
              <Stepper label={sideName(g, 'b')} value={b} onChange={setB} id="b" />
              {hint && (
                <p className="tm-am-hint" role="status" data-tm-score-hint>
                  {hint}
                </p>
              )}
              <button
                type="button"
                className="btn block big"
                disabled={busy || a === b}
                onClick={async () => {
                  const ok = await save(() => gamesCall(t, { action: 'result', num: g.num, a, b, seen: seenOf(g) }), 'Saved');
                  if (ok) onClose();
                }}
                data-tm-fix-save
              >
                Save
              </button>
            </>
          ) : (
            <p className="tm-card-note">The teams for this game aren’t set yet.</p>
          )}
          {(g.winner || g.skipped) && (
            <button
              type="button"
              className="btn block ghost"
              disabled={busy}
              onClick={async () => {
                const ok = await save(() => gamesCall(t, { action: 'result', num: g.num, winner: null, seen: seenOf(g) }), 'Result cleared');
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
                  {s.standby ? 'From standby. ' : ''}Takes over {who.name}’s games from Round {round}.
                </span>
              </span>
              <span className="tm-gd-option-mark">{choice === s.id ? 'Picked' : 'Pick'}</span>
            </button>
          ))}
          <button type="button" className="tm-gd-option" aria-pressed={choice === null} onClick={() => setSwapIn(null)} data-tm-left-remove>
            <span className="tm-gd-option-text">
              <b>Remove {who.name}</b>
              <span>Finished games stay. The team’s later games are skipped.</span>
            </span>
            <span className="tm-gd-option-mark">{choice === null ? 'Picked' : 'Pick'}</span>
          </button>
          <button
            type="button"
            className="btn block big"
            disabled={busy}
            onClick={async () => {
              const ok = await save(() => gamesCall(t, { action: 'left', playerId: who.id, ...(choice ? { swapIn: choice } : {}) }), choice ? 'Swapped in' : `${who.name}’s team sits out`);
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
