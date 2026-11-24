// Zip 77 (🎾77.reveal): the Americano standings reveal, the PLAYER side (pictures 1 to 4 and the reveal video). Part of the tournament card's own
// download, like RoundsView.
//   During the night: no Standings card at all (the server sends no table), one line at the bottom (StandingsLater).
//   Every game in: the card loses its kicker, its bar becomes a thin divider, and a slim green "Final standings coming soon" card with three
//   bouncing pickleballs takes the Up next card's place (WaitingCard; Home checks every 2 seconds meanwhile).
//   The reveal (RevealNight): the tournament card itself grows open into the board. The board is drawn from T alone (seconds after the tap plus
//   3 s, on the SERVER's clock: src/serverClock.ts), so every phone shows the same frame, a phone that opens mid-reveal lands in step, and one
//   that opens after it finished sees the final board once (remembered per phone). The X folds it away; then the night shows its final
//   standings in the usual Standings card. Reduced motion: the same order and timing, simple fades only.
// The timeline's numbers are shared/reveal.ts (the server holds the ticker, the congratulations and the medals until the board is done).
import { type CSSProperties, type ReactNode, type Ref, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlayerRoundsView, PlayerTournamentView } from '../../shared/tournament';
import { COUNTDOWN_MS, countdownText, REVEAL_COUNT_S, REVEAL_FLY_S, REVEAL_LEAD_MS, REVEAL_SLOTS_S, type RevealPlan, revealPlan } from '../../shared/reveal';
import { storageGet, storageSet } from '../lib';
import { Pickleball } from '../ui';
import { MedalIcon } from '../Medals';
import { clockKnown, serverNow, syncServerClock } from '../serverClock';
import { openLayer } from '../backStack';
import './reveal.css';

type Standing = PlayerRoundsView['standings'][number];

/** The bottom line during the night (picture 1). */
export function StandingsLater() {
  return (
    <p className="tc-rv-later" data-tc-standings-later>
      Standings will be revealed at the end of the night.
    </p>
  );
}

/** The card's top on the night once every game is in, during and after the reveal: the name, no kicker, a thin divider (picture 2). */
export function DoneHero({ name, onClose, xIn }: { name: string; onClose?: () => void; xIn?: boolean }) {
  return (
    <section className="tc-gd-hero tc-rv-hero" aria-label={name} data-tc-day-hero data-tc-done-hero>
      <div className="tc-gd-hero-top tc-rv-top">
        <h2 className="tc-gd-hero-name">{name}</h2>
        {onClose && <XButton onClose={onClose} shown={!!xIn} />}
      </div>
      <span className="tc-gd-bar tc-rv-divider" aria-hidden="true" />
    </section>
  );
}

function XButton({ onClose, shown, refEl }: { onClose: () => void; shown: boolean; refEl?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={refEl}
      type="button"
      className="tc-rv-x"
      aria-label="Close the standings"
      onClick={onClose}
      style={shown ? undefined : { opacity: 0, pointerEvents: 'none' }}
      tabIndex={shown ? 0 : -1}
      data-tc-reveal-x
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

/** Every game is in (picture 2): one white line and three of the site's pickleballs bouncing in turn. Zip 88: also "Games start soon". */
export function WaitingCard({ title = 'Final standings coming soon', sub, data = 'standings' }: { title?: string; sub?: ReactNode; data?: string }) {
  return (
    <section className={sub ? 'tc-gd-next tc-rv-wait tc-rv-wait-sub' : 'tc-gd-next tc-rv-wait'} role="status" aria-label={title} data-tc-waiting={data}>
      <span className="tc-rv-wait-words">
        <h3 className="tc-rv-wait-title">{title}</h3>
        {sub}
      </span>
      <span className="tc-rv-balls" aria-hidden="true">
        <Pickleball />
        <Pickleball />
        <Pickleball />
      </span>
    </section>
  );
}


/**
 * Zip 88 (Alex): game day, before the night starts: "Games start soon" with the bouncing pickleballs; in the last 30 minutes before the start a
 * countdown under it ("Starts in 24:10"), ticking each second on this phone (the server's clock as the reveal uses it; no extra call). At zero:
 * "Starting now" until the next check brings the games. Start now on the organizer's phone: the next check brings the games (no countdown).
 */
export function StartsSoonCard({ startsAt }: { startsAt: string }) {
  const at = Date.parse(startsAt);
  const [now, setNow] = useState(() => serverNow());
  const left = at - now;
  const ticking = left <= COUNTDOWN_MS;
  useEffect(() => {
    // Once a second in the last half hour; once a minute before it (only to notice the half hour coming).
    const id = window.setInterval(() => setNow(serverNow()), ticking ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [ticking]);
  const sub = !ticking ? undefined : left > 0 ? (
    <span className="tc-rv-wait-sub-line" data-tc-countdown={Math.ceil(left / 1000)}>
      Starts in <b>{countdownText(left)}</b>
    </span>
  ) : (
    <span className="tc-rv-wait-sub-line" data-tc-countdown={0}>
      Starting now
    </span>
  );
  return <WaitingCard title="Games start soon" sub={sub} data="start" />;
}

// ---------------------------------------------------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------------------------------------------------

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const seenKey = (id: string) => `pb_reveal_seen:${id}`;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number) => x * x * x;
/** The board grows open over this long at T0 (a phone that joins later opens it at once). */
const SLIDE_S = 0.55;
/** The X folds the board away over this long. */
const FOLD_MS = 380;
const RING_R = 82;
const RING_C = 2 * Math.PI * RING_R;

/** Each top place's effects: rays, shock waves, sparks, the card's shake (px). 3rd: a small pop and one ring. */
const FX: Record<1 | 2 | 3, { rays: boolean; waves: number; sparks: number; shake: number; cls: 'g' | 's' }> = {
  1: { rays: true, waves: 2, sparks: 28, shake: 7, cls: 'g' },
  2: { rays: false, waves: 1, sparks: 10, shake: 0, cls: 's' },
  3: { rays: false, waves: 1, sparks: 0, shake: 0, cls: 'g' },
};

/** The sparks' fixed directions and speeds (the same on every phone: a seeded list, not Math.random). */
function sparksOf(p: 1 | 2 | 3) {
  let s = 11 + p;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const n = FX[p].sparks;
  return Array.from({ length: n }, (_, i) => ({
    a: (i / n) * Math.PI * 2 + rnd() * 0.2,
    v: (p === 1 ? 260 : 190) + rnd() * (p === 1 ? 260 : 150),
    len: (p === 1 ? 12 : 9) + rnd() * 14,
    d: rnd() * 0.08,
  }));
}
const SPARKS = { 1: sparksOf(1), 2: sparksOf(2), 3: sparksOf(3) };

/**
 * One frame of the board at T seconds (a pure function of T and the plan: the same on every phone). Writes styles straight onto the board's
 * elements (60 frames a second, no React render).
 */
function drawFrame(root: HTMLElement, hero: HTMLElement, T: number, plan: RevealPlan, calm: boolean) {
  const n = plan.players;
  // The countdown: 5, 4, 3, 2, 1 in a lime ring that drains each second; the number pops.
  const count = root.querySelector<HTMLElement>('.tc-rv-count');
  if (count) {
    if (T < REVEAL_COUNT_S + 0.45) {
      const whole = Math.floor(Math.max(0, T));
      const num = Math.max(1, REVEAL_COUNT_S - whole);
      const frac = T >= REVEAL_COUNT_S ? 1 : Math.max(0, T) - whole;
      const numEl = count.querySelector<HTMLElement>('.tc-rv-num')!;
      if (numEl.textContent !== String(num)) numEl.textContent = String(num);
      count.querySelector('.tc-rv-arc')!.setAttribute('stroke-dashoffset', String(RING_C * frac));
      const pop = !calm && T < REVEAL_COUNT_S ? 1 + 0.14 * (1 - easeOut(clamp(frac / 0.22))) : 1;
      const out = T >= REVEAL_COUNT_S ? clamp((T - REVEAL_COUNT_S) / 0.4) : 0;
      numEl.style.transform = `scale(${pop.toFixed(3)})`;
      count.style.opacity = String(1 - out);
      count.style.transform = calm ? '' : `scale(${(1 - 0.15 * out).toFixed(3)})`;
      count.style.display = '';
    } else count.style.display = 'none';
  }
  // The card shakes when 1st lands.
  let shake = 0;
  if (!calm) {
    const st = T - (plan.at[1] + REVEAL_FLY_S[1]);
    if (n >= 1 && st > 0 && st < 0.45) shake = Math.sin(st * 70) * FX[1].shake * (1 - st / 0.45);
  }
  hero.style.transform = shake ? `translateX(${shake.toFixed(2)}px)` : '';

  root.querySelectorAll<HTMLElement>('.tc-rv-row').forEach((li) => {
    const p = Number(li.dataset.p);
    const slotIn = easeOut(clamp((T - REVEAL_SLOTS_S - (n - p) * 0.04) / 0.3));
    li.style.opacity = String(slotIn);
    li.style.translate = calm ? '' : `0 ${(10 * (1 - slotIn)).toFixed(2)}px`;
    const r = plan.at[p];
    const fly = !calm && p <= 2 ? REVEAL_FLY_S[p as 1 | 2] : 0;
    const inEl = li.querySelector<HTMLElement>('.tc-rv-in')!;
    const ph = li.querySelector<HTMLElement>('.tc-rv-ph')!;
    const rk = li.querySelector<HTMLElement>('.tc-rv-rkv')!;
    const md = li.querySelector<HTMLElement>('.tc-rv-md');
    const dash = li.querySelector<HTMLElement>('.tc-rv-dash')!;
    const land = T - (r + fly);
    li.classList.toggle('tc-rv-gold', p === 1 && land >= 0);
    li.classList.toggle('tc-rv-silver', p === 2 && land >= 0);
    li.classList.toggle('tc-rv-third', p === 3 && T >= r);
    li.dataset.in = T >= r ? '1' : '0';
    dash.style.opacity = '0';
    if (md) md.style.display = p === 1 && land >= 0 ? '' : 'none';
    rk.style.display = p === 1 && land >= 0 ? 'none' : '';
    if (T < r) {
      // Waiting: the empty slot. The drumroll before 2nd and 1st: the slot pulses (faster and longer for 1st).
      inEl.style.opacity = '0';
      ph.style.opacity = '1';
      inEl.style.transform = '';
      inEl.style.filter = '';
      li.style.scale = '';
      rk.style.transform = '';
      const dr = p <= 2 ? plan.drum[p as 1 | 2] : null;
      if (dr !== null && T >= dr) {
        const k = p === 1 ? 1 : 0.6;
        const w = 0.5 + 0.5 * Math.sin((T - dr) * Math.PI * 2 * (1.6 + (T - dr) * 0.9));
        li.style.boxShadow = calm
          ? `inset 0 0 0 2px color-mix(in srgb, var(--ball) ${Math.round(100 * Number((0.35 + 0.4 * w * k)))}%, transparent)`
          : `inset 0 0 0 2px color-mix(in srgb, var(--ball) ${Math.round(100 * Number(((0.25 + 0.65 * w) * k)))}%, transparent), 0 0 ${Math.round((8 + 22 * w) * k)}px color-mix(in srgb, var(--ball) ${Math.round(100 * Number(((0.12 + 0.3 * w) * k)))}%, transparent)`;
      } else li.style.boxShadow = '';
      return;
    }
    if (calm) {
      // Reduced motion: the row fades in where it is; a short lime outline fades out.
      const a = clamp((T - r) / 0.45);
      inEl.style.opacity = String(a);
      inEl.style.transform = '';
      inEl.style.filter = '';
      ph.style.opacity = String(1 - a);
      li.style.boxShadow = a < 1 && p > 1 ? `inset 0 0 0 2px color-mix(in srgb, var(--ball) ${Math.round(100 * Number((0.9 * (1 - a))))}%, transparent)` : '';
      li.style.scale = '';
      return;
    }
    if (p <= 2) {
      // 2nd drops in from a little above; 1st flies in from well above, then lands with the card's shake.
      const f = clamp((T - r) / fly);
      const e = easeIn(f);
      const dist = p === 1 ? 300 : 70;
      const sc = p === 1 ? 0.35 : 0.12;
      const bl = p === 1 ? 5 : 1.5;
      inEl.style.opacity = String(Math.min(1, f * 3));
      inEl.style.transform = land < 0 ? `translateY(${(-dist * (1 - e)).toFixed(1)}px) scale(${(1 + sc - sc * e).toFixed(3)})` : '';
      inEl.style.filter = land < 0 ? `blur(${(bl * (1 - e)).toFixed(2)}px)` : '';
      ph.style.opacity = land < 0 ? '1' : '0';
      if (land >= 0) {
        const k = clamp(land / 0.5);
        li.style.scale = String(1 + (p === 1 ? 0.08 : 0.05) * Math.sin(Math.PI * k) * (1 - k * 0.3));
        const glow = 0.45 + 0.55 * Math.exp(-land * 2.2);
        li.style.boxShadow =
          p === 1
            ? `0 0 0 2px var(--ball-hi), 0 0 ${Math.round(30 + 40 * glow)}px color-mix(in srgb, var(--ball) ${Math.round((0.35 + 0.4 * glow) * 100)}%, transparent)`
            : `inset 0 0 0 1.5px rgb(255 255 255 / ${Math.round((0.25 + 0.5 * Math.exp(-land * 2.5)) * 100)}%), 0 0 ${Math.round(18 * Math.exp(-land * 2))}px color-mix(in srgb, var(--ball) ${Math.round(0.3 * Math.exp(-land * 2) * 100)}%, transparent)`;
        if (p === 1 && md) {
          md.style.transform = `scale(${(1 + 0.4 * Math.exp(-land * 4)).toFixed(3)})`;
          // The dashed ring spins around the medal, then settles away.
          dash.style.opacity = String(land < 1.2 ? 1 : Math.max(0, 1 - (land - 1.2) * 2));
          dash.style.transform = `rotate(${(land * 420).toFixed(1)}deg) scale(${(1.25 - 0.25 * clamp(land / 0.4)).toFixed(3)})`;
        } else rk.style.transform = `scale(${(1 + 0.3 * Math.exp(-land * 4)).toFixed(3)})`;
      } else {
        li.style.boxShadow = `inset 0 0 0 2px color-mix(in srgb, var(--ball) ${Math.round(100 * Number(p === 1 ? 0.9 : 0.6))}%, transparent)`;
        li.style.scale = '';
      }
      return;
    }
    // Everyone else slides up into the slot with a short lime outline flash; 3rd a little slower, with a small pop.
    const dur = p === 3 ? 0.6 : 0.42;
    const a = clamp((T - r) / dur);
    const e = easeOut(a);
    inEl.style.opacity = String(e);
    inEl.style.transform = `translateY(${(16 * (1 - e)).toFixed(2)}px)`;
    inEl.style.filter = '';
    ph.style.opacity = String(1 - e);
    li.style.boxShadow = a < 1 ? `inset 0 0 0 2px color-mix(in srgb, var(--ball) ${Math.round(100 * Number((0.9 * (1 - a))))}%, transparent)` : '';
    li.style.scale = p === 3 ? String(1 + 0.04 * Math.sin(Math.PI * a)) : '';
  });

  // Rays behind 1st, shock waves for the top three, sparks for 1st and 2nd (none with reduced motion).
  const stage = root.querySelector<HTMLElement>('.tc-rv-stage');
  if (!stage || calm) return;
  for (const p of [1, 2, 3] as const) {
    if (p > n) continue;
    const row = root.querySelector<HTMLElement>(`.tc-rv-row[data-p="${p}"]`);
    if (!row) continue;
    // The row's place in the stage, without its own scale (offsets are layout, so the pop never moves the effects).
    const list = row.offsetParent as HTMLElement | null;
    const top = row.offsetTop + (list && list !== stage ? list.offsetTop : 0);
    const h = row.offsetHeight;
    const cx = row.offsetLeft + (list && list !== stage ? list.offsetLeft : 0) + row.offsetWidth / 2;
    const cy = top + h / 2;
    const land = T - (plan.at[p] + (p <= 2 ? REVEAL_FLY_S[p as 1 | 2] : 0));
    const f = FX[p];
    if (f.rays) {
      const rays = root.querySelector<HTMLElement>('.tc-rv-rays');
      if (rays) {
        rays.style.top = `${(cy - 320).toFixed(1)}px`;
        rays.style.opacity = land < 0 ? '0' : String((0.12 + 0.6 * Math.exp(-land * 2.2)).toFixed(3));
        rays.style.transform = `rotate(${(Math.max(0, land) * 22).toFixed(2)}deg) scale(${land < 0 ? 0.6 : (0.6 + 0.4 * easeOut(clamp(land / 0.5))).toFixed(3)})`;
      }
    }
    root.querySelectorAll<HTMLElement>(`.tc-rv-wave[data-p="${p}"]`).forEach((w) => {
      const t = land - Number(w.dataset.i) * 0.16;
      w.style.top = `${top}px`;
      w.style.height = `${h}px`;
      if (t < 0 || t > 0.8) {
        w.style.opacity = '0';
        return;
      }
      const k = easeOut(t / 0.8);
      const big = p === 1 ? 1.4 : p === 2 ? 0.9 : 0.5;
      w.style.opacity = String((1 - t / 0.8) * (p === 3 ? 0.7 : 0.95));
      w.style.transform = `scale(${(1 + 0.12 * k).toFixed(3)}, ${(1 + big * k).toFixed(3)})`;
    });
    root.querySelectorAll<HTMLElement>(`.tc-rv-spark[data-p="${p}"]`).forEach((el) => {
      const s = SPARKS[p][Number(el.dataset.i)];
      const t = land - s.d;
      if (t < 0 || t > 0.75) {
        el.style.opacity = '0';
        return;
      }
      const dist = s.v * (1 - Math.pow(1 - t / 0.75, 2)) * 0.75 + 30;
      el.style.height = `${s.len.toFixed(1)}px`;
      el.style.left = `${(cx + Math.cos(s.a) * dist * 1.25).toFixed(1)}px`;
      el.style.top = `${(cy + Math.sin(s.a) * dist * 0.75).toFixed(1)}px`;
      el.style.opacity = String(1 - t / 0.75);
      el.style.transform = `translate(-50%,-50%) rotate(${((s.a * 180) / Math.PI + 90).toFixed(1)}deg)`;
    });
  }
}

/** The board's rows: the slot number (or the gold medal for 1st), the name (wraps, never cut), "YOU", the record and the points. No money. */
function BoardRow({ r, p }: { r: Standing; p: number }) {
  return (
    <li className="tc-rv-row" data-p={p} data-tc-reveal-row={r.name} style={{ opacity: 0 } as CSSProperties}>
      <span className="tc-rv-rk">
        <span className="tc-rv-dash" aria-hidden="true" />
        <span className="tc-rv-rkv">{p}</span>
        {p === 1 && (
          <span className="tc-rv-md" style={{ display: 'none' }} aria-label="1st, gold medal" role="img">
            <MedalIcon className="tc-rv-medal" />
          </span>
        )}
      </span>
      <span className="tc-rv-ph" aria-hidden="true" />
      <span className="tc-rv-in" style={{ opacity: 0 }}>
        <span className="tc-rv-name">
          {r.name}
          {r.me && <span className="tc-rv-you">YOU</span>}
        </span>
        <span className="tc-rv-rec">{r.record}</span>
        <span className="tc-rv-pts">{r.points} pts</span>
      </span>
    </li>
  );
}

/**
 * The board inside the tournament card (picture 3). `startT`: where the timeline is when the board first shows (0 at T0; later for a phone that
 * joins mid-reveal; past the end for one that opens after it finished). It then follows the server's clock frame by frame.
 */
function Board({ t, standings, tapMs, onDone, onClose }: { t: PlayerTournamentView; standings: Standing[]; tapMs: number; onDone: () => void; onClose: () => void }) {
  const plan = revealPlan(standings.length);
  const heroRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const xRef = useRef<HTMLButtonElement>(null);
  const [xIn, setXIn] = useState(false);
  const [folding, setFolding] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const calm = useRef(reduced()).current;
  // Zip 85 (🎾84 dry run): the board is a layer like every sheet: Back (an iPhone edge swipe, Android's back) folds it away like the X, never
  // leaving the site. The layer is given up the moment the fold starts (whichever way), so the history entry goes back exactly once.
  const releaseRef = useRef<() => void>(() => undefined);
  const foldRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const release = openLayer(() => foldRef.current());
    releaseRef.current = release;
    return release;
  }, []);

  useLayoutEffect(() => {
    const root = boardRef.current;
    const hero = heroRef.current;
    if (!root || !hero) return undefined;
    let raf = 0;
    let finished = false;
    const startT = (serverNow() - tapMs - REVEAL_LEAD_MS) / 1000;
    // A phone that joins after the board has grown open opens it at once (the rows already revealed are just there).
    const slide = !calm && startT < SLIDE_S;
    const full = () => {
      root.style.height = '';
      return root.offsetHeight;
    };
    let fullH = full();
    const onResize = () => {
      fullH = full();
    };
    window.addEventListener('resize', onResize);
    const tick = () => {
      const T = (serverNow() - tapMs - REVEAL_LEAD_MS) / 1000;
      const sp = slide ? easeOut(clamp(T / SLIDE_S)) : 1;
      root.style.height = sp >= 1 ? '' : `${(fullH * sp).toFixed(1)}px`;
      drawFrame(root, hero, Math.max(0, T), plan, calm);
      const xo = clamp((T - plan.x) / 0.35);
      const x = xRef.current;
      if (x) {
        x.style.opacity = String(xo);
        x.style.transform = calm ? '' : `scale(${(0.7 + 0.3 * easeOut(xo)).toFixed(3)})`;
        x.style.pointerEvents = xo > 0.5 ? '' : 'none';
      }
      if (xo > 0.5) setXIn(true);
      if (T >= plan.end + 0.2) {
        if (!finished) {
          finished = true;
          doneRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      hero.style.transform = '';
    };
    // The board runs once per tap; the standings it shows are fixed once revealed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapMs]);

  function fold() {
    releaseRef.current();
    const root = boardRef.current;
    if (!root || calm) return onClose();
    setFolding(true);
    root.style.height = `${root.offsetHeight}px`;
    void root.offsetHeight;
    root.style.transition = `height ${FOLD_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${FOLD_MS}ms ease`;
    root.style.height = '0px';
    root.style.opacity = '0';
    setTimeout(onClose, FOLD_MS);
  }
  foldRef.current = fold;

  return (
    <section ref={heroRef} className="tc-gd-hero tc-rv-hero tc-rv-open" aria-label={`${t.name}, final standings`} data-tc-day-hero data-tc-reveal>
      <div className="tc-gd-hero-top tc-rv-top">
        <h2 className="tc-gd-hero-name">{t.name}</h2>
        <XButton refEl={xRef} onClose={fold} shown={xIn && !folding} />
      </div>
      <span className="tc-gd-bar tc-rv-divider" aria-hidden="true" />
      <div ref={boardRef} className="tc-rv-board" data-tc-board>
        <h2 className="tc-rv-title">Final standings</h2>
        <div className="tc-rv-stage">
          {!calm && <div className="tc-rv-rays" aria-hidden="true" />}
          <div className="tc-rv-count" aria-hidden="true">
            <span className="tc-rv-cl">Revealing in</span>
            <div className="tc-rv-ring">
              <svg viewBox="0 0 180 180">
                <circle cx="90" cy="90" r={RING_R} fill="none" stroke="rgb(255 255 255 / 12%)" strokeWidth="9" />
                <circle className="tc-rv-arc" cx="90" cy="90" r={RING_R} fill="none" style={{ stroke: 'var(--ball)' }} strokeWidth="9" strokeLinecap="round" strokeDasharray={RING_C} strokeDashoffset="0" />
              </svg>
              <span className="tc-rv-num">5</span>
            </div>
          </div>
          <ol className="tc-rv-list" aria-label="Final standings">
            {standings.map((r, i) => (
              <BoardRow key={r.name} r={r} p={i + 1} />
            ))}
          </ol>
          {!calm && (
            <div className="tc-rv-fx" aria-hidden="true">
              {([1, 2, 3] as const).flatMap((p) => [
                ...Array.from({ length: FX[p].waves }, (_, i) => <span key={`w${p}-${i}`} className={`tc-rv-wave tc-rv-${FX[p].cls}`} data-p={p} data-i={i} />),
                ...Array.from({ length: FX[p].sparks }, (_, i) => <i key={`s${p}-${i}`} className={`tc-rv-spark tc-rv-${FX[p].cls}`} data-p={p} data-i={i} />),
              ])}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The revealed night (status 'ended', `t.reveal`): before T0 the waiting look; then the board (in step with every phone); after it is closed
 * (or on a phone that already saw it) the card's top and the night's final standings in the usual Standings card (`after`).
 */
export function RevealNight({ t, day, rounds, after, done }: { t: PlayerTournamentView; day: PlayerRoundsView; rounds: ReactNode; after: ReactNode; done?: ReactNode }) {
  const reveal = t.reveal!;
  const plan = revealPlan(reveal.players);
  const seen = () => storageGet(seenKey(t.id)) === '1';
  const phaseNow = (): 'before' | 'board' | 'closed' => {
    const T = (serverNow() - reveal.tapMs - REVEAL_LEAD_MS) / 1000;
    if (T < 0) return 'before';
    if (T >= plan.end && seen()) return 'closed';
    return 'board';
  };
  // Until the clock is read (a phone that opens mid-reveal takes 3 quick readings, about a third of a second), the waiting look.
  const [ready, setReady] = useState(() => clockKnown());
  const [phase, setPhase] = useState<'before' | 'board' | 'closed'>(() => (clockKnown() ? phaseNow() : 'before'));
  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    void syncServerClock(3).then(() => {
      if (!live) return;
      setReady(true);
      setPhase(phaseNow());
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  // Before T0: wait for it on the server's clock (checked a few times a second).
  useEffect(() => {
    if (!ready || phase !== 'before') return undefined;
    const id = setInterval(() => {
      const p = phaseNow();
      if (p !== 'before') setPhase(p);
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase]);
  // A phone that opens the board after it finished sees it once: remembered at once (the X still closes it here).
  useEffect(() => {
    if (phase === 'board' && (serverNow() - reveal.tapMs - REVEAL_LEAD_MS) / 1000 >= plan.end) storageSet(seenKey(t.id), '1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (!ready || phase === 'before') {
    return (
      <>
        <DoneHero name={t.name} />
        <WaitingCard />
        {rounds}
        <StandingsLater />
      </>
    );
  }
  if (phase === 'board') {
    return (
      <>
        <Board
          t={t}
          standings={day.standings}
          tapMs={reveal.tapMs}
          onDone={() => storageSet(seenKey(t.id), '1')}
          onClose={() => {
            storageSet(seenKey(t.id), '1');
            setPhase('closed');
          }}
        />
        {rounds}
      </>
    );
  }
  // Zip 79: `done` (the results row) takes the card's top once the board is closed.
  return (
    <>
      {done ?? <DoneHero name={t.name} />}
      {rounds}
      {after}
    </>
  );
}
