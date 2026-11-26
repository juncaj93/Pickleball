// Zip 95 (🎾95.level check, pictures 1 and 2): after a tournament ends, the card at the very top of the organizer's Home. Kicker
// "LEVEL CHECK · THE COLD OPEN", title "Suggest a higher level next time?", one row per player who played above their level (the rules:
// shared/levelCheck.ts): the name, a gray line ("3.0 · won all 5 games"), No (outlined) and Yes (green). No: the row goes. Yes: the row shows
// every level above theirs as round choices, the next step up picked, and Save; Save: the row goes. The card goes when every row is answered,
// or 3 days after the tournament ended. The player never sees No; a saved level shows at their next sign-up as RECOMMENDED.
// Each row is its own <article>, so the browser tests' "one green button per card" rule judges a row at a time (picture 1 has a Yes on every
// row); the level choices are radio inputs (a state, like the court switch), so Save stays the row's one green button.
import { useEffect, useId, useRef, useState } from 'react';
import { levelsAbove, type LevelCheckRow } from '../../../shared/levelCheck';
import { levelLabel } from '../../../shared/tournament';
import { api, ApiError } from '../../lib';
import { useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { useServerNow } from './DoNowCard';
import './level-check.css';

export function LevelCheckCard({ ctx }: { ctx: AdminCtx }) {
  const check = ctx.d.levelCheck;
  const nowMs = useServerNow(ctx.d.now);
  // Rows answered on this phone ('<tournament>:<player>'), gone at once (the save runs behind; a failure puts the row back).
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const card = useRef<HTMLElement>(null);
  const toast = useToast();
  if (!check || Date.parse(check.until) <= nowMs) return null;
  const keyOf = (r: LevelCheckRow) => `${check.tournamentId}:${r.playerId}`;
  const rows = check.rows.filter((r) => !gone.has(keyOf(r)));
  if (!rows.length) return null;
  async function answer(r: LevelCheckRow, level: number | null) {
    // The keyboard and screen reader move on to the next row's first button (never lost to the page).
    const next = rows[rows.indexOf(r) + 1] ?? rows[rows.indexOf(r) - 1];
    setGone((g) => new Set(g).add(keyOf(r)));
    if (next) requestAnimationFrame(() => card.current?.querySelector<HTMLButtonElement>(`[data-level-check-row="${CSS.escape(next.name)}"] button`)?.focus());
    try {
      await api('POST', '/api/admin/level-check', { tournamentId: check!.tournamentId, playerId: r.playerId, level });
      toast(level === null ? `${r.name} stays at ${levelLabel(r.level)}` : `${r.name}: ${levelLabel(level)} suggested next time`);
      void ctx.reload();
    } catch (err) {
      setGone((g) => {
        const next = new Set(g);
        next.delete(keyOf(r));
        return next;
      });
      toast(err instanceof ApiError || err instanceof Error ? err.message : 'Could not save. Try again.', 'error');
      if (err instanceof ApiError && err.status === 409) void ctx.reload();
    }
  }
  return (
    <section ref={card} className="card lc-card" aria-labelledby="lc-title" data-level-check={rows.length}>
      <p className="lc-kicker">
        Level check · <span className="lc-kicker-name">{check.name}</span>
      </p>
      <h2 id="lc-title" className="lc-title">
        Suggest a higher level next time?
      </h2>
      <div className="lc-rows">
        {rows.map((r) => (
          <LevelCheckRowView key={r.playerId} row={r} onAnswer={(level) => void answer(r, level)} />
        ))}
      </div>
    </section>
  );
}

function LevelCheckRowView({ row, onAnswer }: { row: LevelCheckRow; onAnswer: (level: number | null) => void }) {
  const above = levelsAbove(row.level);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<number>(above[0]);
  const name = useId();
  const firstChoice = useRef<HTMLInputElement>(null);
  // Yes: the keyboard and screen reader land on the picked level.
  useEffect(() => {
    if (picking) firstChoice.current?.focus();
  }, [picking]);
  return (
    <article className="lc-row" aria-label={row.name} data-level-check-row={row.name} data-picking={picking ? 'yes' : 'no'}>
      <div className="lc-who">
        <strong className="lc-name">{row.name}</strong>
        <span className="lc-line">{row.line}</span>
      </div>
      {picking ? (
        <div className="lc-pick">
          <div className="lc-levels" role="radiogroup" aria-label={`Level for ${row.name} next time`}>
            {above.map((v) => (
              <label key={v} className={`lc-level${v === pick ? ' lc-level-on' : ''}`} data-lc-level={v}>
                <input
                  ref={v === pick ? firstChoice : undefined}
                  type="radio"
                  className="lc-level-input"
                  name={name}
                  value={v}
                  checked={v === pick}
                  onChange={() => setPick(v)}
                />
                <span>{levelLabel(v)}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn small lc-save" onClick={() => onAnswer(pick)} data-lc-save>
            Save
          </button>
        </div>
      ) : (
        <div className="lc-acts">
          <button type="button" className="btn small ghost lc-no" onClick={() => onAnswer(null)} data-lc-no>
            No
          </button>
          <button type="button" className="btn small lc-yes" onClick={() => setPicking(true)} data-lc-yes>
            Yes
          </button>
        </div>
      )}
    </article>
  );
}
