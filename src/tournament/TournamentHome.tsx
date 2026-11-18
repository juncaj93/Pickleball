// Zip 55 "Tournaments", the PLAYER side: the pinned ticket card at the top of Home (mocks 04, 07, 08), the "Only you can see this" strip (mock
// 04), the 2-step sign-up sheet (05, 06), "See who's signed up" (names only), Edit my sign-up (13) and the Back out confirm (13b).
// Zip 56, piece 2 (the pictures 07 to 13b): tickets. The card's states 3 (Tickets open: Lock my spot), 4 (8 spots taken: Join waitlist) and 5
// (You're in), the waitlist, tapping the card for the overlay with Who's in and the waitlist (09, 11, 12), the site's own Pay sheet (10), Back
// out with the money it gives back (13b), and the plain Canceled and "Rescheduled. Pick your dates again" cards. Money moves only on the server
// (server/tournamentTickets.ts); this screen sends what it showed, so a stale screen never pays or gets back a different amount.
//
// This file is its own download (src/TournamentSlot.tsx loads it): a phone fetches it only when the server sends a tournament for it, so with
// the switch off (or a tournament on Only me) a player's download is exactly main's.
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { FormatVote, PlayerTicketsView, PlayerTournamentView } from '../../shared/tournament';
import { DEFAULT_FORMAT_VOTE, dayShort, formatLine, formatName, hoursLabel, monthsBetween, startLabel, stubParts } from '../../shared/tournament';
import { payByLabel, payByShort, payCountdown, placeWord } from '../../shared/tournamentTickets';
import { formatPrice, venmoPayUrl } from '../../shared/money';
import { api, ApiError, useNow, VIEW_ONLY_MESSAGE } from '../lib';
import { AlertCard } from '../AlertCard';
import { ConfirmDialog, Pickleball, Sheet, useToast } from '../ui';
import { PaySheet } from '../PaySheet';
import type { TournamentPayInfo } from '../TournamentSlot';
import { type DayLook, LevelList, MonthCalendar, useMoreBelow, VoteList } from './parts';

/** Zip 60: the format line on the cards. While the players' vote is open it is "Tournament style TBD" (no other words). */
const formatText = (t: PlayerTournamentView): string => (t.formatTbd ? 'Tournament style TBD' : formatLine(t.format));
/** The card's label for screen readers. */
const cardLabel = (t: PlayerTournamentView): string => (t.formatTbd ? `${t.name}, style to be decided` : `${t.name}, ${formatName(t.format)} tournament`);

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 && /view only/i.test(err.message) ? VIEW_ONLY_MESSAGE : err.message;
  return 'That did not work. Try again.';
}

/** The organizer's first name for the players' words ("Pay Alex $16", "once Alex confirms"). */
const firstOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'the organizer';

/**
 * Zip 56: where this player stands with tickets, from the server's answer only.
 *   lock     a spot is open and their ticket is not paid: Lock my spot (state 3)
 *   full     every spot is taken and they are not in line: Join waitlist (state 4)
 *   in       locked in (state 5)
 *   line     on the waitlist (unpaid: Hold my spot; paid: their spot is held)
 *   (Zip 63, the trust rule: an I paid counts as locked in on the player's screens, so there is no "waiting" state for players any more)
 *   closed   ticket sales are over (the night has started) and they are not locked in
 */
type TicketState = 'lock' | 'full' | 'in' | 'line' | 'closed';

export function ticketStateOf(t: PlayerTournamentView): TicketState | null {
  const k = t.tickets;
  if (t.status !== 'tickets' || !k || !t.me) return null;
  const mine = k.mine;
  if (mine?.place === 'spot') return 'in';
  // A waitlist player keeps their place on the card even when sales are closed (no Hold button then: it waits for a freed spot).
  if (k.closed && mine?.place !== 'line') return 'closed';
  // Alex: the spots follow the players locked in; every spot is taken only at 12, then the waitlist starts.
  const open = !k.full;
  const paid = !!mine && mine.creditCents + mine.paidCents >= k.priceCents;
  if (mine?.place === 'line') return open && !paid && mine.claimCents === 0 ? 'lock' : 'line';
  // Zip 63 (Alex): we trust people that they paid. An I paid for the whole ticket is "locked in" at once (the organizer confirms or undoes it).
  if (mine && mine.claimCents > 0 && mine.owedCents === 0) return 'in';
  return open ? 'lock' : 'full';
}

/** What is still to pay on their ticket (the price before they ever tapped Lock my spot). */
const dueOf = (k: PlayerTicketsView) => (k.mine ? k.mine.owedCents : k.priceCents);

/** Their place in line (1 = first), or 0. */
const linePlace = (k: PlayerTicketsView) => k.line.findIndex((x) => x.me) + 1;

export default function TournamentHome({ t, onChanged, pay, notice }: { t: PlayerTournamentView; onChanged: () => Promise<unknown>; pay: TournamentPayInfo; notice?: ReactNode }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<null | 'signup' | 'edit' | 'who' | 'overlay'>(null);
  const [askOut, setAskOut] = useState(false);
  const [askShow, setAskShow] = useState(false);
  const [paying, setPaying] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Zip 59: the ticket punch (about 1.5 seconds) plays over the save when sign-up finishes; it never waits on it.
  const [punch, setPunch] = useState(false);
  const punchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(punchTimer.current), []);
  function startPunch() {
    clearTimeout(punchTimer.current);
    setPunch(true);
    punchTimer.current = setTimeout(() => setPunch(false), PUNCH_MS);
  }
  function stopPunch() {
    clearTimeout(punchTimer.current);
    setPunch(false);
  }
  const signed = t.me !== null;
  const k = t.tickets ?? null;
  const org = firstOf(pay.group.organizerName);

  async function run(fn: () => Promise<unknown>, done: string | ((res: any) => string)): Promise<any> {
    if (busy) return null;
    setBusy(true);
    try {
      const res = await fn();
      await onChanged();
      const said = typeof done === 'function' ? done(res) : done;
      if (said) toast(said);
      return res ?? true;
    } catch (err) {
      toast(errorText(err), 'error');
      // Something changed under the sheet (the date was picked, the tournament closed, the spots filled): show what is true now.
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) void onChanged();
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Lock my spot / Hold my spot: credit goes on at once; what is left opens the Pay sheet. */
  async function lock(intent: 'lock' | 'hold') {
    if (!k) return;
    const res = await run(
      () => api('POST', '/api/tournament/lock', { tournamentId: t.id, intent, priceCents: k.priceCents }),
      (r: { result: string; creditUsedCents: number; dueCents: number }) => {
        const used = r.creditUsedCents > 0 ? ` ${formatPrice(r.creditUsedCents)} credit used.` : '';
        if (r.result === 'locked') return `You're locked in.${used}`;
        if (r.result === 'held') return `Your spot is held.${used}`;
        return r.creditUsedCents > 0 ? `${formatPrice(r.creditUsedCents)} credit used. ${formatPrice(r.dueCents)} left to pay.` : `Pay ${org} ${formatPrice(r.dueCents)}`;
      },
    );
    if (res && res.result === 'due' && res.dueCents > 0) setPaying(res.dueCents);
  }

  async function iPaid() {
    if (paying === null) return;
    const held = k?.mine?.place === 'line' || ticketStateOf(t) === 'line';
    const cents = paying;
    // Zip 63: the sheet closes at the tap, so the card (and its new gold ball's pop) is in view when the answer lands. A failed save shows its
    // error and opens the sheet again.
    setPaying(null);
    const ok = await run(() => api('POST', '/api/tournament/paid', { tournamentId: t.id, cents }), held ? 'Thanks. Your spot is held.' : 'Thanks. You’re locked in.');
    if (!ok) setPaying(cents);
  }

  async function joinWaitlist() {
    const ok = await run(() => api('POST', '/api/tournament/waitlist', { tournamentId: t.id }), "You're on standby");
    if (ok) setSheet('overlay');
  }

  // Back out: what the sheet says comes back is what the server checks (credit and confirmed cash on the ticket, an I paid that waits).
  const mine = k?.mine ?? null;
  const backCents = mine ? mine.creditCents + mine.paidCents + mine.claimCents : 0;
  // Zip 63: no waiting words for players (an I paid still waiting comes back as credit when the organizer answers it, as before).
  const backLine = !mine || backCents === 0 ? '' : ` Your ${formatPrice(backCents)} comes back as credit.`;
  const venmo = venmoPayUrl(pay.group.venmoUrl, paying ?? 0, `${t.name} ticket${pay.meName ? ` - ${pay.meName}` : ''}`);

  return (
    <div className="tc-wrap stack" data-tournament={t.status}>
      {/* Zip 63: the pay countdown (mocks 08 to 13), first: only while this player can lock a spot and has not paid, from 3 days before Pay by. */}
      {k?.payBy && !k.closed && ticketStateOf(t) === 'lock' && <PayCountdownCard t={t} payBy={k.payBy} due={dueOf(k)} busy={busy} onPay={() => void lock('lock')} />}
      {/* Zip 60's date alert, right under the countdown (PlayerHome hands it in). */}
      {notice}
      {t.onlyMe && (
        <div className="tc-strip" role="note" data-tc-strip>
          <div className="tc-strip-text">
            <p className="tc-strip-title">Only you can see this</p>
            <p className="tc-strip-sub">Players don't see the {t.name} yet.</p>
          </div>
          <button type="button" className="btn" onClick={() => setAskShow(true)} data-tc-show>
            Show to everyone
          </button>
        </div>
      )}
      <TicketCard
        t={t}
        org={org}
        busy={busy}
        punch={punch}
        onSignUp={() => setSheet('signup')}
        onWho={() => setSheet(t.status === 'tickets' ? 'overlay' : 'who')}
        onOpen={t.status === 'tickets' && signed ? () => setSheet('overlay') : undefined}
        onEdit={() => setSheet('edit')}
        onDropOut={() => setAskOut(true)}
        onLock={() => void lock('lock')}
        onHold={() => void lock('hold')}
        onJoin={() => void joinWaitlist()}
      />
      {t.status === 'tickets' && k && signed && (
        <Sheet calmFocus open={sheet === 'overlay'} title={t.name} back="Home" onClose={() => setSheet((cur) => (cur === 'overlay' ? null : cur))} className="tc-tw-overlay">
          <Overlay
            t={t}
            k={k}
            org={org}
            meName={pay.meName}
            busy={busy}
            onLock={() => void lock('lock')}
            onHold={() => void lock('hold')}
            onKeep={() => {
              setSheet(null);
              toast("You're on standby");
            }}
            onJoin={() => void joinWaitlist()}
            onDropOut={() => setAskOut(true)}
            onEdit={() => setSheet('edit')}
          />
        </Sheet>
      )}
      {k && (
        <PaySheet
          g={pay}
          open={paying !== null}
          onClose={() => setPaying(null)}
          cents={paying ?? 0}
          pay={venmo}
          onTapPay={() => undefined}
          onPaid={() => void iPaid()}
          busy={busy}
          saving={busy}
        />
      )}
      <SignUpSheet
        org={org}
        key={`signup-${sheet === 'signup'}`}
        t={t}
        open={sheet === 'signup'}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={async (level, dates, vote) => {
          const save = () => api('POST', '/api/tournament/signup', { tournamentId: t.id, level, dates, ...(vote ? { formatVote: vote } : {}) });
          // Reduced motion: no punch, straight to "You're on the list" (the toast and the card).
          if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const ok = await run(save, "You're on the list");
            if (ok) setSheet(null);
            return;
          }
          // The punch plays over the save: the sheet closes at once, the save runs at its own speed, the card shows the punch for about 1.5 s.
          setSheet(null);
          startPunch();
          const ok = await run(save, '');
          if (!ok) {
            stopPunch();
            setSheet('signup');
          }
        }}
      />
      {signed && (
        <EditSheet
          key={`edit-${sheet === 'edit'}`}
          t={t}
          open={sheet === 'edit'}
          busy={busy}
          onClose={() => setSheet(null)}
          onBackOut={() => {
            setSheet(null);
            setAskOut(true);
          }}
          onSubmit={async (dates, vote) => {
            // Alex: Edit sign-up changes the dates only (the level was picked once; only the organizer changes it). Zip 60: and the format vote.
            const ok = await run(() => api('PUT', '/api/tournament/signup', { tournamentId: t.id, ...(dates ? { dates } : {}), ...(vote ? { formatVote: vote } : {}) }), 'Saved');
            if (ok) setSheet(null);
          }}
        />
      )}
      <WhoSheet t={t} open={sheet === 'who'} onClose={() => setSheet(null)} />
      <ConfirmDialog
        open={askOut}
        title="Back out?"
        body={
          <p className="tm-confirm-text" data-tm-backout-text>
            Are you sure you want to back out of the {t.name}? You come off the list. You can sign up again if you change your mind.{backLine}
          </p>
        }
        cancelLabel="Stay signed up"
        confirmLabel="Yes, back out"
        danger
        busy={busy}
        onCancel={() => setAskOut(false)}
        onConfirm={async () => {
          const ok = await run(
            () => api('POST', '/api/tournament/back-out', { tournamentId: t.id, ...(k ? { backCents } : {}) }),
            (r: { creditBackCents?: number; creditReturnedCents?: number; waitingCents?: number }) => {
              const back = (r?.creditBackCents ?? 0) + (r?.creditReturnedCents ?? 0);
              if ((r?.waitingCents ?? 0) > 0) return `You're off the list. Your ${formatPrice((r.waitingCents ?? 0) + back)} comes back as credit.`;
              if (back > 0) return (r.creditBackCents ?? 0) > 0 ? `You're off the list. ${formatPrice(back)} back as credit.` : `You're off the list. ${formatPrice(back)} credit returned.`;
              return "You're off the list";
            },
          );
          if (ok) {
            setAskOut(false);
            setSheet(null);
          }
        }}
      />
      {t.onlyMe && (
        <ConfirmDialog
          open={askShow}
          title="Show to everyone?"
          body={<p className="tm-confirm-text">Every player sees the {t.name} on Home and can sign up.</p>}
          confirmLabel="Show to everyone"
          busy={busy}
          onCancel={() => setAskShow(false)}
          onConfirm={async () => {
            const ok = await run(() => api('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility: 'all' }), 'Everyone can see it now');
            if (ok) setAskShow(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Zip 63: the pay countdown (mocks 08 to 13), the site's own alert card: amber, then red on the day, then "Your payment is late" after Pay by
 * (shown only while a spot can still be paid for: the existing late rule). Its button opens the same flow as Lock my spot (credit first, then
 * the Pay sheet). It counts down on its own (a redraw every 15 seconds; "Pretend it's..." holds the clock still). It goes the moment they pay:
 * the card's state is no longer "lock".
 */
function PayCountdownCard({ t, payBy, due, busy, onPay }: { t: PlayerTournamentView; payBy: string; due: number; busy: boolean; onPay: () => void }) {
  const now = useNow(15_000);
  const c = payCountdown(payBy, now, 'America/Detroit', t.name);
  if (!c) return null;
  return (
    <AlertCard
      as="section"
      tone={c.tone}
      icon={c.icon}
      label={c.title}
      title={c.title}
      sub={c.sub}
      data={{ 'data-pay-countdown': c.late ? 'late' : c.tone }}
      action={
        <button type="button" className="ac-btn" disabled={busy} onClick={onPay} data-pay-countdown-btn>
          {c.late ? 'Pay now' : `Pay ${formatPrice(due)}`}
        </button>
      }
    />
  );
}

/** Zip 59: how long the ticket punch plays (ms). The CSS (src/tournament/tournament.css, "ticket punch") runs the same 1.5 s. */
const PUNCH_MS = 1500;

/** The burst of dots: angle (degrees) and how far (px) each flies. */
const PUNCH_DOTS: [number, number][] = [
  [10, 30],
  [50, 36],
  [95, 28],
  [140, 38],
  [185, 30],
  [225, 36],
  [270, 28],
  [315, 38],
  [30, 20],
  [200, 22],
];

/** Zip 59: the small ring in the ticket's top right corner: a dashed ring while it signs you up, then the punch hole with a quick burst of dots. */
function PunchRing() {
  return (
    <span className="tc-punch" aria-hidden="true" data-tc-punch>
      <span className="tc-punch-wave" />
      <span className="tc-punch-ring" />
      {PUNCH_DOTS.map(([a, d], i) => (
        <span
          key={i}
          className="tc-punch-dot"
          style={{ '--dx': `${Math.round(Math.cos((a * Math.PI) / 180) * d)}px`, '--dy': `${Math.round(Math.sin((a * Math.PI) / 180) * d)}px`, '--i': i } as CSSProperties}
        />
      ))}
    </span>
  );
}

/** Zip 59: "Signing you up..." and then "You're on the list" (the green one), in the line under the name. */
function PunchSub() {
  return (
    <span className="tc-punch-sub">
      <span className="tc-punch-a">Signing you up…</span>
      <span className="tc-punch-b">You’re on the list</span>
    </span>
  );
}

/**
 * Zip 63: the card's top line, "TOURNAMENT · TUE DEC 1 · ~7:30 PM" (the mocks), with the lime dot. "DATE TBD" until a date is picked. The start
 * keeps its "~": the plan's start follows the players locked in, and nothing sets the real start yet (a later zip).
 */
function kickerWords(t: PlayerTournamentView): string {
  const s = t.finalDate ? stubParts(t.finalDate) : null;
  return ['Tournament', s ? `${s.weekday} ${s.month} ${s.day}` : 'Date TBD', `~${startLabel(t.start)}`].join(' · ');
}

/** The small status line above the name (the lime dot and the words). */
function Kicker({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <p className={muted ? 'tc-kicker tc-kicker-muted' : 'tc-kicker'} data-tc-kicker>
      <span className="tc-kdot" aria-hidden="true" />
      {children}
    </p>
  );
}

/** The card's name, smaller for a long one (17 letters or more) so a long word never breaks in the middle. */
const Title = ({ t }: { t: PlayerTournamentView }) => <h2 className={Array.from(t.name).length >= 17 ? 'tc-title tc-title-long' : 'tc-title'}>{t.name}</h2>;

/** Zip 63: the most pickleballs a card draws (the hidden cap: 16 locked in). */
const MAX_BALLS = 16;

/**
 * Zip 63: the balls' size and gap at 420 px wide (the mocks): up to 10 the usual size, then smaller so 16 still fit one row. On a narrower card
 * both shrink together (from the card's own width, `100cqw` of the row), so a 320 px phone keeps one row too.
 */
function ballSpec(n: number): { size: number; gap: number } {
  if (n <= 10) return { size: 26, gap: 9 };
  if (n <= 12) return { size: 22, gap: 8 };
  if (n <= 14) return { size: 19, gap: 6 };
  return { size: 17, gap: 5 };
}

/**
 * Zip 63: one pickleball per person, no counts and no empty rings (mocks 00 to 07). A gold ring marks a ball for each person locked in, filled
 * left to right in the order people pay (the balls are not tied to anyone). A ball that turns gold while the card is on screen pops (the site's
 * m-ball-pop, 240 ms) and its gold glow eases to a steady ring (mocks 03 and 04); the first look is still. CSS only; none with reduced motion.
 */
export function TourBalls({ total, gold }: { total: number; gold: number }) {
  const n = Math.max(0, Math.min(MAX_BALLS, total));
  const lit = Math.max(0, Math.min(n, gold));
  const before = useRef<number | null>(null);
  const [fresh, setFresh] = useState<[number, number] | null>(null);
  useEffect(() => {
    const was = before.current;
    before.current = lit;
    if (was === null || lit <= was) return;
    setFresh([was, lit]);
    const timer = setTimeout(() => setFresh(null), 1200);
    return () => clearTimeout(timer);
  }, [lit]);
  if (n === 0) return null;
  const { size, gap } = ballSpec(n);
  const style = { '--tc-ball-size': `min(${size}px, calc(100cqw / ${n + ((n - 1) * gap) / size}))`, '--tc-ball-gap': `calc(var(--tc-ball-size) * ${gap / size})` } as CSSProperties;
  return (
    <div className="tc-balls-row" data-tc-balls={`${lit}/${n}`}>
      <span className="tc-balls" style={style} role="img" aria-label={lit > 0 ? `${n} ${n === 1 ? 'player' : 'players'}, ${lit} locked in` : `${n} ${n === 1 ? 'player' : 'players'}`}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={i < lit ? (fresh && i >= fresh[0] && i < fresh[1] ? 'tc-ball tc-gold tc-gold-new' : 'tc-ball tc-gold') : 'tc-ball'} data-tb={i < lit ? 'gold' : 'ball'}>
            <Pickleball />
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Zip 63, PREVIEW BUILDS ONLY (`__PREVIEW_BUILD__` is false in every live build, so this is not in the live file): the Tournament test page's
 * "Ball look" links (?balls=16,12) draw that many balls on the card of that page, look only, because the preview's 10 names cannot make 12 to 16.
 */
function previewBalls(): { total: number; gold: number } | null {
  if (!__PREVIEW_BUILD__ || typeof window === 'undefined') return null;
  // Round 2: only while the address has ?balls= (no memory on the phone), so another name opened next shows its real card.
  const m = /^(\d{1,2}),(\d{1,2})$/.exec(new URLSearchParams(window.location.search).get('balls') ?? '');
  return m ? { total: Number(m[1]), gold: Number(m[2]) } : null;
}
const PREVIEW_BALLS = previewBalls();

/** Zip 63: how many balls and how many gold on this card. Before a date: one per sign-up. After: one per player who can make that date. */
function ballsOf(t: PlayerTournamentView): { total: number; gold: number } {
  if (PREVIEW_BALLS) return PREVIEW_BALLS;
  const rows = cardRows(t);
  return rows ? { total: rows.gold.length + rows.rest.length, gold: rows.gold.length } : { total: t.names.length, gold: 0 };
}

type Who = { name: string; me?: true };
/**
 * Zip 63 round 2 (Alex): the people on the card, once a date is picked: the balls and See who's in are always the same people. `gold`: locked
 * in (every spot and every trusted I paid), in the order they paid. `rest`: everyone else who can make the date and is not on standby, the
 * viewer first (their row sits right under the last gold one), then the others in sign-up order. Null before a date (one ball per sign-up).
 */
function cardRows(t: PlayerTournamentView): { gold: Who[]; rest: Who[] } | null {
  if (!t.finalDate || !t.going) return null;
  const k = t.tickets;
  const gold = k?.locked ?? [];
  const taken = new Set([...gold.map((g) => g.name), ...(k?.line ?? []).map((l) => l.name)]);
  const left = t.going.filter((g) => !taken.has(g.name));
  return { gold, rest: [...left.filter((g) => g.me), ...left.filter((g) => !g.me)] };
}

/** Zip 56: "8 spots taken" (the overlay's line on standby). Zip 63: at the hidden cap no number ("Every spot is taken"). */
const takenWords = (k: PlayerTicketsView) => (k.full ? 'Every spot is taken' : `${k.size} spots taken`);

/** Zip 63: "Pay by 11/30", the card's plain bottom line while tickets are open. */
const payByFoot = (k: PlayerTicketsView): string | null => (k.payBy ? `Pay by ${payByShort(k.payBy, 'America/Detroit')}` : null);

/** "You're 2nd on standby" (Zip 63: standby, never waitlist). */
const standbyWhere = (place: number) => (place > 0 ? `You’re ${placeWord(place)} on standby` : 'You’re on standby');

/** Zip 56, Zip 63: the words for each ticket state. `foot`: the card's plain bottom line; `sub`: the overlay's line under the name. */
function ticketWords(t: PlayerTournamentView, s: TicketState): { foot: string; sub: string } {
  const k = t.tickets!;
  const hours = hoursLabel(t.minutes);
  const payBy = k.payBy ? payByLabel(k.payBy, 'America/Detroit', t.finalDate) : null;
  const foot = payByFoot(k);
  const place = linePlace(k);
  const mine = k.mine;
  switch (s) {
    case 'lock':
      // Zip 59: after Pay by only a spot freed by a back out is open: "A spot opened".
      if (k.freed > 0) return { foot: 'A spot opened', sub: `${hours} · A spot opened` };
      return { foot: foot ?? hours, sub: payBy ? `${hours} · ${`Pay by ${payBy}`.replace(/ /g, ' ')}` : hours };
    case 'full':
      return { foot: foot ?? 'Every spot is taken', sub: 'Join standby in case someone drops' };
    case 'in':
      return { foot: 'You’re locked in', sub: hours };
    case 'closed': {
      // Zip 59: closed because the night started, or because Pay by has passed (the freed-spot exception ended 3 hours before the start).
      const why = k.started ? 'The tournament has started.' : payBy ? `Tickets closed. Pay by was ${payBy}.` : 'Tickets are closed.';
      return { foot: why, sub: why };
    }
    case 'line': {
      const where = standbyWhere(place);
      // Zip 63: a paid hold, or an I paid for it (trusted), is held.
      if (mine && mine.creditCents + mine.paidCents + mine.claimCents >= k.priceCents) return { foot: `${where}. Your spot is held.`, sub: `${where}. Your spot is held.` };
      return { foot: where, sub: takenWords(k) };
    }
  }
}

/** Zip 63: the card's one look (mocks 00 to 07), every state: the top line, the name, the format, the balls, the button, the bottom line. */
function CardShell({
  t,
  data,
  punch,
  onClick,
  tap,
  balls,
  actions,
  foot,
  links,
  muted,
}: {
  t: PlayerTournamentView;
  data: string;
  punch?: boolean;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  tap?: boolean;
  balls?: boolean;
  actions?: ReactNode;
  foot: ReactNode;
  links?: ReactNode;
  muted?: boolean;
}) {
  const b = ballsOf(t);
  return (
    <section
      className={`tc tc-hero${tap ? ' tc-tap' : ''}${punch ? ' tc-punching' : ''}`}
      aria-label={t.status === 'canceled' ? `${t.name}, canceled` : cardLabel(t)}
      data-tc-format={t.formatTbd ? 'tbd' : t.format}
      data-tc={data}
      onClick={onClick}
    >
      <span className="tc-halo" aria-hidden="true" />
      {punch && <PunchRing />}
      <Kicker muted={muted}>{muted ? `Canceled · ${kickerWords(t).split(' · ').slice(1).join(' · ')}` : kickerWords(t)}</Kicker>
      <Title t={t} />
      {t.status !== 'canceled' && (
        <p className="tc-format" data-tc-format-name>
          {formatText(t)}
        </p>
      )}
      {balls && <TourBalls total={b.total} gold={b.gold} />}
      {actions && <div className="tc-actions">{actions}</div>}
      <p className="tc-foot" data-tc-sub>
        {punch ? <PunchSub /> : foot}
      </p>
      {links}
    </section>
  );
}

export function TicketCard({
  t,
  busy,
  punch = false,
  onSignUp,
  onWho,
  onOpen,
  onEdit,
  onDropOut,
  onLock,
  onHold,
  onJoin,
}: {
  t: PlayerTournamentView;
  org: string;
  busy: boolean;
  /** Zip 59: the ticket punch is playing (sign-up just finished). */
  punch?: boolean;
  onSignUp: () => void;
  onWho: () => void;
  /** Zip 56: tapping the card itself opens the overlay (tickets open). */
  onOpen?: () => void;
  onEdit: () => void;
  onDropOut: () => void;
  onLock: () => void;
  onHold: () => void;
  onJoin: () => void;
}) {
  const signed = t.me !== null;
  const picked = !!t.finalDate && (t.status === 'date_picked' || t.status === 'tickets');
  const k = t.tickets ?? null;
  const s = ticketStateOf(t);

  // ---- Zip 56: the plain Canceled card (no balls, no buttons) ----
  if (t.status === 'canceled') {
    const c = t.canceled ?? { backCents: 0, claimCents: 0 };
    const money =
      c.claimCents > 0 ? `Your ${formatPrice(c.claimCents + c.backCents)} comes back as credit.` : c.backCents > 0 ? `Your ${formatPrice(c.backCents)} is back as credit.` : null;
    return <CardShell t={t} data="canceled" muted foot={money ? `Canceled. ${money}` : 'Canceled.'} />;
  }

  const lime = (label: string, fn: () => void, data: string) => (
    <button type="button" className="tc-btn tc-lime" disabled={busy} onClick={fn} {...{ [data]: '' }}>
      {label}
    </button>
  );
  const gray = (label: string, fn: () => void, data: string) => (
    <button type="button" className="tc-btn tc-gray" onClick={fn} {...{ [data]: '' }}>
      {label}
    </button>
  );

  // ---- Zip 56: tickets open (Lock my spot, Join standby, locked in, standby, waiting for a confirm, closed) ----
  if (s && k) {
    const w = ticketWords(t, s);
    const due = dueOf(k);
    const paidLine = !!k.mine && k.mine.creditCents + k.mine.paidCents >= k.priceCents;
    // Mocks 00 to 07 and 15: the one lime button. The other states keep See who's in (Edit sign-up and Drop out are in the card's overlay).
    const main =
      s === 'lock'
        ? lime(`Lock my spot · ${formatPrice(due)}`, onLock, 'data-tc-lock')
        : s === 'full'
          ? lime('Join standby', onJoin, 'data-tc-join')
          : s === 'line' && !k.closed && !paidLine && !(k.mine && k.mine.claimCents > 0)
            ? lime(`Hold my spot · ${formatPrice(due)}`, onHold, 'data-tc-hold')
            : gray('See who’s in', onWho, 'data-tc-who');
    // Tap the card (not a button) for the overlay (mock 09).
    const open = onOpen
      ? (e: MouseEvent<HTMLElement>) => {
          if ((e.target as Element).closest('button, a')) return;
          onOpen();
        }
      : undefined;
    return <CardShell t={t} data={s} punch={punch} tap={!!onOpen} onClick={open} balls actions={main} foot={w.foot} />;
  }

  // ---- Piece 1's states (before you sign up, signed up, the date picked), and a Reschedule ----
  // The picked date has passed: nothing to pick, so no Sign up (the list, Edit and Drop out stay for those on it). (Every offered date passed
  // with none picked: the server sends no card at all.)
  const noDates = t.openDates.length === 0;
  const held = !!k?.mine && k.mine.creditCents + k.mine.paidCents + k.mine.claimCents > 0;
  // Zip 63: no counts on the card (the balls say it). Where they stand is the plain bottom line.
  const foot =
    t.status === 'rescheduled' && signed
      ? 'Rescheduled. Pick your dates again.'
      : t.status === 'tickets' && !signed
        ? k?.closed
          ? 'Tickets are closed.'
          : noDates
            ? 'That date has passed.'
            : 'Tickets are open. Sign up first.'
        : noDates
          ? 'That date has passed.'
          : picked
            ? signed
              ? held
                ? 'You’re on the list. Your ticket is held. Tickets open soon.'
                : 'You’re on the list. Tickets open soon.'
              : 'Tickets open soon'
            : signed
              ? 'You’re on the list. We’re picking the date.'
              : 'Pick the dates you can play';
  const state = t.status === 'rescheduled' ? 'rescheduled' : picked ? 'date' : signed ? 'listed' : 'open';
  const action =
    (signed || !noDates) && !(t.status === 'tickets' && !signed && k?.closed) ? (signed ? gray('See who’s signed up', onWho, 'data-tc-who') : lime('Sign up', onSignUp, 'data-tc-signup')) : null;
  const links = signed ? (
    <div className="tc-links">
      <button type="button" className="tc-link" onClick={onEdit} data-tc-edit>
        Edit sign-up
      </button>
      <button type="button" className="tc-link" onClick={onDropOut} data-tc-drop>
        Drop out
      </button>
    </div>
  ) : undefined;
  return <CardShell t={t} data={state} punch={punch} balls actions={action} foot={foot} links={links} />;
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 56: the overlay (mocks 09, 11, 12): the card once more with its one action, then Who's in and the waitlist.
// ---------------------------------------------------------------------------------------------------------------------

function Overlay({
  t,
  k,
  busy,
  onLock,
  onHold,
  onKeep,
  onJoin,
  onDropOut,
  onEdit,
}: {
  t: PlayerTournamentView;
  k: PlayerTicketsView;
  org: string;
  meName: string | null;
  busy: boolean;
  onLock: () => void;
  onHold: () => void;
  onKeep: () => void;
  onJoin: () => void;
  onDropOut: () => void;
  onEdit: () => void;
}) {
  const s = ticketStateOf(t) ?? 'full';
  const w = ticketWords(t, s);
  const due = dueOf(k);
  const place = linePlace(k);
  const mine = k.mine;
  const paid = !!mine && mine.creditCents + mine.paidCents >= k.priceCents;
  const claim = !!mine && mine.claimCents > 0;
  // The overlay's own words under the name: the pictures keep it short ("2 hours", "8 spots taken").
  const sub = s === 'in' ? hoursLabel(t.minutes) : s === 'line' ? takenWords(k) : w.sub;
  const lists = [<WhoIn key="in" t={t} />, k.line.length > 0 ? <Waitlist key="line" k={k} /> : null];
  return (
    <div className="tc-tw stack" data-tw={s}>
      <section className="tc tc-hero tc-overlay" aria-label={cardLabel(t)} data-tc-format={t.formatTbd ? 'tbd' : t.format} data-tc={s}>
        <span className="tc-halo" aria-hidden="true" />
        <Kicker>{kickerWords(t)}</Kicker>
        <Title t={t} />
        <p className="tc-format" data-tc-format-name>
          {formatText(t)}
        </p>
        <p className="tc-under" data-tc-sub>
          {sub}
        </p>
        {s === 'in' && (
          <div className="tc-row" data-tc-locked>
            <span className="tc-tw-ball tc-tw-ball-gold" aria-hidden="true">
              <Pickleball />
            </span>
            <span className="tc-row-text tc-row-lime">You’re locked in</span>
            <button type="button" className="tc-link tc-row-link" onClick={onDropOut} data-tc-drop>
              Drop out
            </button>
          </div>
        )}
        {s === 'line' && (
          <div className="tc-row" data-tc-place>
            <span className="tc-tw-num" aria-hidden="true">
              {place || '–'}
            </span>
            <span className="tc-row-text">{standbyWhere(place)}</span>
          </div>
        )}
        {(s === 'lock' || s === 'full') && (
          <div className="tc-actions">
            {s === 'lock' ? (
              <button type="button" className="tc-btn tc-lime" disabled={busy} onClick={onLock} data-tc-lock>
                Lock my spot · {formatPrice(due)}
              </button>
            ) : (
              <button type="button" className="tc-btn tc-lime" disabled={busy} onClick={onJoin} data-tc-join>
                Join standby
              </button>
            )}
          </div>
        )}
        {s === 'line' && !paid && !claim && !k.closed && (
          <div className="tc-choices">
            <button type="button" className="tc-btn tc-lime tc-two" disabled={busy} onClick={onHold} data-tc-hold>
              <span className="tc-two-title">Hold my spot · {formatPrice(due)}</span>
              <span className="tc-two-line">If someone drops, you’re locked into that spot.</span>
            </button>
            <button type="button" className="tc-btn tc-gray tc-two" disabled={busy} onClick={onKeep} data-tc-keep>
              <span className="tc-two-title">Just keep me on the list</span>
              <span className="tc-two-line">If a spot opens, whoever pays first gets it.</span>
            </button>
          </div>
        )}
        {s === 'line' && (paid || claim) && (
          <p className="tc-note" data-tc-note>
            Your spot is held. If someone drops, you’re locked into that spot.
          </p>
        )}
        {/* Zip 63: Edit sign-up and Drop out moved here from the Home card (the mocks' card has only its one button). Locked in: Drop out is
            on the row above. Closed: neither (as before). */}
        {s !== 'closed' && s !== 'in' && (
          <div className="tc-links">
            {!paid && (
              <button type="button" className="tc-link" onClick={onEdit} data-tc-edit>
                Edit sign-up
              </button>
            )}
            <button type="button" className="tc-link" onClick={onDropOut} data-tc-drop>
              Drop out
            </button>
          </div>
        )}
      </section>
      {/* On standby, standby comes first (mock 12); otherwise Who's in first (mocks 09, 11). */}
      {s === 'line' ? [...lists].reverse() : lists}
    </div>
  );
}

/**
 * WHO'S IN (Zip 63 round 2, Alex's two mocks): every player on the card, the same people as the balls, numbered down the list. Locked in first,
 * in the order they paid, each ball with a gold ring; then the viewer's own row if they have not paid ("Pay to lock in", plain ball); then the
 * others who have not paid, in sign-up order (plain ball, no words). Only the viewer's own row has words. No count, no open spots, no plan size.
 */
function WhoIn({ t }: { t: PlayerTournamentView }) {
  const rows = cardRows(t) ?? { gold: t.tickets?.locked ?? [], rest: [] };
  const all = [...rows.gold.map((p) => ({ ...p, gold: true })), ...rows.rest.map((p) => ({ ...p, gold: false }))];
  return (
    <section className="tc-tw-card" aria-label="Who's in" data-tw-in>
      <div className="tc-tw-head">
        <h3 className="tc-tw-label">Who’s in</h3>
      </div>
      <ol className="tc-tw-rows">
        {all.map((p, i) => (
          <li key={`${p.name}-${i}`} className={p.me ? 'tc-tw-me' : undefined} data-tw-row={p.me ? 'me' : p.name} data-tw-gold={p.gold ? '' : undefined}>
            <span className="tc-tw-n">{i + 1}</span>
            <span className={p.gold ? 'tc-tw-ball tc-tw-ball-gold' : 'tc-tw-ball'} aria-hidden="true">
              <Pickleball />
            </span>
            <span className="tc-tw-name">{p.name}</span>
            {p.me ? <span className={p.gold ? 'tc-tw-tag tc-tw-gold' : 'tc-tw-tag'}>{p.gold ? 'Locked in' : 'Pay to lock in'}</span> : <span />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * WAITLIST: everyone in line, in the order they joined it, by name. Alex (ship answer 5): no Paid or Not paid next to anyone else (that is the
 * organizer's screen); the player's own row says You.
 */
function Waitlist({ k }: { k: PlayerTicketsView }) {
  return (
    <section className="tc-tw-card" aria-label="Standby" data-tw-line>
      <div className="tc-tw-head">
        <h3 className="tc-tw-label">Standby</h3>
      </div>
      <ol className="tc-tw-rows">
        {k.line.map((p, i) => (
          <li key={`${p.name}-${i}`} className={p.me ? 'tc-tw-me' : undefined} data-tw-row={p.name}>
            <span />
            <span className="tc-tw-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="tc-tw-name">{p.name}</span>
            <span className="tc-tw-tag">{p.me ? 'You' : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The months a player's calendar shows: from the first open date's month to the last's. */
function useMonths(days: readonly string[]) {
  return useMemo(() => (days.length ? monthsBetween([...days].sort()[0], [...days].sort()[days.length - 1]) : []), [days]);
}

function DatesPicker({ t, picked, setPicked, summary = true }: { t: PlayerTournamentView; picked: string[]; setPicked: (d: string[]) => void; summary?: boolean }) {
  const months = useMonths(t.openDates);
  const open = new Set(t.openDates);
  const look = (d: string): DayLook => (picked.includes(d) ? 'on' : open.has(d) ? 'open' : 'off');
  return (
    <>
      {summary && (
        <div className="tm-picked" data-tm-picked aria-live="polite">
          <b>{picked.length} picked</b>
          {picked.length > 0 && <span>{picked.map(dayShort).join(' · ')}</span>}
        </div>
      )}
      <MonthCalendar
        months={months}
        variant="pick"
        boxed={false}
        label="Dates that work"
        look={look}
        onTap={(d) => {
          if (!open.has(d)) return;
          setPicked(picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort());
        }}
      />
    </>
  );
}

/** The sheets' sticky bottom bar. Its soft fade shows only while the sheet has more to scroll (Alex). */
function SheetBottom({ stack, children }: { stack?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useMoreBelow(ref, false);
  return (
    <div ref={ref} className={stack ? 'tm-bottom tm-bottom-stack' : 'tm-bottom'}>
      {children}
    </div>
  );
}

/** Zip 60: the short question under the dates, with its three rows. */
function VoteBlock({ vote, onPick }: { vote: FormatVote; onPick: (v: FormatVote) => void }) {
  return (
    <>
      <p className="tm-eyebrow tm-vote-head" data-tm-vote-head>
        Format you’d like
      </p>
      <VoteList value={vote} onPick={onPick} />
    </>
  );
}

function SignUpSheet({
  t,
  org,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  t: PlayerTournamentView;
  /** The organizer's first name, for "Not sure? Ask Alex." */
  org: string;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (level: number, dates: string[], vote: FormatVote | null) => void;
}) {
  // Zip 60: "Format you'd like" (only while the players' vote is open); Either is fine is preselected.
  const [vote, setVote] = useState<FormatVote>(DEFAULT_FORMAT_VOTE);
  // Alex: a level is picked once. Someone signing up again (after Drop out or Back out) keeps their first level: no level step.
  const locked = t.lockedLevel ?? null;
  const [step, setStep] = useState<1 | 2>(locked === null ? 1 : 2);
  const [level, setLevel] = useState<number | null>(locked);
  // Once the date is picked there is one date to pick: it starts picked.
  const [pickedRaw, setPicked] = useState<string[]>(t.openDates.length === 1 ? [...t.openDates] : []);
  // Only the dates still open count: one that closed while the sheet was open (the date was picked, midnight passed) drops out, never sent.
  const picked = pickedRaw.filter((d) => t.openDates.includes(d));
  return (
    <Sheet calmFocus open={open} title="Sign up" onClose={onClose} className="tm-sheet">
      {locked === null && (
        <div className="tm-steps" aria-hidden="true">
          <span className="on" />
          <span className={step === 2 ? 'on' : undefined} />
        </div>
      )}
      {step === 1 ? (
        <div data-tm-step="1">
          <p className="tm-eyebrow">Step 1 of 2 · Your level</p>
          <LevelList value={level} onPick={setLevel} />
          <p className="tm-help tm-level-note" data-tm-level-note>
            Not sure? Ask {org}.
          </p>
          <SheetBottom>
            <button type="button" className="btn" disabled={level === null} onClick={() => setStep(2)} data-tm-next>
              Next
            </button>
          </SheetBottom>
        </div>
      ) : (
        <div data-tm-step="2">
          <p className="tm-eyebrow">{locked === null ? 'Step 2 of 2 · Pick every date that works' : 'Pick every date that works'}</p>
          <p className="tm-help">Green dates are open. Games start around {startLabel(t.start)}.</p>
          <DatesPicker t={t} picked={picked} setPicked={setPicked} />
          {t.formatTbd && <VoteBlock vote={vote} onPick={setVote} />}
          <SheetBottom>
            {locked === null && (
              <button type="button" className="btn secondary" onClick={() => setStep(1)} data-tm-back>
                Back
              </button>
            )}
            <button type="button" className="btn" disabled={busy || picked.length === 0 || level === null} onClick={() => level !== null && onSubmit(level, picked, t.formatTbd ? vote : null)} data-tm-submit>
              {busy ? 'Signing up…' : 'Sign up'}
            </button>
          </SheetBottom>
        </div>
      )}
    </Sheet>
  );
}

function EditSheet({
  t,
  open,
  busy,
  onClose,
  onBackOut,
  onSubmit,
}: {
  t: PlayerTournamentView;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onBackOut: () => void;
  /** `dates` null: the dates were not touched (nothing to send). `vote` null: the format vote was not touched. */
  onSubmit: (dates: string[] | null, vote: FormatVote | null) => void;
}) {
  const me = t.me!;
  // Zip 60: their own format vote, changeable until the date is locked.
  const [vote, setVote] = useState<FormatVote>(me.formatVote ?? DEFAULT_FORMAT_VOTE);
  const voteTouched = !!t.formatTbd && vote !== (me.formatVote ?? DEFAULT_FORMAT_VOTE);
  // Only the dates still open count (once the date is picked, that one date). Untouched dates are not sent.
  const [pickedRaw, setPickedRaw] = useState<string[]>(me.dates);
  // Only the dates still open count, also after a reload under the open sheet (a date that closed drops out and is never sent).
  const picked = pickedRaw.filter((d) => t.openDates.includes(d));
  const [touched, setTouched] = useState(false);
  const setPicked = (d: string[]) => {
    setTouched(true);
    setPickedRaw(d);
  };
  return (
    <Sheet calmFocus open={open} title="Edit my sign-up" onClose={onClose} className="tm-sheet">
      {/* Alex: dates only. The level was picked once at sign-up; only the organizer changes it. */}
      {t.openDates.length > 0 && (
        <>
          <p className="tm-eyebrow tm-eyebrow-dates">Dates that work</p>
          <DatesPicker t={t} picked={picked} setPicked={setPicked} summary={false} />
        </>
      )}
      {t.formatTbd && <VoteBlock vote={vote} onPick={setVote} />}
      <SheetBottom stack>
        <button type="button" className="btn" disabled={busy || (!touched && !voteTouched) || (touched && picked.length === 0)} onClick={() => onSubmit(touched ? picked : null, voteTouched ? vote : null)} data-tm-save>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="tm-quiet-link" onClick={onBackOut} data-tm-backout>
          Back out of tournament
        </button>
      </SheetBottom>
    </Sheet>
  );
}

function WhoSheet({ t, open, onClose }: { t: PlayerTournamentView; open: boolean; onClose: () => void }) {
  return (
    <Sheet calmFocus open={open} title="Who's signed up" onClose={onClose} className="tm-sheet">
      <ol className="tm-who" aria-label="Signed up">
        <li className="tm-who-head" aria-hidden="true">
          <span className="tm-head-label">Signed up</span>
          <span className="tm-chip">{t.names.length}</span>
        </li>
        {t.names.length === 0 && (
          <li>
            <span />
            <span />
            <span className="tm-who-name">Nobody yet</span>
          </li>
        )}
        {t.names.map((name, i) => (
          <li key={`${name}-${i}`} data-tm-who-row>
            <span className="tm-who-n">{i + 1}</span>
            <span className="tm-who-ball" aria-hidden="true">
              <Pickleball />
            </span>
            <span className="tm-who-name">{name}</span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
