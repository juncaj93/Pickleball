// Zip 55 "Tournaments", piece 1, the ORGANIZER side (server/tournament.ts): Settings > Schedule > Create tournament (mocks 03, 01, 02, 24),
// the tournament's own page (who can see it, the level list of mock 14, how many can make each date and picking it, Edit, Cancel), the card on
// Home, and the level and date sheets. Only drawn while the switch is on for this phone (ctx.d.tournaments). No money moves here: the ticket
// price and the champion credit are stored for pieces 2 and 3.
import { theName } from '../../../shared/credit';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AdminTicketView,
  type AdminTournamentView,
  CREATE_MONTHS,
  startLabel,
  stubParts,
  dateCounts,
  heatColors,
  oddSwitchWords,
  dayLong,
  DEFAULT_CREDIT_CENTS,
  DEFAULT_TICKET_CENTS,
  levelOf,
  levelShort,
  MAX_DATES,
  MAX_PRICE_CENTS,
  monthsBetween,
  monthStartPlus,
  NAME_MAX,
  planTitle,
  planRange,
  type Visibility,
  WINNERS,
  formatName,
  formatRule,
  DEFAULT_FORMAT_CHOICE,
  type FinalizeView,
  type FormatChoice,
  type TournamentFormat,
  VOTE_LABEL,
  DEFAULT_SECOND_CREDIT_CENTS,
  MAX_SPOTS,
  type TournamentSignupView,
  prizeCentsOf,
} from '../../../shared/tournament';
import { EXPECT_MAX, EXPECT_MIN, expectedPlayers, type MoneyLine, moneyLine, moneyRowLabel } from '../../../shared/tournamentMoney';
import { formatPrice, parseDollars } from '../../../shared/money';
import { evensWarning, payByAt, payByDays, payByLabel, payByParts, salesCutoffMs, startMsOf, tournamentRemindText } from '../../../shared/tournamentTickets';
import { siteAddress, smsHref } from '../../../shared/messages';
import { signupCloseDefault, signupReminderText } from '../../../shared/tournamentNudge';
import { AlertCard } from '../../AlertCard';
import { localParts } from '../../../shared/time';
import { api, ApiError, copyText, isIOS, storageGet, storageRemove, storageSet, useNow, VIEW_ONLY_MESSAGE } from '../../lib';
import { ConfirmDialog, Pickleball, Sheet, useToast } from '../../ui';
import { type DayLook, LevelList, MonthCalendar } from '../../tournament/parts';
import type { AdminCtx } from '../Admin';
import { TournamentDayCards } from './TournamentDay';
import { fitWords, nightPlan } from '../../../shared/tournamentPlan';
import { type ProjectedTeam, projectedTeams } from '../../../shared/projectedTeams';
import { totalLabel } from '../../../shared/tournamentSchedule';
import './tournament-admin.css';

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
  async function save(fn: () => Promise<unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      await ctx.reload();
      toast(done);
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
      ? `${dayLong(t.finalDate)} · ${lockedNum(t)} of ${t.spots ?? t.size} locked in`
      : t.status === 'date_picked' && t.finalDate
        ? `${dayLong(t.finalDate)} · ${t.signups.length} signed up`
        : t.status === 'rescheduled'
          ? `Rescheduled · ${t.signups.length} signed up${heldOf(t) ? ` · ${heldOf(t)} ${heldOf(t) === 1 ? 'ticket' : 'tickets'} held` : ''}`
          : `Sign-up open · ${t.signups.length} signed up`;

/** Zip 56: the tickets in a spot (Who's in), in the order they were taken. */
const lockedOf = (t: AdminTournamentView) => (t.tickets ?? []).filter((k) => k.place === 'spot' && !k.out);
/**
 * Zip 72 (dry run): THE locked-in number on every organizer row ("7 of 10", "8 locked in", the Tickets chip, the Plan chip): the server's count
 * (Zip 63's trust rule: every spot and every I paid for a whole ticket still waiting), the same one "8 locked in. Draft the teams." and the
 * style use, and what players see. The spots ("of 10") are counted as before.
 */
const lockedNum = (t: AdminTournamentView): number => t.lockedIn ?? lockedOf(t).length;
/** Zip 56: the waitlist, in the order they joined it. */
const lineOf = (t: AdminTournamentView) => (t.tickets ?? []).filter((k) => k.place === 'line' && !k.out);
/** Zip 56: I paid taps waiting for the organizer's answer. */
const claimsOf = (t: AdminTournamentView) => (t.tickets ?? []).filter((k) => k.claimCents > 0);
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
        <span className="tm-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {t && (
        <button type="button" className="set-row tm-set-row" onClick={() => setOpen('page')} data-tm-open-row>
          <span className="set-label">
            <span className="set-name">{t.name}</span>
            <span className="set-hint">{statusLine(t)}</span>
          </span>
          <span className="tm-chevron" aria-hidden="true">
            ›
          </span>
        </button>
      )}
      <CreateSheet ctx={ctx} open={open === 'create'} onClose={() => setOpen(null)} />
      {t && <TournamentPage ctx={ctx} t={t} open={open === 'page'} onClose={() => setOpen(null)} />}
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
      {claims.map((k) => (
        <TicketClaimCard key={k.playerId} ctx={ctx} t={t} k={k} />
      ))}
      {/* Zip 66b: the tickets card (Paid, Not paid yet, Remind all unpaid) and the count card are folded into the card below. */}
      {/* Zip 66: one card for every stage, starting closed (mocks 01 and 02). */}
      <HomeCard ctx={ctx} t={t} />
    </>
  );
}

/** Zip 66: "Doubles 2 · Americano 0 · Either 6" (the card's Votes row; Doubles, not Locked). */
const votesWords = (v: NonNullable<AdminTournamentView['votes']>) => `Locked doubles ${v.locked} · Americano ${v.americano} · Either ${v.either}`;
/** Zip 66: "6 players · 1 court · 2.5 hrs" (the card's Plan row). */
// Zip 70: the Plan's expected players (the saved Expect number, else the site's suggestion), not the plan size.
const planShort = (t: AdminTournamentView) => `${t.expected ?? t.size} players · ${t.courts} ${t.courts === 1 ? 'court' : 'courts'} · ${t.minutes / 60} ${t.minutes === 60 ? 'hr' : 'hrs'}`;

/** Zip 70: the winners' credits now set, as the server's money line counted them (Tickets minus Courts minus You). */
const prizeOf = (t: AdminTournamentView) => (t.money ? t.money.ticketsCents - t.money.courtCents - t.money.youCents : 0);

/** Zip 70 (pictures 1 and 3): "+$6" in green when the organizer makes money, "$30" in red (no minus) when it costs them. */
function MoneyValue({ cents, data }: { cents: number; data?: string }) {
  return (
    <b className={cents >= 0 ? 'tm-money-up' : 'tm-money-down'} {...(data ? { [data]: cents >= 0 ? 'up' : 'down' } : {})}>
      {cents >= 0 ? `+${formatPrice(cents)}` : formatPrice(-cents)}
    </b>
  );
}

/** Zip 70 (pictures 2, 4 and 7): "Courts $96 · Tickets $126 · You +$30" (or "Your cost $30" in red), from THE money line. */
function MoneyLineText({ m }: { m: MoneyLine }) {
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
      </span>
    </p>
  );
}

/** Zip 70: the fit line for a count, courts and hours, naming the style really played (an odd count is Americano). */
function FitLine({ n, courts, minutes, start, format }: { n: number; courts: number; minutes: number; start: number; format: TournamentFormat }) {
  const fit = fitWords(nightPlan(n, courts, minutes, format), start);
  return (
    <p className={fit.fits ? 'tm-fin-fit' : 'tm-fin-fit tm-fin-tight'} role="status" data-tm-box-fit={fit.fits ? 'fits' : 'tight'}>
      {fit.text}
    </p>
  );
}

/**
 * Zip 70 (picture 2): tap Time: the start and the end (the Finalize pickers' steps), the fit line and the money line as they change, Save.
 * Everything that depends on the time follows on the server; the "Call the venue" card shows again with the new times.
 */
function TimeBox({ ctx, t, onDone }: { ctx: AdminCtx; t: AdminTournamentView; onDone: () => void }) {
  const { busy, save } = useSave(ctx);
  const [start, setStart] = useState(t.start);
  const [end, setEnd] = useState(t.start + t.minutes);
  const starts = PLAY_STARTS.includes(start) ? PLAY_STARTS : [...PLAY_STARTS, start].sort((a, b) => a - b);
  const ends = playEnds(start, end);
  const n = t.expected ?? t.size;
  const m = moneyLine({ expected: n, courts: t.courts, minutes: end - start, ticketCents: t.ticketCents, prizeCents: prizeOf(t) });
  return (
    <div className="tm-hc-box tm-hc-edit" data-tm-time-box>
      <span className="tm-fin-boxes tm-hc-times" role="group" aria-label="Time">
        <select
          className="tm-select tm-fin-box"
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
              {timeWords(x)}
            </option>
          ))}
        </select>
        <span className="tm-fin-to">to</span>
        <select className="tm-select tm-fin-box" aria-label="End" value={end} disabled={busy} onChange={(e) => setEnd(Number(e.target.value))} data-tm-time-end>
          {ends.map((x) => (
            <option key={x} value={x}>
              {timeWords(x % (24 * 60))}
            </option>
          ))}
        </select>
      </span>
      <FitLine n={n} courts={t.courts} minutes={end - start} start={start} format={t.format} />
      <MoneyLineText m={m} />
      <button
        type="button"
        className="btn block tm-hc-save"
        disabled={busy}
        onClick={async () => {
          const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}/time`, { start, minutes: end - start }), 'Time saved');
          if (ok) {
            if (t.finalDate) venueAsk(t.id, t.finalDate, start, end - start);
            onDone();
          }
        }}
        data-tm-time-save
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

/**
 * Zip 70 (picture 7): tap Plan: Expect with - and + (6 to 16, never fewer than locked in) and Courts 1 | 2, the fit line and the money line,
 * Save. The site keeps suggesting the number until one is saved; the saved courts are the night's real courts.
 */
function PlanBox({ ctx, t, onDone }: { ctx: AdminCtx; t: AdminTournamentView; onDone: () => void }) {
  const { busy, save } = useSave(ctx);
  const low = Math.max(EXPECT_MIN, t.lockedIn ?? 0);
  const [n, setN] = useState(Math.min(EXPECT_MAX, Math.max(low, t.expected ?? t.size)));
  const [courts, setCourts] = useState<1 | 2>(t.courts === 1 ? 1 : 2);
  const m = moneyLine({ expected: n, courts, minutes: t.minutes, ticketCents: t.ticketCents, prizeCents: prizeOf(t) });
  return (
    <div className="tm-hc-box tm-hc-edit" data-tm-plan-box>
      <div className="tm-fin-row tm-hc-plan-row" role="group" aria-label="Expect">
        <span className="tm-fin-row-label">Expect</span>
        <span className="tm-step">
          <button type="button" className="tm-step-btn" aria-label="One fewer" disabled={busy || n <= low} onClick={() => setN((x) => Math.max(low, x - 1))} data-tm-expect-minus>
            −
          </button>
          <b className="tm-step-n" aria-live="polite" data-tm-expect>
            {n}
          </b>
          <button type="button" className="tm-step-btn" aria-label="One more" disabled={busy || n >= EXPECT_MAX} onClick={() => setN((x) => Math.min(EXPECT_MAX, x + 1))} data-tm-expect-plus>
            +
          </button>
        </span>
      </div>
      <div className="tm-fin-row tm-hc-plan-row" role="group" aria-label="Courts">
        <span className="tm-fin-row-label">Courts</span>
        <span className="segmented tm-fin-courts">
          {([1, 2] as const).map((c) => (
            <button key={c} type="button" aria-pressed={courts === c} disabled={busy} onClick={() => setCourts(c)} data-tm-plan-courts={c}>
              {c}
            </button>
          ))}
        </span>
      </div>
      <FitLine n={n} courts={courts} minutes={t.minutes} start={t.start} format={t.format} />
      <MoneyLineText m={m} />
      <button
        type="button"
        className="btn block tm-hc-save"
        disabled={busy}
        onClick={async () => {
          const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}/plan`, { expected: n, courts }), 'Plan saved');
          if (ok) {
            // The venue card follows the courts (once the date is finalized).
            if (t.finalDate && t.startSet && courts !== t.courts) venueAsk(t.id, t.finalDate, t.start, t.minutes);
            onDone();
          }
        }}
        data-tm-plan-save
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
/** Zip 66: the Style row ("Players vote" while the vote is open). */
const styleWords = (t: AdminTournamentView) => (t.formatPending ? 'Players vote' : formatName(t.format));
/** Zip 66: the players whose votes the counts are: everyone on the list before a date, then those who can make the picked date. */
const votersOf = (t: AdminTournamentView) => t.signups.filter((s) => !t.finalDate || s.dates.includes(t.finalDate));

/** Zip 66 (mock 07): who voted what, inside the card under the Votes row. Organizer only. */
function VotesBox({ t }: { t: AdminTournamentView }) {
  const voters = votersOf(t);
  const rows: { key: 'locked' | 'americano' | 'either'; label: string }[] = [
    { key: 'locked', label: 'Doubles' },
    { key: 'americano', label: 'Americano' },
    { key: 'either', label: 'Either' },
  ];
  return (
    <dl className="tm-hc-box tm-hc-votes" data-tm-votes-box>
      {rows.map((r) => {
        const names = voters.filter((s) => (s.vote ?? 'either') === r.key).map((s) => s.name);
        return (
          <div key={r.key} className="tm-hc-vrow" data-tm-votes-row={r.key}>
            <dt>{r.label}</dt>
            <dd className={names.length ? undefined : 'tm-hc-nobody'}>{names.length ? names.join(', ') : 'Nobody'}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Zip 66 (mock 09): the names not signed up, and Copy reminder text. Organizer only. */
function MissingBox({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const toast = useToast();
  const ns = t.notSignedUp!;
  const tz = ctx.d.group.timezone;
  async function copy() {
    const close = ns.closeAt ?? signupCloseDefault(Date.parse(ctx.d.now), tz);
    const text = signupReminderText(
      ns.players.map((p) => p.name),
      t.name,
      close,
      tz,
      siteAddress(ctx.d.group.playerLink),
    );
    const ok = await copyText(text);
    toast(ok ? 'Copied' : 'Could not copy. Try again.', ok ? undefined : 'error');
  }
  return (
    <div className="tm-hc-box tm-hc-missing" data-tm-missing-box={ns.mode}>
      <p className="tm-hc-names" data-tm-missing-names>
        {ns.players.map((p) => p.name).join(', ')}
      </p>
      <button type="button" className="tm-hc-copy" onClick={() => void copy()} data-tm-missing-copy>
        Copy reminder text
      </button>
    </div>
  );
}

/**
 * Zip 66b (picture A4): who still has to pay, in the soft box under the Not paid yet row, and Remind all unpaid, which works exactly like the old
 * tickets card's (Zip 63, mock 14): it opens Messages with every unpaid person's number and a ready text; the organizer taps Send. The site never
 * sends a text. "No number for <name>" when a number is missing.
 */
function UnpaidBox({ ctx, t, unpaid }: { ctx: AdminCtx; t: AdminTournamentView; unpaid: TournamentSignupView[] }) {
  const now = useNow(60_000);
  const tz = ctx.d.group.timezone;
  const phoneOf = new Map(ctx.d.players.map((p) => [p.id, p.phone]));
  const phones = unpaid.map((s) => phoneOf.get(s.playerId)).filter((p): p is string => !!p);
  const missing = unpaid.filter((s) => !phoneOf.get(s.playerId)).map((s) => s.name);
  const body = tournamentRemindText(t.name, t.payBy!, t.finalDate!, now, tz, siteAddress(ctx.d.group.playerLink));
  return (
    <div className="tm-hc-box tm-hc-missing" data-tm-unpaid-box data-tm-remind={unpaid.length}>
      <p className="tm-hc-names" data-tm-unpaid-names>
        {unpaid.map((p) => p.name).join(', ')}
      </p>
      {missing.length > 0 && (
        <p className="tm-hc-nonum" data-tm-remind-missing>
          No number for {missing.join(', ')}
        </p>
      )}
      <a className="tm-hc-copy" href={smsHref(phones.length ? phones : null, body, isIOS)} data-tm-remind-btn>
        Remind all unpaid
      </a>
    </div>
  );
}

/** Zip 66: a row that opens a soft box under it (Votes, Not signed up). No arrow; tap again to close. */
function TapRow({ label, value, open, onTap, data, valueData, fit }: { label: string; value: ReactNode; open: boolean; onTap: () => void; data: string; valueData?: string; fit?: boolean }) {
  return (
    <button type="button" className="tm-row tm-hc-tap" aria-expanded={open} onClick={onTap} {...{ [data]: true }}>
      <span>{label}</span>
      <b className={fit ? 'tm-hc-val tm-hc-fit' : 'tm-hc-val'} {...(valueData ? { [valueData]: true } : {})}>
        {value}
      </b>
    </button>
  );
}

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 9.5l6 6 6-6" />
  </svg>
);

/**
 * Zip 66 (mocks 01, 02, 06 to 09): the tournament on the organizer's Home. One line to start (the pickleball, the name, "8 signed up", a chevron);
 * tap anywhere on it to open, tap again to close. It starts closed every time Home loads (nothing is remembered). Open: Style, Votes (tap: who
 * voted what), Not signed up (tap: the names and Copy reminder text), Plan, then the stage's buttons as before: Pick date and Edit (sign-up),
 * the ticket rows with Tickets and Cancel or reschedule (once the date is picked), or the Canceled note with Hide.
 */
function HomeCard({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const [open, setOpen] = useState(false);
  const [showVotes, setShowVotes] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [showUnpaid, setShowUnpaid] = useState(false);
  // Zip 70: the Time and Plan boxes (one open at a time; tap the row again to close).
  const [edit, setEdit] = useState<null | 'time' | 'plan'>(null);
  const [page, setPage] = useState<null | 'dates' | 'edit' | 'tickets'>(null);
  const tz = ctx.d.group.timezone;
  const canceled = t.status === 'canceled';
  const ticketsStage = t.status === 'date_picked' || t.status === 'tickets' || canceled;
  const today = todayKeyOf(ctx.d.now, tz);
  // Every offered date has passed and none is picked: players do not see the card any more (server/tournament.ts), so say it here.
  const datesPassed = !ticketsStage && !t.finalDate && !t.offeredDates.some((d) => d >= today);
  const ns = t.notSignedUp && t.notSignedUp.players.length > 0 ? t.notSignedUp : null;
  const evens = evensOf(t, ctx.d.now);
  const locked = lockedNum(t);
  const line = lineOf(t);
  const bodyId = `tm-hc-body-${t.id}`;
  // Zip 70: the Time row, once the date is finalized with real times (tickets open).
  const timeRow = t.status === 'tickets' && !!t.startSet && !!t.finalDate;
  // Zip 66b: who can make the date and has not paid (only while a spot can still be bought: tickets open, before Pay by, spots left).
  const unpaid = unpaidOf(t, ctx.d.now);
  // The pill (picture A3): "8 signed up" before tickets; once they are open "3 unpaid" (amber) while anyone has not paid, else "7 locked in".
  const pill = canceled
    ? { words: 'Canceled', cls: 'tm-chip tm-hc-pill' }
    : t.status === 'tickets'
      ? unpaid.length > 0
        ? { words: `${unpaid.length} unpaid`, cls: 'tm-chip tm-chip-unpaid tm-hc-pill' }
        : { words: `${locked} locked in`, cls: 'tm-chip tm-chip-ok tm-hc-pill' }
      : { words: `${t.signups.length} signed up`, cls: 'tm-chip tm-chip-ok tm-hc-pill' };
  return (
    <section className={open ? 'tm-hc tm-hc-open' : 'tm-hc'} aria-label={`${t.name}, ${formatName(t.format)} tournament`} data-tm-home={ticketsStage ? t.status : true} data-tm-open={open}>
      <h2 className="tm-hc-head">
        <button type="button" className="tm-hc-top" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((o) => !o)} data-tm-home-toggle>
          <span className="tm-hc-ball" aria-hidden="true">
            <Pickleball />
          </span>
          <span className="tm-hc-name">{t.name}</span>
          <span className={pill.cls} data-tm-stage data-tickets-card={t.status === 'tickets' ? `${locked}/${t.size}` : undefined}>
            {pill.words}
          </span>
          <span className="tm-hc-chev" aria-hidden="true">
            <ChevronIcon />
          </span>
        </button>
      </h2>
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
        <div className="tm-hc-body" id={bodyId} data-tm-home-body>
          <div className="tm-rows tm-hc-rows">
            {!canceled && (
              <div className="tm-row">
                <span>Style</span>
                <b className="tm-hc-val" data-tm-home-format={t.formatPending ? 'vote' : t.format}>
                  {styleWords(t)}
                </b>
              </div>
            )}
            {!canceled && t.votes && (
              <>
                <TapRow label="Votes" value={votesWords(t.votes)} open={showVotes} onTap={() => setShowVotes((v) => !v)} data="data-tm-votes-toggle" valueData="data-tm-vote-counts" fit />
                {showVotes && <VotesBox t={t} />}
              </>
            )}
            {!canceled && ns && (
              <>
                <TapRow label="Not signed up" value={ns.players.length} open={showMissing} onTap={() => setShowMissing((v) => !v)} data="data-tm-missing-toggle" valueData="data-tm-missing-count" />
                {showMissing && <MissingBox ctx={ctx} t={t} />}
              </>
            )}
            {ticketsStage && (
              <div className="tm-row">
                <span>Date</span>
                <b className="tm-hc-val tm-hc-fit" data-tm-row="date">
                  {timeRow ? dateOnly(t) : dateRow(t)}
                </b>
              </div>
            )}
            {/* Zip 70 (pictures 1 and 2): Time, its own row once the date is finalized; tap it to move the start or the end (until the night). */}
            {timeRow &&
              (t.timeOpen ? (
                <>
                  <TapRow label="Time" value={planRange(t.start, t.minutes)} open={edit === 'time'} onTap={() => setEdit((e) => (e === 'time' ? null : 'time'))} data="data-tm-time-toggle" valueData="data-tm-row-time" fit />
                  {edit === 'time' && <TimeBox key={`${t.start}-${t.minutes}`} ctx={ctx} t={t} onDone={() => setEdit(null)} />}
                </>
              ) : (
                <div className="tm-row">
                  <span>Time</span>
                  <b className="tm-hc-val tm-hc-fit" data-tm-row-time>
                    {planRange(t.start, t.minutes)}
                  </b>
                </div>
              ))}
            {!canceled && (!ticketsStage || t.status === 'tickets') &&
              (t.planOpen ? (
                <>
                  {/* Zip 70 (picture 7): tap Plan: Expect and Courts. */}
                  <TapRow label="Plan" value={planShort(t)} open={edit === 'plan'} onTap={() => setEdit((e) => (e === 'plan' ? null : 'plan'))} data="data-tm-plan-toggle" valueData="data-tm-home-plan" fit />
                  {edit === 'plan' && <PlanBox key={`${t.expected}-${t.courts}`} ctx={ctx} t={t} onDone={() => setEdit(null)} />}
                </>
              ) : (
                <div className="tm-row">
                  <span>Plan</span>
                  <b className="tm-hc-val tm-hc-fit" data-tm-row="plan" data-tm-home-plan>
                    {planShort(t)}
                  </b>
                </div>
              ))}
            {t.status === 'tickets' && (
              <>
                {/* Zip 70 (pictures 1 and 3, dry run fix 5): THE money line for the Plan's expected players. */}
                {t.money && (
                  <div className="tm-row">
                    <span data-tm-money-label>{moneyRowLabel(t.money.youCents)}</span>
                    <MoneyValue cents={t.money.youCents} data="data-tm-row-money" />
                  </div>
                )}
                <div className="tm-row">
                  <span>Locked in</span>
                  <b data-tm-row="locked">
                    {locked} of {t.spots ?? t.size}
                  </b>
                </div>
                {/* Zip 66b (picture A4): Not paid yet, hidden at 0; tap: the names and Remind all unpaid. */}
                {unpaid.length > 0 && (
                  <>
                    <TapRow label="Not paid yet" value={unpaid.length} open={showUnpaid} onTap={() => setShowUnpaid((v) => !v)} data="data-tm-unpaid-toggle" valueData="data-tm-row-unpaid" />
                    {showUnpaid && <UnpaidBox ctx={ctx} t={t} unpaid={unpaid} />}
                  </>
                )}
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
            {t.status === 'date_picked' && (
              <div className="tm-row">
                <span>Signed up</span>
                <b data-tm-row="signed">{t.signups.length}</b>
              </div>
            )}
            {ticketsStage && !canceled && (
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
              {/* The name used to open the page; it opens and closes the card now, so Tickets opens the page (the list on top). */}
              <button type="button" className="btn block secondary tm-tix-go" onClick={() => setPage('tickets')} data-tm-tickets>
                Tickets
              </button>
              <HideCanceled ctx={ctx} t={t} />
            </>
          ) : ticketsStage ? (
            <>
              {/* Alex: no Open tickets button. Picking the date opened them. Tickets opens the tournament page (the list on top). */}
              {t.status === 'tickets' ? (
                <button type="button" className="btn block big tm-tix-go" onClick={() => setPage('tickets')} data-tm-tickets>
                  Tickets
                </button>
              ) : (
                <div className="tm-home-actions">
                  <button type="button" className="btn" onClick={() => setPage('edit')} data-tm-open-edit>
                    Edit
                  </button>
                </div>
              )}
              {/* A night that has been played is never refunded or moved (the server refuses both), so the taps are not offered. */}
              {!t.over && <CancelOrReschedule ctx={ctx} t={t} />}
            </>
          ) : (
            // Pick date and Edit, exactly as before (Levels live inside Edit). Edit opens the whole tournament page at the top.
            <div className="tm-home-actions">
              <button type="button" className="btn" onClick={() => setPage('dates')} data-tm-open-dates>
                Pick date
              </button>
              <button type="button" className="btn secondary" onClick={() => setPage('edit')} data-tm-open-edit>
                Edit
              </button>
            </div>
          )}
        </div>
      )}
      <TournamentPage
        ctx={ctx}
        t={t}
        open={page !== null}
        focus={page === 'dates' ? 'dates' : page === 'tickets' ? 'tickets' : undefined}
        onClose={() => setPage(null)}
      />
    </section>
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
      action === 'reject' ? 'Cleared' : t.status === 'canceled' || k.out ? `${k.name}’s ${formatPrice(k.claimCents)} is credit now` : `${k.name}’s ${formatPrice(k.claimCents)} is in`,
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

/** Zip 56: a new Pay by while tickets are open (it starts on the one set when the date was picked: the night before at 7:00 PM). */
function PayBySheet({ ctx, t, open, onClose }: { ctx: AdminCtx; t: AdminTournamentView; open: boolean; onClose: () => void }) {
  return (
    <Sheet calmFocus open={open} title="Pay by" onClose={onClose} className="tm-sheet-pay">
      {open && <PayByBody key={t.payBy ?? 'none'} ctx={ctx} t={t} onDone={onClose} />}
    </Sheet>
  );
}

function PayByBody({ ctx, t, onDone }: { ctx: AdminCtx; t: AdminTournamentView; onDone: () => void }) {
  const tz = ctx.d.group.timezone;
  const nowMs = Date.parse(ctx.d.now);
  const start = t.payBy ? payByParts(t.payBy, tz) : { day: t.finalDate ?? '', minutes: 19 * 60 };
  const [day, setDay] = useState(start.day);
  const [minutes, setMinutes] = useState(start.minutes);
  const { busy, save } = useSave(ctx);
  const days = t.finalDate ? payByDays(t.finalDate, tz, nowMs) : [];
  const iso = day ? payByAt(day, minutes, tz) : null;
  const times = PAY_TIMES.includes(minutes) ? PAY_TIMES : [...PAY_TIMES, minutes].sort((a, b) => a - b);
  async function go() {
    if (!iso) return;
    const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}/pay-by`, { payBy: iso }), `Pay by ${payByLabel(iso, tz, t.finalDate)}`);
    if (ok) onDone();
  }
  return (
    <div className="stack" data-tm-pay-by="change">
      <div className="tm-rows">
        <label className="tm-row" htmlFor="tm-pay-day">
          <span>Pay by</span>
          <select id="tm-pay-day" className="tm-select" value={day} onChange={(e) => setDay(e.target.value)} data-tm-pay-day>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLong(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="tm-row" htmlFor="tm-pay-time">
          <span>Time</span>
          <select id="tm-pay-time" className="tm-select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} data-tm-pay-time>
            {times.map((m) => (
              <option key={m} value={m}>
                {timeWords(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" className="btn block tm-go" disabled={busy || !iso} onClick={() => void go()} data-tm-pay-go>
        {busy ? 'Working…' : 'Save'}
      </button>
    </div>
  );
}

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
      <div className="tm-card-head tm-head-line">
        <h3 className="tm-label">Tickets</h3>
        <span className={lockedNum(t) >= (t.spots ?? t.size) ? 'tm-chip tm-chip-ok' : 'tm-chip'} data-tm-locked-chip>
          {lockedNum(t)} of {t.spots ?? t.size} locked in
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
        {tickets.filter((k) => !k.out && k.place === 'none' && k.claimCents > 0).map((k) => row(k.playerId, k.name, 'I paid, waiting'))}
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
  const act = async (action: 'confirm' | 'reject' | 'mark_paid' | 'take_off', cents: number | undefined, done: string) => {
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
                <span>I paid, not confirmed</span>
                <b>{formatPrice(k.claimCents)}</b>
              </div>
            )}
          </div>
          {k && k.claimCents > 0 ? (
            <div className="btn-row confirm-row">
              <button type="button" className="btn confirm-safe" disabled={busy} onClick={() => void act('confirm', k.claimCents, `${name}’s ${formatPrice(k.claimCents)} is in`)} data-tm-ticket-paid>
                Paid
              </button>
              <button type="button" className="btn danger confirm-out" disabled={busy} onClick={() => void act('reject', k.claimCents, 'Cleared')} data-tm-ticket-not-paid>
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


export function CreateSheet({ ctx, open, onClose, editing }: { ctx: AdminCtx; open: boolean; onClose: () => void; editing?: AdminTournamentView }) {
  // A fresh form each time it opens (the key), so a Create after a Cancel starts clean.
  return (
    <Sheet calmFocus open={open} title={editing ? `Edit ${editing.name}` : 'Create tournament'} onClose={onClose} className="tm-page">
      {open && <CreateForm key={editing?.id ?? 'new'} ctx={ctx} editing={editing} onDone={onClose} />}
    </Sheet>
  );
}

function CreateForm({ ctx, editing, onDone }: { ctx: AdminCtx; editing?: AdminTournamentView; onDone: () => void }) {
  const tz = ctx.d.group.timezone;
  const today = todayKeyOf(ctx.d.now, tz);
  const [name, setName] = useState(editing?.name ?? '');
  const [dates, setDates] = useState<string[]>(editing?.offeredDates ?? []);
  const [ticket, setTicket] = useState<number | null>(editing?.ticketCents ?? DEFAULT_TICKET_CENTS);
  const [credit, setCredit] = useState<number | null>(editing?.championCreditCents ?? DEFAULT_CREDIT_CENTS);
  // Zip 60: a format, or "Let players vote" (the start for a new tournament; an edited one starts on it while the vote is still open).
  // Zip 64: after the date is finalized, a style the vote decided starts on "Auto" (the vote's winner), until tickets close.
  const autoNow = !!editing?.finalDate && (editing.formatSource === 'vote' || editing.formatSource === 'tie') && !editing.styleDecided;
  const [format, setFormat] = useState<FormatChoice>(editing ? (editing.formatPending || autoNow ? 'vote' : editing.format) : DEFAULT_FORMAT_CHOICE);
  // The vote can be switched on until the date is locked. Zip 64: after that, the same choice is "Auto" (the vote's winner for that date).
  const canVote = !editing || !editing.finalDate || editing.formatPending === true || editing.formatSource === 'vote' || editing.formatSource === 'tie';
  const autoLabel = !!editing?.finalDate && editing.formatPending !== true;
  // Americano's 2nd place: what an Americano tournament has, else the $7 start (a Doubles one switched to Americano starts there too).
  const [second, setSecond] = useState<number | null>(editing && (editing.format === 'americano' || editing.formatPending) ? editing.secondCreditCents : DEFAULT_SECOND_CREDIT_CENTS);
  const formatLocked = editing?.formatLocked === true;
  // Zip 56: once tickets have been open, the price, the spots and Only me stay as they are (players hold tickets; the server refuses too).
  const sold = editing?.settingsLocked === true;
  const americano = format === 'americano';
  const voting = format === 'vote';
  const [visibility, setVisibility] = useState<Visibility>(editing?.visibility ?? 'me');
  const [error, setError] = useState<string | null>(null);
  const { busy, save } = useSave(ctx);
  // The Create calendar: this month and the next five (and any month an edited tournament already offers).
  const months = useMemo(() => {
    const last = [monthStartPlus(today, CREATE_MONTHS - 1), ...dates].sort().slice(-1)[0];
    return monthsBetween([today, ...dates].sort()[0], last);
  }, [today, dates]);
  const offered = new Set(editing?.offeredDates ?? []);
  const look = (d: string): DayLook => (dates.includes(d) ? 'on' : d < today && !offered.has(d) ? 'past' : 'off');
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
              : credit === null
                ? 'Type a credit amount ($0 to skip it).'
                : (americano || voting) && second === null
                  ? 'Type a 2nd place credit ($0 to skip it).'
                  : null;
    setError(problem);
    if (problem) return;
    // Alex: no players expected and no court plan (the smart plan follows the players locked in, on the tournament page).
    const body = { name: n, dates, ticketCents: ticket, creditCents: credit, visibility, format, secondCreditCents: americano || voting ? second : 0 };
    const ok = editing
      ? await save(() => api('PUT', `/api/admin/tournament/${editing.id}`, body), 'Saved')
      : await save(() => api('POST', '/api/admin/tournament', body), visibility === 'me' ? 'Sign-up is open. Only you can see it.' : 'Sign-up is open for everyone');
    if (ok) onDone();
  }
  return (
    <div className="tm-form stack" data-tm-form={editing ? 'edit' : 'create'}>
      <Card label={editing ? 'Tournament' : 'New tournament'} data="name">
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

      {/* The format: two big choices. Locked once tickets open (piece 2); in piece 1 it can always change. */}
      <Card label="Format" data="format" chip={formatLocked ? <span className="tm-chip">Locked</span> : undefined}>
        <div className="segmented tm-seg tm-seg-format" role="group" aria-label="Format">
          {canVote && (
            <button type="button" aria-pressed={format === 'vote'} disabled={formatLocked} onClick={() => setFormat('vote')} data-format="vote">
              <span className="tm-format-name">{autoLabel ? 'Auto' : VOTE_LABEL}</span>
              {autoLabel && <span className="tm-format-rule">The vote’s winner</span>}
            </button>
          )}
          {(['doubles', 'americano'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={format === f} disabled={formatLocked} onClick={() => setFormat(f)} data-format={f}>
              <span className="tm-format-name">{formatName(f)}</span>
              <span className="tm-format-rule">{formatRule(f)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card label={americano || voting ? 'Prizes' : 'Champion prize'} data="prize" line>
        {americano || voting ? (
          <div className="tm-rows">
            <label className="tm-row" htmlFor="tm-credit">
              <span>{voting ? 'Winner or 1st place' : '1st place credit'}</span>
              <MoneyBox id="tm-credit" cents={credit} onChange={setCredit} label="1st place credit" />
            </label>
            <label className="tm-row" htmlFor="tm-credit2">
              <span>{voting ? '2nd place' : '2nd place credit'}</span>
              <MoneyBox id="tm-credit2" cents={second} onChange={setSecond} label="2nd place credit" />
            </label>
          </div>
        ) : (
          <div className="tm-rows">
            <label className="tm-row" htmlFor="tm-credit">
              <span>Game credit for each winner</span>
              <MoneyBox id="tm-credit" cents={credit} onChange={setCredit} label="Game credit for each winner" />
            </label>
            <div className="tm-row">
              <span>Winners</span>
              <b>{WINNERS} players</b>
            </div>
            <div className="tm-row">
              <span>Total credit</span>
              <b data-tm-total>{credit === null ? '$?' : formatPrice(credit * WINNERS)}</b>
            </div>
          </div>
        )}
        <p className="tm-card-note">
          {americano || voting ? '1st place also gets a medal. Set either credit to $0 to skip it.' : 'Medal and banner are automatic. Set the credit to $0 to skip it.'}
        </p>
      </Card>

      <Card label="Ticket price" data="ticket" line>
        <div className="tm-rows">
          <label className="tm-row" htmlFor="tm-ticket">
            <span>Each player pays</span>
            {sold ? <b data-tm-ticket-locked>{formatPrice(editing!.ticketCents)}</b> : <MoneyBox id="tm-ticket" cents={ticket} onChange={setTicket} label="Each player pays" />}
          </label>
          <div className="tm-row">
            <span>Same for 6 to 16 players</span>
            <b>Fixed</b>
          </div>
        </div>
        <p className="tm-card-note">
          {sold
            ? 'Tickets have been sold, so the price stays.'
            : editing
              ? 'You host and pay the court bill. Change the price any time before tickets open.'
              : 'You host and pay the court bill. Change the price any time before sign-up opens.'}
        </p>
      </Card>

      <Card label="Who can see it" data="who">
        <div className="segmented tm-seg tm-seg-who" role="group" aria-label="Who can see it">
          <button type="button" aria-pressed={visibility === 'me'} disabled={sold} onClick={() => setVisibility('me')} data-vis="me">
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
        {busy ? 'Working…' : editing ? 'Save changes' : visibility === 'me' ? 'Open sign-up (only me)' : 'Open sign-up (everyone)'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The tournament's own page: who can see it, the level list (mock 14), the dates and picking one, the settings, Cancel.
// ---------------------------------------------------------------------------------------------------------------------

export function TournamentPage({
  ctx,
  t,
  open,
  onClose,
  focus,
}: {
  ctx: AdminCtx;
  t: AdminTournamentView;
  open: boolean;
  onClose: () => void;
  focus?: 'levels' | 'dates' | 'tickets';
}) {
  return (
    <Sheet calmFocus open={open} title={t.name} onClose={onClose} className="tm-page">
      {open && <PageBody ctx={ctx} t={t} focus={focus} onClosed={onClose} />}
    </Sheet>
  );
}

/** "$12", or "-$4" when the tickets more than cover it (the minus as Adjust credit writes it, "-$5"). */
const costWords = (cents: number) => (cents < 0 ? `-${formatPrice(-cents)}` : formatPrice(cents));

/**
 * Alex's smart plan (organizer only): the players locked in decide the planned size (rounded up to even, plus 2, 6 to 12), that size's courts
 * and hours, and the organizer's cost: the court bill, minus the tickets, plus the winners' credits. The site never books anything.
 */
function PlanCard({ ctx, t }: { ctx: AdminCtx; t: AdminTournamentView }) {
  const locked = lockedNum(t);
  // 2.5 and 3 hour games need Booking hours on (the same gate as their prices).
  const needsBooking = t.minutes > 120 && ctx.d.longGames !== true;
  // Zip 66 (mock 03): the plan as three pills, then one cost line: "$8 ($88 with 0 paid)".
  // Zip 70: the Plan's expected players (the same number as the Home card's Plan row).
  const pills = [`${t.expected ?? t.size} players`, `${t.courts} ${t.courts === 1 ? 'court' : 'courts'}`, `${t.minutes / 60} ${t.minutes === 60 ? 'hr' : 'hrs'}`];
  return (
    <section className="tm-card tm-plan-card" aria-label="Plan" data-tm-card="plan">
      <div className="tm-card-head">
        <h3 className="tm-label">Plan</h3>
        <span className="tm-chip" data-tm-plan-locked>
          {locked} locked in
        </span>
      </div>
      <p className="tm-plan-pills" aria-label={`${t.expected ?? t.size} players, ${planTitle(t)}`} data-tm-plan={planTitle(t)}>
        {pills.map((x) => (
          <span key={x} className="tm-plan-pill">
            {x}
          </span>
        ))}
      </p>
      {t.cost && t.money && (
        <div className="tm-row tm-plan-cost">
          {/* Zip 70: THE money line's label and amount (green "+$6", red "$30"), the same as the Home card. */}
          <span>{moneyRowLabel(t.money.youCents)}</span>
          <span className="tm-plan-cost-val">
            <MoneyValue cents={t.money.youCents} data="data-tm-cost-fills" />{' '}
            <span className="tm-plan-cost-now" data-tm-cost-now>
              ({costWords(t.cost.nowCents)} with {t.cost.paidNow} paid)
            </span>
          </span>
        </div>
      )}
      {needsBooking && (
        <p className="tm-card-note tm-booking-note" data-tm-booking-note>
          Turn on Booking hours
        </p>
      )}
    </section>
  );
}

function PageBody({ ctx, t, focus, onClosed }: { ctx: AdminCtx; t: AdminTournamentView; focus?: 'levels' | 'dates' | 'tickets'; onClosed: () => void }) {
  const { busy, save } = useSave(ctx);
  const [levelFor, setLevelFor] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [payBy, setPayBy] = useState(false);
  // Zip 66: Pick the date starts folded, unless the page was opened for it (Home's Pick date).
  const [datesOpen, setDatesOpen] = useState(focus === 'dates');
  const canceled = t.status === 'canceled';
  // Zip 56: the date stays once tickets are open (Cancel or reschedule moves it).
  const dateLocked = t.status === 'tickets' || canceled;
  const showTickets = (t.tickets ?? []).length > 0 || t.status === 'tickets';
  const held = (t.tickets ?? []).filter((k) => !k.out && k.claimCents === 0 && k.creditCents + k.paidCents > 0);
  const heldCents = held.reduce((s, k) => s + k.creditCents + k.paidCents, 0);
  const tz = ctx.d.group.timezone;
  const counts = useMemo(() => new Map(dateCounts(t.offeredDates, t.signups).map((c) => [c.day, c.names])), [t]);
  const best = Math.max(0, ...[...counts.values()].map((n) => n.length));
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
  const who = t.signups.find((s) => s.playerId === levelFor) ?? null;
  // Zip 71: worked out from the levels on this screen each time it draws, so a level saved with the pencil shows in the open list at once.
  const projected = useMemo(() => projectedTeams(t), [t]);
  // Open on the part the Home card asked for, ONCE: a later redraw (a save, a live update) never scrolls the page back there.
  const scrolled = useRef(false);
  const scrollRef = (el: HTMLElement | null) => {
    if (!el || !focus || scrolled.current) return;
    scrolled.current = true;
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  };
  return (
    <div className="tm-form stack" data-tm-page>
      {showTickets && <TicketsCard ctx={ctx} t={t} scrollRef={focus === 'tickets' ? scrollRef : undefined} />}
      {/* Zip 66 (mocks 03 and 04): Plan, Players (the levels), Pick the date (folded), Settings. */}
      {!canceled && <PlanCard ctx={ctx} t={t} />}

      <section className="tm-card tm-levels-card" aria-label="Levels" data-tm-card="levels" ref={focus === 'levels' ? scrollRef : undefined}>
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
        {/* Zip 71 (pictures pair-01 and pair-02): Projected teams, the last row of Levels. Tap opens it in place, tap again folds it. */}
        {projected && <ProjectedTeams teams={projected} />}
      </section>

      {/* Zip 66: Pick the date starts folded (one line with "34 offered"); tap the line to open the calendar, tap it again to close. Opened
          from Home's Pick date, it starts open. */}
      <section className={datesOpen ? 'tm-card tm-dates-card tm-dates-open' : 'tm-card tm-dates-card'} aria-label="Pick the date" data-tm-card="dates" data-tm-dates-open={datesOpen} ref={focus === 'dates' ? scrollRef : undefined}>
        <h3 className="tm-dates-head">
          <button type="button" className="tm-dates-top" aria-expanded={datesOpen} onClick={() => setDatesOpen((o) => !o)} data-tm-dates-toggle>
            <span className="tm-label">Pick the date</span>
            <span className="tm-chip">{t.finalDate ? dayLong(t.finalDate) : `${t.offeredDates.length} offered`}</span>
          </button>
        </h3>
        {datesOpen && (
          <>
            <p className="tm-card-note tm-dates-note" data-tm-dates-note>
              {dateLocked
                ? canceled
                  ? 'Canceled.'
                  : 'Tickets are open on this date. To move it, use Cancel or reschedule.'
                : !t.finalDate && !t.offeredDates.some((d) => d >= today)
                  ? 'Every date you offered has passed. Tap Edit below to offer new ones.'
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
          </>
        )}
      </section>

      <Card label="Settings" data="settings" line>
        <div className="tm-rows">
          <div className="tm-row">
            <span>Format</span>
            <b data-tm-format-row>{t.formatPending ? 'Players vote' : formatName(t.format)}</b>
          </div>
          <div className="tm-row">
            <span>Ticket price</span>
            <b>{formatPrice(t.ticketCents)}</b>
          </div>
          {t.format === 'americano' || t.formatPending ? (
            <>
              <div className="tm-row">
                <span>1st place credit</span>
                <b>{formatPrice(t.championCreditCents)}</b>
              </div>
              <div className="tm-row">
                <span>2nd place credit</span>
                <b>{formatPrice(t.secondCreditCents)}</b>
              </div>
            </>
          ) : (
            <div className="tm-row">
              <span>Champion credit</span>
              <b>{formatPrice(t.championCreditCents)}</b>
            </div>
          )}
          {t.status === 'tickets' && t.payBy && (
            <div className="tm-row">
              <span>Pay by</span>
              <span className="tm-row-end">
                <b data-tm-pay-by-row>{payByLabel(t.payBy, tz, t.finalDate)}</b>
                {!t.closed && (
                  <button type="button" className="tm-mini" onClick={() => setPayBy(true)} data-tm-pay-by-change>
                    Change
                  </button>
                )}
              </span>
            </div>
          )}
          {/* Zip 66: Who can see it is a plain row here (no caret, not a tap of its own); the Edit button below changes it. */}
          <div className="tm-row">
            <span>Who can see it</span>
            <b data-tm-who-row={t.visibility}>{t.visibility === 'all' ? 'Everyone' : 'Only me'}</b>
          </div>
        </div>
        {!canceled && (
          <button type="button" className="btn secondary block tm-edit" onClick={() => setEditing(true)} data-tm-edit-settings>
            Edit
          </button>
        )}
      </Card>

      {t.backedOut.length > 0 && <p className="tm-card-note tm-backed">Dropped out: {t.backedOut.map((b) => b.name).join(', ')}</p>}

      {/* Zip 56: once the date is picked, Cancel or reschedule (picture 30); before it (and after a Reschedule), Cancel tournament. */}
      {!canceled &&
        !t.over &&
        (t.status === 'date_picked' || t.status === 'tickets' ? (
          <CancelOrReschedule ctx={ctx} t={t} onDone={onClosed} />
        ) : (
          <button type="button" className="tm-cancel-link" onClick={() => setAskCancel(true)} data-tm-cancel>
            Cancel tournament
          </button>
        ))}

      <LevelSheet ctx={ctx} t={t} who={who} onClose={() => setLevelFor(null)} />
      <DateSheet ctx={ctx} t={t} day={day} names={day ? (counts.get(day) ?? []) : []} onClose={() => setDay(null)} />
      <CreateSheet ctx={ctx} open={editing} editing={t} onClose={() => setEditing(false)} />
      {t.status === 'tickets' && <PayBySheet ctx={ctx} t={t} open={payBy} onClose={() => setPayBy(false)} />}
      <ConfirmDialog
        open={askCancel}
        title="Cancel the tournament?"
        body={
          <p>
            {held.length > 0
              ? `Players see it canceled. ${held.length} paid ${held.length === 1 ? 'ticket comes' : 'tickets come'} back as credit (${formatPrice(heldCents)}).`
              : t.finalDate
                ? 'Players on the list see it canceled. Nothing was paid, so nothing comes back.'
                : `Players stop seeing ${theName(t.name)}. The list stays saved. Nothing was paid, so nothing comes back.`}
          </p>
        }
        cancelLabel="Keep it"
        confirmLabel="Cancel tournament"
        danger
        busy={busy}
        onCancel={() => setAskCancel(false)}
        onConfirm={async () => {
          const ok = await save(() => api('POST', `/api/admin/tournament/${t.id}/cancel`, {}), 'Tournament canceled');
          setAskCancel(false);
          if (ok) onClosed();
        }}
      />
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
    { key: 'doubles', name: 'Doubles' },
    { key: 'americano', name: 'Americano' },
  ];
  const picked = choice === 'doubles' || choice === 'americano' ? choice : 'vote';
  // Zip 57 (mocks 60 and 61): the game plan for the players who can make this date, the courts and the hours (shared/tournamentPlan.ts, the one
  // source). Never blocks Finalize.
  // Zip 70: the count the Plan expects (Alex's saved Expect number, else who can make this date); the fit line names the style really played,
  // and the money line (THE money line) follows Time and Courts as they change (picture 4).
  const count = t.expectSaved && t.expected ? t.expected : view.players.length;
  const plan = nightPlan(count, courts, end - start, picked === 'vote' ? autoFormat : picked);
  const fit = count >= 6 ? fitWords(plan, start) : { fits: false, text: `${view.players.length} can play. A tournament needs at least 6.` };
  const money = moneyLine({
    expected: expectedPlayers({ saved: t.expectSaved ? (t.expected ?? null) : null, suggested: view.players.length, locked: 0 }),
    courts,
    minutes: end - start,
    ticketCents: view.ticketCents,
    prizeCents: prizeCentsOf(plan.style, t.championCreditCents, t.secondCreditCents),
  });
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
            Votes: Doubles {view.votes.locked} · Americano {view.votes.americano} · Either {view.votes.either}
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
      {notice && (
        <p className="tm-card-note tm-fin-notice" role="status" data-tm-fin-notice>
          {notice}
        </p>
      )}
      <div className="tm-fin-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={onClose} data-tm-finalize-back>
          Back
        </button>
        <button type="button" className="btn tm-go" disabled={busy || !payIso} onClick={() => void finalize()} data-tm-finalize-go>
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
      title={oddSwitchWords(t.name)}
      sub={`${t.lockedIn ?? 0} locked in. Locked doubles needs an even number.`}
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
const shortStyle = (f: TournamentFormat) => (f === 'americano' ? 'Americano' : 'Doubles');
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
