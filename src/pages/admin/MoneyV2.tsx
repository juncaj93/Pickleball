import { type ReactNode, useState } from 'react';
import type { AdminRosterEntry, AdminSessionView, MonthlyMoney } from '../../../shared/api';
import { smsHref } from '../../../shared/messages';
import { formatPrice } from '../../../shared/money';
import { formatShortDate, formatTime, localParts } from '../../../shared/time';
import { api, isIOS, useDemoVersion, useLoad, useNow, usePretend } from '../../lib';
import { Chip, ErrorState, Notice, Sheet, Spinner } from '../../ui';
import { RollText } from '../../motion';
import type { AdminCtx } from '../Admin';
import { minus, monthName, shiftMonth, STATE_TEXT } from './MonthlyMoney';
import { CreditBackList, payChip, payMoneyLine, useAction } from './Sessions';
import { reminderText } from './textMenu';
import { isPlayed } from './todo';
import { unpaidRows } from './moneyList';
import { reopenRequestedReason } from '../../../shared/credit';
import '../../credit-admin.css';
import { CLEAR_CHOICES } from '../../../shared/lateFees';
import { lateFeeLine } from './LateFees';

type View = 'who' | 'totals';
type Tone = 'ok' | 'info' | 'warn' | 'muted';

/** A canceled game where someone's payment became credit. */
const creditBackRows = (s: AdminSessionView) => s.roster.filter((r) => !r.isOrganizer && r.creditBackCents > 0);

export const currentMonth = (ctx: AdminCtx) => {
  const p = localParts(Date.parse(ctx.d.now), ctx.d.group.timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
};

/**
 * Money, new layout (ADMIN_V2): one slim control row (month stepper, Who paid | Totals), then either every game as a
 * line that opens (Who paid) or the month's numbers on one screen (Totals). It always opens on Who paid and never
 * remembers the last view. Same money, same rules, same actions as the old Money tab; only the layout changed.
 */
export function MoneyTabV2({ ctx }: { ctx: AdminCtx }) {
  const [view, setView] = useState<View>('who');
  const [month, setMonth] = useState(() => currentMonth(ctx));
  return (
    <section className="stack money-v2" aria-label="Money">
      <div className="mv2-controls">
        <div className="month-picker" role="group" aria-label="Month">
          <button className="btn small secondary" aria-label="Previous month" onClick={() => setMonth((x) => shiftMonth(x, -1))}>
            ‹
          </button>
          <label className="sr-only" htmlFor="mv2-month">
            Month
          </label>
          {/* The month name is drawn by us, centered; the real month picker sits on top, see-through, so a tap still opens it. */}
          <div className="month-field">
            <span className="month-label" aria-hidden="true" data-month-label>
              {shortMonth(month)}
            </span>
            <input
              id="mv2-month"
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.();
                } catch {
                  /* some browsers only open it on their own */
                }
              }}
            />
          </div>
          <button className="btn small secondary" aria-label="Next month" onClick={() => setMonth((x) => shiftMonth(x, 1))}>
            ›
          </button>
        </div>
        <div className="segmented compact" role="group" aria-label="Who paid or Totals">
          <button aria-pressed={view === 'who'} onClick={() => setView('who')}>
            Who paid
          </button>
          <button aria-pressed={view === 'totals'} onClick={() => setView('totals')}>
            Totals
          </button>
        </div>
      </div>
      {view === 'who' ? <WhoPaid ctx={ctx} /> : <Totals ctx={ctx} month={month} />}
    </section>
  );
}

/** "2026-11" as "Nov 2026". */
export function shortMonth(month: string): string {
  return monthName(month).replace(/^(\w{3})\w*/, '$1');
}

// ---------- Who paid ----------

function WhoPaid({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  // Every game with a court to pay for, and a canceled game where payments became credit (same list as the old tab).
  const canceledWithCredit = ctx.d.sessions.filter((s) => s.state.flags.canceled && creditBackRows(s).length > 0);
  const withMoney = ctx.d.sessions.filter((s) => (!s.state.flags.canceled && s.court !== null) || canceledWithCredit.includes(s));
  // Next game first (soonest at the top), then the games already played, most recent first.
  const upcoming = withMoney.filter((s) => Date.parse(s.startsAt) > nowMs);
  const started = withMoney.filter((s) => Date.parse(s.startsAt) <= nowMs).reverse();
  const ordered = [...upcoming, ...started];
  // The next game starts open; any number can be open at once.
  const [open, setOpen] = useState<Set<string>>(() => new Set(ordered.length ? [ordered[0].id] : []));
  const [remind, setRemind] = useState<string | null>(null);
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const remindSession = ordered.find((s) => s.id === remind) ?? null;
  if (ordered.length === 0) return <p className="muted small">Nobody is signed up yet.</p>;
  return (
    <>
      <div className="mv2-games">
        {ordered.map((s) => (
          <GameV2 key={s.id} ctx={ctx} s={s} open={open.has(s.id)} onToggle={() => toggle(s.id)} onRemind={() => setRemind(s.id)} sameDay={ordered.filter((x) => formatShortDate(x.startsAt, ctx.d.group.timezone) === formatShortDate(s.startsAt, ctx.d.group.timezone)).length > 1} />
        ))}
      </div>
      <Sheet open={!!remindSession} title={remindSession ? `Remind · ${formatShortDate(remindSession.startsAt, ctx.d.group.timezone)}` : ''} onClose={() => setRemind(null)}>
        {remindSession && <RemindList ctx={ctx} s={remindSession} />}
      </Sheet>
    </>
  );
}


/** The one-line summary of a game: "1 of 3 paid", "5 played · $11 each", "canceled". */
function gameSub(s: AdminSessionView, priceCents: number, open: boolean): string {
  if (s.state.flags.canceled) return 'canceled';
  if (s.finalized) return `${s.finalized.playedCount} played · $${s.finalized.priceCents / 100} each`;
  if (s.payableCount > 0) return `${s.paidCount} of ${s.payableCount} paid${open ? ` · ${formatPrice(priceCents)} each` : ''}`;
  return open ? `${formatPrice(priceCents)} each` : '';
}

/** The chip on a game's line: what needs doing, most urgent first. */
function gameChip(s: AdminSessionView): { tone: Tone; label: string } | null {
  if (s.state.flags.canceled) return { tone: 'muted', label: 'Closed' };
  if (s.needsFinalize) return { tone: 'warn', label: 'Finalize' };
  const owing = s.payableCount - s.paidCount;
  if (owing > 0) return { tone: 'warn', label: `${owing} ${owing === 1 ? 'owes' : 'owe'}` };
  if (s.court?.paid === false) return { tone: 'warn', label: 'Court due' };
  if (s.payableCount > 0) return { tone: 'ok', label: 'All paid' };
  return null;
}

export const Chevron = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m7 10 5 5 5-5" />
  </svg>
);

function GameV2({ ctx, s, open, onToggle, onRemind, sameDay }: { ctx: AdminCtx; s: AdminSessionView; open: boolean; onToggle: () => void; onRemind: () => void; sameDay: boolean }) {
  const tz = ctx.d.group.timezone;
  const date = formatShortDate(s.startsAt, tz);
  const sub = gameSub(s, ctx.d.group.settings.pricePerPlayerCents, open);
  const chip = gameChip(s);
  const owed = unpaidRows(s).length;
  return (
    <article className={`card mv2-game${open ? ' open' : ''}`} data-session={s.id} data-open={open ? 'yes' : 'no'}>
      <div className="mv2-head">
        <button type="button" className="mv2-toggle" aria-expanded={open} aria-label={`${date}${sub ? `, ${sub}` : ''}`} onClick={onToggle}>
          <span className="mv2-date">{date}</span>
          <span className="mv2-sub">
            {sameDay ? `${formatTime(s.startsAt, tz)}${sub ? ' · ' : ''}` : ''}
            {sub && <RollText text={sub} />}
          </span>
        </button>
        {open && owed > 0 && !s.state.flags.canceled ? (
          <button type="button" className="btn small secondary mv2-remind" data-remind onClick={onRemind}>
            Remind {owed}
          </button>
        ) : (
          !open && chip && (
            <span className="mv2-headchip">
              <Chip tone={chip.tone}>{chip.label}</Chip>
            </span>
          )
        )}
        <button type="button" className="mv2-chev" aria-hidden="true" tabIndex={-1} onClick={onToggle}>
          <Chevron />
        </button>
      </div>
      {open && <GameBody ctx={ctx} s={s} />}
    </article>
  );
}

export function GameBody({ ctx, s, r2 }: { ctx: AdminCtx; s: AdminSessionView; r2?: boolean }) {
  const tz = ctx.d.group.timezone;
  const { busy, run } = useAction(ctx);
  const fin = s.finalized;
  const played = isPlayed(s);
  const myId = s.roster.find((r) => r.isOrganizer)?.playerId ?? ctx.d.me?.id ?? null;
  // The organizer is not a row of their own money: they pay the venue (the court row).
  // Plus every open late fee (shared/lateFees.ts): a late drop, a no-show, a seat in a game canceled late.
  const allRows = s.roster.filter((r) => !r.isOrganizer && (r.status === 'confirmed' || r.paymentStatus === 'paid' || !!r.lateFee) && (!s.state.flags.canceled || !!r.lateFee));
  // Round 2 (ADMIN_R2): the people who still owe come first, then the people who paid (each group keeps its order). Same rows, same money.
  const rows = r2 ? [...allRows.filter((r) => r.paymentStatus !== 'paid'), ...allRows.filter((r) => r.paymentStatus === 'paid')] : allRows;
  const [tapped, setTapped] = useState<string | null>(null);
  const setPaid = (r: AdminRosterEntry, paid: boolean) =>
    // With the amount this screen showed as owed (refused if a Finalize or redo changed it since).
    run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid, seen: r.moneySeen, ...(paid && r.owesCents > 0 ? { cents: r.owesCents } : {}) }), paid ? `${r.name} marked paid` : `${r.name} marked unpaid`);
  const setCourtPaid = (paid: boolean) => run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: myId, paid }), paid ? 'Court marked paid' : 'Court marked due');
  const reopen = () => run(() => api('POST', `/api/admin/sessions/${s.id}/reopen`, {}), 'Reopened. Finalize it again from Home.');

  const feeRows = s.roster.some((r) => !r.isOrganizer && r.lateFee);
  if (s.state.flags.canceled && !feeRows) {
    return (
      <div className="mv2-body stack">
        <Notice tone="muted" title="Session canceled">
          Nobody owes for it. Anyone who paid has it as credit.
          {s.chargedCents ? ` The venue charged you ${formatPrice(s.chargedCents)}.` : ''}
        </Notice>
        <CreditBackList s={s} />
      </div>
    );
  }

  type Act = { label: string; onClick: () => void; attrs?: Record<string, string> };
  const clearFee = (r: AdminRosterEntry, why: string, label: string) =>
    run(() => api('POST', `/api/admin/sessions/${s.id}/late-fee`, { playerId: r.playerId, why }), `${r.name}: cleared (${label.toLowerCase()})`);
  const actionsOf = (r: AdminRosterEntry): Act[] => {
    const acts: Act[] = [];
    if (r.lateFee) {
      // A late fee: Mark paid (or Unmark), and Clear with why (shared/lateFees.ts rule 8). The money stays on this game.
      if (r.paymentStatus === 'paid' && !r.refundedAt) {
        if (r.selfPaid) acts.push({ label: 'Mark paid', onClick: () => void setPaid(r, true) });
        acts.push({ label: 'Unmark', onClick: () => void setPaid(r, false) });
      } else if (r.owesCents > 0) acts.push({ label: 'Mark paid', onClick: () => void setPaid(r, true) });
      for (const c of CLEAR_CHOICES) acts.push({ label: `Clear: ${c.label.toLowerCase()}`, attrs: { 'data-clear-why': c.why }, onClick: () => void clearFee(r, c.why, c.label) });
      return acts;
    }
    if (r.paymentStatus === 'paid' && !r.refundedAt) {
      // Confirm an I paid while they are in; one on a seat that left is a claim, answered on Home.
      if (r.selfPaid && r.status === 'confirmed' && !s.state.flags.canceled) acts.push({ label: 'Mark paid', onClick: () => void setPaid(r, true) });
      acts.push({ label: 'Unmark', onClick: () => void setPaid(r, false) });
    } else if (r.status === 'confirmed') {
      if (r.owesCents > 0) acts.push({ label: 'Mark paid', onClick: () => void setPaid(r, true) });
      // Credit on a seat that still owes ("Credit $3"): Unmark puts it back in their credit.
      if (r.paymentStatus === 'unpaid' && r.creditCents > 0) {
        acts.push({
          label: 'Unmark',
          attrs: { 'data-unmark-credit': r.name },
          onClick: () => void run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: false, seen: r.moneySeen }), `${r.name}'s credit put back`),
        });
      }
    }
    return acts;
  };

  return (
    <div className="mv2-body">
      {s.state.flags.canceled && (
        <p className="mv2-summary small muted" data-summary>
          {s.canceledBy === 'organizer_fee_kept' ? 'Canceled late, the venue did not waive the fee: everyone who was in owes their $14.' : 'Canceled. Only late fees are left on it.'}
        </p>
      )}
      {!s.state.flags.canceled && (fin ? fin.creditBackCents > 0 : !played && Date.parse(s.endsAt) <= Date.parse(ctx.d.now)) && (
        <p className="mv2-summary small muted" data-summary>
          {fin ? <span data-finalized-line>{formatPrice(fin.creditBackCents)} back as credit</span> : <span>Not finalized yet. Finalize it from Home.</span>}
        </p>
      )}
      <ul className="mv2-rows" aria-label="Who paid">
        {rows.map((r) => {
          const base = payChip(r, s);
          const chip = { tone: base.tone, label: r.paymentStatus === 'paid' ? 'Paid' : 'Unpaid' };
          const acts = actionsOf(r);
          const selfMarked = r.selfPaid && r.paymentStatus === 'paid';
          const feeLine = lateFeeLine(r);
          const full = feeLine ?? `${selfMarked ? 'self-marked · ' : ''}${payMoneyLine(r, s, tz)}`.replace(/ · $/, '');
          const paidWithCredit = r.creditCents > 0 && r.creditCents >= (r.paymentAmountCents ?? 0);
          const short = feeLine
            ? feeLine
            : r.paymentStatus === 'paid' && r.paidAt
              ? selfMarked
                ? 'self-marked'
                : r.refundedAt
                  ? payMoneyLine(r, s, tz)
                  : paidWithCredit
                    ? `paid with credit ${formatPrice(r.paymentAmountCents ?? 0)}`
                    : `paid ${formatPrice(r.paymentAmountCents ?? 0)} · ${formatShortDate(r.paidAt, tz)}`
              : payMoneyLine(r, s, tz);
          return (
            <MoneyRow
              key={r.playerId}
              id={r.playerId}
              attrs={{ 'data-pay-row': r.name }}
              name={r.name}
              short={short}
              full={full}
              chip={chip}
              primary={acts[0]}
              extra={acts.slice(1)}
              busy={busy}
              expanded={tapped === r.playerId}
              onTap={() => setTapped((cur) => (cur === r.playerId ? null : r.playerId))}
            />
          );
        })}
        {s.court && (
          <MoneyRow
            id="court"
            court
            attrs={{ 'data-court': s.id }}
            name={`Court ${formatPrice(s.court.costCents)}`}
            short={r2 ? (myId ? '' : 'Add your name in Settings to mark paid') : myId ? (s.court.covered ? 'Northville, players cover' : `Northville, you pay ${formatPrice(s.court.yourShareCents)}`) : 'Add your name in Settings to mark paid'}
            full={r2 ? '' : `You pay Northville Pickleball ${formatPrice(s.court.costCents)} · ${s.court.covered ? 'Players cover the court' : `Players cover ${formatPrice(s.court.playersCoverCents)}, your share ${formatPrice(s.court.yourShareCents)}`}`}
            chip={{ tone: s.court.paid ? 'ok' : r2 ? 'muted' : 'warn', label: s.court.paid ? 'Paid' : 'Due', srPrefix: 'Court ' }}
            primary={myId ? { label: s.court.paid ? 'Unmark' : 'Mark paid', onClick: () => void setCourtPaid(!s.court!.paid) } : undefined}
            note={myId ? undefined : 'Add your name in Settings (Group > Your name) to mark this paid.'}
            extra={[]}
            busy={busy}
            expanded={tapped === 'court'}
            onTap={() => setTapped((cur) => (cur === 'court' ? null : 'court'))}
          />
        )}
      </ul>
      {fin && (
        <div className="stack" style={{ gap: 6 }}>
          <button className="btn small secondary" disabled={busy || s.reopenBlockedBy.length > 0 || s.reopenRequestedBy.length > 0} data-reopen onClick={reopen}>
            Reopen
          </button>
          {s.reopenBlockedBy.length > 0 && (
            <p className="small muted" data-reopen-blocked>
              Can't reopen: {s.reopenBlockedBy.join(' and ')} already used or got back credit from this game.
            </p>
          )}
          {s.reopenBlockedBy.length === 0 && s.reopenRequestedBy.length > 0 && (
            <p className="small muted" data-reopen-blocked>
              {reopenRequestedReason(s.reopenRequestedBy)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One line of money: name with a small second line, a fixed-width status chip, a fixed-width gray button. Tapping the
 * name shows the whole line (and any second action, like Unmark next to Mark paid).
 */
function MoneyRow({
  id,
  name,
  short,
  full,
  chip,
  primary,
  extra,
  busy,
  expanded,
  onTap,
  attrs,
  court,
  note,
}: {
  id: string;
  name: string;
  short: string;
  full: string;
  chip: { tone: Tone; label: string; srPrefix?: string };
  primary?: { label: string; onClick: () => void; attrs?: Record<string, string> };
  extra: { label: string; onClick: () => void; attrs?: Record<string, string> }[];
  busy: boolean;
  expanded: boolean;
  onTap: () => void;
  attrs?: Record<string, string>;
  court?: boolean;
  note?: string;
}): ReactNode {
  return (
    <li className={`mv2-row${court ? ' court' : ''}${expanded ? ' expanded' : ''}`} data-row-id={id} {...attrs}>
      <button type="button" className="mv2-who" aria-expanded={expanded} onClick={onTap}>
        <strong className="mv2-name">{name}</strong>
        <span className="mv2-line small muted">{expanded ? full || short : short}</span>
      </button>
      <span className="mv2-chipcell">
        <Chip tone={chip.tone}>
          {chip.srPrefix && <span className="sr-only">{chip.srPrefix}</span>}
          {chip.label}
        </Chip>
      </span>
      <span className="mv2-btncell">
        {primary && (
          <button type="button" className="btn small secondary" disabled={busy} onClick={primary.onClick} {...primary.attrs}>
            {primary.label}
          </button>
        )}
      </span>
      {expanded && (extra.length > 0 || note) && (
        <div className="mv2-extra">
          {note && <span className="small muted">{note}</span>}
          {extra.map((a) => (
            <button key={a.label} type="button" className="btn small secondary" disabled={busy} onClick={a.onClick} {...a.attrs}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * "Remind N": the players who still owe on this game, each with their own Text button. It opens Messages with today's
 * prepared payment reminder for that one person (the organizer presses send there; the site sends nothing). Never a group text.
 */
export function RemindList({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const [readied, setReadied] = useState<Set<string>>(new Set());
  const rows = unpaidRows(s);
  if (rows.length === 0) return <p className="muted">Everyone has paid.</p>;
  return (
    <div className="stack">
      <p className="small muted">One text per person. Messages opens with the reminder filled in; you press send.</p>
      <ul className="mv2-remind-list" aria-label="Players who owe">
        {rows.map((r) => {
          const body = reminderText(ctx.d, r.playerId, r.name, s);
          return (
            <li key={r.playerId} data-remind-row={r.name}>
              <span className="mv2-remind-who">
                <strong>{r.name}</strong>
                <span className="small muted">
                  owes {formatPrice(r.owesCents)}
                  {r.phone ? '' : ' · no number saved'}
                  {readied.has(r.playerId) ? ' · Message ready' : ''}
                </span>
              </span>
              <a
                className="btn small secondary"
                href={smsHref(r.phone, body, isIOS)}
                aria-label={`Text ${r.name}: ${body}`}
                onClick={() => setReadied((cur) => new Set(cur).add(r.playerId))}
              >
                Text
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Totals ----------

/** The same numbers and the same math as the old month card, in a two-column grid that fits one phone screen. */
export function Totals({ ctx, month }: { ctx: AdminCtx; month: string }) {
  const tz = ctx.d.group.timezone;
  const pretend = usePretend();
  const demo = useDemoVersion();
  const load = useLoad(() => api<MonthlyMoney>('GET', `/api/admin/money?month=${month}`), [month, pretend, demo, ctx.d]);
  const m = load.data;
  // Money numbers roll when they change; keyed by the month shown, so moving to another month never rolls.
  const roll = (text: string) => <RollText key={m?.label} text={text} />;
  if (load.loading && !m) return <Spinner />;
  if (load.error) return <ErrorState error={load.error} onRetry={load.reload} />;
  if (!m) return null;
  const played = m.sessions.filter((x) => x.state === 'played').length;
  return (
    <>
      <div className={`card mv2-totals ${m.netCents >= 0 ? 'surplus' : 'short'}`} data-totals>
        <div className="mv2-left">
          <div>
            <span className="money-left-label">{m.coveredCents > 0 ? 'You covered' : m.surplusCents > 0 ? 'Surplus' : 'Left'}</span>
            <span className="big-amount">{roll(formatPrice(m.coveredCents > 0 ? m.coveredCents : m.surplusCents))}</span>
          </div>
          <p className="bottom-line">{m.bottomLine}</p>
        </div>
        <dl className="mv2-grid">
          <Cell label="Collected" value={roll(formatPrice(m.collectedCents))} />
          <Cell label="Court costs" value={roll(minus(m.courtCostCents))} />
          <Cell label="Credits owed" value={roll(formatPrice(m.creditsOwedCents))} attr={{ 'data-credits-owed': '' }} />
          <Cell label="Held" value={roll(formatPrice(m.heldCents))} held />
          <Cell label="Membership" value={roll(formatPrice(m.membershipCents))} />
          <Cell label="Sessions played" value={String(played)} />
        </dl>
        {m.creditsOwedCents > 0 && (
          <p className="kv-note mv2-note" data-credits-owed-note>
            Credits owed: money that came back to players as credit. Not taken off Left.
          </p>
        )}
      </div>
      {m.sessions.length === 0 ? (
        <p className="muted small">No sessions in {m.label}.</p>
      ) : (
        <details className="money-sess card">
          <summary>
            <span>Sessions in {m.label}</span>
          </summary>
          <ul className="rows" aria-label={`Sessions in ${m.label}`}>
            {m.sessions.map((x) => (
              <li key={x.id}>
                <span className="who">
                  <strong>{formatShortDate(x.startsAt, tz)}</strong>
                  <span className="small muted">
                    {x.state === 'played'
                      ? `${x.playedCount} played · ${formatPrice(x.priceCents ?? 0)} each · ${formatPrice(x.collectedCents)} in · court ${formatPrice(x.courtCostCents)}${x.typicalCost ? ' (typical)' : ''}`
                      : x.state === 'canceled' && x.charged
                        ? `Canceled, venue charged ${formatPrice(x.courtCostCents)}`
                        : STATE_TEXT[x.state]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Cell({ label, value, held, attr }: { label: string; value: ReactNode; held?: boolean; attr?: Record<string, string> }) {
  return (
    <div className={`mv2-cell${held ? ' mv2-held' : ''}`}>
      <dt>{label}</dt>
      <dd {...attr}>{value}</dd>
    </div>
  );
}
