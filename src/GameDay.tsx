import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { COURT_ROWS, TBD_POP_MS, tbdText } from '../shared/gameDay';
import { COURT_NAME, directionsUrl } from '../shared/zip9';
import { localParts } from '../shared/time';
import type { GroupView, PlayerSessionView } from '../shared/api';
import { DirectionsArrowIcon } from './CardButtons';

// Zip 14, "Game day card" (GAME_DAY_CARD, shared/gameDay.ts). Display only: nothing here saves, charges or sends anything.
//  - GameDayButtons: the two equal buttons on the day of the game, "Court 3" (opens the court map) and "Directions" (Apple Maps on an
//    iPhone, Google Maps elsewhere, the one address in shared/zip9.ts). No court yet: a muted "Court TBD" that shows a small pop-up
//    under the buttons ("Alex will add it soon.") which fades by itself after about 3 seconds.
//  - CourtMap: the venue's 16 courts drawn in 3D (src/gameday.css, from the approved mock), as a small panel over the page. Players: the
//    game's court lit with the Tonight card's glow and light sweep. The organizer (Add game / Edit game): every court is a button and one
//    tap picks it; "Not set yet" clears it. Tap outside, Escape or the X closes it. A native <dialog>, so it sits above an open sheet too.

/** The Eastern date ("2026-11-10") of a moment. */
function dateKey(iso: string, tz: string): string {
  const p = localParts(Date.parse(iso), tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Preview only (GAME_DAY_TEST): the date the phone should treat as "today", the date of the next game that is still to come and not
 * canceled. Null when the test is not on (always on live: the server never sends gameDayTest there).
 */
export function gameDayTestDate(g: GroupView): string | null {
  if (g.gameDayTest !== true) return null;
  const next = g.sessions.find((s) => !s.canceled && !s.started);
  return next ? dateKey(next.startsAt, g.group.timezone) : null;
}

/**
 * Is this game shown as the game day card: the switch on, not canceled, and on today's date (or the preview test's date) until it ENDS
 * (Alex, Nov 8: Court stays on the card while the game is being played, for late arrivals). `today`: the game's Eastern date is today.
 * A game that has ended is no longer on the player screen at all (the server leaves it out).
 */
export function isGameDayCard(g: GroupView, s: PlayerSessionView, today: boolean): boolean {
  if (g.gameDayCard !== true || s.canceled) return false;
  if (today) return true;
  const test = gameDayTestDate(g);
  return test !== null && dateKey(s.startsAt, g.group.timezone) === test;
}

/** The two buttons under "You're in" on the game day card. `held`: the saved copy of the last screen, drawn but never tappable. */
export function GameDayButtons({ court, organizerName, dayLabel, held }: { court: number | null; organizerName: string | null; dayLabel: string; held?: boolean }) {
  const [mapOpen, setMapOpen] = useState(false);
  const [pop, setPop] = useState(0);
  const courtRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  // The pop-up goes by itself; a second tap starts it again (a new key restarts its fade).
  useEffect(() => {
    if (!pop) return undefined;
    const t = setTimeout(() => setPop(0), TBD_POP_MS);
    return () => clearTimeout(t);
  }, [pop]);
  return (
    <div className="gd-btns" data-game-day-buttons>
      {court !== null ? (
        <button ref={courtRef} type="button" className="gd-btn" data-gd-court={court} aria-haspopup="dialog" aria-label={`Court ${court}, show it on the court map`} disabled={held} onClick={() => setMapOpen(true)}>
          Court {court}
        </button>
      ) : (
        <button type="button" className="gd-btn gd-tbd" data-gd-court="tbd" aria-label="Court TBD, not set yet" aria-describedby={pop ? popId : undefined} disabled={held} onClick={() => setPop((n) => n + 1)}>
          Court TBD
        </button>
      )}
      {held ? (
        // The saved copy of the last screen: drawn, never a link.
        <span className="gd-btn" aria-hidden="true">
          <DirectionsArrowIcon />
          Directions
        </span>
      ) : (
        <a className="gd-btn" href={directionsUrl(COURT_NAME, ua)} target="_blank" rel="noopener noreferrer" data-gd-directions aria-label={`Directions to the courts for ${dayLabel}`}>
          <DirectionsArrowIcon />
          Directions
        </a>
      )}
      {pop > 0 && (
        <span key={pop} id={popId} className="gd-pop" role="status" data-gd-pop>
          {tbdText(organizerName)}
        </span>
      )}
      {court !== null && <CourtMap open={mapOpen} onClose={() => setMapOpen(false)} lit={court} anchor={courtRef} label={`Court map. Your game is on Court ${court}.`} />}
    </div>
  );
}

const ARROW = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

/**
 * The court map. `lit`: the court shown in green with the glow (the player's game, or the organizer's current pick). `onPick`: the
 * organizer's picker (every court a button, plus "Not set yet"); missing for players (the map only shows).
 */
export function CourtMap({
  open,
  onClose,
  lit,
  anchor,
  label,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  lit: number | null;
  anchor?: React.RefObject<HTMLElement | null>;
  label: string;
  onPick?: (court: number | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [top, setTop] = useState<number | null>(null);
  // Opened first, then measured (a closed dialog has no height): under the button that opened it (the X needs 14 px above the panel),
  // moved up if it would run off the bottom of the screen. A screen too short for it lets the panel scroll (gameday.css).
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!open) {
      if (d.open) d.close();
      return;
    }
    if (!d.open) d.showModal();
    const h = d.offsetHeight || 300;
    const vh = window.innerHeight;
    const a = anchor?.current?.getBoundingClientRect();
    let y = a ? a.bottom + 22 : (vh - h) / 2;
    if (y + h > vh - 12) y = a ? a.top - h - 18 : vh - h - 12;
    setTop(Math.max(22, Math.min(y, vh - h - 12)));
  }, [open, anchor]);
  // A tap on the dimmed page outside the panel closes it (the dialog's own box is the panel; its backdrop is the rest).
  const outside = (e: ReactMouseEvent<HTMLDialogElement>) => {
    if (e.target !== ref.current) return;
    const r = ref.current.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
  };
  const cell = (n: number): ReactNode => {
    const on = n === lit;
    const cls = `cm-cl${on ? ' me' : ''}`;
    if (onPick)
      return (
        <button key={n} type="button" className={cls} data-court-cell={n} aria-pressed={on} aria-label={`Court ${n}`} onClick={() => onPick(n)}>
          {n}
        </button>
      );
    return (
      <div key={n} className={cls} data-court-cell={n}>
        {n}
      </div>
    );
  };
  return (
    <dialog
      ref={ref}
      className={`cm${onPick ? ' cm-pick' : ''}`}
      aria-label={label}
      data-court-map={onPick ? 'pick' : 'view'}
      style={top !== null ? { top } : undefined}
      onClick={outside}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      {open && (
        <>
          <button type="button" className="cm-x" aria-label="Close the court map" onClick={onClose}>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
          <div className="cm-st" aria-hidden={onPick ? undefined : true}>
            <div className="cm-pl">
              {COURT_ROWS.map((row) => (
                <div key={row[0]} className="cm-rw">
                  <div className="cm-pr">{row.slice(0, 2).map(cell)}</div>
                  <div className="cm-wk" />
                  <div className="cm-pr">{row.slice(2).map(cell)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="cm-ent" aria-hidden="true">
            {ARROW}
            <span>ENTRANCE</span>
            {ARROW}
          </div>
          {onPick && (
            <button type="button" className="cm-clear" data-court-clear aria-pressed={lit === null} onClick={() => onPick(null)}>
              Not set yet
            </button>
          )}
        </>
      )}
    </dialog>
  );
}

/**
 * The organizer's "Court" row on Add game and Edit game (only while "Game day card" is on): "Not set" in blue until a court is picked,
 * then "Court 3". (`stacked`, Zip 24: the Booking hours picker puts the word "Court" above the box, so inside it the word is for screen readers only.) A tap opens the court map; one tap on a court picks it, "Not set yet" clears it. Saved with the sheet's own button.
 */
export function CourtRow({ value, onChange, stacked }: { value: number | null; onChange: (court: number | null) => void; stacked?: boolean }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={rowRef} type="button" className={stacked ? 'gd-court-row bh-box bh-courtbox' : 'gd-court-row'} data-court-row={value ?? 'unset'} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className={stacked ? 'sr-only' : 'gd-court-label'}>Court</span>
        <span className={`gd-court-value${value === null ? ' unset' : ''}`}>
          {value === null ? 'Not set' : `Court ${value}`}
          <svg className="gd-chev" viewBox="0 0 9 14" aria-hidden="true">
            <path d="M1.5 1.5L7 7l-5.5 5.5" />
          </svg>
        </span>
      </button>
      <CourtMap
        open={open}
        onClose={() => setOpen(false)}
        lit={value}
        anchor={rowRef}
        label="Pick the court for this game"
        onPick={(court) => {
          onChange(court);
          setOpen(false);
        }}
      />
    </>
  );
}
