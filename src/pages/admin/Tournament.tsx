// Zip 55 "Tournaments", piece 1, the ORGANIZER side (server/tournament.ts): Settings > Schedule > Create tournament (mocks 03, 01, 02, 24),
// the tournament's own page (who can see it, the level list of mock 14, how many can make each date and picking it, Edit, Cancel), the card on
// Home, and the level and date sheets. Only drawn while the switch is on for this phone (ctx.d.tournaments). No money moves here: the ticket
// price and the champion credit are stored for pieces 2 and 3.
import { theName } from '../../../shared/credit';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { checkDay, dayRule } from '../../../shared/bookingHours';
import { OPEN_TOURNAMENT_TIME } from './VenueHours';
import {
  type AdminTicketView,
  type AdminTournamentView,
  CREATE_MONTHS,
  startLabel,
  stubParts,
  dateCounts,
  heatColors,
  oddSwitchWords,
  oddSwitchSub,
  styleAtClose,
  dayLong,
  DEFAULT_TICKET_CENTS,
  levelOf,
  levelShort,
  MAX_DATES,
  MAX_PRICE_CENTS,
  monthsBetween,
  monthStartPlus,
  NAME_MAX,
  planRange,
  type Visibility,
  formatName,
  formatRule,
  DEFAULT_FORMAT_CHOICE,
  type FinalizeView,
  type FormatChoice,
  type TournamentFormat,
  VOTE_LABEL,
  MAX_SPOTS,
  type TournamentSignupView,
  courtCentsOf,
} from '../../../shared/tournament';
import { afterFullWords, EXPECT_MAX, EXPECT_MIN, expectedPlayers, type MoneyLine, planMoney } from '../../../shared/tournamentMoney';
import { formatPrice, parseDollars } from '../../../shared/money';
import { isOwedClaim } from '../../../shared/tournamentTickets';
import { evensWarning, payByAt, payByDays, payByLabel, payByParts, salesCutoffMs, startMsOf, tournamentRemindText } from '../../../shared/tournamentTickets';
import { siteAddress, smsHref } from '../../../shared/messages';
import { signupCloseDefault, signupReminderText } from '../../../shared/tournamentNudge';
import { nightOnAt } from './nightCardData';
import { type ButtonTone, cardButtons, clockShort, dueOf, isGameDay, moneySheet, pillOf, plannedStyle, prizesOf, STEPS, statusWords, stepOf, styleShort, type SubTone, ticketCount, ticketWords } from '../../../shared/tournamentCard';
import { DateTile } from '../PlayerHome';
import { tileDay } from '../../../shared/zip7';
import { type BoxesDraft, draftOf, PrizeBoxes, sendOf } from './PrizeBoxes';
import { AlertCard } from '../../AlertCard';
import { localParts } from '../../../shared/time';
import { clashingGames, clashWords, gameDayKey } from '../../../shared/tournamentClash';
import { api, ApiError, copyText, isIOS, storageGet, storageRemove, storageSet, useNow, VIEW_ONLY_MESSAGE } from '../../lib';
import { ConfirmDialog, GearIcon, Pickleball, Sheet, useToast } from '../../ui';
import { type DayLook, LevelList, MonthCalendar } from '../../tournament/parts';
import type { AdminCtx } from '../Admin';
import { TournamentDayCards } from './TournamentDay';
import { fitWords, nightPlan } from '../../../shared/tournamentPlan';
import { type ProjectedTeam, projectedTeams } from '../../../shared/projectedTeams';
import { totalLabel } from '../../../shared/tournamentSchedule';
import './tournament-admin.css';
import './tournament-card86.css';
import './tournament-card87.css';
import './night-card88.css';

const todayKeyOf = (nowIso: string, tz: string) => {
  const p = localParts(Date.parse(nowIso), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 && /view only/i.test(err.message) ? VIEW_ONLY_MESSAGE : err.message;
  return 'That did not work. Try again.';
}

/** One tap that saves: the server, then a fresh dashboard, then a toast. */
function useSave(ctx: AdminCtx) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Zip 85: `done` may read the server's answer (Didn't pay after the night says who now owes, never "Cleared").
  async function save(fn: () => Promise<unknown>, done: string | ((answer: unknown) => string)): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      const answer = await fn();
      await ctx.reload();
      toast(typeof done === 'function' ? done(answer) : done);
      return true;
    } catch (err) {
      toast(errText(err), 'error');
      if (err instanceof ApiError && err.status === 409) void ctx.reload();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, save };
}

const statusLine = (t: AdminTournamentView) =>
  t.status === 'canceled'
    ? 'Canceled'
    : t.status === 'tickets' && t.finalDate
      ? `${dayLong(t.finalDate)} · ${ticketWords(ticketCount(t))}`
      : t.status === 'date_picked' && t.finalDate
        ? `${dayLong(t.finalDate)} · ${t.signups.length} signed up`
        : t.status === 'rescheduled'
          ? `Rescheduled · ${t.signups.length} signed up${heldOf(t) ? ` · ${heldOf(t)} ${heldOf(t) === 1 ? 'ticket' : 'tickets'} held` : ''}`
          : `Sign-up open · ${t.signups.length} signed up`;

/** Zip 56: the tickets in a spot (Who's in), in the order they were taken. */
const lockedOf = (t: AdminTournamentView) => (t.tickets ?? []).filter((k) => k.place === 'spot' && !k.out);
/** Zip 56: the waitlist, in the order they joined it. */
const lineOf = (t: AdminTournamentView) => (t.tickets ?? []).filter((k) => k.place === 'line' && !k.out);
/** Zip 56: I paid taps waiting for the organizer's answer. */
// Zip 85: a ticket marked Didn't pay after the night started is a debt (Money's Tournament tickets card), not an I paid waiting.
const claimsOf = (t: AdminTournamentView) => (t.tickets ?? []).filter((k) => k.claimCents > 0 && !isOwedClaim(k));
/** Zip 56: tickets holding money or a spot (a Reschedule keeps them). */
const heldOf = (t: AdminTournamentView) => (t.tickets ?? []).filter((k) => !k.out && (k.place === 'spot' || k.creditCents + k.paidCents + k.claimCents > 0)).length;
/** Zip 56: paid in full with money that counts (credit and confirmed cash). */
const ticketIsPaid = (k: AdminTicketView) => k.creditCents + k.paidCents >= k.priceCents;
/** Zip 56: Pay by has passed (the moment the evens rule is checked). */
const payByPassed = (t: AdminTournamentView, nowIso: string) => t.status === 'tickets' && !!t.payBy && Date.parse(nowIso) >= Date.parse(t.payBy);
/** Zip 56: the plain warning on the card: an odd number locked in at the Pay by time (nobody is taken off by the site). */
// Zip 64: an odd number after Pay by now plays Americano by itself (the style rules), so the evens warning shows only where no rule covers it
// (a style still on Locked doubles with an odd count, e.g. a screen that has not caught up yet).
const evensOf = (t: AdminTournamentView, nowIso: string) =>
  payByPassed(t, nowIso) && t.format !== 'americano' && lockedOf(t).length % 2 === 1 ? evensWarning(lockedOf(t).length) : null;

// ---------------------------------------------------------------------------------------------------------------------
// Where the organizer finds it: Settings > Schedule, and a card on Home while one is open.
// ---------------------------------------------------------------------------------------------------------------------

/** Settings > Schedule: "Create tournament" (none open) or the open tournament's row. */
export function TournamentScheduleRow({ ctx }: { ctx: AdminCtx }) {
  const [open, setOpen] = useState<null | 'create' | 'page'>(null);
  const toast = useToast();
  if (ctx.d.tournaments !== true) return null;
  const t = ctx.d.tournament ?? null;
  // Zip 56: a canceled one (its Canceled card still shows for a few days) never blocks a new one.
  const current = t && t.status !== 'canceled' ? t : null;
  return (
    <div className="set-row-wrap" data-row="tournament">
      {/* Always here. One tournament at a time: with one open, a tap says so (the open one has its own row below). */}
      <button type="button" className="set-row tm-set-row" onClick={() => (current ? toast('Finish or cancel the current one first.') : setOpen('create'))} data-tm-schedule-row>
        <span className="set-label">
          <span className="set-name">Create tournament</span>
          <span className="set-hint">Doubles, once a year</span>
        </span>
      </button>
      {t && (
        <button type="button" className="set-row tm-set-row" onClick={() => setOpen('page')} data-tm-open-row>
          <span className="set-label">
            <span className="set-name">{t.name}</span>
            <span className="set-hint">{statusLine(t)}</span>
          </span>
        </button>
      )}
      <CreateSheet ctx={ctx} open={open === 'create'} onClose={() => setOpen(null)} />
      {/* Zip 87 round 2: the tournament's row opens its settings (the gear's sheet); a canceled one, its Players (who got credit back). */}
      {t && (t.status === 'canceled' ? <PlayersSheet ctx={ctx} t={t} open={open === 'page'} onClose={() => setOpen(null)} /> : <SettingsSheet ctx={ctx} t={t} open={open === 'page'} onClose={() => setOpen(null)} />)}
    </div>
  );
}

/**
 * Home: the open tournament. Before the date is picked (and after a Reschedule): piece 1's card with Pick date and Edit. Zip 56: from the date
 * picked on, the card of picture 29 (the facts, the stage's one button, Cancel or reschedule), with an I paid card above it for each payment
 * waiting for an answer and, while tickets are open, the "Tickets: 6 of 8 locked in" card.
 */
export function TournamentHomeCard({ ctx }: { ctx: AdminCtx }) {
  const t = ctx.d.tournaments === true ? (ctx.d.tournament ?? null) : null;
  if (!t) return null;
  const claims = claimsOf(t);
  return (
    <>
      {/* Zip 64: the style cards (an odd switch; switch back?) and the venue reminder after Finalize, first. */}
      {/* Zip 57: the plan check when tickets close, Draft teams, the published teams and game night. */}
      {t.status === 'tickets' && <TournamentDayCards ctx={ctx} t={t} />}
      {t.oddSwitch && <OddSwitchCard ctx={ctx} t={t} k={t.oddSwitch.key} />}
      {t.switchBack && <SwitchBackCard ctx={ctx} t={t} k={t.switchBack.key} />}
      <VenueAlertCard t={t} />
      <ClashCard ctx={ctx} t={t} />
      {claims.map((k) => (
        <TicketClaimCard key={k.playerId} ctx={ctx} t={t} k={k} />
      ))}
      {/* Zip 66b: the tickets card (Paid, Not paid yet, Remind all unpaid) and the count card are folded into the card below. */}
      {/* Zip 66: one card for every stage, starting closed (mocks 01 and 02). Zip 88: not on game night while the night card (or the End
          card) is up: that one card is enough. */}
      {!nightCardUp(ctx, t) && <HomeCard ctx={ctx} t={t} />}
    </>
  );
}

/** Zip 88: game night's one card (or the End card after the last game) is on Home: the night has its games and it is on. */
function nightCardUp(ctx: AdminCtx, t: AdminTournamentView): boolean {
  if (t.status !== 'tickets' || !nightOnAt(t, ctx.d.now, ctx.d.group.timezone)) return false;
  return !!t.end || (t.format === 'americano' ? !!t.rounds : t.day?.phase === 'published');
}

/** Zip 66: "6 players · 1 court · 2.5 hrs" (the card's Plan row). */
// Zip 70: the Plan's expected players (the saved Expect number, else the site's suggestion), not the plan size.
const planShort = (t: AdminTournamentView) => `${t.expected ?? t.size} players · ${t.courts} ${t.courts === 1 ? 'court' : 'courts'} · ${t.minutes / 60} ${t.minutes === 60 ? 'hr' : 'hrs'}`;

/** Zip 70 (pictures 1 and 3): "+$6" in green when the organizer makes money, "$30" in red (no minus) when it costs them. */
function MoneyValue({ cents, data }: { cents: number; data?: string }) {
  return (
    <b className={cents >= 0 ? 'tm-money-up' : 'tm-money-down'} {...(data ? { [data]: cents >= 0 ? 'up' : 'down' } : {})}>
      {cents >= 0 ? `+${formatPrice(cents)}` : formatPrice(-cents)}
    </b>
  );
}

/** Zip 70 (pictures 2, 4 and 7): "Courts $96 · Tickets $126 · You +$30" (or "Your cost $30" in red), from THE money line. */
function MoneyLineText({ m }: { m: MoneyLine & { afterFullCents: number } }) {
  // Zip 82 (the price check): what is left after the FULL prizes (shared/tournamentMoney.ts, the same tiers as Edit awards' suggestion).
  // Zip 85: worked out once, with the money line, by the style the count really plays (planMoney).
  const after = m.afterFullCents;
  return (
    <p className="tm-money-line" data-tm-money-line={`${m.courtCents}/${m.ticketsCents}/${m.youCents}`}>
      {/* Each word stays with its amount on a narrow phone. */}
      <span className="tm-ml-pair">
        Courts <b>{formatPrice(m.courtCents)}</b>
      </span>{' '}
      · <span className="tm-ml-pair">
        Tickets <b>{formatPrice(m.ticketsCents)}</b>
      </span>{' '}
      · <span className="tm-ml-pair">
        {m.youCents >= 0 ? 'You' : 'Your cost'} <MoneyValue cents={m.youCents} />
      </span>{' '}
      · <span className={after >= 0 ? 'tm-ml-pair tm-ml-after' : 'tm-ml-pair tm-ml-after tm-ml-short'} data-tm-after-full={after}>
        {afterFullWords(after)}
      </span>
    </p>
  );
}

/**
 * Zip 81: with Booking hours on, a tournament's night must sit inside the venue hours of its date (special hours too), like a game. The words
 * the server would refuse with, or null when it fits (or the hours are not known). The server checks it too.
 */
function venueHoursProblem(ctx: AdminCtx, date: string | null, start: number, end: number): string | null {
  const config = ctx.d.group.venueHours;
  if (ctx.d.bookingHours !== true || !config || !date) return null;
  const r = checkDay(dayRule(config, date), start, end);
  return r.ok ? null : r.message;
}


/** Zip 66: the Style row ("Players vote" while the vote is open). */
const styleWords = (t: AdminTournamentView) => (t.formatPending ? 'Players vote' : formatName(t.format));





// ---------------------------------------------------------------------------------------------------------------------
// Zip 86 (🎾86.clean admin, pictures 5, 6 and 7): the tournament card on the organizer's Home, cleaner. The folded head (the name, a gray
// status line, the pill), then open: the 4 steps, the When block with Change, four big buttons that each say what is behind them, and Cancel or
// reschedule. Nothing hides behind a row tap any more: Votes, Not signed up, Time, Plan and Not paid yet live in the buttons and the sheets.
// Game night and after keep the 🎾82 screens (the night cards above the card) and the card's facts.
// ---------------------------------------------------------------------------------------------------------------------

/** "+$42" / "−$30" (a real minus sign). */
const signed = (cents: number) => (cents >= 0 ? `+${formatPrice(cents)}` : `−${formatPrice(-cents)}`);

/** Zip 87 (picture 1): the 4 steps as underlined words: done green with a ✓ and a soft green line, the current one ink on a solid green line,
 *  later ones gray. Flush under the card's head. */
function Steps({ step }: { step: 0 | 1 | 2 | 3 }) {
  return (
    <ol className="tm86-steps tm87-steps" aria-label={`Step ${step + 1} of 4: ${STEPS[step]}`} data-tm-steps={step}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < step ? 'tm87-step tm87-done' : i === step ? 'tm87-step tm87-now' : 'tm87-step'} aria-current={i === step ? 'step' : undefined}>
          {i < step && (
            <svg className="tm87-tick" viewBox="0 0 12 12" aria-hidden="true">
              <path d="m2.5 6.3 2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className="tm87-step-word">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Zip 86: one of the four big buttons: the name, and a short second line saying what is behind it. Zip 87: its look follows the state (tone),
 *  and the second line is never bold (subTone colors it). */
function BigButton({
  title,
  sub,
  tone = 'plain',
  subTone = 'gray',
  onClick,
  href,
  data,
}: {
  title: string;
  sub: string;
  tone?: ButtonTone;
  subTone?: SubTone;
  onClick?: () => void;
  href?: string;
  data: string;
}) {
  const quiet = tone === 'quiet';
  const cls = `tm86-btn tm87-${tone}`;
  const inner = (
    <>
      <span className="tm86-btn-title">{title}</span>
      <span className={`tm86-btn-sub tm87-sub-${subTone}`}>{sub}</span>
    </>
  );
  if (href && !quiet) {
    return (
      <a className={cls} href={href} {...{ [data]: tone }}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={quiet ? undefined : onClick} aria-disabled={quiet || undefined} {...{ [data]: tone }}>
      {inner}
    </button>
  );
}

/** Zip 86: "Votes: Locked doubles 3 · Americano 0 · Either 7" (one small gray line while the style is decided by vote). */
const votesLine = (v: NonNullable<AdminTournamentView['votes']>) => (
  <p className="tm86-votes" data-tm-vote-counts>
    Votes: <span className="tm-ml-pair">Locked doubles {v.locked}</span> · <span className="tm-ml-pair">Americano {v.americano}</span> · <span className="tm-ml-pair">Either {v.either}</span>
  </p>
);

function HomeCard({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<null | 'change' | 'money' | 'prizes'>(null);
  // Zip 88: Start now's "Are you sure?" and its call in flight.
  const [askStart, setAskStart] = useState(false);
  const [starting, setStarting] = useState(false);
  // Zip 87 round 2: the Players sheet (Tickets renamed) and Pick the date; no tournament page or Edit page any more.
  const [page, setPage] = useState<null | 'dates' | 'players'>(null);
  const toast = useToast();
  // Zip 81: the Home card "the venue closes at noon" asks to open Time (Change time): the card opens with the Change sheet showing.
  const cardRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const openTime = () => {
      setOpen(true);
      setSheet('change');
      requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    };
    window.addEventListener(OPEN_TOURNAMENT_TIME, openTime);
    return () => window.removeEventListener(OPEN_TOURNAMENT_TIME, openTime);
  }, []);
  const tz = ctx.d.group.timezone;
  const canceled = t.status === 'canceled';
  // Zip 87 (pictures 7 and 8): Game night is the step from the tournament's day on; the card keeps its date row and four buttons until the
  // night itself starts (then 🎾88's night card takes over and the steps hide).
  const gameDay = isGameDay(t, ctx.d.now, tz);
  const step = stepOf(t, gameDay);
  const ticketsStage = t.status === 'date_picked' || t.status === 'tickets' || canceled;
  const today = todayKeyOf(ctx.d.now, tz);
  // Every offered date has passed and none is picked: players do not see the card any more (server/tournament.ts), so say it here.
  const datesPassed = !ticketsStage && !t.finalDate && !t.offeredDates.some((d) => d >= today);
  const ns = t.notSignedUp && t.notSignedUp.players.length > 0 ? t.notSignedUp : null;
  const evens = evensOf(t, ctx.d.now);
  const bodyId = `tm-hc-body-${t.id}`;
  // Zip 87: who still has to pay (before Pay by: unpaid; after it: past due), for the pill, the status line and Remind.
  const due = dueOf(t);
  // The pill (picture A3): "8 signed up" before tickets; once they are open "3 unpaid" (amber) while anyone has not paid, else "7 locked in".
  const tp = pillOf(t);
  const pill = canceled
    ? { words: 'Canceled', cls: 'tm-chip tm-hc-pill' }
    : t.status === 'tickets'
      ? { words: tp.words, cls: tp.unpaid ? 'tm-chip tm-chip-unpaid tm-hc-pill' : 'tm-chip tm-chip-ok tm-hc-pill' }
      : { words: `${t.signups.length} signed up`, cls: 'tm-chip tm-chip-ok tm-hc-pill' };
  const before = step === 0 || step === 1 || (step === 2 && !t.closed);
  const m = t.money;
  const count = ticketCount(t);
  async function copyMissing() {
    if (!ns) return;
    const close = ns.closeAt ?? signupCloseDefault(Date.parse(ctx.d.now), tz);
    const ok = await copyText(signupReminderText(ns.players.map((p) => p.name), t.name, close, tz, siteAddress(ctx.d.group.playerLink)));
    toast(ok ? `Copied. Paste it to ${ns.players.length === 1 ? ns.players[0].name : `the ${ns.players.length}`}.` : 'Could not copy. Try again.', ok ? undefined : 'error');
  }
  // Zip 87: Teams / Rounds open the night's own card above this one (the team draft, or the rounds).
  function openDay() {
    const el = document.querySelector<HTMLElement>('[data-tm-draft-prompt], [data-tm-draft-card], [data-tm-fix], [data-tm-published], [data-tm-am-rounds]');
    if (!el) {
      toast(t.format === 'americano' ? 'The site makes the rounds. They show here once the style is set.' : 'The draft opens once tickets close.');
      return;
    }
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }
  const money = m ? <BigButton title="Money" sub={`${signed(m.youCents)} if all pay`} subTone={m.youCents >= 0 ? 'green' : 'red'} onClick={() => setSheet('money')} data="data-tm86-money" /> : null;
  // The gear: Change (time, courts, players expected) and, while it can still be called off, Plans changed? (Reschedule, Cancel).
  // Zip 87 round 2: the gear is every setting, so it is always there before the night (nothing to change on a canceled one).
  const gear = !canceled && !t.over;
  const tileIso = t.finalDate ? new Date(startMsOf(t.finalDate, t.start, tz)).toISOString() : null;
  const tile = tileIso ? (ctx.d.tonightGlow === true ? (tileDay(tileIso, tz, Date.parse(ctx.d.now), !canceled) ?? undefined) : undefined) : undefined;
  return (
    <section ref={cardRef} className={open ? 'tm-hc tm86 tm87 tm-hc-open' : 'tm-hc tm86 tm87'} aria-label={`${t.name}, ${formatName(t.format)} tournament`} data-tm-home={ticketsStage ? t.status : true} data-tm-open={open}>
      <h2 className={t.startNow ? 'tm-hc-head tm88-head' : 'tm-hc-head'}>
        <button type="button" className="tm-hc-top" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((o) => !o)} data-tm-home-toggle>
          <span className="tm-hc-ball" aria-hidden="true">
            <Pickleball />
          </span>
          <span className="tm86-head-words">
            <span className="tm-hc-name">{t.name}</span>
            <span className="tm86-status" data-tm86-status>
              {statusWords(t, ctx.d.now, tz, t.status === 'tickets' ? due.length : undefined)}
            </span>
          </span>
          {!t.startNow && (
            <span className={pill.cls} data-tm-stage data-tickets-card={t.status === 'tickets' ? `${count.locked}/${count.total}` : undefined}>
              {pill.words}
            </span>
          )}
        </button>
        {/* Zip 88: game day, teams and courts set: the pill is a solid green Start now (44 px). Its own button, outside the fold toggle. */}
        {t.startNow && (
          <button type="button" className="tm88-start" onClick={() => setAskStart(true)} aria-expanded={askStart} data-tm88-start>
            Start now
          </button>
        )}
      </h2>
      {t.startNow && askStart && (
        <div className="tm88-ask" role="group" aria-label="Start the night now?" data-tm88-ask>
          <p className="tm88-ask-q">
            <b>Start the night now?</b> Are you sure? Games go on the courts and players can enter scores. The end time and the money stay.
          </p>
          <div className="tm88-ask-btns">
            <button
              type="button"
              className="tm88-ask-btn"
              disabled={starting}
              onClick={async () => {
                setStarting(true);
                try {
                  await api('POST', `/api/admin/tournament/${t.id}/games`, { action: 'start' });
                  await ctx.reload();
                  toast(`${t.name} started`);
                  setAskStart(false);
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
                  void ctx.reload();
                } finally {
                  setStarting(false);
                }
              }}
              data-tm88-yes
            >
              Start now
            </button>
            <button type="button" className="tm88-ask-btn" disabled={starting} onClick={() => setAskStart(false)} data-tm88-no>
              Not yet
            </button>
          </div>
        </div>
      )}
      {/* Review: the card's warnings show on the closed line too (they used to be on the always-open card). */}
      {(datesPassed || evens) && (
        <div className="tm-hc-notes">
          {datesPassed && (
            <p className="tm-home-note" data-tm-home-note>
              Dates have passed. Add dates.
            </p>
          )}
          {evens && (
            <p className="tm-evens" role="status" data-tm-evens>
              {evens}
            </p>
          )}
        </div>
      )}
      {open && (
        <div className={before ? 'tm-hc-body tm86-body tm87-body' : 'tm-hc-body tm86-body'} id={bodyId} data-tm-home-body>
          {step !== null && (before || step === 3) && <Steps step={step} />}
          {before ? (
            <>
              {/* Zip 87 (picture 1): the date tile (TONIGHT / TOMORROW like the game cards), the time bold and the plan line gray, the round gear. */}
              <div className="tm86-when tm87-when" data-tm86-when>
                {tileIso && (
                  <span className="tm87-tile" data-tm87-tile={tile ?? 'date'}>
                    <DateTile iso={tileIso} tz={tz} day={tile} />
                  </span>
                )}
                <div className="tm86-when-words">
                  <p className="tm86-when-main" data-tm-row-time>
                    {t.finalDate ? (t.startSet ? planRange(t.start, t.minutes) : `About ${startLabel(t.start)}`) : `${t.offeredDates.length} ${t.offeredDates.length === 1 ? 'date' : 'dates'} offered`}
                  </p>
                  <p className="tm86-when-sub" data-tm-home-plan>
                    {t.courts} {t.courts === 1 ? 'court' : 'courts'} · {styleShort(t)} · {formatPrice(t.ticketCents)}
                  </p>
                  {t.votes && (t.formatPending || step === 0) && votesLine(t.votes)}
                </div>
                {gear && (
                  <button type="button" className="tm87-gear" aria-label={`Settings for ${t.name}`} onClick={() => setSheet('change')} data-tm86-change>
                    <GearIcon />
                  </button>
                )}
              </div>
              <div className="tm86-grid">
                {step === 1 || step === 2 ? (
                  cardButtons(t, ctx.d.now, tz).map((b) =>
                    b.key === 'tickets' ? (
                      <BigButton key={b.key} title={b.title} sub={b.sub} tone={b.tone} subTone={b.subTone} onClick={() => setPage('players')} data="data-tm-tickets" />
                    ) : b.key === 'remind' ? (
                      b.tone === 'quiet' ? (
                        <BigButton key={b.key} title={b.title} sub={b.sub} tone="quiet" subTone="gray" data="data-tm86-remind" />
                      ) : (
                        <RemindButton key={b.key} ctx={ctx} t={t} unpaid={due} sub={b.sub} tone={b.tone} />
                      )
                    ) : b.key === 'teams' || b.key === 'rounds' ? (
                      <BigButton key={b.key} title={b.title} sub={b.sub} tone={b.tone} subTone={b.subTone} onClick={openDay} data={`data-tm87-${b.key}`} />
                    ) : b.key === 'prizes' ? (
                      <BigButton key={b.key} title={b.title} sub={b.sub} tone={b.tone} subTone={b.subTone} onClick={() => setSheet('prizes')} data="data-tm86-prizes" />
                    ) : (
                      <BigButton key={b.key} title={b.title} sub={b.sub} tone={b.tone} subTone={b.subTone} onClick={() => setSheet('money')} data="data-tm86-money" />
                    ),
                  )
                ) : (
                  <>
                    {/* Sign up: today's actions in the same frame (Who's signed up, Remind not signed up, Dates), then Money. */}
                    <BigButton title="Who’s signed up" sub={`${t.signups.length} signed up`} tone="solid" subTone="white" onClick={() => setPage('players')} data="data-tm-open-edit" />
                    {ns ? (
                      <BigButton title="Remind" sub={`${ns.players.length} not signed up`} subTone="amber" onClick={() => void copyMissing()} data="data-tm-missing-copy" />
                    ) : (
                      <BigButton title="Remind" sub="Everyone signed up" tone="quiet" data="data-tm86-remind" />
                    )}
                    <BigButton title="Dates" sub={t.finalDate ? dateOnly(t) : 'Pick the date'} onClick={() => setPage('dates')} data="data-tm-open-dates" />
                    {money ?? <BigButton title="Prizes" sub="Not set yet" onClick={() => setSheet('prizes')} data="data-tm86-prizes" />}
                  </>
                )}
              </div>
              {/* Review fix: the "Not signed up" copy text stays reachable while tickets are open (the server still sends the list). */}
              {step === 1 && ns && (
                <button type="button" className="tm-quiet-link tm86-ns" onClick={() => void copyMissing()} data-tm-missing-copy>
                  Copy reminder for {ns.players.length} not signed up
                </button>
              )}
            </>
          ) : (
            <NightBody ctx={ctx} t={t} onTickets={() => setPage('players')} />
          )}
        </div>
      )}
      <PlayersSheet ctx={ctx} t={t} open={page === 'players'} onClose={() => setPage(null)} />
      <DatesSheet ctx={ctx} t={t} open={page === 'dates'} onClose={() => setPage(null)} />
      <SettingsSheet ctx={ctx} t={t} open={sheet === 'change'} onClose={() => setSheet((cur) => (cur === 'change' ? null : cur))} />
      <Sheet calmFocus open={sheet === 'money'} title="Money" onClose={() => setSheet((cur) => (cur === 'money' ? null : cur))} className="tm86-sheet">
        {sheet === 'money' && <MoneyBody t={t} onPrizes={() => setSheet('prizes')} />}
      </Sheet>
      <Sheet calmFocus open={sheet === 'prizes'} title="Prizes" onClose={() => setSheet((cur) => (cur === 'prizes' ? null : cur))} className="tm86-sheet">
        {sheet === 'prizes' && <PrizesBody ctx={ctx} t={t} onDone={() => setSheet(null)} />}
      </Sheet>
    </section>
  );
}

/**
 * Zip 86: Remind ("4 haven't paid", amber words) is today's "Remind all unpaid" (Zip 63, mock 14): it opens Messages with every unpaid person's
 * number and a ready text; the organizer taps Send. The site never sends a text. A missing number is said in a toast after the tap.
 */
function RemindButton({ ctx, t, unpaid, sub, tone }: { ctx: AdminCtx; t: AdminTournamentView; unpaid: TournamentSignupView[]; sub: string; tone: ButtonTone }) {
  const now = useNow(60_000);
  const toast = useToast();
  const tz = ctx.d.group.timezone;
  const phoneOf = new Map(ctx.d.players.map((p) => [p.id, p.phone]));
  const phones = unpaid.map((s) => phoneOf.get(s.playerId)).filter((p): p is string => !!p);
  const missing = unpaid.filter((s) => !phoneOf.get(s.playerId)).map((s) => s.name);
  const body = tournamentRemindText(t.name, t.payBy!, t.finalDate!, now, tz, siteAddress(ctx.d.group.playerLink));
  return (
    <a
      className={`tm86-btn tm87-${tone}`}
      href={smsHref(phones.length ? phones : null, body, isIOS)}
      onClick={() => {
        if (missing.length) toast(`No number for ${missing.join(', ')}`);
      }}
      aria-label={`Remind: ${unpaid.map((p) => p.name).join(', ')} ${unpaid.length === 1 ? 'hasn’t' : 'haven’t'} paid. Opens Messages.`}
      data-tm-remind-btn={tone}
      data-tm-remind={unpaid.length}
    >
      <span className="tm86-btn-title">Remind</span>
      <span className={`tm86-btn-sub tm87-sub-${tone === 'red' ? 'red' : 'amber'}`} data-tm-row-unpaid>
        {sub}
      </span>
    </a>
  );
}

/** Zip 86: game night and after: the card's facts as before (no tap rows), Tickets, and Cancel or reschedule until the night is over. */
function NightBody({ ctx, t, onTickets }: { ctx: AdminCtx; t: AdminTournamentView; onTickets: () => void }) {
  const tz = ctx.d.group.timezone;
  const canceled = t.status === 'canceled';
  const line = lineOf(t);
  return (
    <>
      <div className="tm-rows tm-hc-rows">
        {!canceled && (
          <div className="tm-row">
            <span>Style</span>
            <b className="tm-hc-val" data-tm-home-format={t.formatPending ? 'vote' : t.format}>
              {styleWords(t)}
            </b>
          </div>
        )}
        <div className="tm-row">
          <span>Date</span>
          <b className="tm-hc-val tm-hc-fit" data-tm-row="date">
            {t.startSet && t.finalDate ? dateOnly(t) : dateRow(t)}
          </b>
        </div>
        {t.startSet && t.finalDate && (
          <div className="tm-row">
            <span>Time</span>
            <b className="tm-hc-val tm-hc-fit" data-tm-row-time>
              {planRange(t.start, t.minutes)}
            </b>
          </div>
        )}
        {!canceled && (
          <div className="tm-row">
            <span>Plan</span>
            <b className="tm-hc-val tm-hc-fit" data-tm-row="plan" data-tm-home-plan>
              {planShort(t)}
            </b>
          </div>
        )}
        {t.status === 'tickets' && (
          <>
            <div className="tm-row">
              <span>Locked in</span>
              <b data-tm-row="locked">
                {ticketCount(t).locked} of {ticketCount(t).total}
              </b>
            </div>
            {line.length > 0 && (
              <div className="tm-row">
                <span>Standby</span>
                <b data-tm-row="line">
                  {line.length} ({line.filter(ticketIsPaid).length} paid)
                </b>
              </div>
            )}
          </>
        )}
        {!canceled && (
          <div className="tm-row">
            <span>Ticket</span>
            <b className="tm-hc-val tm-hc-fit" data-tm-row="ticket">
              {formatPrice(t.ticketCents)}
              {t.payBy ? ` · pay by ${payByLabel(t.payBy, tz, t.finalDate)}` : ''}
            </b>
          </div>
        )}
      </div>
      {canceled ? (
        <>
          <p className="tm-card-note" data-tm-canceled-note>
            Every paid ticket came back as credit.
          </p>
          <button type="button" className="btn block secondary tm-tix-go" onClick={onTickets} data-tm-tickets>
            Players
          </button>
          <HideCanceled ctx={ctx} t={t} />
        </>
      ) : (
        <>
          {t.status === 'tickets' && (
            <button type="button" className="btn block big tm-tix-go" onClick={onTickets} data-tm-tickets>
              Players
            </button>
          )}
          {/* A night that has been played is never refunded or moved (the server refuses both), so the taps are not offered. */}
          {!t.over && t.status === 'tickets' && <CancelOrReschedule ctx={ctx} t={t} />}
        </>
      )}
    </>
  );
}

/**
 * Zip 87 round 2 (Alex): the gear is ALL the tournament's settings, one sheet, one Save. Date, Time (before the date is final: "7 to 7:30 PM, by
 * players" and "10 PM close"), Courts, Players you expect, Courts cost (Zip 86's Change), then Style, Ticket price, Pay by, Who can see it, Name
 * and, during sign-up, the dates offered (the old Edit page, now gone). "Plans changed?" Reschedule | Cancel last, then Save. Save sends only what
 * changed, with today's calls: PUT /api/admin/tournament/:id (name, dates, price, style, who; the prize boxes as they are), PUT .../time,
 * PUT .../plan, PUT .../pay-by. Prizes live only in Prizes; the money only in Money.
 */
export function SettingsSheet({ ctx, t, open, onClose }: { ctx: AdminCtx; t: AdminTournamentView; open: boolean; onClose: () => void }) {
  const [dates, setDates] = useState(false);
  const canceled = t.status === 'canceled';
  return (
    <>
      <Sheet calmFocus open={open} title={`Change ${t.name}`} onClose={onClose} className="tm86-sheet tm87-change-sheet">
        {open && (
          <ChangeBody
            ctx={ctx}
            t={t}
            plans={!canceled && !t.over}
            onDone={onClose}
            onDates={() => {
              onClose();
              setDates(true);
            }}
          />
        )}
      </Sheet>
      <DatesSheet ctx={ctx} t={t} open={dates} onClose={() => setDates(false)} />
    </>
  );
}

function ChangeBody({ ctx, t, plans, onDone, onDates }: { ctx: AdminCtx; t: AdminTournamentView; plans: boolean; onDone: () => void; onDates: () => void }) {
  const { busy, save } = useSave(ctx);
  const tz = ctx.d.group.timezone;
  const today = todayKeyOf(ctx.d.now, tz);
  const [ask, setAsk] = useState(false);
  // Zip 87 (picture 2): Plans changed? Reschedule or Cancel, each "Are you sure?" first, then today's reschedule or cancel.
  const [sure, setSure] = useState<null | 'reschedule' | 'cancel'>(null);
  const back = (t.tickets ?? []).filter((k) => !k.out && k.claimCents === 0 && k.creditCents + k.paidCents > 0);
  const backCents = back.reduce((n, k) => n + k.creditCents + k.paidCents, 0);
  const canReschedule = t.status === 'date_picked' || t.status === 'tickets';
  // Time and plan (Zip 86's Change).
  const timeOn = !!t.timeOpen && !!t.startSet && !!t.finalDate;
  const planOn = !!t.planOpen;
  const [start, setStart] = useState(t.start);
  const [end, setEnd] = useState(t.start + t.minutes);
  const low = Math.max(EXPECT_MIN, t.lockedIn ?? 0);
  const [n, setN] = useState(Math.min(EXPECT_MAX, Math.max(low, t.expected ?? t.size)));
  const [courts, setCourts] = useState<1 | 2>(t.courts === 1 ? 1 : 2);
  const starts = PLAY_STARTS.includes(start) ? PLAY_STARTS : [...PLAY_STARTS, start].sort((a, b) => a - b);
  const ends = playEnds(start, end);
  const minutes = timeOn ? end - start : t.minutes;
  const outside = timeOn ? venueHoursProblem(ctx, t.finalDate, start, end) : null;
  // The old Edit page's settings.
  const autoNow = !!t.finalDate && (t.formatSource === 'vote' || t.formatSource === 'tie') && !t.styleDecided;
  const startFormat: FormatChoice = t.formatPending || autoNow ? 'vote' : t.format;
  const [format, setFormat] = useState<FormatChoice>(startFormat);
  const canVote = !t.finalDate || t.formatPending === true || t.formatSource === 'vote' || t.formatSource === 'tie';
  const autoLabel = !!t.finalDate && t.formatPending !== true;
  const formatLocked = t.formatLocked === true;
  const sold = t.settingsLocked === true;
  const [ticket, setTicket] = useState<number | null>(t.ticketCents);
  const [visibility, setVisibility] = useState<Visibility>(t.visibility);
  const [name, setName] = useState(t.name);
  const offerOn = t.status === 'signup' || t.status === 'rescheduled' || t.status === 'date_picked';
  const [offer, setOffer] = useState<string[]>(t.offeredDates);
  const [offerOpen, setOfferOpen] = useState(false);
  const offerMonths = useMemo(() => {
    const last = [monthStartPlus(today, CREATE_MONTHS - 1), ...offer].sort().slice(-1)[0];
    return monthsBetween([today, ...offer].sort()[0], last);
  }, [today, offer]);
  const wasOffered = new Set(t.offeredDates);
  const offerLook = (d: string): DayLook => (offer.includes(d) ? 'on' : d < today && !wasOffered.has(d) ? 'past' : 'off');
  const payOn = t.status === 'tickets' && !!t.payBy && !t.closed;
  const payStart = t.payBy ? payByParts(t.payBy, tz) : { day: t.finalDate ?? '', minutes: 19 * 60 };
  const [payDay, setPayDay] = useState(payStart.day);
  const [payMin, setPayMin] = useState(payStart.minutes);
  const payDays = payOn && t.finalDate ? payByDays(t.finalDate, tz, Date.parse(ctx.d.now)) : [];
  const payTimes = PAY_TIMES.includes(payMin) ? PAY_TIMES : [...PAY_TIMES, payMin].sort((a, b) => a - b);
  // Zip 92: before tickets close the fit line names the style the count will play (an odd count or 12 is Americano).
  const fitStyle = format === 'americano' ? 'americano' : t.format;
  const fit = fitWords(nightPlan(n, courts, minutes, t.closed || t.styleDecided ? fitStyle : styleAtClose(fitStyle, n)), timeOn ? start : t.start);
  const timeChanged = timeOn && (start !== t.start || end !== t.start + t.minutes);
  const planChanged = planOn && (n !== (t.expected ?? t.size) || courts !== t.courts);
  const payChanged = payOn && (payDay !== payStart.day || payMin !== payStart.minutes);
  const settingsChanged =
    name.trim() !== t.name || ticket !== t.ticketCents || visibility !== t.visibility || format !== startFormat || offer.join() !== t.offeredDates.join();
  const problem = !name.trim()
    ? 'Type a name.'
    : Array.from(name.trim()).length > NAME_MAX
      ? `Keep the name to ${NAME_MAX} letters.`
      : offer.length === 0
        ? 'Pick at least one date to offer.'
        : offer.length > MAX_DATES
          ? `Offer at most ${MAX_DATES} dates.`
          : ticket === null
            ? 'Type a ticket price.'
            : null;
  const changed = timeChanged || planChanged || payChanged || settingsChanged;
  async function go() {
    if (problem) return;
    // The prize boxes travel as they are (prizes live only in Prizes): saved boxes as saved, else the columns unchanged.
    const boxes = prizesOf(t);
    const body = {
      name: name.trim(),
      dates: offer,
      ticketCents: ticket,
      creditCents: t.championCreditCents,
      secondCreditCents: t.secondCreditCents,
      visibility,
      ...(format !== startFormat ? { format } : {}),
      ...(boxes.saved ? { prizes: { doubles: boxes.doubles, americano: boxes.americano } } : {}),
    };
    // Review fixes: a Pay by moved earlier goes before a time change (the server checks each against the one saved now); each call is told
    // apart, so a failure says what was already saved, the screen reads the server again, and the venue card still follows a saved time.
    const payIso = payChanged ? payByAt(payDay, payMin, tz) : null;
    const payFirst = !!payIso && !!t.payBy && Date.parse(payIso) < Date.parse(t.payBy);
    const steps: { what: string; run: () => Promise<unknown> }[] = [];
    if (settingsChanged) steps.push({ what: 'settings', run: () => api('PUT', `/api/admin/tournament/${t.id}`, body) });
    if (payIso && payFirst) steps.push({ what: 'Pay by', run: () => api('PUT', `/api/admin/tournament/${t.id}/pay-by`, { payBy: payIso }) });
    if (timeChanged) steps.push({ what: 'time', run: () => api('PUT', `/api/admin/tournament/${t.id}/time`, { start, minutes: end - start }) });
    if (planChanged) steps.push({ what: 'courts and players', run: () => api('PUT', `/api/admin/tournament/${t.id}/plan`, { expected: n, courts }) });
    if (payIso && !payFirst) steps.push({ what: 'Pay by', run: () => api('PUT', `/api/admin/tournament/${t.id}/pay-by`, { payBy: payIso }) });
    const done: string[] = [];
    const ok = await save(async () => {
      for (const step of steps) {
        try {
          await step.run();
          done.push(step.what);
        } catch (err) {
          if (!done.length) throw err;
          void ctx.reload().catch(() => {});
          const why = err instanceof ApiError ? err.message : 'That did not save.';
          throw new ApiError(err instanceof ApiError ? err.status : 400, 'partly_saved', `Saved the ${done.join(' and ')}. The ${step.what} did not save: ${why}`);
        }
      }
    }, 'Saved');
    // The venue card follows a new time or a new number of courts (once the date is finalized), when that part saved.
    const timeSaved = done.includes('time');
    const courtsSaved = done.includes('courts and players') && courts !== t.courts;
    if (t.finalDate && t.startSet && (timeSaved || courtsSaved)) venueAsk(t.id, t.finalDate, timeSaved ? start : t.start, timeSaved ? end - start : t.minutes);
    if (ok) onDone();
  }
  const dateWords = t.finalDate ? dateOnly(t) : 'Pick the date';
  return (
    <div className="tm86-change-body" data-tm86-change-sheet>
      <div className="tm86-field">
        <span className="tm86-label">Date</span>
        <button
          type="button"
          className="tm86-box"
          disabled={busy || t.status === 'canceled'}
          onClick={() => (t.finalDate && t.status === 'tickets' && !t.over ? setAsk(true) : onDates())}
          data-tm86-date
        >
          {dateWords}
        </button>
      </div>
      {t.startSet && t.finalDate ? (
        <div className="tm86-field">
          <span className="tm86-label">Time</span>
          {timeOn ? (
            <span className="tm86-times" role="group" aria-label="Time">
              <select
                className="tm86-box tm86-select"
                aria-label="Start"
                value={start}
                disabled={busy}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  // Keep the length when the start moves (never past midnight), as on Finalize.
                  setEnd(Math.min(next + (end - start), 24 * 60, next + 360));
                  setStart(next);
                }}
                data-tm-time-start
              >
                {starts.map((x) => (
                  <option key={x} value={x}>
                    {clockShort(timeWords(x))}
                  </option>
                ))}
              </select>
              <span className="tm86-to">to</span>
              <select className="tm86-box tm86-select" aria-label="End" value={end} disabled={busy} onChange={(e) => setEnd(Number(e.target.value))} data-tm-time-end>
                {ends.map((x) => (
                  <option key={x} value={x}>
                    {clockShort(timeWords(x % (24 * 60)))}
                  </option>
                ))}
              </select>
            </span>
          ) : (
            <b className="tm86-fixed" data-tm-row-time>
              {planRange(t.start, t.minutes)}
            </b>
          )}
        </div>
      ) : (
        <>
          {/* Before the date is final (the old Create and Edit page's facts): the players pick the start; the venue closes at 10. */}
          <div className="tm86-field">
            <span className="tm86-label">Start time</span>
            <b className="tm86-fixed">7 to 7:30 PM, by players</b>
          </div>
          <div className="tm86-field">
            <span className="tm86-label">Ends</span>
            <b className="tm86-fixed">10 PM close</b>
          </div>
        </>
      )}
      <div className="tm86-field">
        <span className="tm86-label">Courts</span>
        <span className="segmented tm86-courts" role="group" aria-label="Courts">
          {([1, 2] as const).map((c) => (
            <button key={c} type="button" aria-pressed={courts === c} disabled={busy || !planOn} onClick={() => setCourts(c)} data-tm-plan-courts={c}>
              {c}
            </button>
          ))}
        </span>
      </div>
      <div className="tm86-field">
        <span className="tm86-label">Players you expect</span>
        <span className="tm86-stepper">
          <button type="button" className="tm86-box tm86-sq" aria-label="One fewer" disabled={busy || !planOn || n <= low} onClick={() => setN((x) => Math.max(low, x - 1))} data-tm-expect-minus>
            −
          </button>
          <b className="tm86-n" aria-live="polite" data-tm-expect>
            {n}
          </b>
          <button type="button" className="tm86-box tm86-sq" aria-label="One more" disabled={busy || !planOn || n >= EXPECT_MAX} onClick={() => setN((x) => Math.min(EXPECT_MAX, x + 1))} data-tm-expect-plus>
            +
          </button>
        </span>
      </div>
      <div className="tm86-field tm86-cost tm87-cost-line">
        <span className="tm86-label">Courts cost</span>
        <b data-tm86-court-cost={courtCentsOf({ courts, minutes })}>{formatPrice(courtCentsOf({ courts, minutes }))}</b>
      </div>
      {!fit.fits && (
        <p className="tm-fin-fit tm-fin-tight" role="status" data-tm-box-fit="tight">
          {fit.text}
        </p>
      )}
      {outside && (
        <p className="field-error" role="alert" data-tm-hours>
          {outside}
        </p>
      )}
      {/* Zip 87 round 2: the old Edit page's settings, here. */}
      <div className="tm86-field tm87-stack" data-tm87-style>
        <span className="tm86-label">Style{formatLocked ? ' (the night has started)' : ''}</span>
        <span className="segmented tm87-seg" role="group" aria-label="Style">
          {canVote && (
            <button type="button" aria-pressed={format === 'vote'} disabled={busy || formatLocked} onClick={() => setFormat('vote')} data-format="vote">
              {autoLabel ? 'Auto' : 'Players vote'}
            </button>
          )}
          {(['doubles', 'americano'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={format === f} disabled={busy || formatLocked} onClick={() => setFormat(f)} data-format={f}>
              {formatName(f)}
            </button>
          ))}
        </span>
      </div>
      <div className="tm86-field" data-tm87-ticket>
        <span className="tm86-label">Ticket price{sold ? ' (tickets sold)' : ''}</span>
        {sold ? (
          <b className="tm86-fixed" data-tm-ticket-locked>
            {formatPrice(t.ticketCents)}
          </b>
        ) : (
          <MoneyBox id="tm87-ticket" cents={ticket} onChange={setTicket} label="Ticket price" />
        )}
      </div>
      {payOn && (
        <div className="tm86-field tm87-stack" data-tm87-pay-by>
          <span className="tm86-label">Pay by</span>
          <span className="tm87-pay">
            <select className="tm86-box tm86-select" aria-label="Pay by day" value={payDay} disabled={busy} onChange={(e) => setPayDay(e.target.value)} data-tm-pay-day>
              {payDays.map((d) => (
                <option key={d} value={d}>
                  {dayLong(d)}
                </option>
              ))}
            </select>
            <select className="tm86-box tm86-select" aria-label="Pay by time" value={payMin} disabled={busy} onChange={(e) => setPayMin(Number(e.target.value))} data-tm-pay-time>
              {payTimes.map((m) => (
                <option key={m} value={m}>
                  {clockShort(timeWords(m))}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}
      <div className="tm86-field" data-tm87-who>
        <span className="tm86-label">Who can see it</span>
        <span className="segmented tm87-seg tm87-who" role="group" aria-label="Who can see it">
          <button type="button" aria-pressed={visibility === 'me'} disabled={busy || sold} onClick={() => setVisibility('me')} data-vis="me">
            Only me
          </button>
          <button type="button" aria-pressed={visibility === 'all'} disabled={busy} onClick={() => setVisibility('all')} data-vis="all">
            Everyone
          </button>
        </span>
      </div>
      <div className="tm86-field tm87-stack">
        <label className="tm86-label" htmlFor="tm87-name">
          Name
        </label>
        <input
          id="tm87-name"
          className="tm86-box tm87-name"
          type="text"
          value={name}
          maxLength={NAME_MAX + 8}
          autoComplete="off"
          enterKeyHint="done"
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          data-tm-name
        />
      </div>
      {offerOn && (
        <div className="tm86-field tm87-stack" data-tm87-offer>
          <span className="tm87-offer-head">
            <span className="tm86-label">Dates offered</span>
            <button type="button" className="tm86-box" aria-expanded={offerOpen} onClick={() => setOfferOpen((x) => !x)} data-tm87-offer-toggle>
              {offer.length} {offer.length === 1 ? 'date' : 'dates'}
            </button>
          </span>
          {offerOpen && (
            <MonthCalendar
              months={offerMonths}
              variant="offer"
              label="Dates to offer"
              look={offerLook}
              scrollTo={offer[0] ?? null}
              onTap={(d) => setOffer((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}
            />
          )}
        </div>
      )}
      {plans && (
        <div className="tm86-field tm87-plans" data-tm87-plans>
          <span className="tm86-label">Plans changed?</span>
          <span className="tm87-plans-btns">
            {canReschedule && (
              <button type="button" className="tm86-box" disabled={busy} onClick={() => setSure('reschedule')} data-tm-reschedule>
                Reschedule
              </button>
            )}
            <button type="button" className="tm86-box" disabled={busy} onClick={() => setSure('cancel')} data-tm-cancel-tournament>
              Cancel
            </button>
          </span>
        </div>
      )}
      {problem && changed && (
        <p className="field-error" role="alert" data-tm-error>
          {problem}
        </p>
      )}
      {/* Review fix: a time outside the venue hours blocks only a time change, never the other settings. */}
      <button type="button" className="btn block big tm86-save" disabled={busy || (timeChanged && !!outside) || !changed || !!problem} onClick={() => void go()} data-tm86-save>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <ConfirmDialog
        open={sure === 'reschedule'}
        title="Are you sure?"
        body={<p>Reschedule: the date comes off and everyone picks their dates again. Paid tickets stay held.</p>}
        cancelLabel="Keep it"
        confirmLabel="Reschedule"
        busy={busy}
        onCancel={() => setSure(null)}
        onConfirm={async () => {
          const ok = await save(() => api('POST', `/api/admin/tournament/${t.id}/reschedule`, {}), 'Rescheduled. Pick new dates.');
          setSure(null);
          if (ok) onDone();
        }}
      />
      <ConfirmDialog
        open={sure === 'cancel'}
        title="Are you sure?"
        body={
          <p>
            {t.finalDate || back.length > 0 ? `Cancel ${t.name}: players see it canceled.` : `Cancel ${t.name}: players stop seeing it. The list stays saved.`}
            {back.length > 0 ? ` ${back.length} paid ${back.length === 1 ? 'ticket comes' : 'tickets come'} back as credit (${formatPrice(backCents)}).` : ' Nothing was paid, so nothing comes back.'}
          </p>
        }
        cancelLabel="Keep it"
        confirmLabel="Cancel tournament"
        danger
        busy={busy}
        onCancel={() => setSure(null)}
        onConfirm={async () => {
          const ok = await save(() => api('POST', `/api/admin/tournament/${t.id}/cancel`, {}), 'Tournament canceled');
          setSure(null);
          if (ok) onDone();
        }}
      />
      <ConfirmDialog
        open={ask}
        title="Change the date?"
        body={<p>Changing the date is a Reschedule: the date comes off and everyone picks their dates again. Paid tickets stay held.</p>}
        confirmLabel="Reschedule"
        busy={busy}
        onCancel={() => setAsk(false)}
        onConfirm={async () => {
          const ok = await save(() => api('POST', `/api/admin/tournament/${t.id}/reschedule`, {}), 'Rescheduled. Pick new dates.');
          setAsk(false);
          if (ok) onDone();
        }}
      />
    </div>
  );
}

/** Zip 86: one line of the Money sheet. */
function MoneyRow({ label, cents, words, data }: { label: ReactNode; cents?: number; words?: string; data: string }) {
  return (
    <div className="tm86-mrow" {...{ [data]: cents ?? words ?? '' }}>
      <span>{label}</span>
      {words !== undefined ? <b>{words}</b> : <b className={cents! < 0 ? 'tm-money-down' : undefined}>{cents! < 0 ? `−${formatPrice(-cents!)}` : formatPrice(cents!)}</b>}
    </div>
  );
}

/**
 * Zip 86 (picture 7): Money. RIGHT NOW: the tickets paid, the courts, the prizes set (or "Not set"), So far. IF ALL N PAY: the tickets
 * expected ("you play free" when the organizer has a free seat), the courts, the prizes as set (or the suggested full tier when none is set),
 * You keep. Every number is the server's money line (shared/tournamentMoney.ts planMoney) and cost: the card, Time, Plan, Finalize and Totals
 * read the same ones, to the cent.
 */
function MoneyBody({ t, onPrizes }: { t: AdminTournamentView; onPrizes: () => void }) {
  const ms = moneySheet(t);
  if (!ms) return <p className="tm-card-note">The money shows once the plan is set.</p>;
  return (
    <div className="tm86-money" data-tm86-money-sheet>
      <h3 className="tm86-mhead">Right now</h3>
      <MoneyRow label={`${ms.paidCount} ${ms.paidCount === 1 ? 'ticket' : 'tickets'} paid`} cents={ms.paidCents} data="data-tm86-paid" />
      <MoneyRow label={`Courts (${t.courts} · ${hoursWords(t.minutes)})`} cents={-ms.courtCents} data="data-tm86-courts-now" />
      {ms.prizesNowCents !== null ? <MoneyRow label="Prizes" cents={-ms.prizesNowCents} data="data-tm86-prizes-now" /> : <MoneyRow label="Prizes" words="Not set" data="data-tm86-prizes-now" />}
      <div className="tm86-total" data-tm86-so-far={ms.soFarCents}>
        <span>So far</span>
        <b className={ms.soFarCents >= 0 ? 'tm-money-up' : 'tm-money-down'}>{signed(ms.soFarCents)}</b>
      </div>
      <h3 className="tm86-mhead">If all {ms.expected} pay</h3>
      <MoneyRow label={`${Math.max(0, ms.expected - 1)} tickets${ms.freeSeat ? ' (you play free)' : ''}`} cents={ms.ticketsAllCents} data="data-tm86-tickets-all" />
      <MoneyRow label="Courts" cents={-ms.courtCents} data="data-tm86-courts-all" />
      <MoneyRow
        label={
          <>
            Prizes: {ms.prizeAllWords}
            {ms.prizeSuggested && <em className="tm86-suggest">Suggested. Not set yet.</em>}
          </>
        }
        cents={-ms.prizeAllCents}
        data="data-tm86-prizes-all"
      />
      <div className="tm86-total" data-tm86-keep={ms.keepCents}>
        <span>You keep</span>
        <b className={ms.keepCents >= 0 ? 'tm-money-up' : 'tm-money-down'}>{signed(ms.keepCents)}</b>
      </div>
      <button type="button" className="btn block secondary tm86-setprizes" onClick={onPrizes} data-tm86-set-prizes>
        Set prizes
      </button>
    </div>
  );
}

/** "2.5 hrs", "2 hrs", "1 hr". */
const hoursWords = (minutes: number) => `${minutes / 60} ${minutes === 60 ? 'hr' : 'hrs'}`;

/**
 * Zip 87 (picture 9): Prizes for both styles (src/pages/admin/PrizeBoxes.tsx): "Tickets $162 − courts $120 = $42 left" (before the night the
 * tickets expected, on the night the tickets actually paid), "Suggested for both styles" with Use these, the planned style's box on top ("Plan
 * now"), the other under it, Save. Saves through the tournament's own Edit save (PUT /api/admin/tournament/:id) with everything else as it is,
 * both boxes in `prizes`; the night pays the box of the style actually played.
 */
function PrizesBody({ ctx, t, onDone }: { ctx: AdminCtx; t: AdminTournamentView; onDone: () => void }) {
  const { busy, save } = useSave(ctx);
  const [draft, setDraft] = useState<BoxesDraft>(() => draftOf(prizesOf(t)));
  const m = t.money;
  const night = !!t.closed;
  // On the night: the tickets actually paid. Once End is ready, exactly Edit awards' numbers (the night's money as Totals counts it).
  const tickets = t.end?.money ? t.end.money.ticketsCents : night ? (t.cost?.paidNow ?? 0) * t.ticketCents : (m?.ticketsCents ?? 0);
  const courts = t.end?.money ? t.end.money.courtCents : (m?.courtCents ?? 0);
  const planned = plannedStyle(t);
  const sendable = sendOf(draft);
  async function go() {
    if (!sendable) return;
    const body = { name: t.name, dates: t.offeredDates, ticketCents: t.ticketCents, creditCents: sendable[planned].first, visibility: t.visibility, prizes: sendable };
    const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}`, body), 'Prizes saved');
    if (ok) onDone();
  }
  return (
    <div className="stack tm86-prizes" data-tm86-prize-sheet>
      <PrizeBoxes tickets={tickets} courts={courts} planned={planned} tag={night ? 'Tonight' : 'Plan now'} value={draft} onChange={setDraft} />
      <button type="button" className="btn block big" disabled={busy || !sendable} onClick={() => void go()} data-tm86-prizes-save>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 56, piece 2: tickets on the organizer's side (pictures 29 and 30)
// ---------------------------------------------------------------------------------------------------------------------

/** "Thu Dec 17 · 7:30 PM" (picture 29's Date row). */
const dateRow = (t: AdminTournamentView) => {
  if (!t.finalDate) return 'Not picked';
  const s = stubParts(t.finalDate);
  return `${s.weekday.charAt(0)}${s.weekday.slice(1).toLowerCase()} ${s.month.charAt(0)}${s.month.slice(1).toLowerCase()} ${s.day} · ${startLabel(t.start)}`;
};

/** Zip 70 (picture 1): "Tue Dec 1" (the Date row once the Time row has the times). */
const dateOnly = (t: AdminTournamentView) => {
  const s = stubParts(t.finalDate!);
  return `${s.weekday.charAt(0)}${s.weekday.slice(1).toLowerCase()} ${s.month.charAt(0)}${s.month.slice(1).toLowerCase()} ${s.day}`;
};

/** How a ticket was paid, in a few words (the organizer sees everyone's money). */
function paidWords(k: AdminTicketView): string {
  if (k.organizer) return 'You, free';
  if (k.creditCents > 0 && k.paidCents > 0) return `${formatPrice(k.creditCents)} credit + ${formatPrice(k.paidCents)}`;
  if (k.creditCents > 0) return `${formatPrice(k.creditCents)} credit`;
  if (k.paidCents > 0) return `Paid ${formatPrice(k.paidCents)}`;
  return 'Not paid';
}

/** Zip 56: an I paid on a ticket, waiting for the organizer (the same amber card and words as a game's I paid). */
function TicketClaimCard({ ctx, t, k }: { ctx: AdminCtx; t: AdminTournamentView; k: AdminTicketView }) {
  const { busy, save } = useSave(ctx);
  const where = t.status === 'canceled' ? `${t.name} was canceled.` : k.out ? `Dropped out of ${theName(t.name)}.` : `${t.name} ticket.`;
  const answer = (action: 'confirm' | 'reject') =>
    save(
      () => api('POST', `/api/admin/tournament/${t.id}/ticket`, { playerId: k.playerId, action, cents: k.claimCents }),
      action === 'reject' ? (r: unknown) => ((r as { owedCents?: number } | null)?.owedCents ? `${k.name} owes ${formatPrice((r as { owedCents: number }).owedCents)}` : 'Cleared') : t.status === 'canceled' || k.out ? `${k.name}’s ${formatPrice(k.claimCents)} is credit now` : `${k.name}’s ${formatPrice(k.claimCents)} is in`,
    );
  return (
    <AlertCard
      tone="amber"
      icon="owe"
      label={`${k.name} payment not confirmed`}
      titleAs="h3"
      data={{ 'data-ticket-claim': k.name }}
      title={`${k.name} tapped I paid (${formatPrice(k.claimCents)}), not confirmed.`}
      sub={where}
      actions={
        <>
          <button className="ac-btn" disabled={busy} data-claim-paid onClick={() => void answer('confirm')}>
            Paid
          </button>
          <button className="ac-btn ac-out" disabled={busy} data-claim-not-paid onClick={() => void answer('reject')}>
            Didn’t pay
          </button>
        </>
      }
    />
  );
}

/**
 * Zip 63: who still has to pay: on the list, able to make the picked date, no ticket paid in full and no I paid waiting (that one is the
 * organizer's to answer), and never the organizer (their seat is free). Only while a spot can still be bought: tickets open, before Pay by and
 * before every spot is taken. Empty otherwise (the card hides).
 */
export function unpaidOf(t: AdminTournamentView, nowIso: string): TournamentSignupView[] {
  if (t.status !== 'tickets' || !t.finalDate || !t.payBy || t.closed || payByPassed(t, nowIso)) return [];
  const tickets = t.tickets ?? [];
  if (lockedOf(t).length >= MAX_SPOTS) return [];
  const byId = new Map(tickets.map((k) => [k.playerId, k]));
  return t.signups.filter((s) => {
    const k = byId.get(s.playerId);
    if (k?.organizer) return false;
    if (!s.dates.includes(t.finalDate!)) return false;
    return !k || (k.place !== 'spot' && !ticketIsPaid(k) && k.claimCents === 0);
  });
}

/** Zip 59: Hide on a canceled tournament's card (organizer only). It leaves Home and every list; Settings > Advanced > Hidden tournaments brings it back. */
function HideCanceled({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const { busy, save } = useSave(ctx);
  return (
    <button
      type="button"
      className="btn block secondary tm-hide"
      disabled={busy}
      onClick={() => void save(() => api('POST', `/api/admin/tournament/${t.id}/hide`, { hidden: true }), 'Hidden. Restore it in Settings, Advanced.')}
      data-tm-hide
    >
      {busy ? 'Working…' : 'Hide'}
    </button>
  );
}

/** Zip 56: the Pay by choices: every day from today to the tournament day, and the time (every 30 minutes, 6:00 AM to 11:30 PM). */
const PAY_TIMES = Array.from({ length: 36 }, (_, i) => 360 + i * 30);
const timeWords = (m: number) => `${m % 720 >= 60 ? Math.floor((m % 720) / 60) : 12}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'AM' : 'PM'}`;

/**
 * Picture 30: "Cancel or reschedule". Reschedule (back to the date step, tickets stay paid and held) or Cancel tournament (every paid ticket comes
 * back as credit). Each asks "Are you sure" first.
 */
function CancelOrReschedule({ ctx, t, onDone }: { ctx: AdminCtx; t: AdminTournamentView; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<null | 'reschedule' | 'cancel'>(null);
  const { busy, save } = useSave(ctx);
  const back = (t.tickets ?? []).filter((k) => !k.out && k.claimCents === 0 && k.creditCents + k.paidCents > 0);
  const backCents = back.reduce((s, k) => s + k.creditCents + k.paidCents, 0);
  return (
    <>
      <button type="button" className="tm-quiet-link tm-tix-link" onClick={() => setOpen(true)} data-tm-cancel-or-reschedule>
        Cancel or reschedule
      </button>
      <Sheet calmFocus open={open} title="Cancel or reschedule" onClose={() => setOpen(false)}>
        <div className="stack tm-cor" data-tm-cor>
          <div className="btn-row confirm-row">
            <button type="button" className="btn big confirm-safe" onClick={() => setAsk('reschedule')} data-tm-reschedule>
              Reschedule
            </button>
            <button type="button" className="btn big danger confirm-out" onClick={() => setAsk('cancel')} data-tm-cancel-tournament>
              Cancel tournament
            </button>
          </div>
          <p className="tm-cor-note">Reschedule: pick new dates. Players can drop out and get their money back as credit. Cancel: everyone gets their money back as credit.</p>
        </div>
      </Sheet>
      <ConfirmDialog
        open={ask === 'reschedule'}
        title="Reschedule?"
        body={<p>The date comes off and everyone picks their dates again. Paid tickets stay held.</p>}
        confirmLabel="Reschedule"
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={async () => {
          const ok = await save(() => api('POST', `/api/admin/tournament/${t.id}/reschedule`, {}), 'Rescheduled. Pick new dates.');
          setAsk(null);
          if (ok) {
            setOpen(false);
            onDone?.();
          }
        }}
      />
      <ConfirmDialog
        open={ask === 'cancel'}
        title="Cancel the tournament?"
        body={
          <p>
            Players see it canceled.
            {back.length > 0 ? ` ${back.length} paid ${back.length === 1 ? 'ticket comes' : 'tickets come'} back as credit (${formatPrice(backCents)}).` : ' Nothing was paid, so nothing comes back.'}
          </p>
        }
        cancelLabel="Keep it"
        confirmLabel="Cancel tournament"
        danger
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={async () => {
          const ok = await save(() => api('POST', `/api/admin/tournament/${t.id}/cancel`, {}), 'Tournament canceled');
          setAsk(null);
          if (ok) {
            setOpen(false);
            onDone?.();
          }
        }}
      />
    </>
  );
}

/**
 * Zip 56: the Tickets list on the tournament page: I paid taps waiting, who is locked in and how they paid, the waitlist, and the players on the
 * list with no ticket. A row opens its actions (Paid or Didn't pay, Mark paid, Take off the list).
 */
function TicketsCard({ ctx, t, scrollRef }: { ctx: AdminCtx; t: AdminTournamentView; scrollRef?: (el: HTMLElement | null) => void }) {
  const [who, setWho] = useState<string | null>(null);
  const tickets = t.tickets ?? [];
  const has = new Set(tickets.filter((k) => !k.out && (k.place !== 'none' || k.creditCents + k.paidCents + k.claimCents > 0)).map((k) => k.playerId));
  const locked = lockedOf(t);
  const line = lineOf(t);
  const firstPaid = line.findIndex(ticketIsPaid);
  const others = t.signups.filter((s) => !has.has(s.playerId));
  const evens = evensOf(t, ctx.d.now);
  const row = (key: string, name: string, tag: string, cls = '', data = '') => (
    <li key={key} className={cls}>
      <button type="button" className="tm-tk-row" onClick={() => setWho(key)} data-tm-ticket-row={data || name}>
        <span className="tm-tk-name">{name}</span>
        <span className="tm-tk-tag">{tag}</span>
      </button>
    </li>
  );
  return (
    <section className="tm-card" aria-label="Tickets" data-tm-card="tickets" ref={scrollRef}>
      {/* Zip 92: no "Tickets" heading; the sheet's own title already says Players. The chip leads the card. */}
      <div className="tm-card-head tm-head-line tm-head-start">
        {/* Zip 87: of everyone who can make the date (the organizer too), the balls players see. */}
        <span className={ticketCount(t).locked >= ticketCount(t).total ? 'tm-chip tm-chip-ok' : 'tm-chip'} data-tm-locked-chip>
          {ticketWords(ticketCount(t))}
        </span>
      </div>
      {evens && (
        <p className="tm-evens" role="status">
          {evens}
        </p>
      )}
      <ul className="tm-tk">
        {locked.map((k) => row(k.playerId, k.name, paidWords(k), 'tm-tk-in'))}
        {line.length > 0 && <li className="tm-tk-head">Standby</li>}
        {line.map((k, i) => row(k.playerId, `${i + 1}. ${k.name}`, ticketIsPaid(k) ? (i === firstPaid ? 'Paid, first in line' : 'Paid') : k.claimCents > 0 ? 'I paid, waiting' : 'Not paid', '', k.name))}
        {tickets.filter((k) => !k.out && k.place === 'none' && k.claimCents > 0).map((k) => row(k.playerId, k.name, isOwedClaim(k) ? `Owes ${formatPrice(k.claimCents)}` : 'I paid, waiting'))}
        {others.length > 0 && <li className="tm-tk-head">No ticket yet</li>}
        {others.map((s) => row(s.playerId, s.name, 'Not paid'))}
      </ul>
      <TicketSheet ctx={ctx} t={t} playerId={who} onClose={() => setWho(null)} />
    </section>
  );
}

/** Zip 56: one player's ticket: what it holds, and the organizer's taps on it. */
function TicketSheet({ ctx, t, playerId, onClose }: { ctx: AdminCtx; t: AdminTournamentView; playerId: string | null; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const [askOff, setAskOff] = useState(false);
  const k = (t.tickets ?? []).find((x) => x.playerId === playerId) ?? null;
  const s = t.signups.find((x) => x.playerId === playerId) ?? null;
  const name = k?.name ?? s?.name ?? '';
  const owed = k ? Math.max(0, k.priceCents - k.creditCents - k.paidCents - k.claimCents) : t.ticketCents;
  const backCents = k ? k.creditCents + k.paidCents : 0;
  const act = async (action: 'confirm' | 'reject' | 'mark_paid' | 'take_off', cents: number | undefined, done: string | ((answer: unknown) => string)) => {
    const ok = await save(() => api('POST', `/api/admin/tournament/${t.id}/ticket`, { playerId, action, ...(cents === undefined ? {} : { cents }) }), done);
    if (ok) onClose();
  };
  return (
    <Sheet calmFocus open={!!playerId} title={name ? `${name}’s ticket` : 'Ticket'} onClose={onClose}>
      {playerId && (
        <div className="stack" data-tm-ticket-sheet={name}>
          <div className="tm-rows">
            <div className="tm-row">
              <span>Where</span>
              <b>{k?.place === 'spot' ? 'Locked in' : k?.place === 'line' ? 'Standby' : 'No spot yet'}</b>
            </div>
            <div className="tm-row">
              <span>Paid</span>
              <b>{k ? paidWords(k) : 'Not paid'}</b>
            </div>
            {k && k.claimCents > 0 && (
              <div className="tm-row">
                <span>{isOwedClaim(k) ? 'Owes (Didn’t pay)' : 'I paid, not confirmed'}</span>
                <b>{formatPrice(k.claimCents)}</b>
              </div>
            )}
          </div>
          {k && isOwedClaim(k) ? (
            // Zip 85: owed after a Didn't pay on the night: Mark paid when the money comes in (the same answer as Money's Mark paid).
            <button type="button" className="btn block" disabled={busy} onClick={() => void act('mark_paid', k.claimCents, `${name}’s ${formatPrice(k.claimCents)} is in`)} data-tm-ticket-mark>
              Mark paid {formatPrice(k.claimCents)}
            </button>
          ) : k && k.claimCents > 0 ? (
            <div className="btn-row confirm-row">
              <button type="button" className="btn confirm-safe" disabled={busy} onClick={() => void act('confirm', k.claimCents, `${name}’s ${formatPrice(k.claimCents)} is in`)} data-tm-ticket-paid>
                Paid
              </button>
              <button type="button" className="btn danger confirm-out" disabled={busy} onClick={() => void act('reject', k.claimCents, (r: unknown) => ((r as { owedCents?: number } | null)?.owedCents ? `${name} owes ${formatPrice((r as { owedCents: number }).owedCents)}` : 'Cleared'))} data-tm-ticket-not-paid>
                Didn’t pay
              </button>
            </div>
          ) : (
            t.status === 'tickets' &&
            !t.closed &&
            // Nobody gets a ticket on a tournament they cannot see (Only me, or Tournaments off for players): the server refuses it too.
            t.visibility === 'all' &&
            ctx.d.tournamentsForAll === true &&
            owed > 0 &&
            !k?.organizer && (
              <button type="button" className="btn block" disabled={busy} onClick={() => void act('mark_paid', owed, `${name} marked paid`)} data-tm-ticket-mark>
                Mark paid {formatPrice(owed)}
              </button>
            )
          )}
          {s && !t.closed && t.status !== 'canceled' && (
            <button type="button" className="tm-cancel-link" disabled={busy} onClick={() => setAskOff(true)} data-tm-ticket-off>
              Take {name} off the list
            </button>
          )}
          <ConfirmDialog
            open={askOff}
            title={`Take ${name} off?`}
            body={<p>{backCents > 0 ? `${name}’s ${formatPrice(backCents)} comes back as credit. ` : ''}{k?.place === 'spot' ? 'The spot goes to the first paid player in line.' : `${name} comes off the list.`}</p>}
            cancelLabel="Keep"
            confirmLabel="Take off"
            danger
            busy={busy}
            onCancel={() => setAskOff(false)}
            onConfirm={async () => {
              setAskOff(false);
              await act('take_off', undefined, `${name} is off the list`);
            }}
          />
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Create tournament / Edit (mocks 03, 01, 02, 24)
// ---------------------------------------------------------------------------------------------------------------------

function MoneyBox({ id, cents, onChange, label }: { id: string; cents: number | null; onChange: (c: number | null) => void; label: string }) {
  const [text, setText] = useState(cents === null ? '' : formatPrice(cents).replace('$', ''));
  return (
    <span className="tm-money">
      <span aria-hidden="true">$</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseDollars(e.target.value);
          onChange(c === null || c > MAX_PRICE_CENTS ? null : c);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </span>
  );
}

function Card({ label, chip, children, className = '', data, line }: { label: string; chip?: ReactNode; children: ReactNode; className?: string; data?: string; line?: boolean }) {
  return (
    <section className={`tm-card ${className}`} aria-label={label} data-tm-card={data}>
      <div className={line ? 'tm-card-head tm-head-line' : 'tm-card-head'}>
        <h3 className="tm-label">{label}</h3>
        {chip}
      </div>
      {children}
    </section>
  );
}


export function CreateSheet({ ctx, open, onClose }: { ctx: AdminCtx; open: boolean; onClose: () => void }) {
  // A fresh form each time it opens, so a Create after a Cancel starts clean. Zip 87 round 2: Create only; every later change is on the gear.
  return (
    <Sheet calmFocus open={open} title="Create tournament" onClose={onClose} className="tm-page">
      {open && <CreateForm ctx={ctx} onDone={onClose} />}
    </Sheet>
  );
}

/**
 * Create tournament: the name, the dates to offer, the style, the ticket price and who can see it. Zip 87 round 2 (Alex): no prize boxes here;
 * prizes live only in Prizes (a new tournament starts with none set, $0 in the columns: "Not set yet").
 */
function CreateForm({ ctx, onDone }: { ctx: AdminCtx; onDone: () => void }) {
  const tz = ctx.d.group.timezone;
  const today = todayKeyOf(ctx.d.now, tz);
  const [name, setName] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [ticket, setTicket] = useState<number | null>(DEFAULT_TICKET_CENTS);
  // Zip 60: a format, or "Let players vote" (the start for a new tournament).
  const [format, setFormat] = useState<FormatChoice>(DEFAULT_FORMAT_CHOICE);
  const [visibility, setVisibility] = useState<Visibility>('me');
  const [error, setError] = useState<string | null>(null);
  const { busy, save } = useSave(ctx);
  // The Create calendar: this month and the next five.
  const months = useMemo(() => {
    const last = [monthStartPlus(today, CREATE_MONTHS - 1), ...dates].sort().slice(-1)[0];
    return monthsBetween([today, ...dates].sort()[0], last);
  }, [today, dates]);
  const look = (d: string): DayLook => (dates.includes(d) ? 'on' : d < today ? 'past' : 'off');
  async function submit() {
    const n = name.trim();
    const problem = !n
      ? 'Type a name.'
      : Array.from(n).length > NAME_MAX
        ? `Keep the name to ${NAME_MAX} letters.`
        : dates.length === 0
          ? 'Pick at least one date.'
          : dates.length > MAX_DATES
            ? `Pick at most ${MAX_DATES} dates.`
            : ticket === null
              ? 'Type a ticket price.'
              : null;
    setError(problem);
    if (problem) return;
    // Alex: no players expected and no court plan (the smart plan follows the players locked in). No prizes: set them in Prizes.
    const body = { name: n, dates, ticketCents: ticket, creditCents: 0, secondCreditCents: 0, visibility, format };
    const ok = await save(() => api('POST', '/api/admin/tournament', body), visibility === 'me' ? 'Sign-up is open. Only you can see it.' : 'Sign-up is open for everyone');
    if (ok) onDone();
  }
  return (
    <div className="tm-form stack" data-tm-form="create">
      <Card label="New tournament" data="name">
        <input
          className="tm-name"
          type="text"
          value={name}
          maxLength={NAME_MAX + 8}
          placeholder="Winter Classic"
          aria-label="Tournament name"
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
          data-tm-name
        />
        <div className="tm-card-head tm-sub-head">
          <h3 className="tm-label">Dates to offer</h3>
          <span className="tm-chip" data-tm-lit>
            {dates.length} lit
          </span>
        </div>
        <MonthCalendar
          months={months}
          variant="offer"
          label="Dates to offer"
          look={look}
          // Opens on the first lit date; with none, on next month once this month is half over (the mock opens on next month).
          scrollTo={dates[0] ?? (Number(today.slice(8)) >= 15 ? monthStartPlus(today, 1) : null)}
          onTap={(d) => setDates((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}
        />
        <div className="tm-facts">
          <div className="tm-fact">
            <span>Start time</span>
            <b>7 to 7:30 PM, by players</b>
          </div>
          <div className="tm-fact">
            <span>Ends</span>
            <b>10 PM close</b>
          </div>
        </div>
      </Card>

      <Card label="Format" data="format">
        <div className="segmented tm-seg tm-seg-format" role="group" aria-label="Format">
          <button type="button" aria-pressed={format === 'vote'} onClick={() => setFormat('vote')} data-format="vote">
            <span className="tm-format-name">{VOTE_LABEL}</span>
          </button>
          {(['doubles', 'americano'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)} data-format={f}>
              <span className="tm-format-name">{formatName(f)}</span>
              <span className="tm-format-rule">{formatRule(f)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card label="Ticket price" data="ticket" line>
        <div className="tm-rows">
          <label className="tm-row" htmlFor="tm-ticket">
            <span>Each player pays</span>
            <MoneyBox id="tm-ticket" cents={ticket} onChange={setTicket} label="Each player pays" />
          </label>
          <div className="tm-row">
            <span>Same for 6 to 16 players</span>
            <b>Fixed</b>
          </div>
        </div>
        <p className="tm-card-note">You host and pay the court bill. Change the price any time before tickets open.</p>
      </Card>

      <Card label="Who can see it" data="who">
        <div className="segmented tm-seg tm-seg-who" role="group" aria-label="Who can see it">
          <button type="button" aria-pressed={visibility === 'me'} onClick={() => setVisibility('me')} data-vis="me">
            Only me
          </button>
          <button type="button" aria-pressed={visibility === 'all'} onClick={() => setVisibility('all')} data-vis="all">
            Everyone
          </button>
        </div>
        <p className="tm-card-note tm-who-note">Look at it on your own phone first, then switch to Everyone.</p>
      </Card>

      {error && (
        <p className="field-error" role="alert" data-tm-error>
          {error}
        </p>
      )}
      <button type="button" className="btn block tm-go" disabled={busy} onClick={() => void submit()} data-tm-open-signup>
        {busy ? 'Working…' : visibility === 'me' ? 'Open sign-up (only me)' : 'Open sign-up (everyone)'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 87 round 2 (Alex): the Players sheet (who paid / no ticket yet, Levels with the pencils, Projected teams) and the Pick the date sheet.
// Every setting is on the gear (SettingsSheet); there is no second edit page.
// ---------------------------------------------------------------------------------------------------------------------

/** The Players sheet: the tickets (who paid, standby, no ticket yet), then Levels with the pencils, then Projected teams. Nothing else. */
export function PlayersSheet({ ctx, t, open, onClose }: { ctx: AdminCtx; t: AdminTournamentView; open: boolean; onClose: () => void }) {
  return (
    <Sheet calmFocus open={open} title="Players" onClose={onClose} className="tm-page">
      {open && <PlayersBody ctx={ctx} t={t} />}
    </Sheet>
  );
}

function PlayersBody({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const [levelFor, setLevelFor] = useState<string | null>(null);
  const canceled = t.status === 'canceled';
  const showTickets = (t.tickets ?? []).length > 0 || t.status === 'tickets';
  const who = t.signups.find((s) => s.playerId === levelFor) ?? null;
  // Zip 71: worked out from the levels on this screen each time it draws, so a level saved with the pencil shows in the open list at once.
  const projected = useMemo(() => projectedTeams(t), [t]);
  return (
    <div className="tm-form stack" data-tm-page="players">
      {showTickets && <TicketsCard ctx={ctx} t={t} />}
      <section className="tm-card tm-levels-card" aria-label="Levels" data-tm-card="levels">
        <div className="tm-card-head">
          <h3 className="tm-label">Levels</h3>
          <span className="tm-chip" data-tm-count>
            {t.signups.length} {t.signups.length === 1 ? 'player' : 'players'}
          </span>
        </div>
        {t.signups.length === 0 ? (
          <p className="tm-empty">Nobody has signed up yet.</p>
        ) : (
          <ul className="tm-lrows">
            {t.signups.map((s) => (
              <li key={s.playerId} className="tm-lrow" data-tm-level-row={s.name}>
                <span className="tm-lrow-text">
                  <b className="tm-lrow-name">{s.name}</b>
                  <span className="tm-lrow-picked">Picked {levelShort(s.pickedLevel)}</span>
                </span>
                <b className="tm-lrow-level" data-tm-level>
                  {levelShort(s.level)}
                </b>
                {/* A canceled tournament's levels stay as they are (the server refuses a change). */}
                {!canceled && (
                  <button type="button" className="tm-pencil" aria-label={`Change ${s.name}’s level`} onClick={() => setLevelFor(s.playerId)} data-tm-pencil>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
                      <path d="M13.5 6.5l4 4" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* Zip 71 (pictures pair-01 and pair-02): Projected teams, under Levels. Tap opens it in place, tap again folds it. */}
      {projected && (
        <section className="tm-card tm-proj-card" aria-label="Projected teams" data-tm-card="projected">
          <ProjectedTeams teams={projected} />
        </section>
      )}
      {t.backedOut.length > 0 && <p className="tm-card-note tm-backed">Dropped out: {t.backedOut.map((b) => b.name).join(', ')}</p>}
      <LevelSheet ctx={ctx} t={t} who={who} onClose={() => setLevelFor(null)} />
    </div>
  );
}

/** Pick the date: the offered dates as a heat map (brighter green, more can play), a tap picks one (the date sheet's confirm). */
export function DatesSheet({ ctx, t, open, onClose }: { ctx: AdminCtx; t: AdminTournamentView; open: boolean; onClose: () => void }) {
  return (
    <Sheet calmFocus open={open} title="Pick the date" onClose={onClose} className="tm-page">
      {open && <DatesBody ctx={ctx} t={t} />}
    </Sheet>
  );
}

function DatesBody({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const [day, setDay] = useState<string | null>(null);
  const canceled = t.status === 'canceled';
  // Zip 56: the date stays once tickets are open (Plans changed? Reschedule moves it).
  const dateLocked = t.status === 'tickets' || canceled;
  const counts = useMemo(() => new Map(dateCounts(t.offeredDates, t.signups).map((c) => [c.day, c.names])), [t]);
  const best = Math.max(0, ...[...counts.values()].map((x) => x.length));
  const months = useMemo(() => (t.offeredDates.length ? monthsBetween(t.offeredDates[0], t.offeredDates[t.offeredDates.length - 1]) : []), [t.offeredDates]);
  const offered = new Set(t.offeredDates);
  const today = todayKeyOf(ctx.d.now, ctx.d.group.timezone);
  // A day that has passed can no longer be picked (its count still shows).
  const look = (d: string): DayLook => (d === t.finalDate ? 'on' : offered.has(d) ? (d < today ? 'past' : 'open') : 'off');
  // Zip 64 (mock 03): the heat map: each date still to pick is shaded by how many can play, the brightest for the most, the palest for the fewest.
  const heatDays = t.offeredDates.filter((d) => d >= today && d !== t.finalDate);
  const heatN = heatDays.map((d) => counts.get(d)?.length ?? 0);
  const heatMin = Math.min(...heatN);
  const heatMax = Math.max(...heatN);
  const heat = (d: string): CSSProperties | undefined => {
    if (look(d) !== 'open') return undefined;
    const c = heatColors(counts.get(d)?.length ?? 0, heatMin, heatMax);
    return { '--heat-bg': c.light.bg, '--heat-edge': c.light.edge, '--heat-bg-dark': c.dark.bg, '--heat-edge-dark': c.dark.edge } as CSSProperties;
  };
  return (
    <div className="tm-form stack" data-tm-page="dates">
      <section className="tm-card tm-dates-card tm-dates-open" aria-label="Pick the date" data-tm-card="dates">
        <p className="tm-card-note tm-dates-note" data-tm-dates-note>
          {dateLocked
            ? canceled
              ? 'Canceled.'
              : 'Tickets are open on this date. To move it, use the gear: Plans changed? Reschedule.'
            : !t.finalDate && !t.offeredDates.some((d) => d >= today)
              ? 'Every date you offered has passed. Offer new ones with the gear: Dates offered.'
              : 'Brighter green means more can play. Tap a date to pick it.'}
        </p>
        <MonthCalendar
          months={months}
          variant="counts"
          boxed={false}
          label="Offered dates, with how many can play"
          look={look}
          onTap={(d) => !dateLocked && offered.has(d) && (d >= today || d === t.finalDate) && setDay(d)}
          dayStyle={dateLocked ? undefined : heat}
          badge={(d) => (offered.has(d) ? <span className={(counts.get(d)?.length ?? 0) === best && best > 0 ? 'tm-best-count' : undefined}>{counts.get(d)?.length ?? 0}</span> : null)}
        />
      </section>
      <DateSheet ctx={ctx} t={t} day={day} names={day ? (counts.get(day) ?? []) : []} onClose={() => setDay(null)} />
    </div>
  );
}

/**
 * Zip 71 (pictures pair-01 and pair-02): "Projected teams" and how many, one row at the bottom of the Levels card. Tap: the likely teams open in
 * place (strongest with weakest, the same pairing as Draft teams, highest team total first); tap the row again to fold it. No caret. Names and
 * numbers in the body font.
 */
function ProjectedTeams({ teams }: { teams: ProjectedTeam[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tm-proj" data-tm-projected data-tm-projected-open={open}>
      <button type="button" className="tm-proj-row" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-tm-projected-toggle>
        <span>Projected teams</span>
        <b data-tm-projected-count>{teams.length}</b>
      </button>
      {open && (
        <ul className="tm-proj-list" aria-label="Projected teams">
          {teams.map((x) => (
            <li key={`${x.players[0].id}+${x.players[1].id}`} className="tm-proj-team" data-tm-projected-team>
              <span className="tm-proj-names">
                {x.players.map((p, i) => (
                  <span key={p.id} className="tm-proj-p">
                    {i > 0 && <span className="tm-proj-plus"> + </span>}
                    {p.name}
                    {'\u00a0'}
                    <span className="tm-proj-lvl">{levelShort(p.level)}</span>
                  </span>
                ))}
              </span>
              <b className="tm-proj-total">{totalLabel(x.total)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mock 14: one player's level. Their own pick is tinted ("SAGE PICKED"), yours is boxed ("YOUR PICK"); Save sets it. */
function LevelSheet({ ctx, t, who, onClose }: { ctx: AdminCtx; t: AdminTournamentView; who: AdminTournamentView['signups'][number] | null; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const [pick, setPick] = useState<number | null>(null);
  const value = pick ?? who?.level ?? null;
  const first = (who?.name ?? '').split(' ')[0];
  return (
    <Sheet
      calmFocus
      open={!!who}
      title={who ? `${first}’s level` : 'Level'}
      onClose={() => {
        setPick(null);
        onClose();
      }}
      className="tm-level-sheet"
    >
      {who && (
        <div className="stack" data-tm-level-sheet>
          {/* Zip 66 (mock 05): the dates this player signed up for, as chips under the title. */}
          <div className="tm-signed-for" data-tm-signed-for>
            <span className="tm-signed-for-label">Signed up for</span>
            {who.dates.length === 0 ? (
              <span className="tm-signed-for-none">No dates</span>
            ) : (
              who.dates.map((d) => (
                <span key={d} className="tm-date-chip" data-tm-date-chip={d}>
                  {dayWords(d)}
                </span>
              ))
            )}
          </div>
          <LevelList flat value={value} onPick={setPick} theirPick={who.pickedLevel} theirName={who.name} />
          <button
            type="button"
            className="btn block tm-go"
            disabled={busy || value === null}
            onClick={async () => {
              if (value === null) return;
              const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}/level`, { playerId: who.playerId, level: value }), `${first} is ${levelShort(value)}`);
              if (ok) {
                setPick(null);
                onClose();
              }
            }}
            data-tm-level-save
          >
            {busy ? 'Saving…' : `Save ${levelOf(value ?? 0)?.short ?? ''}`}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** One offered date: who can make it, and Pick (or, for the picked one, take it back). */
/**
 * Zip 60: the Finalize screen. Tapping a date no longer locks it: this opens with that date's facts (who can make it, what the plan fits, the votes of
 * those same players and who wins), a format chooser that starts on the winner, Pay by and the ticket price, and a Finalize date button. Back locks
 * nothing. Finalizing does what Pick date did (the date, tickets open, the format, the alert). The votes are counted again when it lands: if the
 * winner moved while this was open it says so and locks nothing.
 */
function FinalizeBody({ ctx, t, day, onClose }: { ctx: AdminCtx; t: AdminTournamentView; day: string; onClose: () => void }) {
  const tz = ctx.d.group.timezone;
  const nowMs = Date.parse(ctx.d.now);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<FinalizeView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choice, setChoice] = useState<FormatChoice | null>(null);
  const [payDay, setPayDay] = useState('');
  const [payMinutes, setPayMinutes] = useState(19 * 60);
  // Zip 64: "Plays", the real start and end (7:30 PM to 10:00 PM to start).
  const [start, setStart] = useState(19 * 60 + 30);
  const [end, setEnd] = useState(22 * 60);
  // Zip 57: the Courts row (1 or 2, from the tournament's courts field: 2 to start).
  const [courts, setCourts] = useState<1 | 2>(2);
  const [touched, setTouched] = useState({ pay: false });
  /** Read the facts for this date. `keep`: after a "votes changed" answer the organizer's own edits stay. */
  async function load(keep: boolean) {
    try {
      const v = await api<FinalizeView>('GET', `/api/admin/tournament/${t.id}/finalize?date=${encodeURIComponent(day)}`);
      setView(v);
      setFailed(null);
      if (!keep) {
        setChoice(v.winner ? 'vote' : v.format);
        const p = payByParts(v.payBy, tz);
        setPayDay(p.day);
        setPayMinutes(p.minutes);
        setStart(v.start);
        setEnd(v.start + v.minutes);
        setCourts(v.courts === 1 ? 1 : 2);
      } else if (!v.winner && choice === 'vote') setChoice(v.format);
    } catch (err) {
      setFailed(errText(err));
    }
  }
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, t.id]);
  if (failed)
    return (
      <div className="stack" data-tm-finalize-error>
        <p className="field-error" role="alert">
          {failed}
        </p>
        <button type="button" className="btn secondary" onClick={onClose} data-tm-finalize-back>
          Back
        </button>
      </div>
    );
  if (!view) return <p className="tm-card-note" data-tm-finalize-loading>Looking…</p>;
  const winner = view.winner;
  const days = payByDays(day, tz, nowMs);
  const times = PAY_TIMES.includes(payMinutes) ? PAY_TIMES : [...PAY_TIMES, payMinutes].sort((a, b) => a - b);
  const payIso = payDay ? payByAt(payDay, payMinutes, tz) : null;
  const starts = PLAY_STARTS.includes(start) ? PLAY_STARTS : [...PLAY_STARTS, start].sort((a, b) => a - b);
  const ends = playEnds(start, end);
  async function finalize() {
    if (!payIso || busy) return;
    setBusy(true);
    try {
      await api('PUT', `/api/admin/tournament/${t.id}/date`, {
        date: day,
        format: choice ?? undefined,
        start,
        minutes: end - start,
        courts,
        ...(touched.pay ? { payBy: payIso } : {}),
        ...(winner ? { seenWinner: winner.format } : {}),
      });
      // Zip 64: the small venue reminder on Home ("Call the venue: keep courts 1 and 2 together, 7:30 to 10 PM"), until Done.
      venueAsk(t.id, day, start, end - start);
      // The date is locked: a failed refresh must not read as a failed lock (the screen refreshes itself in 5 seconds).
      await ctx.reload().catch(() => undefined);
      toast(`${dayLong(day)} is the date. Tickets are open.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'votes_changed') {
        // The votes moved the winner while this was open: nothing was locked. Show the new counts and say so; the organizer taps Finalize again.
        await load(true);
        setBusy(false);
        setNotice(err.message);
      } else {
        toast(errText(err), 'error');
        if (err instanceof ApiError && err.status === 409) void ctx.reload();
      }
    } finally {
      setBusy(false);
    }
  }
  // Mock 04: Auto (the vote's winner under it), Doubles, Americano. With no vote (a style chosen when it was created), Auto keeps that style.
  const autoFormat = winner?.format ?? view.format;
  const styles: { key: FormatChoice; name: string; sub?: string }[] = [
    { key: 'vote', name: 'Auto', sub: shortStyle(autoFormat) },
    { key: 'doubles', name: 'Locked doubles' },
    { key: 'americano', name: 'Americano' },
  ];
  const picked = choice === 'doubles' || choice === 'americano' ? choice : 'vote';
  // Zip 57 (mocks 60 and 61): the game plan for the players who can make this date, the courts and the hours (shared/tournamentPlan.ts, the one
  // source). Never blocks Finalize.
  // Zip 70: the count the Plan expects (Alex's saved Expect number, else who can make this date); the fit line names the style really played,
  // and the money line (THE money line) follows Time and Courts as they change (picture 4).
  const count = t.expectSaved && t.expected ? t.expected : view.players.length;
  const plan = nightPlan(count, courts, end - start, styleAtClose(picked === 'vote' ? autoFormat : picked, count));
  const fit = count >= 6 ? fitWords(plan, start) : { fits: false, text: `${view.players.length} can play. A tournament needs at least 6.` };
  // Zip 85: the same shared function as the Time and Plan boxes and the card (the style picked here, then the odd-count rule).
  const money = planMoney({
    format: picked === 'vote' ? autoFormat : picked,
    closed: false,
    expected: expectedPlayers({ saved: t.expectSaved ? (t.expected ?? null) : null, suggested: view.players.length, locked: 0 }),
    courts,
    minutes: end - start,
    ticketCents: view.ticketCents,
    championCents: t.championCreditCents,
    secondCents: t.secondCreditCents,
    // Zip 87: the box of the style the night would play.
    prizes: prizesOf(t),
  });
  const outside = venueHoursProblem(ctx, day, start, end);
  return (
    <div className="stack tm-finalize tm-fin1" data-tm-finalize={day}>
      <section className="tm-fin-who" aria-label="Players for this date" data-tm-fin-players>
        <p className="tm-fin-count">
          <b data-tm-fin-count>{view.players.length}</b> can play {dayWords(day)}
        </p>
        {view.players.length > 0 && <p className="tm-fin-names" data-tm-fin-names>{view.players.join(', ')}</p>}
        {view.over > 0 && (
          <p className="tm-card-note tm-fin-over" data-tm-fin-over>
            {view.over} over the {MAX_SPOTS} spots. Once {MAX_SPOTS} are locked in, the rest can join standby.
          </p>
        )}
      </section>
      <section className="tm-fin-style-block" aria-label="Style" data-tm-fin-format>
        <h3 className="tm-label">Style</h3>
        <div className="segmented tm-fin-style" role="group" aria-label="Style">
          {styles.map((x) => (
            <button key={x.key} type="button" aria-pressed={picked === x.key} disabled={busy} onClick={() => setChoice(x.key === 'vote' ? (winner ? 'vote' : view.format) : x.key)} data-format={x.key}>
              <span className="tm-fin-style-name">{x.name}</span>
              {x.sub && <span className="tm-fin-style-sub">{x.sub}</span>}
            </button>
          ))}
        </div>
        {view.votes && (
          <p className="tm-fin-votes" data-tm-fin-counts>
            Votes: Locked doubles {view.votes.locked} · Americano {view.votes.americano} · Either {view.votes.either}
          </p>
        )}
      </section>
      <div className="tm-fin-rows" data-tm-fin-settings>
        <div className="tm-fin-row" role="group" aria-label="Time">
          <span className="tm-fin-row-label">Time</span>
          <span className="tm-fin-boxes">
            <select
              className="tm-select tm-fin-box"
              aria-label="Start"
              value={start}
              onChange={(e) => {
                const next = Number(e.target.value);
                // Keep the length when the start moves (never past midnight).
                setEnd(Math.min(next + (end - start), 24 * 60, next + 360));
                setStart(next);
              }}
              data-tm-fin-start
            >
              {starts.map((m) => (
                <option key={m} value={m}>
                  {timeWords(m)}
                </option>
              ))}
            </select>
            <span className="tm-fin-to">to</span>
            <select className="tm-select tm-fin-box" aria-label="End" value={end} onChange={(e) => setEnd(Number(e.target.value))} data-tm-fin-end>
              {ends.map((m) => (
                <option key={m} value={m}>
                  {timeWords(m % (24 * 60))}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="tm-fin-row" role="group" aria-label="Courts">
          <span className="tm-fin-row-label">Courts</span>
          <span className="segmented tm-fin-courts">
            {([1, 2] as const).map((c) => (
              <button key={c} type="button" aria-pressed={courts === c} disabled={busy} onClick={() => setCourts(c)} data-tm-fin-courts={c}>
                {c}
              </button>
            ))}
          </span>
        </div>
        <div className="tm-fin-row" role="group" aria-label="Pay by">
          <span className="tm-fin-row-label">Pay by</span>
          <span className="tm-fin-boxes">
            <select
              className="tm-select tm-fin-box"
              aria-label="Pay by day"
              value={payDay}
              onChange={(e) => {
                setPayDay(e.target.value);
                setTouched({ pay: true });
              }}
              data-tm-fin-pay-day
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayWords(d)}
                </option>
              ))}
            </select>
            <select
              className="tm-select tm-fin-box"
              aria-label="Pay by time"
              value={payMinutes}
              onChange={(e) => {
                setPayMinutes(Number(e.target.value));
                setTouched({ pay: true });
              }}
              data-tm-fin-pay-time
            >
              {times.map((m) => (
                <option key={m} value={m}>
                  {timeWords(m)}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>
      {fit && (
        <p className={fit.fits ? 'tm-fin-fit' : 'tm-fin-fit tm-fin-tight'} role="status" data-tm-fin-fit={fit.fits ? 'fits' : 'tight'}>
          {fit.text}
        </p>
      )}
      <MoneyLineText m={money} />
      {outside && (
        <p className="field-error" role="alert" data-tm-fin-hours>
          {outside}
        </p>
      )}
      {notice && (
        <p className="tm-card-note tm-fin-notice" role="status" data-tm-fin-notice>
          {notice}
        </p>
      )}
      <div className="tm-fin-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={onClose} data-tm-finalize-back>
          Back
        </button>
        <button type="button" className="btn tm-go" disabled={busy || !payIso || !!outside} onClick={() => void finalize()} data-tm-finalize-go>
          {busy ? 'Working…' : 'Finalize date'}
        </button>
      </div>
    </div>
  );
}

/** Zip 64: the style cards' "Not now" and X, remembered on this phone (each key is one switch, so a new switch shows again). */
const STYLE_SEEN_KEY = 'pb_tour_style_seen';
function readStyleSeen(): string[] {
  try {
    const v = JSON.parse(storageGet(STYLE_SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
/**
 * Zip 80 (Alex): a regular game on the same date as this finalized tournament: "Tue Dec 1 has a regular game and The Cold Open." Cancel game
 * opens the usual cancel flow for that game (the gear menu's Cancel session sheet); the X hides the card on this phone (per game and date, so
 * a moved date or another game shows a fresh one). Organizer only; nothing new is read (the dashboard's games and tournament).
 */
function ClashCard({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const tz = ctx.d.group.timezone;
  const today = gameDayKey(ctx.d.now, tz);
  const games = clashingGames(
    ctx.d.sessions.map((x) => ({ id: x.id, startsAt: x.startsAt, canceled: x.state.flags.canceled })),
    t,
    tz,
    today,
  );
  const k = games.length ? `clash:${t.id}:${t.finalDate}:${games.map((g) => g.id).join(',')}` : '';
  const [seen, hide] = useStyleSeen(k);
  if (!games.length || seen) return null;
  const title = clashWords(t.finalDate!, t.name, games.length);
  return (
    <AlertCard
      as="section"
      tone="amber"
      icon="court"
      label={title}
      title={title}
      data={{ 'data-tm-clash': games.map((g) => g.id).join(',') }}
      xLabel="Close"
      onX={hide}
      // The button under the words (the actions row, as the style switch card), so the line keeps the card's width at 390 and narrower.
      actions={
        <button type="button" className="ac-btn ac-out" data-ac-tone="red" onClick={() => ctx.open('cancel', games[0].id)} data-tm-clash-cancel>
          Cancel game
        </button>
      }
    />
  );
}

function useStyleSeen(key: string): [boolean, () => void] {
  const [seen, setSeen] = useState<string[]>(readStyleSeen);
  return [
    seen.includes(key),
    () => {
      const next = [...readStyleSeen().filter((x) => x !== key), key].slice(-30);
      try {
        storageSet(STYLE_SEEN_KEY, JSON.stringify(next));
      } catch {
        /* it shows again on this phone */
      }
      setSeen(next);
    },
  ];
}

/**
 * Zip 64 (rule c): "The Cold Open switched to Americano (odd number of players)." The site's alert card, with an X. Zip 57: "Copy text for the
 * group" on it (who backed out, the date, the price, the last moment to join, the site's link), so one more player can make it even again.
 */
function OddSwitchCard({ ctx, t, k }: { ctx: AdminCtx; t: AdminTournamentView; k: string }) {
  const [seen, hide] = useStyleSeen(k);
  const toast = useToast();
  if (seen) return null;
  const tz = ctx.d.group.timezone;
  const who = t.backedOut[0]?.name ?? null;
  // Zip 70 (dry run fix 3): the last moment to join is 3 hours before the start; once that has passed the text leaves the pay line out.
  const cutoffMs = t.finalDate ? salesCutoffMs(startMsOf(t.finalDate, t.start, tz)) : null;
  const cutoff = cutoffMs !== null && Date.parse(ctx.d.now) < cutoffMs ? payByLabel(new Date(cutoffMs).toISOString(), tz, t.finalDate) : null;
  const text = [
    who ? `${who} dropped out of ${t.name}.` : `A spot opened in ${t.name}.`,
    `One spot is open${t.finalDate ? ` on ${dayWords(t.finalDate)}` : ''}: ${formatPrice(t.ticketCents)}${cutoff ? `, pay by ${cutoff}` : ''}.`,
    siteAddress(ctx.d.group.playerLink),
  ].join(' ');
  return (
    <AlertCard
      as="section"
      tone="amber"
      icon="info"
      label="Style switched"
      title={oddSwitchWords(t.name, t.lockedIn ?? 0)}
      sub={oddSwitchSub(t.lockedIn ?? 0)}
      data={{ 'data-tm-odd-switch': true }}
      xLabel="Close"
      onX={hide}
      // Zip 70 (dry run fix 2): the button sits under the words (the actions row), so the text keeps the card's width at 390 and narrower.
      actions={
        <button
          type="button"
          className="ac-btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast('Copied. Paste it in the group text.');
            } catch {
              toast(text);
            }
          }}
          data-tm-copy-text={text}
        >
          Copy text for the group
        </button>
      }
    />
  );
}

/** Zip 64 (rule d): the count is even again after an odd switch. Never switches by itself: Switch or Not now. */
function SwitchBackCard({ ctx, t, k }: { ctx: AdminCtx; t: AdminTournamentView; k: string }) {
  const { busy, save } = useSave(ctx);
  const [seen, hide] = useStyleSeen(k);
  if (seen) return null;
  return (
    <AlertCard
      as="section"
      tone="blue"
      icon="info"
      label="Switch back"
      title="Switch back to Locked doubles?"
      sub={`${t.lockedIn ?? 0} locked in now, an even number.`}
      data={{ 'data-tm-switch-back': true }}
      actions={
        <>
          <button type="button" className="ac-btn" disabled={busy} onClick={() => void save(() => api('POST', `/api/admin/tournament/${t.id}/switch-back`, {}), 'Back to Locked doubles')} data-tm-switch-back-go>
            Switch
          </button>
          <button type="button" className="ac-btn ac-out" disabled={busy} onClick={hide} data-tm-switch-back-later>
            Not now
          </button>
        </>
      }
    />
  );
}

/** Zip 64: "Tue Dec 8" (the Finalize screen's words, no comma). */
const dayWords = (d: string) => dayLong(d).replace(',', '');
/** Zip 64: the style's short name on the Finalize screen ("Doubles" under Auto). */
const shortStyle = (f: TournamentFormat) => (f === 'americano' ? 'Americano' : 'Locked doubles');
/** Zip 64: "Plays" starts from 4:00 PM to 9:30 PM, on the half hour. */
const PLAY_STARTS = Array.from({ length: 12 }, (_, i) => 16 * 60 + i * 30);
/** The ends for a start: 1 to 6 hours after it, on the half hour, never past midnight (the current end always listed). */
function playEnds(start: number, end: number): number[] {
  const out: number[] = [];
  for (let m = start + 60; m <= Math.min(start + 360, 24 * 60); m += 30) out.push(m);
  if (!out.includes(end) && end > start) out.push(end);
  return out.sort((a, b) => a - b);
}

/**
 * Zip 64: after Finalize, one small reminder on the organizer's Home: "Call the venue: keep courts 1 and 2 together, 7:30 to 10 PM", until Done.
 * Remembered on this phone only (the site's own alert card; nothing new on the server).
 */
const VENUE_KEY = 'pb_tour_venue';
type VenueAsk = { id: string; day: string; start: number; minutes: number };
function venueAsk(id: string, day: string, start: number, minutes: number) {
  try {
    storageSet(VENUE_KEY, JSON.stringify({ id, day, start, minutes } satisfies VenueAsk));
  } catch {
    /* no reminder on this phone: nothing else depends on it */
  }
  // Zip 70: a card already on screen reads it again (a Time or Plan save shows the reminder with the new times at once).
  try {
    window.dispatchEvent(new Event(VENUE_EVENT));
  } catch {
    /* it shows on the next Home load */
  }
}
const VENUE_EVENT = 'pb-venue-ask';
function readVenueAsk(): VenueAsk | null {
  try {
    const v = JSON.parse(storageGet(VENUE_KEY) ?? 'null');
    return v && typeof v.id === 'string' && typeof v.start === 'number' && typeof v.minutes === 'number' ? (v as VenueAsk) : null;
  } catch {
    return null;
  }
}
export function VenueAlertCard({ t }: { t: AdminTournamentView }) {
  const [ask, setAsk] = useState<VenueAsk | null>(readVenueAsk);
  useEffect(() => {
    const again = () => setAsk(readVenueAsk());
    window.addEventListener(VENUE_EVENT, again);
    return () => window.removeEventListener(VENUE_EVENT, again);
  }, []);
  if (!ask || ask.id !== t.id || t.status !== 'tickets' || t.finalDate !== ask.day) return null;
  return (
    <AlertCard
      as="section"
      tone="blue"
      icon="court"
      label="Call the venue"
      // Zip 64 part 8: the courts follow the plan (the same count as the card): 1 court, or courts 1 and 2 together.
      title={`Call the venue: ${t.courts === 1 ? 'keep court 1' : `keep courts 1 and ${t.courts} together`}, ${planRange(t.start, t.minutes)}`}
      data={{ 'data-tm-venue-alert': true }}
      action={
        <button
          type="button"
          className="ac-btn"
          onClick={() => {
            try {
              storageRemove(VENUE_KEY);
            } catch {
              /* it shows again on this phone */
            }
            setAsk(null);
          }}
          data-tm-venue-done
        >
          Done
        </button>
      }
    />
  );
}

function DateSheet({ ctx, t, day, names, onClose }: { ctx: AdminCtx; t: AdminTournamentView; day: string | null; names: string[]; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const cant = day ? t.signups.filter((s) => !s.dates.includes(day)).map((s) => s.name) : [];
  const isFinal = !!day && day === t.finalDate;
  return (
    <Sheet calmFocus open={!!day} title={day ? (day === t.finalDate ? dayLong(day) : `Finalize ${dayWords(day)}`) : 'Date'} onClose={onClose} className="tm-date-sheet">
      {day && (
        <div className="stack" data-tm-date-sheet={day}>
          {isFinal && (
            <>
              <p className="tm-date-count">
                <b>{names.length}</b> of {t.signups.length} can play
              </p>
              {names.length > 0 && (
                <p className="tm-date-names">
                  <span>Can play:</span> {names.join(', ')}
                </p>
              )}
              {cant.length > 0 && (
                <p className="tm-date-names tm-cant">
                  <span>Can’t:</span> {cant.join(', ')}
                </p>
              )}
            </>
          )}
          {isFinal ? (
            <>
              <p className="tm-card-note">This is the date.</p>
              <button
                type="button"
                className="btn secondary block"
                disabled={busy}
                onClick={async () => {
                  const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}/date`, { date: null }), 'Date taken back');
                  if (ok) onClose();
                }}
                data-tm-date-clear
              >
                Take back the date
              </button>
            </>
          ) : (
            <FinalizeBody ctx={ctx} t={t} day={day} onClose={onClose} />
          )}
        </div>
      )}
    </Sheet>
  );
}
