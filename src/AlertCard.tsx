// Zip 11, "Alert cards" (ALERT_CARDS, shared/zip11.ts). The one action-card look ("style B") every alert on the player screen and the
// organizer Home uses while the switch is on: a slim tinted card with a thin matching border, no icon, a bold title, an optional gray
// sub line, and ONE button on the right. Two or more choices go under the text (`actions`). A card that is fine to ignore gets a small
// X (`onX`). Link-style extras (I paid, Use credit) sit under the title in the card's color (`links`).
// Only drawn with the switch on; with it off every alert keeps its old markup, untouched. Styles: src/alert-cards.css.
import type { ReactNode } from 'react';
import './alert-cards.css';

/** The color system (Zip 7): green in / paid / join, amber owes, blue links, credit and booking, purple texting, gray neutral and canceled, red deadlines. */
export type AcTone = 'green' | 'amber' | 'blue' | 'purple' | 'gray' | 'red';

export function AlertCard({
  tone,
  title,
  titleId,
  titleAs = 'p',
  sub,
  subTone,
  links,
  action,
  actions,
  onX,
  xLabel,
  children,
  className = '',
  as = 'article',
  role,
  label,
  data,
}: {
  tone: AcTone;
  title: ReactNode;
  titleId?: string;
  /** The title's element: a heading where the old card had one (h2, h3), so screen readers can still jump between them. */
  titleAs?: 'p' | 'h2' | 'h3';
  /** One gray line under the title (or a node such as the pickleball circles). */
  sub?: ReactNode;
  /** The sub line in another color ("Cancel the court before 7:00 AM" in red). */
  subTone?: AcTone;
  /** Link-style extras under the title, in the card's color. */
  links?: ReactNode;
  /** The ONE button on the right. */
  action?: ReactNode;
  /** Two or more buttons: under the text. */
  actions?: ReactNode;
  /** The small X on the right: only for a card that is fine to ignore. */
  onX?: () => void;
  xLabel?: string;
  /** Anything that must stay with the card (a copy-the-note line, a list), under everything else. */
  children?: ReactNode;
  className?: string;
  as?: 'article' | 'div' | 'section';
  role?: string;
  label?: string;
  /** data-* attributes the older tests and the screen's own code look for. */
  data?: Record<string, string | boolean | undefined>;
}) {
  const Tag = as;
  const Title = titleAs;
  return (
    <Tag className={`ac ac-${tone}${actions ? ' ac-stacked' : ''}${className ? ` ${className}` : ''}`} data-alert-card={tone} role={role} aria-label={label} {...data}>
      <div className="ac-row">
        <div className="ac-text">
          <Title className="ac-title" id={titleId}>
            {title}
          </Title>
          {sub !== undefined && sub !== null && sub !== '' && sub !== false && <div className={`ac-sub${subTone ? ` ac-sub-${subTone}` : ''}`}>{sub}</div>}
          {links && <div className="ac-links">{links}</div>}
        </div>
        {action && <div className="ac-action">{action}</div>}
        {onX && <AcX label={xLabel ?? (typeof title === 'string' ? title : 'this card')} onX={onX} />}
      </div>
      {actions && <div className="ac-actions">{actions}</div>}
      {children}
    </Tag>
  );
}

/** The small X on a card that is fine to ignore: 44 px to tap, a small mark to see. */
export function AcX({ label, onX }: { label: string; onX: () => void }) {
  return (
    <button type="button" className="ac-x" aria-label={`Dismiss: ${label}`} data-dismiss onClick={onX}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

/** The pickleball circles as a sub line ("Tuesday needs 1 more"): one filled ball per player in, empty circles up to 4. */
export function AcBalls({ inCount, of = 4 }: { inCount: number; of?: number }) {
  const slots = Math.max(of, inCount);
  return (
    <span className="ac-balls" role="img" aria-label={`${inCount} in${inCount < of ? `, ${of - inCount} more needed` : ''}`}>
      {Array.from({ length: slots }, (_, i) => (
        <span key={i} className={i < inCount ? 'ac-ball' : 'ac-ball ac-empty'} aria-hidden="true" />
      ))}
    </span>
  );
}
