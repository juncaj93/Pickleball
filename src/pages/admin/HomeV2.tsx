import { type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { type CourtSwitch, courtStatus, courtSwitchOf } from '../../../shared/court';
import { countText } from '../../../shared/spots';
import { cardTime, formatShortDate } from '../../../shared/time';
import { tsKind, tsTime } from '../../timeShift';
import { DateTile } from '../PlayerHome';
import { adminTileDay } from '../../zip7';
import type { AdminCtx } from '../Admin';
import { SessionCard } from './Sessions';
import { menuJustDismissed } from './menuDismiss';
import { shortGameLine } from './ShortGame';
import { PeopleIcon, SpotDots } from '../../ui';

/** Things inside a card that do their own job when tapped: a tap on them never folds the game. */
const OWN_TAP =
  'button, a, input, select, textarea, label, summary, dialog, [role="button"], [role="switch"], [role="menu"], [role="menuitem"], [role="group"], .menu-pop, [data-no-fold]';

const SWITCH_LABEL: Record<CourtSwitch, string> = {
  booked: 'Booked',
  waitlist: 'Waitlist',
  not_booked: 'Not booked',
};

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/** How the games are open or folded: the top 2 start open (round 2: this week's games), a tap flips one game. Nothing is remembered (a reload starts over). */
export function useOpenGames(openByDefault?: (id: string, index: number) => boolean): {
  isOpen: (id: string, index: number) => boolean;
  toggle: (id: string, index: number) => void;
  justToggled: string | null;
} {
  const [over, setOver] = useState<Record<string, boolean>>({});
  const [justToggled, setJust] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const startsOpen = (id: string, index: number) => (openByDefault ? openByDefault(id, index) : index < 2);
  const isOpen = (id: string, index: number) => over[id] ?? startsOpen(id, index);
  const toggle = (id: string, index: number) => {
    setOver((cur) => ({ ...cur, [id]: !(cur[id] ?? startsOpen(id, index)) }));
    setJust(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setJust(null), 220);
  };
  return { isOpen, toggle, justToggled };
}

/**
 * One game on Home in the new layout: the full card (exactly today's) when open, a short row when folded.
 * Tap the date tile, or any empty space on the card or the row, to open or fold it.
 */
export function HomeGame({
  ctx,
  s,
  open,
  fx,
  needsCourt,
  onToggle,
}: {
  ctx: AdminCtx;
  s: AdminSessionView;
  open: boolean;
  /** This game was just opened or folded: it fades in quickly (not with Reduce Motion). */
  fx: boolean;
  /** "Court still needs to be booked" belongs to this game (the separate alert card is gone). */
  needsCourt: boolean;
  onToggle: () => void;
}) {
  const date = formatShortDate(s.startsAt, ctx.d.group.timezone);
  // A game that opens or folds swaps one element for another; if that took the keyboard focus with it, put it on the new one.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const a = document.activeElement;
    if (!a || a === document.body) document.getElementById(`session-${s.id}`)?.focus({ preventScroll: true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (open) {
    return (
      <FoldArea onToggle={onToggle} className={`hv2-open${fx ? ' hv2-fx' : ''}`} data-game-open={s.id}>
        <button type="button" className="hv2-a11y" aria-expanded="true" onClick={onToggle}>
          Fold {date}
        </button>
        <SessionCard ctx={ctx} s={s} courtNeed={needsCourt} />
      </FoldArea>
    );
  }
  return <ShortRow ctx={ctx} s={s} fx={fx} onToggle={onToggle} />;
}

/** Taps on empty space (not on a button, link or field, and not while selecting text) flip the game. */
function FoldArea({ onToggle, className, children, ...rest }: { onToggle: () => void; className: string; children: ReactNode; 'data-game-open': string }) {
  return (
    <div
      className={className}
      {...rest}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        const t = e.target as Element;
        // Pop-ups drawn elsewhere on the page still bubble here through React: only real taps inside the card count.
        if (!e.currentTarget.contains(t)) return;
        if (t.closest(OWN_TAP)) return;
        if (window.getSelection()?.toString()) return;
        // The tap that just closed the gear pop-up only closes it.
        if (menuJustDismissed()) return;
        onToggle();
      }}
    >
      {children}
    </div>
  );
}

/** The folded game: date tile, "2 of 4 in" and the start time, names in small text, the court pill, "In" if you are, a chevron. */
function ShortRow({ ctx, s, fx, onToggle }: { ctx: AdminCtx; s: AdminSessionView; fx: boolean; onToggle: () => void }) {
  const tz = ctx.d.group.timezone;
  const court = courtStatus(
    {
      ...s,
      canceled: s.state.flags.canceled,
      started: s.state.flags.started,
      past: s.state.flags.past,
      bookingOpen: s.state.flags.bookingWindowOpen,
    },
    tz,
  );
  const switchValue = courtSwitchOf(s);
  const canceled = s.state.flags.canceled;
  const names = s.roster.filter((r) => r.status === 'confirmed').map((r) => r.name);
  const me = ctx.d.me;
  const mine = !!me && s.roster.some((r) => r.playerId === me.id && r.status === 'confirmed');
  const ts = tsKind(court.kind, false);
  const start = tsTime(cardTime(s.startsAt, s.endsAt, tz).start, ts);
  const date = formatShortDate(s.startsAt, tz);
  // The second line is always one line (it is cut off with an ellipsis): who is in, or when booking opens. Never a sentence or a button.
  // Zip 9 "Short games": a 1.5 hour game's row says so on its second line ("1.5 hr game · $11 each"); the names show when it opens.
  const tag = canceled ? null : shortGameLine(ctx, s);
  const cleanup = ctx.d.cardCleanup === true;
  const second = canceled ? (s.cancelReason ?? 'Canceled') : tag ? tag : court.kind === 'later' ? court.text : names.length > 0 ? names.join(', ') : 'Nobody in yet';
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <div className="hv2-shortwrap">
      <div
        id={`session-${s.id}`}
        className={`card hv2-short${fx ? ' hv2-fx' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded="false"
        aria-label={`${date}, ${canceled ? 'canceled' : `${countText(names.length, cleanup ? Number.POSITIVE_INFINITY : ctx.d.group.settings.maxPlayers)}, ${SWITCH_LABEL[switchValue]}`}${mine ? ", you're in" : ''}. Open.`}
        data-session={s.id}
        data-court={court.kind}
        data-switch={switchValue}
        onClick={() => {
          if (window.getSelection()?.toString()) return;
          onToggle();
        }}
        onKeyDown={key}
      >
        <DateTile iso={s.startsAt} tz={tz} day={adminTileDay(ctx.d, s)} />
        {cleanup ? (
          // "Card cleanup" (Zip 10): the time on the left of the first line, the circles to its right (no "3 of 4 in"); the people icon before the names.
          <div className="hv2-main">
            <div className="hv2-count cl-row">
              <strong>{canceled ? 'Canceled' : start}</strong>
              {!canceled && (
                // Zip 18 round 2: --n (the circles drawn: at least 4) lets the row keep room for every circle (zip10.css).
                <span className="cl-balls" style={{ '--n': Math.max(4, names.length) } as CSSProperties}>
                  <SpotDots names={names} oneRow />
                </span>
              )}
            </div>
            <div className="hv2-names">
              {!canceled && !tag && court.kind !== 'later' && names.length > 0 ? (
                <span className="cl-names">
                  <span className="people-icon">
                    <PeopleIcon />
                  </span>
                  <span className="cl-names-text">{second}</span>
                </span>
              ) : (
                second
              )}
            </div>
          </div>
        ) : (
          <div className="hv2-main">
            <div className="hv2-count">
              <strong>{canceled ? 'Canceled' : `${countText(names.length, ctx.d.group.settings.maxPlayers)} · ${start}`}</strong>
            </div>
            <div className="hv2-names">{second}</div>
          </div>
        )}
        <div className="hv2-side">
          {canceled ? <span className="hv2-pill off">Canceled</span> : <span className={`hv2-pill sw-${switchValue}`}>{SWITCH_LABEL[switchValue]}</span>}
          {mine && !canceled && (
            <span className="hv2-in">
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <path d="m2.6 6.3 2.2 2.2 4.6-4.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              In
            </span>
          )}
          <span className="hv2-chev" aria-hidden="true">
            <Chevron />
          </span>
        </div>
      </div>
    </div>
  );
}
