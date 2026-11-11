import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { SITE_NAME } from '../shared/settings';
import { DEFAULT_TIMEZONE, localParts } from '../shared/time';
import { applyTheme, getTheme, setTheme, type ThemeChoice, useNow } from './lib';
import { AutoModeIcon, MoonIcon, SunIcon, useToast } from './ui';
import { canMove, motionOn } from './motion';
import { useSiteName } from './siteName';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Today as a small square like the iPhone Calendar icon: "MON" over a big "26". Eastern time. */
export function TodaySquare() {
  const now = useNow();
  const p = localParts(now, DEFAULT_TIMEZONE);
  return (
    <div className="today" role="img" aria-label={`Today is ${DAY_NAMES[p.weekday]}, ${MONTHS[p.month - 1]} ${p.day}`}>
      <span className="dow">{DOW[p.weekday]}</span>
      <span className="day">{p.day}</span>
    </div>
  );
}

/** The green band: logo, eyebrow over the title, an optional button, and today's date, all on one row. */
export function TopBar({
  eyebrow,
  title,
  sub,
  action,
  titleExtra,
  tools,
  chip,
  onTitle,
}: {
  /** The small label over the title. Empty: no label at all (the organizer header with Swap to Alex on). */
  eyebrow: string;
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  /** Small text right after the title, on the same line (like "not you?"). */
  titleExtra?: ReactNode;
  /** Small round buttons left of the chip and the date square (more can be added later). */
  tools?: ReactNode;
  /** The player's credit chip: right before the date square, the same height. */
  chip?: ReactNode;
  /** Swap to Alex (Zip 13): the title and a small swap icon after it are ONE button. Left out: the plain title, exactly as before. */
  onTitle?: { onClick: () => void; label: string };
}) {
  // The tab says the group's name from Settings (src/siteName.ts); "Pickleball" until a screen has it.
  const siteName = useSiteName();
  useEffect(() => {
    document.title = title === SITE_NAME || title === siteName ? siteName : `${title} · ${siteName}`;
  }, [title, siteName]);
  return (
    <header className="topbar">
      <div className="topbar-inner topbar-row">
        {/* The logo on a rounded tile with an outline (green in dark mode, black in light). public/logo-xmas.png is staged for later, unused. */}
        <span className="brand-tile" aria-hidden="true">
          <img className="brand-logo" src="/logo.png" alt="" width="24" height="24" />
        </span>
        <div className="topbar-text">
          {eyebrow !== '' && <div className="eyebrow">{eyebrow}</div>}
          {onTitle ? (
            <div className="title-line">
              <button type="button" className="title-swap" onClick={onTitle.onClick} aria-label={onTitle.label} data-title-swap>
                <h1>{title}</h1>
                <SwapIcon />
              </button>
              {titleExtra}
            </div>
          ) : titleExtra ? (
            <div className="title-line">
              <h1>{title}</h1>
              {titleExtra}
            </div>
          ) : (
            <h1>{title}</h1>
          )}
          {sub && <div className="sub">{sub}</div>}
        </div>
        {/* One group on the right: with very big text it drops under the name instead of squeezing it. */}
        <div className="topbar-end">
          {action}
          {tools && <div className="topbar-tools">{tools}</div>}
          {chip}
          <TodaySquare />
        </div>
      </div>
    </header>
  );
}

const MODES: { v: ThemeChoice; label: string; toast: string; Icon: () => ReactElement }[] = [
  { v: 'system', label: 'Auto', toast: 'Auto (matches your phone)', Icon: AutoModeIcon },
  { v: 'light', label: 'Light', toast: 'Light', Icon: SunIcon },
  { v: 'dark', label: 'Dark', toast: 'Dark', Icon: MoonIcon },
];

/**
 * The player's light/dark button: each tap goes Auto, Light, Dark. Remembered
 * on this phone. With `preview` (the organizer's "View as..."), it only
 * changes what's on screen and puts the organizer's own choice back on exit.
 */
export function ModeButton({ preview }: { preview?: boolean }) {
  const toast = useToast();
  const [mode, setMode] = useState<ThemeChoice>(getTheme);
  useEffect(() => {
    if (!preview) return;
    return () => applyTheme(getTheme());
  }, [preview]);
  const cur = MODES.find((m) => m.v === mode) ?? MODES[0];
  // With the motion on: colors fade over about 200 ms and the new icon turns half a circle into place.
  const btn = useRef<HTMLButtonElement>(null);
  const turn = useRef(false);
  useEffect(() => {
    if (!turn.current) return;
    turn.current = false;
    if (!canMove()) return;
    btn.current?.querySelector('svg')?.animate([{ transform: 'rotate(-180deg)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,.9,.3,1)' });
  }, [mode]);
  return (
    <button
      ref={btn}
      type="button"
      className="mode-btn"
      data-mode={mode}
      aria-label={`Light or dark: ${cur.label}. Tap to change.`}
      onClick={() => {
        const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
        if (motionOn() && canMove()) {
          turn.current = true;
          const root = document.documentElement;
          root.classList.add('m-theme-fade');
          setTimeout(() => root.classList.remove('m-theme-fade'), 320);
        }
        if (preview) applyTheme(next.v);
        else setTheme(next.v);
        setMode(next.v);
        toast(next.toast);
      }}
    >
      <cur.Icon />
    </button>
  );
}

/** Two arrows, one each way (Swap to Alex, Zip 13). Drawn in the text color it sits in. */
export function SwapIcon({ size = 15 }: { size?: number }) {
  return (
    <svg className="swap-icon" viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 5.5h10M9.5 2.5l3 3-3 3M13.5 10.5h-10M6.5 7.5l-3 3 3 3" />
    </svg>
  );
}
