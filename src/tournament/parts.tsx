// Zip 55 "Tournaments": the pieces the player sheets (src/tournament/TournamentHome.tsx, loaded only when a tournament is on a player's Home)
// and the organizer screens (src/pages/admin/Tournament.tsx) share: the month calendar and the level list. Styles: src/tournament/tournament.css.
import { type ReactNode, useEffect, useRef } from 'react';
import { type CalMonth, LEVELS, monthTitle } from '../../shared/tournament';
import './tournament.css';

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** What one day looks like: not a choice (gray number), open (tap to pick), lit/picked (solid green with the ball dot), or past. */
export type DayLook = 'off' | 'open' | 'on' | 'past';

/**
 * The scrollable month calendar (mocks 03, 06, 13). `variant`: 'offer' is the organizer's Create calendar (unlit days are plain numbers you can
 * tap; lit days are solid green with the ball dot); 'pick' is the player's (open days are soft green tiles, picked ones solid green with the dot).
 * `badge` (the organizer's date list): a small count under the number.
 */
export function MonthCalendar({
  months,
  look,
  onTap,
  variant,
  badge,
  label,
  boxed = true,
  scrollTo,
}: {
  months: CalMonth[];
  look: (day: string) => DayLook;
  onTap?: (day: string) => void;
  variant: 'offer' | 'pick' | 'counts';
  badge?: (day: string) => ReactNode;
  label: string;
  /** In its own scroll box with a fade at the bottom (the Create card). False: the sheet scrolls. */
  boxed?: boolean;
  /** A day to bring into view when the calendar opens (the first lit or picked one). */
  scrollTo?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollTo || !box.current || !boxed) return;
    const el = box.current.querySelector<HTMLElement>(`[data-day="${scrollTo}"]`);
    const month = el?.closest<HTMLElement>('.tm-month');
    if (month) box.current.scrollTop = Math.max(0, month.offsetTop - box.current.offsetTop - 4);
    // Only when the calendar opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={box} className={`tm-cal tm-cal-${variant}${boxed ? ' tm-cal-box' : ''}`} role="group" aria-label={label} data-tm-cal={variant}>
      {months.map((m) => (
        <section key={`${m.year}-${m.month}`} className="tm-month" aria-label={monthTitle(m.year, m.month)}>
          <h4 className="tm-month-title">{monthTitle(m.year, m.month)}</h4>
          <div className="tm-week" aria-hidden="true">
            {WEEK.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div className="tm-days">
            {Array.from({ length: m.lead }, (_, i) => (
              <span key={`b${i}`} className="tm-blank" />
            ))}
            {m.days.map((d) => {
              const l = look(d);
              const n = Number(d.slice(8));
              const tappable = !!onTap && l !== 'past' && (variant !== 'pick' || l !== 'off');
              const cls = `tm-day tm-${l}`;
              const inner = (
                <>
                  <span className="tm-num">{n}</span>
                  {l === 'on' && <span className="tm-dot" aria-hidden="true" />}
                  {badge && <span className="tm-badge">{badge(d)}</span>}
                </>
              );
              return tappable ? (
                <button key={d} type="button" className={cls} data-day={d} aria-pressed={l === 'on'} aria-label={dayAria(d)} onClick={() => onTap!(d)}>
                  {inner}
                </button>
              ) : (
                <span key={d} className={cls} data-day={d} aria-disabled="true">
                  {inner}
                </span>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayAria(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${DAYS_LONG[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]}, ${MONTHS_LONG[m - 1]} ${day}`;
}

/**
 * The player's level list (mock 05): one card per level, the number, its words, and a round mark; the picked one green. Also the organizer's
 * flat list (mock 14, `flat`): rows with dashed lines between, the player's own pick tinted ("SAGE PICKED"), the organizer's choice boxed
 * ("YOUR PICK").
 */
export function LevelList({
  value,
  onPick,
  flat,
  theirPick,
  theirName,
}: {
  value: number | null;
  onPick: (v: number) => void;
  flat?: boolean;
  theirPick?: number;
  theirName?: string;
}) {
  return (
    <div className={flat ? 'tm-levels tm-levels-flat' : 'tm-levels'} role="radiogroup" aria-label="Level">
      {LEVELS.map((l) => {
        const on = value === l.value;
        // The organizer's list: the player's own pick is always tinted and named ("SAGE PICKED"), also while it is the selected one;
        // "YOUR PICK" names a different level the organizer chose.
        const theirs = !!flat && theirPick === l.value;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`tm-level${on ? ' tm-level-on' : ''}${theirs ? ' tm-level-theirs' : ''}`}
            data-level={l.value}
            onClick={() => onPick(l.value)}
          >
            <span className="tm-level-num">{l.label}</span>
            <span className="tm-level-text">{l.text}</span>
            {flat ? (
              theirs ? (
                <span className="tm-level-tag">{(theirName ?? 'They').split(' ')[0]} picked</span>
              ) : on ? (
                <span className="tm-level-tag tm-tag-mine">Your pick</span>
              ) : null
            ) : (
              <span className="tm-radio" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
