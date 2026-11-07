import type { ReactNode } from 'react';
import { AcIcon, AcTitle } from '../../AlertCard';
import { useState } from 'react';
import { formatPrice } from '../../../shared/money';
import { formatShortDate, formatTime, formatWeekdayShort, localParts } from '../../../shared/time';
import { venmoUsername } from '../../../shared/venmoRequest';
import { Sheet } from '../../ui';
import type { AdminCtx } from '../Admin';
import { RemindList } from './MoneyV2';
import { ReworkRemind } from './MoneyReworkParts';
import { unpaidRows } from './moneyList';
import { VenmoRequestLink } from './VenmoLink';
import '../../venmo-request.css';

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (ms: number, tz: string) => {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/**
 * Home, "Do this now": for each game on its game day or after that still has people who owe, one card, "Thu game: 3 haven't paid", with a
 * Remind button (opens the Remind sheet) and, per person, a Venmo request link when that player has a Venmo username saved, or the words
 * "no Venmo saved". Only with VENMO_REQUEST on; with it off nothing here exists.
 */
export function OwedVenmoCards({ ctx }: { ctx: AdminCtx }) {
  const [remind, setRemind] = useState<string | null>(null);
  if (ctx.d.venmoRequest !== true) return null;
  const tz = ctx.d.group.timezone;
  const today = dayKey(Date.parse(ctx.d.now), tz);
  const games = ctx.d.sessions
    .filter((s) => s.hiddenFromList !== true && dayKey(Date.parse(s.startsAt), tz) <= today)
    .map((s) => ({ s, rows: unpaidRows(s) }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => a.s.startsAt.localeCompare(b.s.startsAt));
  if (games.length === 0) return null;
  const remindGame = games.find((g) => g.s.id === remind)?.s ?? null;
  return (
    <section className={ctx.d.alertCards === true ? 'ac-stack vr-cards' : 'stack vr-cards'} aria-label="Do this now: who hasn't paid" data-vr-cards>
      {games.map(({ s, rows }) => {
        const amounts = new Set(rows.map((r) => r.owesCents));
        const common = amounts.size === 1 ? rows[0].owesCents : null;
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
                  {common !== null ? `${formatPrice(common)} each` : 'Amounts differ'}
                  {s.state.flags.canceled ? ' · Canceled late, fee kept' : s.court ? ' · Court booked' : ''}
                </p>
              </div>
              <button type="button" className={ctx.d.alertCards === true ? 'ac-btn vr-remind-ac' : 'vr-remind'} data-ac-tone={ctx.d.alertCards === true ? 'purple' : undefined} data-vr-remind onClick={() => setRemind(s.id)}>
                Remind
              </button>
            </div>
            <ul className={ctx.d.alertCards === true ? 'vr-rows ac-body' : 'vr-rows'} aria-label={`Who owes for ${formatShortDate(s.startsAt, tz)}`}>
              {rows.map((r) => {
                const has = venmoUsername(ctx.d.players.find((p) => p.id === r.playerId)?.venmo ?? null) !== null;
                return (
                  <li key={r.playerId} data-vr-row={r.name}>
                    <span className="vr-name">
                      <strong>{r.name}</strong>
                      {common === null && <span className="small muted"> · {formatPrice(r.owesCents)}</span>}
                    </span>
                    {has ? <VenmoRequestLink ctx={ctx} s={s} r={r} /> : <span className="small muted vr-none">no Venmo saved</span>}
                  </li>
                );
              })}
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
