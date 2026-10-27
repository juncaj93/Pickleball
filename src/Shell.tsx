import { type ReactNode, useEffect } from 'react';
import { DEFAULT_TIMEZONE, formatShortDate } from '../shared/time';
import { useNow } from './lib';

export function TopBar({ eyebrow, title, sub, action }: { eyebrow: string; title: string; sub?: ReactNode; action?: ReactNode }) {
  const now = useNow();
  useEffect(() => {
    document.title = `${title} · Pickleball`;
  }, [title]);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="eyebrow">
          <img className="brand-logo" src="/logo-header.png" alt="" width="32" height="32" />
          {eyebrow}
          <span className="today">
            <span className="sr-only">Today is </span>
            {formatShortDate(new Date(now).toISOString(), DEFAULT_TIMEZONE)}
          </span>
        </div>
        <div className="topbar-title">
          <h1>{title}</h1>
          {action}
        </div>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </header>
  );
}
