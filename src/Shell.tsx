import { type ReactNode, useEffect } from 'react';
import { SITE_NAME } from '../shared/settings';
import { DEFAULT_TIMEZONE, localParts } from '../shared/time';
import { useNow } from './lib';

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
}: {
  eyebrow: string;
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  /** Small text right after the title, on the same line (like "not you?"). */
  titleExtra?: ReactNode;
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
        <TodaySquare />
      </div>
    </header>
  );
}
