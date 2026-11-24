// Zip 85 (🎾84 dry run, Alex approved): tournament tickets owed after a "Didn't pay" on the night (shared/tournamentTickets.ts OWED_MARK).
// The player played, so they owe it like any unpaid game: their You owe card (Pay, I paid), and here, on Money > Games, one card with a row per
// ticket: "Kai · The Cold Open, Tue, Dec 1 · $18" with Mark paid; once they tap I paid, Paid and Didn't pay (as every I paid). Paid or Mark
// paid puts the money on the ticket (Totals count it, to the cent); Didn't pay leaves it owed. From the dashboard (one small read in its trip).
import { useState } from 'react';
import type { AdminOwedTicket } from '../../../shared/tournament';
import { formatPrice } from '../../../shared/money';
import { formatShortDate } from '../../../shared/time';
import { api, ApiError } from '../../lib';
import { useToast } from '../../ui';
import type { AdminCtx } from '../Admin';

export function TicketsOwedCard({ ctx }: { ctx: AdminCtx }) {
  const rows = ctx.d.ticketsOwed ?? [];
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!rows.length) return null;
  const tz = ctx.d.group.timezone;
  const owed = rows.filter((r) => !r.waiting).reduce((a, r) => a + r.cents, 0);
  async function act(r: AdminOwedTicket, action: 'mark_paid' | 'confirm' | 'reject', done: string) {
    const key = `${r.tournamentId}:${r.playerId}`;
    if (busy) return;
    setBusy(key);
    try {
      await api('POST', `/api/admin/tournament/${r.tournamentId}/ticket`, { playerId: r.playerId, action, cents: r.cents });
      await ctx.reload();
      toast(done);
    } catch (err) {
      toast(err instanceof ApiError || err instanceof Error ? err.message : 'Could not save. Try again.', 'error');
      if (err instanceof ApiError && err.status === 409) void ctx.reload();
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card mrw-game open mrw-tickets-owed" aria-label="Tournament tickets" data-tickets-owed={rows.length}>
      <div className="mrw-head">
        <span className="mrw-text mrw-tickets-head">
          <span className="mrw-title">Tournament tickets</span>
        </span>
        {owed > 0 && (
          <span className="mrw-right">
            <span className="mrw-owed" data-owed={owed}>
              <span className="sr-only">Owed </span>
              {formatPrice(owed)} owed
            </span>
          </span>
        )}
      </div>
      <ul className="mrw-rows" aria-label="Tournament tickets owed">
        {rows.map((r) => {
          const key = `${r.tournamentId}:${r.playerId}`;
          const wait = busy !== null;
          const day = r.date ? formatShortDate(`${r.date}T17:00:00Z`, tz) : null;
          return (
            <li key={key} className="mrw-row" data-ticket-owed-row={r.playerName} data-waiting={r.waiting ? 'yes' : 'no'}>
              <div className="mrw-line">
                <span className="mrw-who">
                  <strong className="mrw-name">{r.playerName}</strong>
                  <span className="mrw-sub">
                    {r.waiting ? `Tapped I paid (${formatPrice(r.cents)})` : `Owes ${formatPrice(r.cents)}`} · {r.name}
                    {day ? `, ${day}` : ''}
                  </span>
                </span>
                {r.waiting ? (
                  <span className="mrw-acts">
                    <button type="button" className="mrw-mark" disabled={wait} onClick={() => void act(r, 'confirm', `${r.playerName}’s ${formatPrice(r.cents)} is in`)} data-ticket-owed-paid>
                      {busy === key ? 'Saving…' : 'Paid'}
                    </button>
                    <button type="button" className="mrw-undo" disabled={wait} onClick={() => void act(r, 'reject', `${r.playerName} still owes ${formatPrice(r.cents)}`)} data-ticket-owed-not-paid>
                      Didn’t pay
                    </button>
                  </span>
                ) : (
                  <button type="button" className="mrw-mark" disabled={wait} onClick={() => void act(r, 'mark_paid', `${r.playerName}’s ${formatPrice(r.cents)} is in`)} data-ticket-owed-mark>
                    {busy === key ? 'Saving…' : 'Mark paid'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
