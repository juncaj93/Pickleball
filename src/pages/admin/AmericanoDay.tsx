// Zip 61 (🎾61.americano), the Americano night, the ORGANIZER side (server/americanoDay.ts), built from zip 57's game-day controls
// (src/pages/admin/TournamentDay.tsx and its styles): the hero with the round, Pause, the Time check with one tap, the round's scores with
// Set and Fix (two numbers), Player left, and All rounds. Nothing waits for a Yes (Zip 71). Before the night: the rounds card with the courts' numbers.
// Only drawn while the switch is on and the tournament is Americano with tickets closed.
import { lazy, Suspense, useState } from 'react';
import type { AdminRoundGame, AdminRoundsView, AdminTournamentView } from '../../../shared/tournament';
import { api, ApiError, VIEW_ONLY_MESSAGE } from '../../lib';
import { AlertCard } from '../../AlertCard';
import { Sheet, useToast } from '../../ui';
import { MAX_SCORE, scoreHint } from '../../../shared/scores';
import type { AdminCtx } from '../Admin';
import { ScoreboardSheet } from './Scoreboard';
import { afterRoundWords, roundGame } from './scoreboardData';
import { NightCard as NightCardView } from './NightCard';
import { americanoNightModel, nightOnAt } from './nightCardData';
import { StandingsList } from './StandingsList';
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

/** The night is on (or about to be): from 30 minutes before the real start. */
function nightOn(ctx: AdminCtx, t: AdminTournamentView): boolean {
  // Zip 88: also from Start now's tap (nightOnAt).
  return nightOnAt(t, ctx.d.now, ctx.d.group.timezone);
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

/** Zip 82 (picture 4): every round as a scoreboard (src/pages/admin/Scoreboard.tsx), who sits under each round. */
function AllRoundsSheet({ r, open, onClose, onFix, busy, focusRound }: { r: AdminRoundsView; open: boolean; onClose: () => void; onFix?: (g: AdminRoundGame) => void; busy?: boolean; focusRound?: number }) {
  return (
    <ScoreboardSheet
      title="All rounds"
      open={open}
      focusRound={focusRound}
      onClose={onClose}
      games={r.games.map(roundGame)}
      sits={r.sits}
      busy={!!busy}
      onScore={(num) => {
        const g = r.games.find((x) => x.num === num);
        if (g && onFix) onFix(g);
      }}
      data="am"
    />
  );
}

/** Zip 82 (picture 2): the Standings sheet during the night (organizer only): the reveal board's rows as they stand. */
function StandingsSheet({ r, open, onClose }: { r: AdminRoundsView; open: boolean; onClose: () => void }) {
  // Review: the gold only once a score is in (before that everyone is level).
  const scored = r.games.some((g) => g.status === 'done');
  const rows = (r.standings ?? []).map((x, i) => ({ name: x.name, record: x.record, chip: `${x.points} pts`, ...(i === 0 && scored ? { medal: true as const } : {}), ...(x.out ? { out: true as const } : {}) }));
  return (
    <Sheet calmFocus open={open} title="Standings" onClose={onClose} className="tm-gd-sheet">
      {open && <StandingsList rows={rows} note={`${afterRoundWords(r.games)} Only you see this until the reveal.`} data="night" />}
    </Sheet>
  );
}

/**
 * Game night. Zip 88 (pictures 1 and 2): ONE card (src/pages/admin/NightCard.tsx): the name, the round bars, one box per court (rolling courts:
 * the game on each court now), who sits now, All rounds and Standings, Pause and Player left. Above it, as before: Paused and the Time check.
 */
function NightCard({ ctx, t, r }: { ctx: AdminCtx; t: AdminTournamentView; r: AdminRoundsView }) {
  const { busy, save } = useSave(ctx);
  const [fix, setFix] = useState<AdminRoundGame | null>(null);
  const [all, setAll] = useState<number | null>(null);
  const [standings, setStandings] = useState(false);
  const [left, setLeft] = useState(false);
  const [skipTc, setSkipTc] = useState<string | null>(null);
  const m = americanoNightModel(r);
  const round = r.round ?? (m.allIn ? Math.max(1, r.plan.rounds) : 1);
  const tc = r.timeCheck && r.timeCheck.key !== skipTc ? r.timeCheck : null;
  return (
    <>
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
      <NightCardView
        name={t.name}
        m={m}
        busy={busy}
        paused={r.paused}
        onScore={(num) => setFix(r.games.find((g) => g.num === num) ?? null)}
        onBar={(n) => setAll(n)}
        onAll={() => setAll(0)}
        onStandings={() => setStandings(true)}
        onPause={() => void save(() => gamesCall(t, { action: r.paused ? 'resume' : 'pause' }), r.paused ? 'Back on' : 'Paused')}
        onLeft={() => setLeft(true)}
        bonus={r.bonus}
        warmUp={!!r.warmUp}
        breakNow={r.breakNow ?? null}
        onSkipBreak={() => void save(() => gamesCall(t, { action: 'skipBreak' }), 'Break skipped')}
        holdBonus={left}
        onBonus={(key) => void save(() => gamesCall(t, { action: 'bonus', key }), `Round ${Math.max(0, ...r.games.map((g) => g.round)) + 1} added`)}
      />
      <FixSheet ctx={ctx} t={t} g={fix} onClose={() => setFix(null)} />
      <AllRoundsSheet r={r} open={all !== null} focusRound={all || undefined} onClose={() => setAll(null)} busy={busy} onFix={(g) => setFix(g)} />
      <StandingsSheet r={r} open={standings} onClose={() => setStandings(false)} />
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
    // Zip 77 (the 🎾75 audit): a game with no score yet is Set (the button said Set); Fix once it has one.
    <Sheet calmFocus open={!!g} title={g ? `${g.status === 'done' ? 'Fix' : 'Set'} · Round ${g.round} · ${where(g)}` : 'Fix'} onClose={onClose} className="tm-gd-sheet">
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
