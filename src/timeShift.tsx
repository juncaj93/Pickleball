// "Time may shift" on the screens (SPEC items 1, 2, 3 and 6). Display and one tap only: Still in records the
// answer; Can't make it hands over to the game card's own Drop out flow (same 5-second Undo, same credit
// banner). Nothing here moves money or a seat by itself. Off when the TIME_SHIFT switch is off.

import { AlertCard } from './AlertCard';
import { useEffect, useRef, useState } from 'react';
import type { GroupView, PlayerSessionView } from '../shared/api';
import { api, ApiError, isDemo } from './lib';
import { holdLive } from './busy';
import { useToast } from './ui';
import { type TsKind, tsLines } from './timeShiftText';
import './time-shift.css';

export { stillInText, tsDay, tsKind, tsLines, tsTime, type TsKind } from './timeShiftText';

// The last look each game was drawn with on this screen, so a game that flips from Waitlist to Booked while
// the page is open gets the short pop once (and a fresh page load never animates).
const lastKind = new Map<string, TsKind | null>();

/** True for a moment after this game's court flipped from Waitlist to Booked on screen. */
export function useCourtFlip(id: string, kind: TsKind | null): boolean {
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    const before = lastKind.get(id);
    lastKind.set(id, kind);
    if (before === 'wait' && kind === 'booked') {
      setFlip(true);
      const t = setTimeout(() => setFlip(false), 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [id, kind]);
  return flip;
}

/** The two border layers on a date tile: solid and dashed, cross-faded (border-style itself never animates). */
export function TileBorders() {
  return (
    <>
      <span className="tb tb-solid" aria-hidden="true" />
      <span className="tb tb-dash" aria-hidden="true" />
    </>
  );
}

/** Class names for a tile and its time: `ts-booked`, `ts-wait`, `ts-none`, plus `ts-flip` during the pop. */
export function tsClass(kind: TsKind | null, flip: boolean): string {
  if (!kind) return '';
  return ` ts ts-${kind}${flip ? ' ts-flip' : ''}`;
}

// ---------- "Can't make it": the game card's own Drop out flow ----------

const cantHandlers = new Map<string, () => void>();
let pendingCant: { id: string; at: number } | null = null;

/** A game card offers its Drop out flow for the notice. Returns the clean-up. */
export function registerCant(sessionId: string, open: () => void): () => void {
  cantHandlers.set(sessionId, open);
  // Only right after the notice asked for it (the list grew to show the game); never later by surprise.
  if (pendingCant?.id === sessionId) {
    if (Date.now() - pendingCant.at < 4000) queueMicrotask(open);
    pendingCant = null;
  }
  return () => {
    if (cantHandlers.get(sessionId) === open) cantHandlers.delete(sessionId);
  };
}

/** Can't make it on the notice: opens that card's drop question. False when the card is not on screen yet. */
function openCant(sessionId: string): boolean {
  const open = cantHandlers.get(sessionId);
  if (open) {
    open();
    return true;
  }
  pendingCant = { id: sessionId, at: Date.now() };
  return false;
}

// ---------- The notice ----------

/** The games this player still has to answer for (in, game ahead, start changed after they agreed). */
export function timeAsks(view: GroupView | null): PlayerSessionView[] {
  if (!view || view.timeShift === false) return [];
  return view.sessions.filter((s) => !!s.timeAsk && s.mine?.status === 'confirmed' && !s.canceled && !s.started);
}

const MAX_SHOWN = 2;

/** One bar per changed game at the top of Home (two at most, then "N more"). */
export function TimeBars({ view, onChanged, onShowAll }: { view: GroupView; onChanged: () => Promise<void>; onShowAll: () => void }) {
  const asks = timeAsks(view);
  const [more, setMore] = useState(false);
  if (asks.length === 0) return null;
  const shown = more ? asks : asks.slice(0, MAX_SHOWN);
  return (
    <section className="ts-bars" aria-label="Time changes">
      {shown.map((s) => (
        <TimeBar key={`${s.id}-${s.startsAt}`} s={s} tz={view.group.timezone} onChanged={onChanged} onShowAll={onShowAll} card={view.alertCards === true} />
      ))}
      {!more && asks.length > MAX_SHOWN && (
        <button type="button" className="link-btn quiet-link ts-more" onClick={() => setMore(true)}>
          {asks.length - MAX_SHOWN} more
        </button>
      )}
    </section>
  );
}

function TimeBar({ s, tz, onChanged, onShowAll, card }: { s: PlayerSessionView; tz: string; onChanged: () => Promise<void>; onShowAll: () => void; card?: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<'ask' | 'saving' | 'done' | 'gone'>('ask');
  const working = useRef(false);
  const lines = tsLines({ startsAt: s.startsAt, wasStartsAt: s.timeAsk!.wasStartsAt }, tz);

  async function stillIn() {
    if (working.current) return;
    working.current = true;
    setState('saving');
    const release = holdLive();
    try {
      await api('POST', `/api/sessions/${s.id}/still-in`, { startsAt: s.startsAt });
      setState('done');
      // The check shows for a moment, then the bar folds away; the real data takes over after that.
      await new Promise((r) => setTimeout(r, 650));
      setState('gone');
      await new Promise((r) => setTimeout(r, 240));
      await onChanged();
    } catch (err) {
      setState('ask');
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      working.current = false;
      release();
    }
  }

  function cant() {
    if (!openCant(s.id)) onShowAll();
  }

  const busy = state !== 'ask';
  // Zip 11, Alert cards: the same two answers as a blue card, both buttons under the text. No clock icon.
  if (card) {
    const confirmed = state === 'done' || state === 'gone';
    return (
      <AlertCard
        as="div"
        tone="blue"
        role="region"
        label={`${lines.title}. ${lines.was}.`}
        className={`ts-ac${state === 'gone' ? ' ts-gone' : ''}`}
        data={{ 'data-time-bar': s.id }}
        title={lines.title}
        sub={lines.was}
        actions={
          <>
            <button type="button" className="ac-btn ts-yes" disabled={busy} aria-busy={state === 'saving'} onClick={stillIn}>
              {confirmed ? 'Confirmed' : state === 'saving' ? 'Saving…' : 'Still in'}
            </button>
            <button type="button" className="ac-btn ac-out ts-no" disabled={busy} onClick={cant}>
              Can't make it
            </button>
          </>
        }
      />
    );
  }
  return (
    <div className={`ts-bar${state === 'gone' ? ' ts-gone' : ''}`} role="region" aria-label={`${lines.title}. ${lines.was}.`} data-time-bar={s.id}>
      <div className="ts-line1">
        <span className="ts-clock" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M10 6.2V10l2.6 1.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="ts-text">
          <strong className="ts-title">{lines.title}</strong>
          <span className="ts-was">{lines.was}</span>
        </span>
      </div>
      <div className="ts-line2">
        <button type="button" className={`btn ts-yes${state === 'done' || state === 'gone' ? ' ts-done' : ''}`} disabled={busy} aria-busy={state === 'saving'} onClick={stillIn}>
          {state === 'done' || state === 'gone' ? (
            <>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Confirmed
            </>
          ) : state === 'saving' ? (
            'Saving…'
          ) : (
            'Still in'
          )}
        </button>
        <button type="button" className="btn ts-no" disabled={busy} onClick={cant}>
          Can't make it
        </button>
      </div>
    </div>
  );
}
