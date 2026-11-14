import { type ReactNode, useState } from 'react';
import { AcIcon, AcTitle } from '../../AlertCard';
import type { AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { siteAddress, smsHref } from '../../../shared/messages';
import { guestPaymentText, paymentTextR2 } from '../../../shared/textsR2';
import { formatShortDate, formatTime, formatWeekdayShort, localParts } from '../../../shared/time';
import { guestVenmoRequestLinks, venmoRequestLinks } from '../../../shared/venmoRequest';
import { api, isIOS, openVenmo } from '../../lib';
import { Sheet } from '../../ui';
import type { AdminCtx } from '../Admin';
import { opTap, useAction } from './action';
import { RemindList } from './MoneyV2';
import { ReworkRemind } from './MoneyReworkParts';
import { owedHomeGames } from './moneyList';
import '../../mark-paid.css';
import '../../venmo-request.css';

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (ms: number, tz: string) => {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/**
 * Home, "Do this now": for each game that still has people who owe, one card, "Thu game: 3 haven't paid", with a Remind button (opens the Remind
 * sheet) and, per person, "Mark paid" next to "Request" (a Venmo username is saved), "Text" (no Venmo, a number is saved) or the words "no Venmo
 * saved". Zip 29: this card took over from the second money card ("Mark paid tonight" / "Who owes you"), so it also lists the games coming up
 * from their check-in time (src/pages/admin/moneyList.ts owedHomeGames). Only with VENMO_REQUEST on; with it off nothing here exists (and the old
 * second card is drawn instead, exactly as before).
 */
export function OwedVenmoCards({ ctx }: { ctx: AdminCtx }) {
  const [remind, setRemind] = useState<string | null>(null);
  const { run, busy } = useAction(ctx);
  if (ctx.d.venmoRequest !== true) return null;
  const tz = ctx.d.group.timezone;
  const games = owedHomeGames(ctx.d);
  if (games.length === 0) return null;
  const remindGame = games.find((g) => g.s.id === remind)?.s ?? null;
  return (
    <section className={ctx.d.alertCards === true ? 'ac-stack vr-cards' : 'stack vr-cards'} aria-label="Do this now: who hasn't paid" data-vr-cards>
      {games.map(({ s, rows }) => {
        const amounts = new Set(rows.map((r) => r.owesCents + (r.extCents ?? 0)));
        const common = amounts.size === 1 ? rows[0].owesCents + (rows[0].extCents ?? 0) : null;
        return (
          <article key={s.id} className={ctx.d.alertCards === true ? 'ac ac-amber vr-card-ac' : 'card vr-card'} data-vr-card={s.id} {...(ctx.d.alertCards === true ? { 'data-alert-card': 'amber' } : {})}>
            <div className="vr-head">
              {ctx.d.alertCards === true && <AcIcon name="owe" />}
              <div className="vr-title-wrap">
                <VrTitle cards={ctx.d.alertCards === true}>
                  {formatWeekdayShort(s.startsAt, tz)}
                  {games.filter((g) => dayKey(Date.parse(g.s.startsAt), tz) === dayKey(Date.parse(s.startsAt), tz)).length > 1 ? ` ${formatTime(s.startsAt, tz)}` : ''} game: {rows.length}{' '}
                  {rows.length === 1 ? "hasn't" : "haven't"} paid
                </VrTitle>
                <p className={ctx.d.alertCards === true ? 'small muted vr-sub ac-sub' : 'small muted vr-sub'}>
                  {/* Two games on the same weekday (last Tuesday's and the coming one) would read the same: say which date. */}
                  {games.some((g) => g.s.id !== s.id && formatWeekdayShort(g.s.startsAt, tz) === formatWeekdayShort(s.startsAt, tz) && dayKey(Date.parse(g.s.startsAt), tz) !== dayKey(Date.parse(s.startsAt), tz))
                    ? `${formatShortDate(s.startsAt, tz)} · `
                    : ''}
                  {common !== null ? `${formatPrice(common)} each` : 'Amounts differ'}
                  {s.state.flags.canceled ? ' · Canceled late, fee kept' : s.court ? ' · Court booked' : ''}
                </p>
              </div>
              <button type="button" className={ctx.d.alertCards === true ? 'ac-btn vr-remind-ac' : 'vr-remind'} data-ac-tone={ctx.d.alertCards === true ? 'purple' : undefined} data-vr-remind onClick={() => setRemind(s.id)}>
                Remind
              </button>
            </div>
            <ul className="mp-rows" aria-label={`Who owes for ${formatShortDate(s.startsAt, tz)}`} data-vr-rows>
              {rows.map((r) => (
                <li key={r.playerId} className="mp-row" data-vr-row={r.name}>
                  <span className="mp-name">
                    <strong>{r.name}</strong>
                    {common === null && <span className="mp-price">{formatPrice(r.owesCents + (r.extCents ?? 0))}</span>}
                    {/* Zip 31: the extra time riding on this game; Mark paid takes both. */}
                    {!!r.extCents && (
                      <span className="mp-price xt-incl-admin" data-vr-ext={r.name}>
                        incl. {formatPrice(r.extCents)} extension
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="mp-btn mp-amber"
                    disabled={busy}
                    data-vr-markpaid={r.name}
                    aria-label={`Mark ${r.name} paid for ${formatShortDate(s.startsAt, tz)}`}
                    onClick={() =>
                      void run(
                        () => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents, ...(r.extCents ? { extCents: r.extCents } : {}) }),
                        `${r.name} marked paid`,
                        opTap({ kind: 'paid', sessionId: s.id, playerId: r.playerId }, 'Mark paid', ctx.d.adminUndo === true),
                      )
                    }
                  >
                    Mark paid
                  </button>
                  <RowRequest ctx={ctx} s={s} r={r} />
                </li>
              ))}
            </ul>
          </article>
        );
      })}
      {ctx.d.moneyRework === true ? (
        <ReworkRemind ctx={ctx} s={remindGame} open={!!remindGame} onClose={() => setRemind(null)} />
      ) : (
        <Sheet open={!!remindGame} title={remindGame ? `Remind · ${formatShortDate(remindGame.startsAt, tz)}` : ''} onClose={() => setRemind(null)}>
          {remindGame && <RemindList ctx={ctx} s={remindGame} />}
        </Sheet>
      )}
    </section>
  );
}

/** The card's title: with Alert cards on it keeps to one line (AcTitle); off, the same h3 as before. */
function VrTitle({ cards, children }: { cards: boolean; children: ReactNode }) {
  if (cards) return <AcTitle as="h3" className="vr-title">{children}</AcTitle>;
  return <h3 className="vr-title">{children}</h3>;
}

/**
 * The second button on a row: "Request" (Venmo saved: opens Venmo with this person and what they owe), "Text" (no Venmo but a number: Messages
 * to them with the usual payment text), or the small gray words "no Venmo saved" (neither). Nothing is sent or charged here.
 */
export function RowRequest({ ctx, s, r }: { ctx: AdminCtx; s: AdminSessionView; r: AdminRosterEntry }) {
  const p = ctx.d.players.find((x) => x.id === r.playerId);
  const link = venmoRequestLinks(p?.venmo ?? null, r.owesCents + (r.extCents ?? 0), s.startsAt, ctx.d.group.timezone);
  if (link) {
    return (
      <a
        className="sc-req"
        href={link.url}
        data-app-href={link.appUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => openVenmo(e, link)}
        data-venmo-request={r.name}
        aria-label={`Venmo request ${formatPrice(r.owesCents)} from ${r.name}`}
      >
        Request
      </a>
    );
  }
  if (!p?.phone) return <span className="mp-none">no Venmo saved</span>;
  const first = r.name.trim().split(/\s+/)[0] || r.name;
  const body = paymentTextR2(first, r.owesCents, [s], ctx.d.group.timezone, Date.parse(ctx.d.now), siteAddress(ctx.d.group.playerLink));
  return (
    <a className="sc-req sc-req-text" href={smsHref(p.phone, body, isIOS)} data-sc-textone={r.name} aria-label={`Text ${r.name} about the ${formatPrice(r.owesCents)}`}>
      Text
    </a>
  );
}

/**
 * Zip 42 round 2: "Request" on a guest's row. It always goes to the HOST, never the guest (a guest has no phone): Venmo when the host has a
 * username saved (the note names the guest), else Messages to the host with "Hey Parker, you owe $14 for your guest Billy for Thu, Nov 12."
 */
export function GuestRequest({ ctx, s, host, guest, cents }: { ctx: AdminCtx; s: AdminSessionView; host: AdminRosterEntry; guest: string; cents: number }) {
  const p = ctx.d.players.find((x) => x.id === host.playerId);
  const link = guestVenmoRequestLinks(p?.venmo ?? null, cents, s.startsAt, ctx.d.group.timezone, guest);
  if (link) {
    return (
      <a
        className="sc-req"
        href={link.url}
        data-app-href={link.appUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => openVenmo(e, link)}
        data-venmo-request={guest}
        aria-label={`Venmo request ${formatPrice(cents)} from ${host.name} for guest ${guest}`}
      >
        Request
      </a>
    );
  }
  if (!p?.phone) return <span className="mp-none">no Venmo saved</span>;
  const first = host.name.trim().split(/\s+/)[0] || host.name;
  const body = guestPaymentText(first, guest, cents, s.startsAt, ctx.d.group.timezone, siteAddress(ctx.d.group.playerLink));
  return (
    <a className="sc-req sc-req-text" href={smsHref(p.phone, body, isIOS)} data-sc-textone={guest} aria-label={`Text ${host.name} about ${guest}'s ${formatPrice(cents)}`}>
      Text
    </a>
  );
}
