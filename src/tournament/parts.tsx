// Zip 55 "Tournaments": the pieces the player sheets (src/tournament/TournamentHome.tsx, loaded only when a tournament is on a player's Home)
// and the organizer screens (src/pages/admin/Tournament.tsx) share: the month calendar and the level list. Styles: src/tournament/tournament.css.
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { type CalMonth, type FormatVote, LEVELS, monthTitle, VOTE_ROWS } from '../../shared/tournament';
import './tournament.css';

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The nearest ancestor that scrolls (overflow auto or scroll), or null. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

/**
 * Alex: the soft fade at the bottom shows ONLY while there is more to scroll. Puts `data-more` on `ref`'s element while its scroller (the
 * element itself when `own`, else the nearest scrolling ancestor) is not at its end; never when the content fits. The style draws the fade
 * only with `data-more`. Runs after every render, so a list that grows or a sheet that opens is measured again.
 */
export function useMoreBelow(ref: RefObject<HTMLElement | null>, own: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = own ? el : scrollParent(el);
    const update = () => {
      let more = !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 2;
      // Zip 59: a pinned bar (not its own scroll box) fades only when content really hides behind it: the list above it reaches lower than the
      // bar's top. At the end of the list the bar sits below it (nothing hidden), whatever rounding or an elastic bounce says about scrollTop.
      const above = own ? null : el.previousElementSibling;
      if (scroller && above) more = above.getBoundingClientRect().bottom - el.getBoundingClientRect().top > 2;
      el.toggleAttribute('data-more', more);
    };
    update();
    if (!scroller) return;
    scroller.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (ro) {
      ro.observe(scroller);
      for (const child of Array.from(scroller.children)) ro.observe(child);
    }
    return () => {
      scroller.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  });
}

const NO_BOX: RefObject<HTMLElement | null> = { current: null };

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
  dayStyle,
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
  /** Zip 64: a day's own colors (the organizer's heat map sets --heat-* custom properties on each offered day). */
  dayStyle?: (day: string) => CSSProperties | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The boxed calendar scrolls by itself: its fade only while more months are below.
  useMoreBelow(boxed ? box : NO_BOX, true);
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
              const st = dayStyle?.(d);
              const inner = (
                <>
                  <span className="tm-num">{n}</span>
                  {l === 'on' && <span className="tm-dot" aria-hidden="true" />}
                  {badge && <span className="tm-badge">{badge(d)}</span>}
                </>
              );
              return tappable ? (
                <button key={d} type="button" className={cls} style={st} data-heat={st ? '' : undefined} data-day={d} aria-pressed={l === 'on'} aria-label={dayAria(d)} onClick={() => onTap!(d)}>
                  {inner}
                </button>
              ) : (
                <span key={d} className={cls} style={st} data-heat={st ? '' : undefined} data-day={d} aria-disabled="true">
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

/**
 * Zip 60: "Format you'd like" on the sign-up sheets: three radio rows in the level list's own row style (Locked doubles with its short line, Americano
 * with its short line, Either is fine). Your own pick only; nobody sees anyone else's.
 */
export function VoteList({ value, onPick }: { value: FormatVote; onPick: (v: FormatVote) => void }) {
  return (
    <div className="tm-levels tm-votes" role="radiogroup" aria-label="Format you'd like" data-tm-votes>
      {VOTE_ROWS.map((r) => (
        <button key={r.vote} type="button" role="radio" aria-checked={value === r.vote} className={`tm-level${value === r.vote ? ' tm-level-on' : ''}`} data-vote={r.vote} onClick={() => onPick(r.vote)}>
          <span className="tm-vote-text">
            <span className="tm-vote-name">{r.name}</span>
            {r.line && <span className="tm-level-text tm-vote-line">{r.line}</span>}
          </span>
          <span className="tm-radio" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
