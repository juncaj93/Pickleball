import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { SITE_NAME } from '../shared/settings';
import { DEFAULT_TIMEZONE, localParts } from '../shared/time';
import { applyTheme, getTheme, setTheme, type ThemeChoice, useNow } from './lib';
import { AutoModeIcon, MoonIcon, SunIcon, useToast } from './ui';

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
}: {
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
}) {
  useEffect(() => {
    document.title = title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`;
  }, [title]);
  return (
    <header className="topbar">
      <div className="topbar-inner topbar-row">
        <img className="brand-logo" src="/logo-header.png" alt="" width="32" height="32" />
        <div className="topbar-text">
          <div className="eyebrow">{eyebrow}</div>
          {titleExtra ? (
            <div className="title-line">
              <h1>{title}</h1>
              {titleExtra}
            </div>
          ) : (
            <h1>{title}</h1>
          )}
          {sub && <div className="sub">{sub}</div>}
        </div>
        {action}
        {tools && <div className="topbar-tools">{tools}</div>}
        {chip}
        <TodaySquare />
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
  return (
    <button
      type="button"
      className="mode-btn"
      data-mode={mode}
      aria-label={`Light or dark: ${cur.label}. Tap to change.`}
      onClick={() => {
        const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
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
