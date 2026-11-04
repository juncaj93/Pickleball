import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AdminSessionView } from '../../../shared/api';
import { smsHref } from '../../../shared/messages';
import { formatShortDate } from '../../../shared/time';
import { holdLive } from '../../busy';
import { api, ApiError, isIOS } from '../../lib';
import { CalendarPlusIcon, GearIcon, MessageIcon, useToast } from '../../ui';
import { canMove } from '../../motion';
import type { AdminCtx } from '../Admin';
import { sessionTexts } from './textMenu';
import { noteMenuDismissed } from './menuDismiss';
import { HideConfirm } from './MoneyReworkParts';

/**
 * The gear's small pop-up, anchored next to the gear (not a full sheet):
 * Text the group, Edit game, Players, Add to calendar, then Cancel session
 * in red on its own at the bottom. Tap outside or Escape closes it; the
 * arrow keys move between rows; focus goes back to the gear on close. While
 * it is open, live refreshes wait so it never closes under a finger.
 */
export function GameMenu({ ctx, s, canCalendar }: { ctx: AdminCtx; s: AdminSessionView; canCalendar: boolean }) {
  const tz = ctx.d.group.timezone;
  const [open, setOpen] = useState(false);
  const [texts, setTexts] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  // The Money page rework: "Hide from list" asks first, and the question lives here, outside the pop-up that closes when it is picked.
  const [askHide, setAskHide] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Where it opens: under the gear when it fits, else above it, else as a panel just above the tab bar.
  const [place, setPlace] = useState<'down' | 'up' | 'sheet'>('down');
  const gear = useRef<HTMLButtonElement>(null);
  const menuId = `menu-${s.id}`;
  const day = formatShortDate(s.startsAt, tz);
  const items = sessionTexts(ctx.d, s, Date.parse(ctx.d.now));

  // Motion: the pop-up fades out fast (about 90 ms) instead of vanishing. Its content and place are kept until then
  // (they are reset when it opens again), and it takes no taps while it fades.
  const [fading, setFading] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(fadeTimer.current), []);
  const close = (refocus = true) => {
    if (canMove() && open) {
      setFading(true);
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setFading(false), 100);
    } else {
      setTexts(false);
      setOpened(null);
      setPlace('down');
    }
    setOpen(false);
    if (refocus) gear.current?.focus({ preventScroll: true });
  };
  const openMenu = () => {
    clearTimeout(fadeTimer.current);
    setFading(false);
    setTexts(false);
    setOpened(null);
    setPlace('down');
    setOpen(true);
  };

  // Measure with the pop-up drawn (hidden) under the gear, then choose. Runs again when the text list opens or the screen turns.
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const el = pop.current;
      const g = gear.current;
      if (!el || !g) return;
      const need = el.scrollHeight + 8;
      const gr = g.getBoundingClientRect();
      const bar = document.querySelector('.tabbar')?.getBoundingClientRect();
      const vv = window.visualViewport;
      const bottom = Math.min(bar ? bar.top : Infinity, vv ? vv.offsetTop + vv.height : window.innerHeight) - 8;
      const topLimit = Math.max(document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0, vv?.offsetTop ?? 0) + 8;
      if (gr.bottom + 2 + need <= bottom) setPlace('down');
      else if (gr.top - 2 - need >= topLimit) setPlace('up');
      else setPlace('sheet');
    };
    fit();
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [open, texts]);

  // The first row gets focus so a keyboard or screen reader lands inside the menu (again if it moved to a panel).
  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const release = holdLive();
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (wrap.current && !wrap.current.contains(t) && !pop.current?.contains(t)) {
        noteMenuDismissed();
        close(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      return close();
    }
    if (e.key === 'Tab') return close(false);
    const rows = [...(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      rows[(i + rows.length) % rows.length]?.focus({ preventScroll: true });
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
  }

  const pick = (fn: () => void) => () => {
    close(false);
    fn();
  };
  const canceled = s.state.flags.canceled;
  // The new layout (ADMIN_V2): take a canceled game off the player screen, or put it back. It only hides: nothing is deleted.
  const toast = useToast();
  const hidden = s.hiddenFromPlayers === true;
  const toggleHidden = async () => {
    try {
      await api('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: !hidden });
      await ctx.reload();
      toast(hidden ? `${day} shows on the player screen again` : `${day} is off the player screen. Money and history are untouched.`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    }
  };

  // Round 2 (ADMIN_R2): the holiday note's Undo lives here, not on the card.
  const undoHours = async () => {
    try {
      await api('POST', `/api/admin/sessions/${s.id}/holiday-hours`, { ok: false });
      await ctx.reload();
      toast('Undone');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    }
  };

  const menu = (
    <div
      ref={pop}
      className={`menu-pop place-${place}${fading && !open ? ' m-fading' : ''}`}
      id={menuId}
      role="menu"
      aria-label={`Game menu for ${day}`}
    >
          {items.length > 0 && (
            <>
              <button role="menuitem" className="menu-row" aria-expanded={texts} onClick={() => setTexts((v) => !v)}>
                <MessageIcon />
                Text the group
              </button>
              {texts && (
                <ul className="menu-texts text-menu" aria-label="Texts">
                  {items.map((it) => {
                    const key = `${it.id}-${it.label}`;
                    return (
                      <li key={key} className="text-row" data-text={it.id}>
                        <a role="menuitem" className="text-choice" href={smsHref(it.phones.length ? it.phones : null, it.body, isIOS)} onClick={() => setOpened(key)}>
                          <span className="text-name">{it.label}</span>
                          <span className="text-who">{it.who}</span>
                        </a>
                        {it.missing.length > 0 && <div className="small missing-numbers">Missing numbers: {it.missing.join(', ')}</div>}
                        {opened === key && <div className="small muted message-ready">Message ready</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
          {ctx.d.lateFees === true && (
            <button role="menuitem" className="menu-row" data-players-text-menu onClick={pick(() => ctx.open('players_text', s.id))}>
              <MessageIcon />
              Text the players
            </button>
          )}
          {!canceled && (
            <button role="menuitem" className="menu-row" onClick={pick(() => ctx.open('edit', s.id))}>
              <EditIcon />
              Edit game
            </button>
          )}
          <button role="menuitem" className="menu-row" onClick={pick(() => ctx.open('roster', s.id))}>
            <PeopleSmallIcon />
            Players
          </button>
          {canCalendar && (
            <a role="menuitem" className="menu-row" href={`/api/sessions/${s.id}/calendar.ics`} aria-label={`Add ${day} to calendar`} onClick={() => close(false)}>
              <CalendarPlusIcon />
              Add to calendar
            </a>
          )}
          {ctx.d.adminR2 === true && s.holiday && s.holidayHoursOk && (
            <button role="menuitem" className="menu-row" data-holiday-undo onClick={pick(() => void undoHours())}>
              <UndoIcon />
              Undo hours confirmed
            </button>
          )}
          {canceled && ctx.d.adminV2 === true && (
            <button role="menuitem" className="menu-row" data-hide-game onClick={pick(() => void toggleHidden())}>
              <HideIcon />
              {hidden ? 'Show on player screen again' : 'Remove from player screen'}
            </button>
          )}
          {ctx.d.moneyRework === true && s.hiddenFromList !== true && !(canceled && s.canceledBy === 'organizer_fee_kept') && !s.roster.some((r) => r.lateFee) && (
            <button role="menuitem" className="menu-row" data-hide-from-list onClick={pick(() => setAskHide(true))}>
              <HideIcon />
              Hide from list
            </button>
          )}
          <button
            role="menuitem"
            className="menu-row danger"
            disabled={s.state.flags.started || s.courtState === 'not_opened'}
            onClick={pick(() => ctx.open('cancel', s.id))}
          >
            <CancelIcon />
            {canceled ? 'Reopen session' : 'Cancel session'}
          </button>
    </div>
  );

  return (
    <div className="game-menu" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={gear}
        className="icon-round"
        aria-label={`Game menu for ${day}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu())}
      >
        <GearIcon />
      </button>
      {(open || fading) && (place === 'sheet' ? createPortal(menu, document.body) : menu)}
      {ctx.d.moneyRework === true && <HideConfirm ctx={ctx} s={s} open={askHide} onClose={() => setAskHide(false)} />}
    </div>
  );
}

const ICON = { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function EditIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}
function PeopleSmallIcon() {
  return (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16 5.2a3.1 3.1 0 0 1 0 5.6M18 14.8c2 .7 3.2 2.4 3.2 5.2" />
    </svg>
  );
}
function HideIcon() {
  return (
    <svg {...ICON}>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <path d="m4 4 16 16" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg {...ICON}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}
function CancelIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 8 8 8" />
    </svg>
  );
}
