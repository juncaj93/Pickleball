// Zip 11, "Alert cards" (ALERT_CARDS, shared/zip11.ts), redone Nov 7 ("ALERTS_A_final"). The one card every alert on the player screen and
// the organizer Home uses while the switch is on: drawn like a game card (white surface, thin border, the same corners and fonts), a small
// round icon badge on the left tinted by its color, a bold title, an optional gray line, and ONE button on the right. Two or more choices go
// under the text (`actions`). A card that is fine to ignore gets a small round X (`onX`). Link-style extras (I paid, Use credit) sit under the
// title in the card's color (`links`). The pickleballs are the game card's own (`AcBalls` draws them with SpotDots).
// Only drawn with the switch on; with it off every alert keeps its old markup, untouched. Styles: src/alert-cards.css.
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import { SpotDots } from './ui';
import './alert-cards.css';

/** The color system (Zip 7): green in / paid / join, amber owes, blue links, credit, booking and changes, purple texting, gray neutral and canceled, red deadlines. */
export type AcTone = 'green' | 'amber' | 'blue' | 'purple' | 'gray' | 'red';

/** The badge icons (the mock's set, plus a calendar, a message, a person and an info mark for the organizer cards). */
export type AcIconName = 'join' | 'owe' | 'ok' | 'credit' | 'clock' | 'stop' | 'text' | 'court' | 'person' | 'info';

const ICON_PATHS: Record<AcIconName, ReactNode> = {
  join: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3 20c0-3.5 2.7-5.6 6-5.6s6 2.1 6 5.6" />
      <path d="M19 7v6M16 10h6" />
    </>
  ),
  owe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.2c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4 0 1.2-1.1 2-2.6 2-1.1 0-2.1-.5-2.7-1.4M12 6.2V8M12 16v1.8" />
    </>
  ),
  ok: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 9.5" />
    </>
  ),
  credit: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  stop: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 7l10 10" />
    </>
  ),
  text: <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />,
  court: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20c0-3.8 3.1-6 7-6s7 2.2 7 6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.2" />
    </>
  ),
};

/** Each color's usual badge, when a card does not name its own. */
const TONE_ICON: Record<AcTone, AcIconName> = { green: 'ok', amber: 'owe', blue: 'credit', purple: 'text', gray: 'info', red: 'stop' };

/** The round badge on the left of a card (also used by the cards that draw their own rows). */
export function AcIcon({ name }: { name: AcIconName }) {
  return (
    <span className="ac-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">{ICON_PATHS[name]}</svg>
    </span>
  );
}

/** The smallest a title gets before it is allowed to wrap (screens 360 px and wider). */
const FIT_MIN_PX = 13.5;
/** Below this screen width a long title wraps to two balanced lines instead of shrinking. */
const FIT_FROM_WIDTH = 360;

/**
 * Keeps a title on one line on screens 360 px and wider: when it would wrap, the font steps down by half a pixel (no lower than 13.5 px).
 * On a narrower screen it keeps its size and wraps into two balanced lines (CSS text-wrap: balance). Look only; re-checked when the card
 * changes size or its words change.
 */
export function useFitTitle(ref: RefObject<HTMLElement | null>, text: unknown) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      if (window.innerWidth < FIT_FROM_WIDTH) return;
      const lines = () => el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 1);
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (lines() > 1.5 && size - 0.5 >= FIT_MIN_PX) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const parent = el.parentElement;
    if (typeof ResizeObserver === 'undefined' || !parent) return;
    let last = parent.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const w = parent.getBoundingClientRect().width;
      if (Math.abs(w - last) < 0.5) return;
      last = w;
      fit();
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [ref, text]);
}

/** A title that stays on one line (see useFitTitle), for the cards that draw their own rows. */
export function AcTitle({ as: Tag = 'p', className = '', children, id }: { as?: 'p' | 'h2' | 'h3'; className?: string; children: ReactNode; id?: string }) {
  const ref = useRef<HTMLHeadingElement | null>(null);
  useFitTitle(ref, children);
  return (
    <Tag ref={ref} className={`ac-title${className ? ` ${className}` : ''}`} id={id}>
      {children}
    </Tag>
  );
}

export function AlertCard({
  tone,
  icon,
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
  /** The badge on the left; the color's usual one when left out. */
  icon?: AcIconName;
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
  return (
    <Tag className={`ac ac-${tone}${actions ? ' ac-stacked' : ''}${className ? ` ${className}` : ''}`} data-alert-card={tone} role={role} aria-label={label} {...data}>
      <div className="ac-row">
        <AcIcon name={icon ?? TONE_ICON[tone]} />
        <div className="ac-text">
          <AcTitle as={titleAs} id={titleId}>
            {title}
          </AcTitle>
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

/** The small round X on a card that is fine to ignore: 44 px to tap, a small mark to see. */
export function AcX({ label, onX }: { label: string; onX: () => void }) {
  return (
    <button type="button" className="ac-x" aria-label={`Dismiss: ${label}`} data-dismiss onClick={onX}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

/**
 * The pickleballs as a sub line ("Tuesday needs 1 more"): the game card's own SpotDots, so the balls are the same component (Pickleball) and
 * the empty seats are the same `.dot` the game cards draw (and turn into dashed rings with Seat dots). One ball per player in, empty seats up to 4.
 */
export function AcBalls({ inCount }: { inCount: number; of?: number }) {
  return (
    <span className="ac-seats">
      <SpotDots names={Array.from({ length: Math.max(0, inCount) }, () => '')} />
    </span>
  );
}
