// Zip 58 (🎾58.tourney4), the player's Home after a tournament ends (pictures 38 to 40, videos 44 and 45):
//   the WINNERS TICKER: a slim full-width bar at the top of Home that runs right to left with the tournament's name and its winners (Locked
//   doubles: "CHAMPIONS", the team and both winners with their medals; Americano: "WINNER" then "RUNNER-UP"), for the banner length the
//   organizer chose (1 week to start). The server stops sending it when that time is up, so it disappears by itself. Reduced motion: it stands still.
//   the CONGRATULATIONS card: once, for each winner (and Americano's runner-up), until Nice. Zip 90: the prize reveal (PrizeReveal below).
// Only while the server sends `tourAwards` (the Tournaments switch on, a tournament this player could see): otherwise nothing here draws.
import { Fragment, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { TickerView, TourAwardsView } from '../shared/tournament';
import { formatPrice } from '../shared/money';
import { type PrizeKind, prizeKinds, type PrizePhase, prizeWords } from '../shared/prizeReveal';
import { api, ApiError, isDemo } from './lib';
import { useToast } from './ui';
import { MedalIcon, Medals } from './Medals';
import './tour-awards.css';

type Item = { kind: 'label'; text: string } | { kind: 'name'; text: string; medals: number } | { kind: 'dot' };

function itemsOf(t: TickerView): Item[] {
  const out: Item[] = [{ kind: 'label', text: t.name }, { kind: 'dot' }];
  if (t.champions) {
    out.push({ kind: 'label', text: 'Champions' }, { kind: 'name', text: t.champions.team, medals: 0 });
    for (const p of t.champions.players) out.push({ kind: 'name', text: p.name, medals: p.medals });
  }
  if (t.winner) out.push({ kind: 'label', text: 'Winner' }, { kind: 'name', text: t.winner.name, medals: t.winner.medals });
  if (t.winner && t.runnerUp) out.push({ kind: 'dot' });
  if (t.runnerUp) out.push({ kind: 'label', text: 'Runner-up' }, { kind: 'name', text: t.runnerUp.name, medals: t.runnerUp.medals });
  out.push({ kind: 'dot' });
  return out;
}

function TickerRun({ items, hidden }: { items: Item[]; hidden?: boolean }) {
  return (
    <span className="tw-run" aria-hidden={hidden ? 'true' : undefined}>
      {items.map((x, i) => (
        <Fragment key={i}>
          {x.kind === 'label' ? (
            <span className="tw-label">{x.text}</span>
          ) : x.kind === 'dot' ? (
            <span className="tw-dot" aria-hidden="true" />
          ) : (
            <span className="tw-name">
              {x.text}
              {x.medals > 0 && <Medals n={x.medals} />}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** The slim winners bar (full width, under the title). Two copies of the line run side by side so the loop never shows a gap. */
export function WinnersTicker({ t }: { t: TickerView }) {
  const items = itemsOf(t);
  const words = [t.name, t.champions ? `Champions ${t.champions.team}, ${t.champions.players.map((p) => p.name).join(' and ')}` : '', t.winner ? `Winner ${t.winner.name}` : '', t.runnerUp ? `Runner-up ${t.runnerUp.name}` : '']
    .filter(Boolean)
    .join('. ');
  return (
    <div className="tw" role="region" aria-label={words} data-tour-ticker={t.key}>
      <div className="tw-track">
        <TickerRun items={items} />
        <TickerRun items={items} hidden />
      </div>
    </div>
  );
}

/** Zip 90: which header piece a prize card lands on, and where that piece is: 'masked' (held back), 'arriving' (the header makes room
 *  for it, still hidden), 'landed' (the header shows the real amount). PlayerHome keeps it; leaving Home before Nice starts over. */
export type { PrizeKind, PrizePhase };
type Congrats = NonNullable<TourAwardsView['congrats']>;

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The flip (CSS, 500 ms) and the flight (accelerating, then the hard bump). One place for the timings. */
const FLIP_MS = 520;
const FLY_MS = 520;
const OPEN_AT = 0.4;
/** Round 4: the credit's count runs right after the turn (nothing starts inside a card while it turns), then its flight. */
const COUNT_MS = 380;
const GLOW_AFTER_MS = 1000;
const GLOW_MS = 1300;

/** The site's shaded round pickleball with its holes (the admin tournament card's ball light and shade), for the face-down card. */
function RevealBall() {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="rvl-ball" viewBox="0 0 60 60" aria-hidden="true">
      <defs>
        <radialGradient id={`pzb${id}`} cx="35%" cy="35%" r="70%">
          <stop offset="0%" style={{ stopColor: 'var(--ball-hi)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--ball)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--ball-lo)' }} />
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="29" fill={`url(#pzb${id})`} />
      <g className="rvl-holes">
        <circle cx="30" cy="15.6" r="3.9" />
        <circle cx="16.8" cy="24" r="3.9" />
        <circle cx="43.2" cy="24" r="3.9" />
        <circle cx="21.6" cy="39.6" r="3.9" />
        <circle cx="38.4" cy="39.6" r="3.9" />
        <circle cx="30" cy="28.8" r="3.3" />
      </g>
    </svg>
  );
}

/** The burst's dots, drawn with the card (hidden) so the tap only starts their animations: where each one flies (fixed per dot). */
const DOTS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2 + ((i * 7) % 5) * 0.07;
  const d = 46 + ((i * 13) % 7) * 5;
  return { color: ['var(--gold)', 'var(--ball)', 'var(--tour-ink)'][i % 3], dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d), ms: 560 + ((i * 11) % 5) * 40 };
});

/** A small burst of gold, lime and white dots from the card's middle (motion only): transform and opacity only, on dots already there. */
function burst(card: HTMLElement) {
  card.querySelectorAll<HTMLElement>('.rvl-dot').forEach((dot, i) => {
    const d = DOTS[i];
    dot.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${d.dx}px), calc(-50% + ${d.dy}px)) scale(0.4)`, opacity: 0 },
      ],
      { duration: d.ms, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
  });
}

/** The header piece a prize lands on: a new piece still closed (`slot`), or the one already there. */
function headerTarget(kind: PrizeKind): { slot: HTMLElement | null; el: HTMLElement | null } {
  const slot = document.querySelector<HTMLElement>(`.topbar [data-rv-slot="${kind}"]`);
  if (kind === 'medal') return { slot, el: slot ? slot.querySelector<HTMLElement>('.md') : document.querySelector<HTMLElement>('.topbar .h1-badge .md') };
  const chip = (slot ?? document).querySelector<HTMLElement>('.topbar [data-credit-chip] .cc-amount');
  return { slot, el: chip };
}

/** The flight: a copy of the prize (`ghost`) flies from `from` to the header piece, the piece opens as it arrives, then the hard little bump. */
async function slam(kind: PrizeKind, from: HTMLElement, ghost: HTMLElement, setPhase: (k: PrizeKind, p: PrizePhase) => void, alive: () => boolean) {
  setPhase(kind, 'arriving');
  await frame();
  await frame();
  if (!alive()) return;
  const { slot, el } = headerTarget(kind);
  if (!el || reduced()) {
    setPhase(kind, 'landed');
    return;
  }
  // Where the piece will be once open: a new medal opens to the right of the name (its left edge stays); a new credit chip opens to the left
  // of the date (its right edge stays), so the number inside it lands one chip width to the left of where it sits while closed.
  const w = slot ? slot.scrollWidth : 0;
  const t = el.getBoundingClientRect();
  const dx = slot && kind === 'credit' ? -w : 0;
  const to = { left: t.left + dx, top: t.top, width: t.width, height: t.height };
  const f = from.getBoundingClientRect();
  ghost.style.left = `${f.left}px`;
  ghost.style.top = `${f.top}px`;
  ghost.style.width = `${f.width}px`;
  ghost.style.height = `${f.height}px`;
  document.body.appendChild(ghost);
  const s = Math.min(to.width / f.width, to.height / f.height);
  const tx = to.left + to.width / 2 - (f.left + f.width / 2);
  const ty = to.top + to.height / 2 - (f.top + f.height / 2);
  const flight = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${tx}px, ${ty}px) scale(${s})`, opacity: 1 },
    ],
    { duration: FLY_MS, easing: 'cubic-bezier(.55,0,.95,.4)', fill: 'forwards' },
  );
  let opening: Animation | null = null;
  if (slot) {
    const gap = kind === 'credit' ? getComputedStyle(slot.parentElement!).columnGap : '0px';
    opening = slot.animate(
      [
        { width: '0px', marginInlineStart: `calc(-1 * ${gap === 'normal' ? '0px' : gap})` },
        { width: `${w}px`, marginInlineStart: '0px' },
      ],
      { duration: FLY_MS * (1 - OPEN_AT), delay: FLY_MS * OPEN_AT, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' },
    );
  }
  await flight.finished.catch(() => undefined);
  ghost.remove();
  if (!alive()) {
    opening?.cancel();
    return;
  }
  setPhase(kind, 'landed');
  await frame();
  opening?.cancel();
  // The bump: the piece pops, the header gives a tiny shake.
  const piece = kind === 'medal' ? document.querySelector<HTMLElement>('.topbar .h1-badge') : document.querySelector<HTMLElement>('.topbar [data-credit-chip]');
  piece?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)', offset: 0.3 }, { transform: 'scale(0.92)', offset: 0.65 }, { transform: 'scale(1)' }], {
    duration: 380,
    easing: 'ease-out',
  });
  document
    .querySelector<HTMLElement>('.topbar-inner')
    ?.animate([{ transform: 'none' }, { transform: 'translate(-3px, 1px)' }, { transform: 'translate(3px, -1px)' }, { transform: 'translate(-2px, 0)' }, { transform: 'translate(1px, 0)' }, { transform: 'none' }], {
      duration: 260,
      easing: 'linear',
    });
  if (kind === 'medal') {
    await wait(GLOW_AFTER_MS);
    const cup = document.querySelector<HTMLElement>('.topbar .cup-btn');
    if (!cup || !alive()) return;
    cup.classList.add('rv-glow');
    await wait(GLOW_MS);
    cup.classList.remove('rv-glow');
  }
}

/** The amounts the credit counts through ($1 to $14; at most 15 steps for a big prize), the last one exact. */
function countSteps(cents: number): string[] {
  const dollars = Math.max(1, Math.round(cents / 100));
  const n = Math.min(dollars, 15);
  const out: string[] = [];
  for (let i = 1; i < n; i++) out.push(`$${Math.max(1, Math.round((dollars * i) / n))}`);
  out.push(formatPrice(cents));
  return out;
}

/**
 * Zip 90 rounds 3 and 4: the credit counts up $1 to $14 as an odometer: every amount is drawn before the tap, one under the other, and the
 * strip only slides (a stepped transform), right after the turn (so nothing starts inside the card while it turns). It shows $1 while it
 * turns. Without motion: the final amount.
 */
function Odometer({ cents, strip }: { cents: number; strip: RefObject<HTMLSpanElement | null> }) {
  const steps = countSteps(cents);
  const last = steps[steps.length - 1];
  return (
    <span className="rvl-odo">
      <span className="rvl-odo-size">{last}</span>
      <span ref={strip} className="rvl-odo-strip" style={{ transform: reduced() ? `translateY(-${steps.length - 1}em)` : 'translateY(0)' }} data-steps={steps.length}>
        {steps.map((v, i) => (
          <span key={i}>{v}</span>
        ))}
      </span>
    </span>
  );
}

/** Runs the odometer (after the turn) and resolves when it shows the final amount. */
function countUp(strip: HTMLElement | null): Promise<void> {
  const n = Number(strip?.dataset.steps ?? 1);
  if (!strip || n < 2) return Promise.resolve();
  const a = strip.animate([{ transform: 'translateY(0)' }, { transform: `translateY(-${n - 1}em)` }], { duration: COUNT_MS, easing: `steps(${n}, jump-none)`, fill: 'forwards' });
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

function PrizeCard({ kind, c, flipped, onFlip, index, of }: { kind: PrizeKind; c: Congrats; flipped: boolean; onFlip: (card: HTMLElement, art: HTMLElement) => void; index: number; of: number }) {
  const card = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLSpanElement>(null);
  const strip = useRef<HTMLSpanElement>(null);
  const [turning, setTurning] = useState(false);
  return (
    <div ref={card} className={`rvl-card${flipped ? ' rvl-flipped' : ''}${turning ? ' rvl-turning' : ''}`} data-pz-card={kind} data-pz-flipped={flipped ? '' : undefined}>
      <div className="rvl-flip">
        <button
          type="button"
          className="rvl-face rvl-front"
          aria-label={of > 1 ? `Tap to reveal prize ${index + 1} of ${of}` : 'Tap to reveal your prize'}
          disabled={flipped}
          aria-hidden={flipped ? true : undefined}
          tabIndex={flipped ? -1 : undefined}
          onClick={() => {
            if (flipped || !card.current || !art.current) return;
            // Everything for the turn starts in this one tap (the turn and the dots, outside the turning layer); nothing starts, swaps or
            // re-renders inside the card until the turn is over (the count, Nice and the flight come after it).
            setTurning(true);
            if (!reduced()) burst(card.current);
            onFlip(card.current, art.current);
          }}
        >
          <span className="rvl-ballwrap" aria-hidden="true">
            <span className="rvl-glow" />
            <RevealBall />
          </span>
          <span className="rvl-tap" aria-hidden="true">
            <span>T</span>
            <span>A</span>
            <span>P</span>
          </span>
        </button>
        <div className="rvl-face rvl-back" aria-hidden={flipped ? undefined : true}>
          {kind === 'medal' ? (
            <>
              <span ref={art} className="rvl-art rvl-medal">
                <MedalIcon className="rvl-medal-ico" />
              </span>
              <span className="rvl-what">Gold medal</span>
              <span className="rvl-why">Permanent clout</span>
            </>
          ) : (
            <>
              <span ref={art} className="rvl-art rvl-amount">
                <Odometer cents={c.creditCents} strip={strip} />
              </span>
              <span className="rvl-what">Credit</span>
              <span className="rvl-why">Towards next game</span>
            </>
          )}
        </div>
      </div>
      {DOTS.map((d, i) => (
        <span key={i} className="rvl-dot" style={{ background: d.color }} aria-hidden="true" />
      ))}
    </div>
  );
}

/** One line, never wraps: shrinks from the card's size down to about 0.9 rem until it fits; only then may it wrap (never cut). */
function useFitTitle(el: RefObject<HTMLElement | null>, text: string) {
  useLayoutEffect(() => {
    const h = el.current;
    if (!h) return;
    const fit = () => {
      h.style.fontSize = '';
      h.style.whiteSpace = 'nowrap';
      const base = parseFloat(getComputedStyle(h).fontSize);
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const floor = Math.max(11, 0.9 * root);
      let size = base;
      while (h.scrollWidth > h.clientWidth + 0.5 && size > floor) {
        size = Math.max(floor, size - 0.5);
        h.style.fontSize = `${size}px`;
      }
      if (h.scrollWidth > h.clientWidth + 0.5) h.style.whiteSpace = 'normal';
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(h.parentElement ?? h);
    return () => ro?.disconnect();
  }, [el, text]);
}

/**
 * Zip 90 (pictures 1 to 6): the prize reveal, in the old congratulations card's place, once, until Nice. Face-down cards (the gold medal for
 * 1st place, the credit when there is some); a tap flips one and slams its prize into the header (PlayerHome holds the header's medal and
 * credit back until then). Nice shows once every card is turned; it does what Nice always did (POST /api/tournament/award-seen).
 */
export function PrizeReveal({ c, onChanged, onPhase }: { c: Congrats; onChanged: () => Promise<unknown>; onPhase?: (k: PrizeKind, p: PrizePhase) => void }) {
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flipped, setFlipped] = useState<PrizeKind[]>([]);
  const [settled, setSettled] = useState<PrizeKind[]>([]);
  const toast = useToast();
  const title = useRef<HTMLHeadingElement>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    // The cards start face down each time they appear, so the header starts masked with them.
    for (const k of ['medal', 'credit'] as const) onPhase?.(k, 'masked');
    return () => {
      live.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const words = prizeWords(c);
  useFitTitle(title, words.title);
  const kinds = prizeKinds(c);
  if (gone || !kinds.length) return null;
  const setPhase = (k: PrizeKind, p: PrizePhase) => onPhase?.(k, p);
  const flip = (kind: PrizeKind) => (card: HTMLElement, art: HTMLElement) => {
    setFlipped((f) => (f.includes(kind) ? f : [...f, kind]));
    const still = reduced();
    void card;
    void (async () => {
      if (!still) await wait(FLIP_MS);
      if (!live.current) return;
      // The credit counts up right after the turn, then flies. Nice comes in only once the turn is over (nothing moves while one turns).
      if (kind === 'credit' && !still) await countUp(art.querySelector<HTMLElement>('.rvl-odo-strip'));
      if (!live.current) return;
      setSettled((x) => (x.includes(kind) ? x : [...x, kind]));
      const ghost = document.createElement('div');
      ghost.className = `rvl-ghost rvl-ghost-${kind}`;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.innerHTML = kind === 'medal' ? art.innerHTML : formatPrice(c.creditCents);
      await slam(kind, art, ghost, setPhase, () => live.current);
    })();
  };
  const done = kinds.every((k) => settled.includes(k));
  return (
    <section className="rvl" aria-label={words.kicker} data-tour-congrats={c.key} data-prize={c.award} data-prize-cards={kinds.join(' ')}>
      <p className="rvl-kicker">{words.kicker}</p>
      <h2 ref={title} className="rvl-title">
        {words.title}
      </h2>
      <div className={`rvl-cards${kinds.length === 1 ? ' rvl-one' : ''}`}>
        {kinds.map((k, i) => (
          <PrizeCard key={k} kind={k} c={c} flipped={flipped.includes(k)} onFlip={flip(k)} index={i} of={kinds.length} />
        ))}
      </div>
      {done && (
        <button
          type="button"
          className="btn block big rvl-nice"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('POST', '/api/tournament/award-seen', { tournamentId: c.tournamentId });
              setGone(true);
              void onChanged();
            } catch (err) {
              // View as, or the connection: the card stays; the next tap tries again. Zip 76: said like every other button.
              if (isDemo(err)) toast(err.message);
              else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
            } finally {
              setBusy(false);
            }
          }}
          data-tour-nice
        >
          Nice
        </button>
      )}
    </section>
  );
}

/** The file's one door from Home (one lazy load): the ticker (`t`) or the congratulations card (`c`). */
export default function TourAwardsPart({ t, c, onChanged, onPhase }: { t?: TickerView; c?: Congrats; onChanged?: () => Promise<unknown>; onPhase?: (k: PrizeKind, p: PrizePhase) => void }) {
  return t ? <WinnersTicker t={t} /> : c ? <PrizeReveal c={c} onChanged={onChanged ?? (async () => undefined)} onPhase={onPhase} /> : null;
}
