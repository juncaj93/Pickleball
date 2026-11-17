// Zip 55 "Tournaments", the PLAYER side: the pinned ticket card at the top of Home (mocks 04, 07, 08), the "Only you can see this" strip (mock
// 04), the 2-step sign-up sheet (05, 06), "See who's signed up" (names only), Edit my sign-up (13) and the Back out confirm (13b).
// Zip 56, piece 2 (the pictures 07 to 13b): tickets. The card's states 3 (Tickets open: Lock my spot), 4 (8 spots taken: Join waitlist) and 5
// (You're in), the waitlist, tapping the card for the overlay with Who's in and the waitlist (09, 11, 12), the site's own Pay sheet (10), Back
// out with the money it gives back (13b), and the plain Canceled and "Rescheduled. Pick your dates again" cards. Money moves only on the server
// (server/tournamentTickets.ts); this screen sends what it showed, so a stale screen never pays or gets back a different amount.
//
// This file is its own download (src/TournamentSlot.tsx loads it): a phone fetches it only when the server sends a tournament for it, so with
// the switch off (or a tournament on Only me) a player's download is exactly main's.
import { type CSSProperties, type MouseEvent, type ReactNode, useMemo, useState } from 'react';
import type { PlayerTicketsView, PlayerTournamentView } from '../../shared/tournament';
import { dayShort, formatName, formatRule, hoursLabel, levelLabel, stepsFor, monthsBetween, monthSpan, startLabel, stubParts } from '../../shared/tournament';
import { payByLabel, placeWord } from '../../shared/tournamentTickets';
import { formatPrice, venmoPayUrl } from '../../shared/money';
import { api, ApiError, VIEW_ONLY_MESSAGE } from '../lib';
import { ConfirmDialog, Pickleball, Sheet, useToast } from '../ui';
import { PaySheet } from '../PaySheet';
import type { TournamentPayInfo } from '../TournamentSlot';
import { type DayLook, LevelList, MonthCalendar } from './parts';

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
 *   waiting  they tapped I paid; the organizer has not confirmed it yet (no spot until then)
 *   closed   ticket sales are over (the night has started) and they are not locked in
 */
type TicketState = 'lock' | 'full' | 'in' | 'line' | 'waiting' | 'closed';

export function ticketStateOf(t: PlayerTournamentView): TicketState | null {
  const k = t.tickets;
  if (t.status !== 'tickets' || !k || !t.me) return null;
  const mine = k.mine;
  if (mine?.place === 'spot') return 'in';
  if (k.closed) return 'closed';
  const open = k.locked.length < k.size;
  const paid = !!mine && mine.creditCents + mine.paidCents >= k.priceCents;
  if (mine?.place === 'line') return open && !paid && mine.claimCents === 0 ? 'lock' : 'line';
  if (mine && mine.claimCents > 0 && mine.owedCents === 0) return 'waiting';
  return open ? 'lock' : 'full';
}

/** What is still to pay on their ticket (the price before they ever tapped Lock my spot). */
const dueOf = (k: PlayerTicketsView) => (k.mine ? k.mine.owedCents : k.priceCents);

/** Their place in line (1 = first), or 0. */
const linePlace = (k: PlayerTicketsView) => k.line.findIndex((x) => x.me) + 1;

export default function TournamentHome({ t, onChanged, pay }: { t: PlayerTournamentView; onChanged: () => Promise<unknown>; pay: TournamentPayInfo }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<null | 'signup' | 'edit' | 'who' | 'overlay'>(null);
  const [askOut, setAskOut] = useState(false);
  const [askShow, setAskShow] = useState(false);
  const [paying, setPaying] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const signed = t.me !== null;
  const k = t.tickets ?? null;
  const org = firstOf(pay.group.organizerName);

  async function run(fn: () => Promise<unknown>, done: string | ((res: any) => string)): Promise<any> {
    if (busy) return null;
    setBusy(true);
    try {
      const res = await fn();
      await onChanged();
      toast(typeof done === 'function' ? done(res) : done);
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
    const ok = await run(() => api('POST', '/api/tournament/paid', { tournamentId: t.id, cents: paying }), held ? `Thanks. Your spot is held once ${org} confirms.` : `Thanks. You're locked in once ${org} confirms.`);
    if (ok) setPaying(null);
  }

  async function joinWaitlist() {
    const ok = await run(() => api('POST', '/api/tournament/waitlist', { tournamentId: t.id }), "You're on the waitlist");
    if (ok) setSheet('overlay');
  }

  // Back out: what the sheet says comes back is what the server checks (credit and confirmed cash on the ticket, an I paid that waits).
  const mine = k?.mine ?? null;
  const backCents = mine ? mine.creditCents + mine.paidCents + mine.claimCents : 0;
  const backLine = !mine || backCents === 0 ? '' : mine.claimCents > 0 ? ` Your ${formatPrice(backCents)} comes back as credit once ${org} confirms your payment.` : ` Your ${formatPrice(backCents)} comes back as credit.`;
  const venmo = venmoPayUrl(pay.group.venmoUrl, paying ?? 0, `${t.name} ticket${pay.meName ? ` - ${pay.meName}` : ''}`);

  return (
    <div className="tc-wrap stack" data-tournament={t.status}>
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
        <Sheet calmFocus open={sheet === 'overlay'} title={t.name} back="Home" onClose={() => setSheet(null)} className="tc-tw-overlay">
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
              toast("You're on the waitlist");
            }}
            onJoin={() => void joinWaitlist()}
            onDropOut={() => setAskOut(true)}
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
        key={`signup-${sheet === 'signup'}`}
        t={t}
        open={sheet === 'signup'}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={async (level, dates) => {
          const ok = await run(() => api('POST', '/api/tournament/signup', { tournamentId: t.id, level, dates }), "You're on the list");
          if (ok) setSheet(null);
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
          onSubmit={async (level, dates) => {
            const ok = await run(() => api('PUT', '/api/tournament/signup', { tournamentId: t.id, level, ...(dates ? { dates } : {}) }), 'Saved');
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
              if ((r?.waitingCents ?? 0) > 0) return `You're off the list. Your ${formatPrice(r.waitingCents!)} comes back as credit once ${org} confirms.`;
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

/** The faint court drawn in the card's top right corner (mock 04), anchored to the right edge so it sits the same on every width. */
function Court() {
  return (
    <svg className="tc-court" viewBox="0 0 224 176" aria-hidden="true" focusable="false">
      <line x1="1" y1="14" x2="224" y2="14" />
      <line x1="1" y1="87" x2="224" y2="87" />
      <line x1="1" y1="160" x2="224" y2="160" />
      <line x1="1" y1="14" x2="1" y2="176" />
      <line x1="83" y1="14" x2="83" y2="160" />
      <line x1="122" y1="14" x2="122" y2="160" />
      <line x1="160" y1="14" x2="160" y2="160" />
    </svg>
  );
}

/** The ticket stub on the left: the date (or TBD and the months on offer) and the start time. */
function Stub({ t }: { t: PlayerTournamentView }) {
  const picked = !!t.finalDate;
  const stub = picked ? stubParts(t.finalDate!) : null;
  return (
    <div className="tc-stub" aria-label={picked ? `On ${stub!.weekday} ${stub!.month} ${stub!.day} at ${startLabel(t.start)}` : `Date not picked yet, around ${startLabel(t.start)}`}>
      <span className="tc-wd" aria-hidden="true">
        {stub ? stub.weekday : 'Date'}
      </span>
      <span className={stub ? 'tc-day' : 'tc-day tc-day-tbd'} aria-hidden="true">
        {stub ? stub.day : 'TBD'}
      </span>
      <span className={!stub && monthSpan(t.openDates).includes('–') ? 'tc-mon tc-mon-span' : 'tc-mon'} aria-hidden="true">
        {stub ? stub.month : monthSpan(t.openDates) || ' '}
      </span>
      <span className="tc-time" aria-hidden="true">
        {startLabel(t.start)}
      </span>
    </div>
  );
}

/** The steps along the bottom. `now`: the step they are on (1 = Tickets); none for a canceled tournament. */
function Track({ t, now }: { t: PlayerTournamentView; now: number }) {
  return (
    <ol className="tc-track" aria-label="Tournament steps" style={{ '--tc-steps': stepsFor(t.format).length } as CSSProperties}>
      {stepsFor(t.format).map((s, i) => (
        <li key={s} className={i < now ? 'tc-step-done' : i === now ? 'tc-step-now' : undefined} aria-current={i === now ? 'step' : undefined}>
          <span className="tc-step-dot" aria-hidden="true" />
          <span className="tc-step-label">{s.toUpperCase()}</span>
        </li>
      ))}
    </ol>
  );
}

/** Zip 56: the small status line above the name in the ticket states (the pictures 07 to 12): a lime dot and the words. */
function Kicker({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <p className={muted ? 'tc-kicker tc-kicker-muted' : 'tc-kicker'} data-tc-kicker>
      <span className="tc-kdot" aria-hidden="true" />
      {children}
    </p>
  );
}

/** Zip 56: "8 spots taken" as the pictures write it. */
const takenWords = (k: PlayerTicketsView) => `${k.size} spots taken`;

/** Zip 56: the words under the name in each ticket state (the pictures' own words where they have them). */
function ticketWords(t: PlayerTournamentView, s: TicketState, org: string): { kicker: string; sub: string } {
  const k = t.tickets!;
  const hours = hoursLabel(t.minutes);
  const payBy = k.payBy ? payByLabel(k.payBy, 'America/Detroit', t.finalDate) : null;
  const place = linePlace(k);
  const mine = k.mine;
  switch (s) {
    case 'lock':
      // "Pay by Tue 7:00 PM" stays together: on a small phone the line breaks after the dot, never before "PM".
      return { kicker: 'Tickets open', sub: payBy ? `${hours} · ${`Pay by ${payBy}`.replace(/ /g, '\u00a0')}` : hours };
    case 'full':
      return { kicker: takenWords(k), sub: 'Join the waitlist in case someone drops' };
    case 'in':
      return { kicker: 'You’re in', sub: `${hours} · You’re locked in` };
    case 'waiting':
      return { kicker: 'Tickets open', sub: `Paid · Waiting for ${org} to confirm` };
    case 'closed':
      return { kicker: 'Tickets closed', sub: 'The tournament has started.' };
    case 'line': {
      const where = place > 0 ? `You’re ${placeWord(place)} on the waitlist` : 'You’re on the waitlist';
      if (mine && mine.claimCents > 0) return { kicker: 'Waitlist', sub: `${where}. Waiting for ${org} to confirm your payment.` };
      if (mine && mine.creditCents + mine.paidCents >= k.priceCents) return { kicker: 'Waitlist', sub: `${where}. Your spot is held.` };
      return { kicker: 'Waitlist', sub: `${takenWords(k)} · ${where}` };
    }
  }
}

export function TicketCard({
  t,
  org,
  busy,
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
  const n = t.names.length;
  const k = t.tickets ?? null;
  const s = ticketStateOf(t);

  // ---- Zip 56: the plain Canceled card ----
  if (t.status === 'canceled') {
    const c = t.canceled ?? { backCents: 0, claimCents: 0 };
    const money =
      c.claimCents > 0 ? `Your ${formatPrice(c.claimCents)} comes back as credit once ${org} confirms your payment.` : c.backCents > 0 ? `Your ${formatPrice(c.backCents)} is back as credit.` : null;
    return (
      <section className="tc tc-canceled" aria-label={`${t.name}, canceled`} data-tc="canceled">
        <Court />
        <div className="tc-top">
          <Stub t={t} />
          <div className="tc-main">
            <Kicker muted>Canceled</Kicker>
            <h2 className={Array.from(t.name).length >= 17 ? 'tc-title tc-title-long' : 'tc-title'}>{t.name}</h2>
            <p className="tc-sub" data-tc-sub>
              {money ? `Canceled. ${money}` : 'Canceled.'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // ---- Zip 56: tickets open (states 3, 4 and 5, the waitlist, waiting for a confirm, closed) ----
  if (s && k) {
    const w = ticketWords(t, s, org);
    const due = dueOf(k);
    const lime = (label: string, fn: () => void, data: string) => (
      <button type="button" className="tc-btn tc-lime" disabled={busy} onClick={fn} {...{ [data]: '' }}>
        {label}
      </button>
    );
    const who = (
      <button type="button" className="tc-btn tc-gray" onClick={onWho} data-tc-who>
        See who’s in
      </button>
    );
    const paidLine = !!k.mine && k.mine.creditCents + k.mine.paidCents >= k.priceCents;
    const main =
      s === 'lock'
        ? lime(`Lock my spot · ${formatPrice(due)}`, onLock, 'data-tc-lock')
        : s === 'full'
          ? lime('Join waitlist', onJoin, 'data-tc-join')
          : s === 'line' && !paidLine && !(k.mine && k.mine.claimCents > 0)
            ? lime(`Hold my spot · ${formatPrice(due)}`, onHold, 'data-tc-hold')
            : null;
    // Tap the card (not a button) for the overlay (mock 09).
    const open = onOpen
      ? (e: MouseEvent<HTMLElement>) => {
          if ((e.target as Element).closest('button, a')) return;
          onOpen();
        }
      : undefined;
    return (
      <section className={`tc${onOpen ? ' tc-tap' : ''}`} aria-label={`${t.name}, ${formatName(t.format)} tournament`} data-tc-format={t.format} data-tc={s} onClick={open}>
        <Court />
        <div className="tc-top">
          <Stub t={t} />
          <div className="tc-main">
            <Kicker>{w.kicker}</Kicker>
            <h2 className={Array.from(t.name).length >= 17 ? 'tc-title tc-title-long' : 'tc-title'}>{t.name}</h2>
            <p className="tc-sub" data-tc-sub>
              {w.sub}
            </p>
          </div>
        </div>
        <div className={main ? 'tc-actions tc-split' : 'tc-actions'}>
          {main}
          {who}
        </div>
        {/* State 5 (and a paid hold) has Drop out only; the others Edit sign-up and Drop out (mock 08). Closed: neither. */}
        {s !== 'closed' && (
          <div className="tc-links">
            {s !== 'in' && !paidLine && (
              <button type="button" className="tc-link" onClick={onEdit} data-tc-edit>
                Edit sign-up
              </button>
            )}
            <button type="button" className="tc-link" onClick={onDropOut} data-tc-drop>
              Drop out
            </button>
          </div>
        )}
        <Track t={t} now={1} />
      </section>
    );
  }

  // ---- Piece 1's states (before you sign up, signed up, the date picked), and a Reschedule ----
  // The picked date has passed: nothing to pick, so no Sign up (the list, Edit and Drop out stay for those on it). (Every offered date passed
  // with none picked: the server sends no card at all.)
  const noDates = t.openDates.length === 0;
  const held = !!k?.mine && k.mine.creditCents + k.mine.paidCents + k.mine.claimCents > 0;
  // Under the name: the format ("Locked doubles" or "Americano") and its one rule, then where they stand.
  const sub =
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
              : n > 0
                ? `${n} signed up · pick the dates you can play`
                : 'Pick the dates you can play';
  // Piece 1: VOTE while the date is being picked; once it is picked, VOTE is done and TICKETS is next (as state 3's track). A Reschedule is
  // back at VOTE.
  const now = picked ? 1 : 0;
  const state = t.status === 'rescheduled' ? 'rescheduled' : picked ? 'date' : signed ? 'listed' : 'open';
  return (
    <section className="tc" aria-label={`${t.name}, ${formatName(t.format)} tournament`} data-tc-format={t.format} data-tc={state}>
      <Court />
      <div className="tc-top">
        <Stub t={t} />
        <div className="tc-main">
          <h2 className={Array.from(t.name).length >= 17 ? 'tc-title tc-title-long' : 'tc-title'}>{t.name}</h2>
          <p className="tc-format" data-tc-format-name>
            {formatName(t.format)}
          </p>
          <p className="tc-rule" data-tc-rule>
            {formatRule(t.format)}
          </p>
          <p className="tc-sub" data-tc-sub>
            {sub}
          </p>
        </div>
      </div>
      {(signed || !noDates) && !(t.status === 'tickets' && !signed && k?.closed) && (
        <div className="tc-actions">
          {signed ? (
            <button type="button" className="tc-btn tc-gray" onClick={onWho} data-tc-who>
              See who’s signed up
            </button>
          ) : (
            <button type="button" className="tc-btn tc-lime" onClick={onSignUp} data-tc-signup>
              Sign up
            </button>
          )}
        </div>
      )}
      {signed && (
        <div className="tc-links">
          <button type="button" className="tc-link" onClick={onEdit} data-tc-edit>
            Edit sign-up
          </button>
          <button type="button" className="tc-link" onClick={onDropOut} data-tc-drop>
            Drop out
          </button>
        </div>
      )}
      <Track t={t} now={t.status === 'tickets' ? 1 : now} />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 56: the overlay (mocks 09, 11, 12): the card once more with its one action, then Who's in and the waitlist.
// ---------------------------------------------------------------------------------------------------------------------

function Overlay({
  t,
  k,
  org,
  meName,
  busy,
  onLock,
  onHold,
  onKeep,
  onJoin,
  onDropOut,
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
}) {
  const s = ticketStateOf(t) ?? 'full';
  const w = ticketWords(t, s, org);
  const due = dueOf(k);
  const place = linePlace(k);
  const mine = k.mine;
  const paid = !!mine && mine.creditCents + mine.paidCents >= k.priceCents;
  const claim = !!mine && mine.claimCents > 0;
  // The overlay's own words under the name: the pictures keep it short ("2 hours", "8 spots taken").
  const sub = s === 'in' ? hoursLabel(t.minutes) : s === 'line' ? takenWords(k) : w.sub;
  const lists = [<WhoIn key="in" k={k} s={s} meName={meName} />, k.line.length > 0 ? <Waitlist key="line" k={k} /> : null];
  return (
    <div className="tc-tw stack" data-tw={s}>
      <section className="tc" aria-label={`${t.name}, ${formatName(t.format)} tournament`} data-tc-format={t.format} data-tc={s}>
        <Court />
        <div className="tc-top">
          <Stub t={t} />
          <div className="tc-main">
            <Kicker>{w.kicker}</Kicker>
            <h2 className={Array.from(t.name).length >= 17 ? 'tc-title tc-title-long' : 'tc-title'}>{t.name}</h2>
            <p className="tc-sub" data-tc-sub>
              {sub}
            </p>
          </div>
        </div>
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
            <span className="tc-row-text">{place > 0 ? `You’re ${placeWord(place)} on the waitlist` : 'You’re on the waitlist'}</span>
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
                Join waitlist
              </button>
            )}
          </div>
        )}
        {s === 'line' && !paid && !claim && (
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
            {claim ? `Waiting for ${org} to confirm your payment.` : 'Your spot is held. If someone drops, you’re locked into that spot.'}
          </p>
        )}
        <Track t={t} now={1} />
      </section>
      {/* On the waitlist the waitlist comes first (mock 12); otherwise Who's in first (mocks 09, 11). */}
      {s === 'line' ? [...lists].reverse() : lists}
    </div>
  );
}

/** WHO'S IN: the locked-in players in the order they locked in, then this player if they can pay to lock in, then the open spots. */
function WhoIn({ k, s, meName }: { k: PlayerTicketsView; s: TicketState; meName: string | null }) {
  const full = k.locked.length >= k.size;
  // "7 · Vic · Pay to lock in" (mock 09): their own row, only while a spot is open for them.
  const meRow = (s === 'lock' || s === 'waiting') && !full ? { label: s === 'waiting' ? 'Waiting to confirm' : 'Pay to lock in' } : null;
  const open = Math.max(0, k.size - k.locked.length - (meRow ? 1 : 0));
  return (
    <section className="tc-tw-card" aria-label="Who's in" data-tw-in>
      <div className="tc-tw-head">
        <h3 className="tc-tw-label">Who’s in</h3>
        <span className={full ? 'tc-tw-chip tc-tw-chip-full' : 'tc-tw-chip'} data-tw-count>
          {k.locked.length} of {k.size}
        </span>
      </div>
      <ol className="tc-tw-rows">
        {k.locked.map((p, i) => (
          <li key={`${p.name}-${i}`} className={p.me ? 'tc-tw-me' : undefined} data-tw-row={p.name}>
            <span className="tc-tw-n">{i + 1}</span>
            <span className="tc-tw-ball tc-tw-ball-gold" aria-hidden="true">
              <Pickleball />
            </span>
            <span className="tc-tw-name">{p.name}</span>
            <span className="tc-tw-tag tc-tw-gold">Locked in</span>
          </li>
        ))}
        {meRow && (
          <li className="tc-tw-me" data-tw-row="me">
            <span className="tc-tw-n">{k.locked.length + 1}</span>
            <span className="tc-tw-ball" aria-hidden="true">
              <Pickleball />
            </span>
            <span className="tc-tw-name">{meName ?? 'You'}</span>
            <span className="tc-tw-tag">{meRow.label}</span>
          </li>
        )}
        {Array.from({ length: open }, (_, i) => (
          <li key={`open-${i}`} data-tw-row="open">
            <span className="tc-tw-n">{k.locked.length + (meRow ? 1 : 0) + i + 1}</span>
            <span className="tc-tw-ball tc-tw-ball-open" aria-hidden="true" />
            <span className="tc-tw-name">Open spot</span>
            <span />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** WAITLIST: everyone in line, in the order they joined it. The first PAID person gets the next spot (mock 11: "Paid, first in line"). */
function Waitlist({ k }: { k: PlayerTicketsView }) {
  const firstPaid = k.line.findIndex((x) => x.paid);
  return (
    <section className="tc-tw-card" aria-label="Waitlist" data-tw-line>
      <div className="tc-tw-head">
        <h3 className="tc-tw-label">Waitlist</h3>
      </div>
      <ol className="tc-tw-rows">
        {k.line.map((p, i) => (
          <li key={`${p.name}-${i}`} className={p.me ? 'tc-tw-me' : undefined} data-tw-row={p.name}>
            <span />
            <span className="tc-tw-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="tc-tw-name">{p.name}</span>
            <span className={p.me ? 'tc-tw-tag' : p.paid ? 'tc-tw-tag tc-tw-gold' : 'tc-tw-tag'}>{p.me ? 'You' : p.paid ? (i === firstPaid ? 'Paid, first in line' : 'Paid') : 'Not paid'}</span>
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

function SignUpSheet({
  t,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  t: PlayerTournamentView;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (level: number, dates: string[]) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [level, setLevel] = useState<number | null>(null);
  // Once the date is picked there is one date to pick: it starts picked.
  const [pickedRaw, setPicked] = useState<string[]>(t.openDates.length === 1 ? [...t.openDates] : []);
  // Only the dates still open count: one that closed while the sheet was open (the date was picked, midnight passed) drops out, never sent.
  const picked = pickedRaw.filter((d) => t.openDates.includes(d));
  return (
    <Sheet calmFocus open={open} title="Sign up" onClose={onClose} className="tm-sheet">
      <div className="tm-steps" aria-hidden="true">
        <span className="on" />
        <span className={step === 2 ? 'on' : undefined} />
      </div>
      {step === 1 ? (
        <div data-tm-step="1">
          <p className="tm-eyebrow">Step 1 of 2 · Your level</p>
          <LevelList value={level} onPick={setLevel} />
          <div className="tm-bottom">
            <button type="button" className="btn" disabled={level === null} onClick={() => setStep(2)} data-tm-next>
              Next
            </button>
          </div>
        </div>
      ) : (
        <div data-tm-step="2">
          <p className="tm-eyebrow">Step 2 of 2 · Pick every date that works</p>
          <p className="tm-help">Green dates are open. Games start around {startLabel(t.start)}.</p>
          <DatesPicker t={t} picked={picked} setPicked={setPicked} />
          <div className="tm-bottom">
            <button type="button" className="btn secondary" onClick={() => setStep(1)} data-tm-back>
              Back
            </button>
            <button type="button" className="btn" disabled={busy || picked.length === 0 || level === null} onClick={() => level !== null && onSubmit(level, picked)} data-tm-submit>
              {busy ? 'Signing up…' : 'Sign up'}
            </button>
          </div>
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
  /** `dates` null: the dates were not touched (only the level is sent). */
  onSubmit: (level: number, dates: string[] | null) => void;
}) {
  const me = t.me!;
  const [level, setLevel] = useState<number>(me.level);
  const [changing, setChanging] = useState(false);
  // Only the dates still open count (once the date is picked, that one date). Untouched dates are not sent: a level-only change never makes
  // anyone tick a date they cannot make (the server keeps their dates as they are).
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
      {changing ? (
        <div className="tm-change-level" data-tm-change-level>
          <p className="tm-eyebrow">Your level</p>
          <LevelList
            value={level}
            onPick={(v) => {
              setLevel(v);
              setChanging(false);
            }}
          />
        </div>
      ) : (
        <div className="tm-mylevel" data-tm-mylevel>
          <div>
            <small>YOUR LEVEL</small>
            <b>{levelLabel(level)}</b>
          </div>
          <button type="button" className="btn" onClick={() => setChanging(true)} data-tm-change>
            Change
          </button>
        </div>
      )}
      {t.openDates.length > 0 && (
        <>
          <p className="tm-eyebrow tm-eyebrow-dates">Dates that work</p>
          <DatesPicker t={t} picked={picked} setPicked={setPicked} summary={false} />
        </>
      )}
      <div className="tm-bottom tm-bottom-stack">
        <button type="button" className="btn" disabled={busy || (touched && picked.length === 0)} onClick={() => onSubmit(level, touched ? picked : null)} data-tm-save>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="tm-quiet-link" onClick={onBackOut} data-tm-backout>
          Back out of tournament
        </button>
      </div>
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
