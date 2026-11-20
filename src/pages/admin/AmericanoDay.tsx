// Zip 61 (🎾61.americano), the Americano night, the ORGANIZER side (server/americanoDay.ts), built from zip 57's game-day controls
// (src/pages/admin/TournamentDay.tsx and its styles): the hero with the round, Pause, the Time check with one tap, the round's scores with
// Set and Fix (two numbers), Player left, and All rounds. Nothing waits for a Yes (Zip 71). Before the night: the rounds card with the courts' numbers.
// Only drawn while the switch is on and the tournament is Americano with tickets closed.
import { lazy, Suspense, useState } from 'react';
import type { AdminRoundGame, AdminRoundsView, AdminTournamentView } from '../../../shared/tournament';
import { startMsOf } from '../../../shared/tournamentTickets';
import { api, ApiError, VIEW_ONLY_MESSAGE } from '../../lib';
import { AlertCard } from '../../AlertCard';
import { Sheet, useToast } from '../../ui';
import { MAX_SCORE, scoreHint } from '../../../shared/scores';
import type { AdminCtx } from '../Admin';
import './tournament-day.css';

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

const gamesCall = (t: AdminTournamentView, body: Record<string, unknown>) => api('POST', `/api/admin/tournament/${t.id}/games`, body);
const pair = (names: string[]) => names.join(' + ');
const where = (g: AdminRoundGame) => `Court ${g.courtNumber ?? g.court}`;
const STATUS: Record<AdminRoundGame['status'], string> = { done: 'Done', playing: 'Playing', later: 'Later', skipped: 'Off' };

/** The night is on (or about to be): from 30 minutes before the real start. */
function nightOn(ctx: AdminCtx, t: AdminTournamentView): boolean {
  if (!t.finalDate || !t.startSet) return false;
  return Date.parse(ctx.d.now) >= startMsOf(t.finalDate, t.start, ctx.d.group.timezone) - 30 * 60_000;
}

/** Everything zip 61 adds to the organizer's Home (first on it), for an Americano night. */
export function AmericanoCards({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const r = t.rounds;
  if (!r) return null;
  return (
    <>
      {r.tied && r.tied.length > 0 && (
        <AlertCard as="section" tone="amber" icon="info" label="Tied" title={`Tied at the end: ${r.tied.join(', ')}.`} sub="Same wins and points. Settle it on the court." data={{ 'data-tm-am-tied': true }} />
      )}
      {nightOn(ctx, t) ? <NightCard ctx={ctx} t={t} r={r} /> : <RoundsCard ctx={ctx} t={t} r={r} />}
    </>
  );
}

/** Before the night: the rounds (who plays and sits each round), the courts' numbers, the plan line. */
function RoundsCard({ ctx, t, r }: { ctx: AdminCtx; t: AdminTournamentView; r: AdminRoundsView }) {
  const { save } = useSave(ctx);
  const [all, setAll] = useState(false);
  const [nums, setNums] = useState<(number | null)[]>(() => Array.from({ length: r.courts }, (_, i) => r.courtNumbers?.[i] ?? null));
  const setCourt = (i: number, n: number | null) => {
    const next = [...nums];
    next[i] = n;
    setNums(next);
    if (next.every((x): x is number => x !== null) && new Set(next).size === next.length)
      void save(() => api('POST', `/api/admin/tournament/${t.id}/teams`, { action: 'courts', numbers: next }), `Courts ${next.join(' and ')}`);
  };
  const sitEach = r.sits[0]?.names.length ?? 0;
  return (
    <section className="tm-card tm-gd-card" aria-label="Rounds" data-tm-am-rounds={r.plan.rounds}>
      <div className="tm-card-head tm-head-line tm-gd-head">
        <h3 className="tm-label">Rounds</h3>
        <span className="tm-chip tm-chip-ok">Americano</span>
      </div>
      <p className="tm-card-note" data-tm-am-plan>
        {r.lockedIn} locked in. {r.plan.rounds} rounds to {r.plan.gameTo}
        {sitEach ? `, ${sitEach} sit${sitEach === 1 ? 's' : ''} each round` : ''}.{r.plan.fits ? '' : ' Too tight: games to 7.'} New partner every round.
      </p>
      <div className="tm-gd-courts" data-tm-courts>
        <Suspense fallback={null}>
          {nums.map((n, i) => (
            <CourtRow key={i} value={n} onChange={(c) => setCourt(i, c)} />
          ))}
        </Suspense>
      </div>
      <button type="button" className="tm-gd-all" onClick={() => setAll(true)} data-tm-am-all>
        All rounds
      </button>
      <AllRoundsSheet r={r} open={all} onClose={() => setAll(false)} />
    </section>
  );
}

/** Every round: its games and who sits (the organizer sees the whole night). */
function AllRoundsSheet({ r, open, onClose, onFix, busy }: { r: AdminRoundsView; open: boolean; onClose: () => void; onFix?: (g: AdminRoundGame) => void; busy?: boolean }) {
  const rounds = [...new Set(r.games.map((g) => g.round))];
  return (
    <Sheet calmFocus open={open} title="All rounds" onClose={onClose} className="tm-gd-sheet">
      <div className="stack" data-tm-am-all-sheet>
        {rounds.map((n) => (
          <section key={n} aria-label={`Round ${n}`}>
            <h4 className="tm-label tm-am-round-label">Round {n}</h4>
            <ul className="tm-gd-results">
              {r.games
                .filter((g) => g.round === n)
                .map((g) => (
                  <ScoreRow key={g.num} g={g} busy={!!busy} onFix={onFix ? () => onFix(g) : undefined} />
                ))}
            </ul>
            {(r.sits.find((s) => s.round === n)?.names.length ?? 0) > 0 && <p className="tm-card-note tm-am-sits">Sitting: {r.sits.find((s) => s.round === n)!.names.join(', ')}</p>}
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/** One game: where and how it stands, the two pairs (the winners first once there is a score), the score, the button it needs. */
function ScoreRow({ g, busy, onFix, round }: { g: AdminRoundGame; busy: boolean; onFix?: () => void; round?: number }) {
  const scored = g.scoreA !== null && g.scoreB !== null;
  const aFirst = !scored || g.scoreA! > g.scoreB!;
  const [first, second] = aFirst ? [g.a, g.b] : [g.b, g.a];
  const [s1, s2] = aFirst ? [g.scoreA, g.scoreB] : [g.scoreB, g.scoreA];
  const button = g.status === 'done' ? 'Fix' : g.status === 'playing' || g.status === 'later' ? 'Set' : null;
  const status = STATUS[g.status];
  return (
    <li className={`tm-gd-result tm-gd-${g.status}`} data-tm-am-game={g.num} data-status={g.status}>
      <span className="tm-gd-court">
        <b>{round !== undefined && g.round !== round ? `Round ${g.round} · ${where(g)}` : where(g)}</b>
        {/* Late says how long instead of the plain status ("8 min over"). */}
        <span className={g.late ? 'tm-am-late' : undefined}>{g.late ?? status}</span>
      </span>
      <span className="tm-gd-result-text">
        <span className="tm-gd-side">
          <b>{pair(first.names)}</b>
        </span>
        <span className="tm-gd-word" data-tm-am-score>
          {g.status === 'skipped'
            ? `${g.by ?? 'A player'} left`
            : scored
              ? `${s1} to ${s2}`
              : `vs · to ${g.playTo}`}
        </span>
        <span className="tm-gd-side">
          <b>{pair(second.names)}</b>
        </span>
      </span>
      {button && onFix ? (
        <button type="button" className="tm-gd-swap" disabled={busy} onClick={onFix} data-tm-am-fix={g.num}>
          {button}
        </button>
      ) : null}
    </li>
  );
}

/** Game night: the hero with the round, Pause, the Time check, the round's scores, Player left, All rounds. */
function NightCard({ ctx, t, r }: { ctx: AdminCtx; t: AdminTournamentView; r: AdminRoundsView }) {
  const { busy, save } = useSave(ctx);
  const [fix, setFix] = useState<AdminRoundGame | null>(null);
  const [all, setAll] = useState(false);
  const [left, setLeft] = useState(false);
  const [skipTc, setSkipTc] = useState<string | null>(null);
  const rounds = Math.max(1, r.plan.rounds);
  const round = r.round ?? (r.games.length && r.games.every((g) => g.status === 'done' || g.status === 'skipped') ? rounds : 1);
  const inRound = r.games.filter((g) => g.round === round);
  const doneIn = inRound.filter((g) => g.status === 'done' || g.status === 'skipped').length;
  const sits = r.sits.find((s) => s.round === round)?.names ?? [];
  const tc = r.timeCheck && r.timeCheck.key !== skipTc ? r.timeCheck : null;
  const allDone = r.games.length > 0 && r.games.every((g) => g.status === 'done' || g.status === 'skipped');
  return (
    <>
      <section className="tm-gd-hero" aria-label={`${t.name}, round ${round} of ${rounds}`} data-tm-night data-tm-am-night>
        <div className="tm-gd-hero-top">
          <h2 className="tm-gd-hero-name">{t.name}</h2>
          <span className="tm-gd-hero-kicker" data-tm-night-round>
            {allDone ? 'Done' : `Round ${round} of ${rounds}`}
          </span>
        </div>
        <span className="tm-gd-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(((allDone ? rounds : round - 1 + (inRound.length ? doneIn / inRound.length : 0)) / rounds) * 100)}%` }} />
        </span>
      </section>
      {r.paused && <AlertCard as="section" tone="blue" icon="clock" label="Paused" title="Paused. Players see it." data={{ 'data-tm-paused': true }} />}
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
      {!tc && r.timeNote && (
        <p className="tm-gd-tc tm-gd-tc-note" role="status" data-tm-time-note>
          <b>Time check.</b> {r.timeNote}
        </p>
      )}
      <section className="tm-card tm-gd-card" aria-label={`Round ${round} scores`} data-tm-round={round}>
        <div className="tm-card-head tm-head-line tm-gd-head">
          <h3 className="tm-label">Round {round} · Scores</h3>
          <span className="tm-chip tm-chip-ok" data-tm-round-in>
            {doneIn} of {inRound.length} in
          </span>
        </div>
        <ul className="tm-gd-results">
          {inRound.map((g) => (
            <ScoreRow key={g.num} g={g} busy={busy} round={round} onFix={() => setFix(g)} />
          ))}
        </ul>
        {sits.length > 0 && (
          <p className="tm-card-note tm-am-sits" data-tm-am-sits>
            Sitting: {sits.join(', ')}
          </p>
        )}
        <span className="tm-gd-links">
          <button type="button" className="tm-gd-all" onClick={() => setAll(true)} data-tm-am-all>
            All rounds
          </button>
        </span>
      </section>
      <div className="tm-gd-pair-btns">
        <button type="button" className="btn big secondary" disabled={busy} onClick={() => void save(() => gamesCall(t, { action: r.paused ? 'resume' : 'pause' }), r.paused ? 'Back on' : 'Paused')} data-tm-pause>
          {r.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn big secondary" disabled={busy} onClick={() => setLeft(true)} data-tm-player-left>
          Player left
        </button>
      </div>
      <FixSheet ctx={ctx} t={t} g={fix} onClose={() => setFix(null)} />
      <AllRoundsSheet r={r} open={all} onClose={() => setAll(false)} busy={busy} onFix={(g) => setFix(g)} />
      <LeftSheet ctx={ctx} t={t} r={r} open={left} onClose={() => setLeft(false)} round={round} />
    </>
  );
}

/** One side's number with − and + (44 px). Zip 72: Locked doubles' Fix sheet uses it too (src/pages/admin/TournamentDay.tsx). */
export function Stepper({ label, value, onChange, id }: { label: string; value: number; onChange: (next: (n: number) => number) => void; id: string }) {
  // One more or one less than the number as it is now (never a number from an earlier draw, so quick taps all count).
  const step = (d: number) => onChange((n) => Math.max(0, Math.min(MAX_SCORE, n + d)));
  return (
    <div className="tm-am-step-row" data-tm-am-step={id}>
      <span className="tm-am-step-name">{label}</span>
      <span className="tm-am-step-ctl">
        <button type="button" className="tm-am-step" aria-label={`${label}: one less`} onClick={() => step(-1)} disabled={value <= 0} data-tm-am-minus={id} data-tap-repeat>
          −
        </button>
        <b className="tm-am-step-num" data-tm-am-num={id}>
          {value}
        </b>
        <button type="button" className="tm-am-step" aria-label={`${label}: one more`} onClick={() => step(1)} disabled={value >= MAX_SCORE} data-tm-am-plus={id} data-tap-repeat>
          +
        </button>
      </span>
    </div>
  );
}

/** Fix (zip 57's sheet, with two numbers): set or change a game's score; it stands. Clear takes it off. */
function FixSheet({ ctx, t, g, onClose }: { ctx: AdminCtx; t: AdminTournamentView; g: AdminRoundGame | null; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const [a, setA] = useState(11);
  const [b, setB] = useState(0);
  const [seen, setSeen] = useState<string | null>(null);
  if (g && seen !== `${g.num}:${g.stamp}`) {
    setSeen(`${g.num}:${g.stamp}`);
    setA(g.scoreA ?? g.playTo);
    setB(g.scoreB ?? 0);
  }
  return (
    <Sheet calmFocus open={!!g} title={g ? `Fix · Round ${g.round} · ${where(g)}` : 'Fix'} onClose={onClose} className="tm-gd-sheet">
      {g && (
        <div className="stack" data-tm-am-fix-sheet={g.num}>
          <Stepper label={pair(g.a.names)} value={a} onChange={setA} id="a" />
          <Stepper label={pair(g.b.names)} value={b} onChange={setB} id="b" />
          {scoreHint(a, b, g.playTo) && (
            <p className="tm-am-hint" role="status" data-tm-score-hint>
              {scoreHint(a, b, g.playTo)}
            </p>
          )}
          <button
            type="button"
            className="btn block big"
            disabled={busy || a === b}
            onClick={async () => {
              if (await save(() => gamesCall(t, { action: 'score', num: g.num, a, b, seen: g.stamp }), 'Saved')) onClose();
            }}
            data-tm-am-save
          >
            Save
          </button>
          {g.scoreA !== null && (
            <button
              type="button"
              className="btn block ghost"
              disabled={busy}
              onClick={async () => {
                if (await save(() => gamesCall(t, { action: 'clear', num: g.num, seen: g.stamp }), 'Score cleared')) onClose();
              }}
              data-tm-am-clear
            >
              Clear the score
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Player left (zip 57's sheet): who left, then Remove: their later games are skipped; the others in them sit those rounds and are told. */
function LeftSheet({ ctx, t, r, open, onClose, round }: { ctx: AdminCtx; t: AdminTournamentView; r: AdminRoundsView; open: boolean; onClose: () => void; round: number }) {
  const { busy, save } = useSave(ctx);
  const toast = useToast();
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const close = () => {
    setWho(null);
    onClose();
  };
  return (
    <Sheet calmFocus open={open} title={who ? `${who.name} left` : 'Who left?'} onClose={close} className="tm-gd-sheet">
      {!who ? (
        <ul className="tm-gd-who-list" data-tm-left-pick>
          {r.players
            .filter((p) => !p.left)
            .map((p) => (
              <li key={p.id}>
                <button type="button" className="tm-gd-swaprow" onClick={() => setWho(p)} data-tm-left-who={p.name}>
                  <span className="tm-gd-swapname">{p.name}</span>
                </button>
              </li>
            ))}
        </ul>
      ) : (
        <div className="stack" data-tm-left-sheet>
          <div className="tm-gd-option" aria-pressed="true">
            <span className="tm-gd-option-text">
              <b>Remove {who.name}</b>
              <span>Finished games stay. Their games from Round {round} on are off; the others in them sit and are told.</span>
            </span>
          </div>
          <button
            type="button"
            className="btn block big"
            disabled={busy}
            onClick={async () => {
              let skipped = 0;
              const ok = await save(async () => {
                skipped = Number(((await gamesCall(t, { action: 'left', playerId: who.id })) as { skipped?: number }).skipped ?? 0);
              }, '');
              if (ok) {
                toast(skipped ? `${who.name} is out. ${skipped} ${skipped === 1 ? 'game is' : 'games are'} off.` : `${who.name} had no games left.`);
                close();
              }
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
