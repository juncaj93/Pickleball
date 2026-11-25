// Zip 55 "Tournaments": the pieces the player sheets (src/tournament/TournamentHome.tsx, loaded only when a tournament is on a player's Home)
// and the organizer screens (src/pages/admin/Tournament.tsx) share: the month calendar and the level list. Styles: src/tournament/tournament.css.
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { type BreakNow, type CalMonth, type FormatVote, LEVELS, monthTitle, VOTE_ROWS } from '../../shared/tournament';
import { countdownText } from '../../shared/reveal';
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
  previous,
}: {
  value: number | null;
  onPick: (v: number) => void;
  flat?: boolean;
  theirPick?: number;
  theirName?: string;
  /** Zip 79 (picture skills/01): the level agreed at the player's last tournament: a small gray "PREVIOUS RATING" over its words; grayed
   *  while another level is picked (the label stays). */
  previous?: number;
}) {
  return (
    <div className={flat ? 'tm-levels tm-levels-flat' : 'tm-levels'} role="radiogroup" aria-label="Level">
      {LEVELS.map((l) => {
        const on = value === l.value;
        // The organizer's list: the player's own pick is always tinted and named ("SAGE PICKED"), also while it is the selected one;
        // "YOUR PICK" names a different level the organizer chose.
        const theirs = !!flat && theirPick === l.value;
        const prev = !flat && previous === l.value;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`tm-level${on ? ' tm-level-on' : ''}${theirs ? ' tm-level-theirs' : ''}${prev ? ' tm-level-prev' : ''}${prev && !on ? ' tm-level-prev-off' : ''}`}
            data-level={l.value}
            data-tm-previous={prev ? '' : undefined}
            onClick={() => onPick(l.value)}
          >
            <span className="tm-level-num">{l.label}</span>
            {prev ? (
              <span className="tm-level-text tm-level-prevwrap">
                <span className="tm-level-prevtag">Previous rating</span>
                {l.text}
              </span>
            ) : (
              <span className="tm-level-text">{l.text}</span>
            )}
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
    <div className="tm-levels tm-votes" role="radiogroup" aria-label="Format you’d like" data-tm-votes>
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

// ---------------------------------------------------------------------------------------------------------------------
// Zip 58 (🎾58.tourney4): the wheel for a three-way tie (picture 20, wheel-spin3.mp4). In this shared file because the player's card and the
// organizer's Home both draw it (one shared file, as Zip 55 set up: tests/zip48-split.test.ts).
// The arrow is on the rim at the top center; the answer is the server's (`result`, the index of the team that got the bye). Spinning turns the
// wheel clockwise several times and slows down so the winning slice stops under the arrow; then it lights up and the others dim. Reduced
// motion: no spin, the result just shows.
// ---------------------------------------------------------------------------------------------------------------------

/** The slices' colors (picture 20): green, purple, orange. */
const COLORS = ['var(--art-tie-1)', 'var(--art-tie-2)', 'var(--art-tie-3)'];
/** How long a spin takes (the video: about 4 seconds of turning). */
export const SPIN_MS = 4200;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The angle (clockwise from the top) that puts slice `i` of `n` under the arrow. */
const restAngle = (i: number, n: number) => -((i + 0.5) * (360 / n));

/**
 * The wheel. `names`: the slices, clockwise from the top. `result`: the slice that won (null: not spun). `spin`: play the spin to `result` now
 * (once per change of `spinKey`). `small`: the little wheel of "The wheel picked" (picture 21).
 */
export function Wheel({ names, result, spinKey, small, onDone }: { names: string[]; result: number | null; spinKey?: string | null; small?: boolean; onDone?: () => void }) {
  const n = Math.max(1, names.length);
  const step = 360 / n;
  // At rest: unspun as drawn (slice 0 starting at the top); spun: the result under the arrow.
  const [angle, setAngle] = useState(result === null || spinKey ? 0 : restAngle(result, n));
  const [lit, setLit] = useState(result !== null && !spinKey);
  const played = useRef<string | null>(null);
  useEffect(() => {
    if (result === null || !spinKey || played.current === spinKey) return;
    played.current = spinKey;
    if (reduced()) {
      setAngle(restAngle(result, n));
      setLit(true);
      onDone?.();
      return;
    }
    setLit(false);
    // Five turns and a little, so it lands on the slice's middle with a small random lean (never on a line).
    const lean = (Math.random() - 0.5) * step * 0.5;
    const raf = requestAnimationFrame(() => setAngle(5 * 360 + restAngle(result, n) + lean));
    const done = setTimeout(() => {
      setLit(true);
      onDone?.();
    }, SPIN_MS + 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, spinKey]);
  const R = 92;
  const slice = (i: number) => {
    const a0 = ((i * step - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * step - 90) * Math.PI) / 180;
    const large = step > 180 ? 1 : 0;
    return `M0 0 L${(R * Math.cos(a0)).toFixed(2)} ${(R * Math.sin(a0)).toFixed(2)} A${R} ${R} 0 ${large} 1 ${(R * Math.cos(a1)).toFixed(2)} ${(R * Math.sin(a1)).toFixed(2)} Z`;
  };
  const dots = Array.from({ length: 18 }, (_, i) => (i * 360) / 18);
  return (
    <div className={`tc-wh${small ? ' tc-wh-small' : ''}${lit ? ' tc-wh-lit' : ''}`} data-wheel={result === null ? 'ready' : lit ? 'picked' : 'spinning'}>
      <svg viewBox="-110 -110 220 220" className="tc-wh-svg" role="img" aria-label={result !== null && lit ? `The wheel picked ${names[result]}` : `A wheel with ${names.join(', ')}`}>
        <circle r="106" className="tc-wh-rim-gold" />
        <circle r="102" className="tc-wh-rim" />
        {dots.map((d) => (
          <circle key={d} r="2.6" cx={(98 * Math.cos(((d - 90) * Math.PI) / 180)).toFixed(2)} cy={(98 * Math.sin(((d - 90) * Math.PI) / 180)).toFixed(2)} className="tc-wh-dot" />
        ))}
        <g className="tc-wh-turn" style={{ transform: `rotate(${angle}deg)` }}>
          {names.map((name, i) => {
            const mid = i * step + step / 2;
            const off = result !== null && lit && i !== result;
            // A label runs around the wheel across its slice (picture 20), turned the other way on the bottom half so it is never upside down.
            const flip = mid > 90 && mid < 270;
            return (
              <g key={i} className={off ? 'tc-wh-slice tc-wh-off' : result === i && lit ? 'tc-wh-slice tc-wh-win' : 'tc-wh-slice'}>
                <path d={slice(i)} style={{ fill: COLORS[i % COLORS.length] }} className="tc-wh-fill" />
                <text
                  className="tc-wh-text"
                  transform={`rotate(${mid}) translate(0 ${-R * 0.6})${flip ? ' rotate(180)' : ''}`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{ fontSize: `${Math.max(11, Math.min(16, 165 / Math.max(6, name.length)))}px` }}
                >
                  {name}
                </text>
              </g>
            );
          })}
          {names.map((_, i) => {
            const a = ((i * step - 90) * Math.PI) / 180;
            return <line key={`l${i}`} x1="0" y1="0" x2={(R * Math.cos(a)).toFixed(2)} y2={(R * Math.sin(a)).toFixed(2)} className="tc-wh-line" />;
          })}
        </g>
        <circle r="13" className="tc-wh-hub" />
        <path d="M-11 -113 L11 -113 L0 -88 Z" className="tc-wh-arrow" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 89 (🎾89.smart pacing): the break's countdown ("Round 3 in 3:42"), the same on the organizer's night card and the players' phones. It ticks
// once a second from the server's clock as the view sent it (`serverNow`), so a phone with a wrong clock still shows the right time; at 0:00
// the next check moves the night on (the round goes on its courts). Here because this file is the piece both sides already share.
// ---------------------------------------------------------------------------------------------------------------------

/** Milliseconds left in the break, ticking once a second. */
export function useBreakLeft(b: BreakNow): number {
  const offset = useMemo(() => Date.parse(b.serverNow) - Date.now(), [b.serverNow]);
  const until = Date.parse(b.until);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset, until]);
  return Math.max(0, until - now);
}

/** "Round 3 in 3:42". */
export function BreakLeft({ b }: { b: BreakNow }) {
  const left = useBreakLeft(b);
  return (
    <span className="break-left" data-break-left={Math.ceil(left / 1000)}>
      Round {b.round} in <b>{countdownText(left)}</b>
    </span>
  );
}
