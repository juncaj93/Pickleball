import { type ReactNode, useEffect } from 'react';

export function TopBar({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Pickleball`;
  }, [title]);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="eyebrow">
          <img className="brand-logo" src="/logo-header.png" alt="" width="28" height="28" />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </header>
  );
}
