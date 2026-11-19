// Zip 55 "Tournaments", the PLAYER side: the pinned ticket card at the top of Home (mocks 04, 07, 08), the "Only you can see this" strip (mock
// 04), the 2-step sign-up sheet (05, 06), "See who's signed up" (names only), Edit my sign-up (13) and the Back out confirm (13b).
// Zip 56, piece 2 (the pictures 07 to 13b): tickets. The card's states 3 (Tickets open: Lock my spot), 4 (8 spots taken: Join waitlist) and 5
// (You're in), the waitlist, tapping the card for the overlay with Who's in and the waitlist (09, 11, 12), the site's own Pay sheet (10), Back
// out with the money it gives back (13b), and the plain Canceled and "Rescheduled. Pick your dates again" cards. Money moves only on the server
// (server/tournamentTickets.ts); this screen sends what it showed, so a stale screen never pays or gets back a different amount.
//
// This file is its own download (src/TournamentSlot.tsx loads it): a phone fetches it only when the server sends a tournament for it, so with
// the switch off (or a tournament on Only me) a player's download is exactly main's.
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { FormatVote, PlayerTicketsView, PlayerTournamentView } from '../../shared/tournament';
import { DEFAULT_FORMAT_VOTE, dayShort, formatLine, formatName, monthsBetween, monthSpan, startLabel, stubParts } from '../../shared/tournament';
import { payCountdown, placeWord } from '../../shared/tournamentTickets';
import { formatPrice, venmoPayUrl } from '../../shared/money';
import { api, ApiError, useNow, VIEW_ONLY_MESSAGE } from '../lib';
import { AlertCard } from '../AlertCard';
import { missedDate, ticketStateOf } from '../../shared/tournamentNudge';
import { ConfirmDialog, Pickleball, Sheet, useToast } from '../ui';
import { PaySheet } from '../PaySheet';
import type { TournamentPayInfo } from '../TournamentSlot';
import { type DayLook, LevelList, MonthCalendar, useMoreBelow, VoteList } from './parts';
import { DayBody } from './GameDayView';
import { RoundsBody } from './RoundsView';

/** Zip 60: the format line on the cards. While the players' vote is open it is "Tournament style TBD" (no other words). */
const formatText = (t: PlayerTournamentView): string => (t.formatTbd || t.styleTbd ? 'Tournament style TBD' : formatLine(t.format));
/** The card's label for screen readers. */
const cardLabel = (t: PlayerTournamentView): string => (t.formatTbd || t.styleTbd ? `${t.name}, style to be decided` : `${t.name}, ${formatName(t.format)} tournament`);

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 && /view only/i.test(err.message) ? VIEW_ONLY_MESSAGE : err.message;
  return 'That did not work. Try again.';
}

/** The organizer's first name for the players' words ("Pay Alex $16", "once Alex confirms"). */
const firstOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'the organizer';

// Zip 66: ticketStateOf and missedDate moved to shared/tournamentNudge.ts (pure, so the unit tests can read them); the same rules.

/** What is still to pay on their ticket (the price before they ever tapped Lock my spot). */
const dueOf = (k: PlayerTicketsView) => (k.mine ? k.mine.owedCents : k.priceCents);

/** Their place in line (1 = first), or 0. */
const linePlace = (k: PlayerTicketsView) => k.line.findIndex((x) => x.me) + 1;

/** Zip 57, PREVIEW BUILDS ONLY: the 12 players pools look (?poolslook=12): the night drawn from made-up rows by the server (look only). */
function usePoolsLook(): PlayerTournamentView['day'] | null {
  const [day, setDay] = useState<PlayerTournamentView['day'] | null>(null);
  const want = __PREVIEW_BUILD__ && typeof location !== 'undefined' && new URLSearchParams(location.search).get('poolslook') === '12';
  useEffect(() => {
    if (!want) return;
    api<{ day: NonNullable<PlayerTournamentView['day']> }>('GET', '/api/tournament/pools-look').then((r) => setDay(r.day), () => setDay(null));
  }, [want]);
  return want ? day : null;
}

export default function TournamentHome({ t: real, onChanged, pay, notice }: { t: PlayerTournamentView; onChanged: () => Promise<unknown>; pay: TournamentPayInfo; notice?: ReactNode }) {
  const look = usePoolsLook();
  const t = look ? { ...real, day: look } : real;
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
  const missed = missedDate(t);
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
  async function lock(intent: 'lock' | 'hold', before?: () => Promise<unknown>) {
    if (!k) return;
    let added = false;
    const res = await run(
      async () => {
        // Zip 66: I'm in on the in-or-out alert first puts the picked date on their sign-up, inside the same busy tap.
        if (before) {
          await before();
          added = true;
        }
        return api('POST', '/api/tournament/lock', { tournamentId: t.id, intent, priceCents: k.priceCents });
      },
      (r: { result: string; creditUsedCents: number; dueCents: number }) => {
        const used = r.creditUsedCents > 0 ? ` ${formatPrice(r.creditUsedCents)} credit used.` : '';
        if (r.result === 'locked') return `You're locked in.${used}`;
        if (r.result === 'held') return `Your spot is held.${used}`;
        return r.creditUsedCents > 0 ? `${formatPrice(r.creditUsedCents)} credit used. ${formatPrice(r.dueCents)} left to pay.` : `Pay ${org} ${formatPrice(r.dueCents)}`;
      },
    );
    if (res && res.result === 'due' && res.dueCents > 0) setPaying(res.dueCents);
    // The date went on but the lock failed: show what is true now (the alert is gone; Lock my spot is on the card).
    if (!res && added) void onChanged();
  }

  /** Zip 66: I'm in on the in-or-out alert: the picked date goes on their sign-up, then the same flow as Lock my spot (credit first, then Pay). */
  function imIn() {
    if (!t.finalDate) return;
    const day = t.finalDate;
    void lock('lock', () => api('PUT', '/api/tournament/signup', { tournamentId: t.id, dates: [day] }));
  }

  async function iPaid() {
    if (paying === null) return;
    const held = k?.mine?.place === 'line' || ticketStateOf(t) === 'line';
    const cents = paying;
    // Zip 63: the sheet closes at the tap, so the card (and its new gold ball's pop) is in view when the answer lands. A failed save shows its
    // error and opens the sheet again.
    setPaying(null);
    // Paid from the card's overlay: it closes too, so the card and its new gold ball are what they see.
    setSheet(null);
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
      {/* Zip 66: signed up but not for the picked date: "Can you make it?" first, and no pay countdown (or late words) until they answer. */}
      {missed && k && t.finalDate && <MissedDateCard t={t} due={dueOf(k)} busy={busy} onIn={imIn} onOut={() => setAskOut(true)} />}
      {!missed && k?.payBy && !k.closed && ticketStateOf(t) === 'lock' && <PayCountdownCard t={t} payBy={k.payBy} due={dueOf(k)} busy={busy} onPay={() => void lock('lock')} />}
      {/* Zip 60's date alert, right under the countdown (PlayerHome hands it in). Zip 66: the in-or-out alert already says the date. */}
      {!missed && notice}
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
      {/* Zip 57: on game night (the live window) the live view takes the ticket's place; before it the ticket stays as it is (zip 66's one row). */}
      {t.day?.today ? null : (
        <TicketCard
          t={t}
          org={org}
          busy={busy}
          punch={punch}
          onSignUp={() => setSheet('signup')}
          onWho={() => setSheet(t.status === 'tickets' ? 'overlay' : 'who')}
          onEdit={() => setSheet('edit')}
          onDropOut={() => setAskOut(true)}
          onLock={() => void lock('lock')}
          onHold={() => void lock('hold')}
          onJoin={() => void joinWaitlist()}
        />
      )}
      {/* Zip 57: Your team, Your games, All teams or the pools; on game night the one big card, Standings and Currently playing. */}
      {/* Zip 61: the Americano night (Your rounds; on the night the round card, Standings with points, Currently playing). */}
      {t.day?.kind === 'americano' ? <RoundsBody t={t} day={t.day} onChanged={onChanged} /> : t.day && <DayBody t={t} day={t.day} org={org} onChanged={onChanged} />}
      {t.status === 'tickets' && k && signed && (
        <Sheet calmFocus open={sheet === 'overlay'} title={t.name} onClose={() => setSheet((cur) => (cur === 'overlay' ? null : cur))} className="tc-tw-overlay">
          <Overlay
            t={t}
            k={k}
            busy={busy}
            onHold={() => void lock('hold')}
            onKeep={() => {
              setSheet(null);
              toast("You're on standby");
            }}
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

/**
 * Zip 66 (picture 10): the site's two-button blue alert card (the same look as the "game moved: Still in / Can't make it" card), above the ticket:
 * "The Cold Open is Tue Dec 8" / "Most players picked it. Can you make it?", I'm in · $16 and Can't make it. No X: it stays until they answer.
 */
function MissedDateCard({ t, due, busy, onIn, onOut }: { t: PlayerTournamentView; due: number; busy: boolean; onIn: () => void; onOut: () => void }) {
  const s = stubParts(t.finalDate!);
  const day = `${s.weekday.charAt(0)}${s.weekday.slice(1).toLowerCase()} ${s.month.charAt(0)}${s.month.slice(1).toLowerCase()} ${s.day}`;
  return (
    <AlertCard
      as="section"
      tone="blue"
      icon="court"
      label={`${t.name} is ${day}. Can you make it?`}
      className="tc-missed"
      data={{ 'data-missed-date': t.finalDate! }}
      title={`${t.name} is ${day}`}
      sub="Most players picked it. Can you make it?"
      actions={
        <>
          <button type="button" className="ac-btn" disabled={busy} onClick={onIn} data-missed-in>
            I’m in · {formatPrice(due)}
          </button>
          <button type="button" className="ac-btn ac-out" disabled={busy} onClick={onOut} data-missed-out>
            Can’t make it
          </button>
        </>
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
  // Zip 64: the short ticket's narrower column (mock 00: 21 px balls, 6 px apart, up to 10), then Zip 63's steps down, scaled the same way.
  if (n <= 10) return { size: 21, gap: 6 };
  if (n <= 12) return { size: 18, gap: 5 };
  if (n <= 14) return { size: 16, gap: 4 };
  return { size: 14, gap: 4 };
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
 * in (every spot and every trusted I paid), in the order they paid (after Alex confirms an I paid, by when he confirmed it, as spots always
 * were). Standby players are in their own Standby list, not here. `rest`: everyone else who can make the date and is not on standby, the
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

/** "You're 2nd on standby" (Zip 63: standby, never waitlist). */
const standbyWhere = (place: number) => (place > 0 ? `You’re ${placeWord(place)} on standby` : 'You’re on standby');

/**
 * Zip 64 (🎾64.finalize): the date stub on the left of the short ticket (mocks 00 and 01): the weekday, the day, the month and the start. Before a
 * date is picked: "DATE / TBD / DEC (or DEC–JAN) / ~7:30 PM". Once the organizer finalizes the date, the start is the real one (no "~").
 */
function Stub({ t }: { t: PlayerTournamentView }) {
  const s = t.finalDate ? stubParts(t.finalDate) : null;
  const months = monthSpan(t.openDates.length ? t.openDates : t.me?.dates ?? []);
  const time = `${s && t.startSet ? '' : '~'}${startLabel(t.start)}`;
  return (
    <div className="tc-stub" aria-label={s ? `On ${s.weekday} ${s.month} ${s.day} at ${startLabel(t.start)}` : `Date not picked yet, around ${startLabel(t.start)}`} data-tc-stub>
      <span className="tc-wd" aria-hidden="true">
        {s ? s.weekday : 'Date'}
      </span>
      <span className={s ? 'tc-day' : 'tc-day tc-day-tbd'} aria-hidden="true">
        {s ? s.day : 'TBD'}
      </span>
      <span className={!s && months.includes('–') ? 'tc-mon tc-mon-span' : 'tc-mon'} aria-hidden="true">
        {s ? s.month : months || ' '}
      </span>
      <span className="tc-time" aria-hidden="true">
        {time}
      </span>
    </div>
  );
}

/**
 * Zip 64: the short ticket (mocks 00 and 01), every state: the date stub, the notch and the dashed tear line, then the kicker, the name, the format
 * and the balls on the right; one bar along the bottom with the state's one button (and a small link or "Pay by 11/30" on the right).
 */
function CardShell({
  t,
  data,
  punch,
  balls,
  bar,
  row,
  kicker = 'Tournament',
  muted,
}: {
  t: PlayerTournamentView;
  data: string;
  punch?: boolean;
  balls?: boolean;
  bar: ReactNode;
  /** Zip 66b: the tickets-open row (Lock in, Who's in, Drop out). */
  row?: boolean;
  kicker?: string;
  muted?: boolean;
}) {
  const b = ballsOf(t);
  return (
    <section
      className={`tc tc-short${punch ? ' tc-punching' : ''}`}
      aria-label={t.status === 'canceled' ? `${t.name}, canceled` : cardLabel(t)}
      data-tc-format={t.formatTbd || t.styleTbd ? 'tbd' : t.format}
      data-tc={data}
    >
      {punch && <PunchRing />}
      <div className="tc-top">
        <Stub t={t} />
        <div className="tc-main">
          <Kicker muted={muted}>{kicker}</Kicker>
          <Title t={t} />
          {t.status !== 'canceled' && (
            <p className="tc-format" data-tc-format-name>
              {punch ? <PunchSub /> : formatText(t)}
            </p>
          )}
          {balls && <TourBalls total={b.total} gold={b.gold} />}
        </div>
      </div>
      <div className={row ? 'tc-bar tc-bar-row' : 'tc-bar'} data-tc-bar>
        {bar}
      </div>
    </section>
  );
}

/** Zip 64: the small words on the right of the bar ("Pay by 11/30", "You're locked in"). Plain text, never a link. */
const Aside = ({ children, lime }: { children: ReactNode; lime?: boolean }) => (
  <span className={lime ? 'tc-aside tc-aside-lime' : 'tc-aside'} data-tc-sub>
    {children}
  </span>
);

export function TicketCard({
  t,
  busy,
  punch = false,
  onSignUp,
  onWho,
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

  // ---- Zip 56: the plain Canceled card (no balls, no buttons): the kicker in gray, what came back in the bar ----
  if (t.status === 'canceled') {
    const c = t.canceled ?? { backCents: 0, claimCents: 0 };
    const money =
      c.claimCents > 0 ? `Your ${formatPrice(c.claimCents + c.backCents)} comes back as credit.` : c.backCents > 0 ? `Your ${formatPrice(c.backCents)} is back as credit.` : 'This tournament is canceled.';
    return <CardShell t={t} data="canceled" muted kicker="Canceled" bar={<Aside>{money}</Aside>} />;
  }

  const lime = (label: string, fn: () => void, data: string, wide = false) => (
    <button type="button" className={wide ? 'tc-btn tc-lime tc-wide' : 'tc-btn tc-lime'} disabled={busy} onClick={fn} {...{ [data]: '' }}>
      {label}
    </button>
  );
  const gray = (label: string, fn: () => void, data: string) => (
    <button type="button" className="tc-btn tc-gray" onClick={fn} {...{ [data]: '' }}>
      {label}
    </button>
  );

  // ---- Zip 66b (pictures A1, A2): tickets open: ONE row in every state. On the left the lime button (Lock in · $16, Join standby) or the
  // state's short words centered in its place (Locked in, Spot held, 2nd on standby, Tickets closed, Started); then the gray Who's in (the
  // Who's in sheet); then Drop out where it is allowed (not once tickets are closed or the night has started). No Pay by on the card (the
  // countdown alert says it). The card itself is not a tap any more. ----
  if (s && k) {
    const due = dueOf(k);
    const held = !!k.mine && k.mine.creditCents + k.mine.paidCents + k.mine.claimCents >= k.priceCents;
    // Alex (ship answer 1): on standby and not paid, the lime spot is Hold my spot (the same flow as before); the place in line ("2nd on
    // standby") is in the Who's in sheet. Once held: "Spot held".
    const hold = s === 'line' && !held && !k.closed && !(k.mine && k.mine.claimCents > 0);
    const words = s === 'in' ? 'Locked in' : s === 'line' ? (held ? 'Spot held' : shortStandby(linePlace(k))) : k.started ? 'Started' : 'Tickets closed';
    // A longer label ("Lock in · $16.50", "Hold my spot · $16") is set a little smaller, so it is never cut on a narrow phone.
    const label = s === 'lock' ? `Lock in · ${formatPrice(due)}` : s === 'full' ? 'Join standby' : hold ? `Hold my spot · ${formatPrice(due)}` : words;
    const long = Array.from(label).length > 13 ? (Array.from(label).length > 16 ? ' tc-long tc-longer' : ' tc-long') : '';
    const act = s === 'lock' ? onLock : s === 'full' ? onJoin : hold ? onHold : null;
    const actData = s === 'lock' ? 'data-tc-lock' : s === 'full' ? 'data-tc-join' : 'data-tc-hold';
    const main =
      act ? (
        <button type="button" className={`tc-btn tc-lime${long}`} disabled={busy} onClick={act} {...{ [actData]: '' }}>
          {label}
        </button>
      ) : (
        <span className={`${s === 'in' ? 'tc-state tc-state-lime' : 'tc-state'}${long}`} data-tc-sub>
          {label}
        </span>
      );
    const canDrop = s !== 'closed' && !k.started;
    const bar = (
      <>
        {main}
        {gray('Who’s in', onWho, 'data-tc-who')}
        {canDrop && (
          <button type="button" className="tc-link tc-row-drop" onClick={onDropOut} data-tc-drop>
            Drop out
          </button>
        )}
      </>
    );
    return <CardShell t={t} data={s} punch={punch} balls bar={bar} row />;
  }

  // ---- Piece 1's states (before you sign up, signed up, the date picked), and a Reschedule ----
  // The picked date has passed: nothing to pick, so no Sign up (the list, Edit and Drop out stay for those on it). (Every offered date passed
  // with none picked: the server sends no card at all.)
  const noDates = t.openDates.length === 0;
  const state = t.status === 'rescheduled' ? 'rescheduled' : picked ? 'date' : signed ? 'listed' : 'open';
  const kicker = t.status === 'rescheduled' ? 'Rescheduled' : 'Tournament';
  let bar: ReactNode;
  if (signed) {
    // Mock 01: the narrower gray button on the left; Edit and Drop out as plain underlined words on the right, wide apart (no mis-taps).
    bar = (
      <>
        {gray('See who’s signed up', onWho, 'data-tc-who')}
        <span className="tc-bar-links">
        <button type="button" className="tc-link" onClick={onEdit} data-tc-edit>
          Edit
        </button>
        <button type="button" className="tc-link" onClick={onDropOut} data-tc-drop>
          Drop out
        </button>
      </span>
      </>
    );
  } else if (t.status === 'tickets' && k?.closed) bar = <Aside>Tickets are closed.</Aside>;
  else if (noDates) bar = <Aside>That date has passed.</Aside>;
  // Mock 00: one wide lime Sign up across the whole bar, no hint words.
  else bar = lime('Sign up', onSignUp, 'data-tc-signup', true);
  return <CardShell t={t} data={state} punch={punch} balls bar={bar} kicker={kicker} />;
}

/** Zip 64: "2nd on standby" (the bar's short words next to Hold my spot). */
const shortStandby = (place: number) => (place > 0 ? `${placeWord(place)} on standby` : 'On standby');


// ---------------------------------------------------------------------------------------------------------------------
// Zip 56: the overlay (mocks 09, 11, 12): the card once more with its one action, then Who's in and the waitlist.
// ---------------------------------------------------------------------------------------------------------------------

function Overlay({
  t,
  k,
  busy,
  onHold,
  onKeep,
}: {
  t: PlayerTournamentView;
  k: PlayerTicketsView;
  busy: boolean;
  onHold: () => void;
  onKeep: () => void;
}) {
  // Zip 66b: the Who's in sheet (the card's gray Who's in). The card copy, its button, Edit sign-up and Drop out are gone from here (the card's
  // one row has Lock in, Who's in and Drop out). What only this sheet had stays: on standby, the place in line, Hold my spot or Just keep me on
  // the list, and the "Your spot is held" note. Then Who's in and the standby list.
  const s = ticketStateOf(t) ?? 'full';
  const due = dueOf(k);
  const place = linePlace(k);
  const mine = k.mine;
  const paid = !!mine && mine.creditCents + mine.paidCents >= k.priceCents;
  const claim = !!mine && mine.claimCents > 0;
  const lists = [<WhoIn key="in" t={t} />, k.line.length > 0 ? <Waitlist key="line" k={k} /> : null];
  return (
    <div className="tc-tw stack" data-tw={s}>
      {s === 'line' && (
        <section className="tc tc-hero tc-overlay tc-standby" aria-label="Standby" data-tc-format={t.formatTbd || t.styleTbd ? 'tbd' : t.format} data-tc={s}>
          <div className="tc-row" data-tc-place>
            <span className="tc-tw-num" aria-hidden="true">
              {place || '–'}
            </span>
            <span className="tc-row-text">{standbyWhere(place)}</span>
          </div>
          {!paid && !claim && !k.closed && (
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
          {(paid || claim) && (
            <p className="tc-note" data-tc-note>
              Your spot is held. If someone drops, you’re locked into that spot.
            </p>
          )}
        </section>
      )}
      {/* On standby, standby comes first (mock 12); otherwise Who's in first. */}
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
  // "Pay to lock in" only while they really can (a spot open for them, tickets not closed); otherwise their own row has no words.
  const canLock = ticketStateOf(t) === 'lock';
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
            {p.me && (p.gold || canLock) ? <span className={p.gold ? 'tc-tw-tag tc-tw-gold' : 'tc-tw-tag'}>{p.gold ? 'Locked in' : 'Pay to lock in'}</span> : <span />}
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

/** Zip 64 (mock 02): the line under "Your dates" in Sign up and Edit sign-up. */
const DATES_HELP = 'Tap every date you can make. We pick the one that works for the most people.';

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
          {/* Zip 64 (mock 02): the clearer words; the start time is on the ticket. */}
          <p className="tm-eyebrow">{locked === null ? 'Step 2 of 2 · Your dates' : 'Your dates'}</p>
          {!t.finalDate && <p className="tm-help" data-tm-dates-help>{DATES_HELP}</p>}
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
          {/* Zip 64: the same line as Sign up, without the step label (only while the date is still to be picked). */}
          {t.finalDate ? (
            <p className="tm-eyebrow tm-eyebrow-dates">Your date</p>
          ) : (
            <p className="tm-help tm-eyebrow-dates" data-tm-dates-help>
              {DATES_HELP}
            </p>
          )}
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
