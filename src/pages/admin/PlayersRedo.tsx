import '../../players-redo.css';
import type { ReactNode } from 'react';
import type { AdminDashboard, AdminPlayer, PlayerSummary } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { spentText } from '../../../shared/spentTotals';
import { formatWeekdayShort, weekTier } from '../../../shared/time';
import { api, useLoad } from '../../lib';
import { Sheet } from '../../ui';
import type { AdminCtx } from '../Admin';
import { balanceOf, heldCents } from './todo';

// Players redo (PLAYERS_REDO, Zip 13): the admin Players tab from the approved mock (p6_E, p5_details, p5_edit). Only drawn while the switch
// is on; off, PlayersTab draws exactly what it did before. Display only: nothing here saves, charges or sends anything. The money actions
// (Mark paid, Refund credit balance, Adjust credit, Hide, Remove) are the same components as before, moved into the two sheets.

export type ChipKind = 'owes' | 'held' | 'credit';
export interface Chip {
  kind: ChipKind;
  cents: number;
}

/** The money chips for a row, in priority order (Owes > Held > Credit), only the ones above $0. The organizer has none (they pay the venue). */
export function chipsFor(d: AdminDashboard, p: AdminPlayer): Chip[] {
  if (d.me?.id === p.id) return [];
  const { owedCents, creditCents } = balanceOf(d, p.id);
  const held = heldCents(d, p.id);
  const out: Chip[] = [];
  if (owedCents > 0) out.push({ kind: 'owes', cents: owedCents });
  if (held > 0) out.push({ kind: 'held', cents: held });
  if (creditCents > 0) out.push({ kind: 'credit', cents: creditCents });
  return out;
}

const CHIP_WORD: Record<ChipKind, string> = { owes: 'Owes', held: 'Held', credit: 'Credit' };

/** The days of the games this player is in this week or next ("Tue Thu"), oldest first, each weekday once. Empty: none. */
export function upcomingDays(d: AdminDashboard, playerId: string): string[] {
  const tz = d.group.timezone;
  const nowMs = Date.parse(d.now);
  const days: string[] = [];
  const games = [...d.sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const s of games) {
    if (s.state.flags.canceled || Date.parse(s.endsAt) <= nowMs) continue;
    if (weekTier(s.startsAt, nowMs, tz) === 'later') continue;
    if (!s.roster.some((r) => r.playerId === playerId && r.status === 'confirmed')) continue;
    const day = formatWeekdayShort(s.startsAt, tz);
    if (!days.includes(day)) days.push(day);
  }
  return days;
}

function CalIcon() {
  return (
    <svg className="pr-cal" width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="10" rx="2" />
      <path d="M1.5 6h11M4.5 1v3M9.5 1v3" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

/** The list: one card under the month label, one line per person, then a small "Add a person" button. */
export function PlayersRedoList({ ctx, players, onOpen, onAdd }: { ctx: AdminCtx; players: AdminPlayer[]; onOpen: (id: string) => void; onAdd: () => void }) {
  const month = ctx.d.playersRedoMonth ?? '';
  return (
    <div className="pr-wrap" data-players-redo>
      <div className="week-break pr-month">
        <h3 data-pr-month>{month}</h3>
      </div>
      <ul className="pr-list" aria-label="Players">
        {players.map((p) => {
          const chips = chipsFor(ctx.d, p);
          const days = upcomingDays(ctx.d, p.id);
          const n = p.monthPlayed ?? 0;
          const played = `${n} played`;
          const words = [p.name, p.isActive ? played : `Hidden · ${played}`, days.length ? `in ${days.join(' and ')}` : '', ...chips.map((c) => `${CHIP_WORD[c.kind]} ${formatPrice(c.cents)}`)].filter(Boolean).join(', ');
          return (
            <li key={p.id} className="pr-li" data-player={p.name}>
              <button type="button" className="pr-row" onClick={() => onOpen(p.id)} aria-label={`${words}. Details`} data-pr-row={p.name}>
                <b className="pr-name">{p.name}</b>
                <span className="pr-sub" data-pr-sub>
                  {p.isActive ? played : `Hidden · ${played}`}
                  {days.length > 0 && (
                    <span className="pr-days" data-pr-days>
                      {' · '}
                      <CalIcon />
                      {days.join(' ')}
                    </span>
                  )}
                </span>
                <span className="pr-sp" />
                {chips.length > 0 && (
                  <span className={`pr-chip pr-${chips[0].kind}`} data-pr-chip={chips[0].kind}>
                    {CHIP_WORD[chips[0].kind]} {formatPrice(chips[0].cents)}
                  </span>
                )}
                {chips.length > 1 && (
                  <span className="pr-chip pr-more" data-pr-more>
                    +{chips.length - 1}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn ghost block small pr-add" onClick={onAdd} data-pr-add>
        Add a person
      </button>
    </div>
  );
}

function Kv({ label, value, tone, data }: { label: string; value: string | null; tone?: ChipKind; data: string }) {
  const zero = value === '$0' || value === '0';
  return (
    <div className={`pr-kv${tone ? ` pr-${tone}` : ''}${zero ? ' pr-zero' : ''}`} data-pr-kv={data}>
      <span>{label}</span>
      <b>{value ?? '…'}</b>
    </div>
  );
}

/**
 * The details sheet: the month card (games played, spent), the money card (owes, held for a game, credit, and a cash out request only while
 * one waits), the All time card, then the games and credit history with their buttons (`children`, the same parts as the old sheet).
 */
export function PlayerDetailsSheet({ ctx, player, onClose, onEdit, children }: { ctx: AdminCtx; player: AdminPlayer | null; onClose: () => void; onEdit: (p: AdminPlayer) => void; children?: ReactNode }) {
  return (
    <Sheet
      open={!!player}
      title={player?.name ?? ''}
      onClose={onClose}
      className="pr-sheet"
      // The small pencil sits right after the name; the ✕ stays alone at the top right, as on the edit sheet.
      titleAfter={
        player && (
          <button type="button" className="icon-btn pr-pen" onClick={() => onEdit(player)} aria-label={`Edit ${player.name}`} data-pr-edit>
            <PencilIcon />
          </button>
        )
      }
    >
      {player && <DetailsBody ctx={ctx} player={player}>{children}</DetailsBody>}
    </Sheet>
  );
}

function DetailsBody({ ctx, player, children }: { ctx: AdminCtx; player: AdminPlayer; children?: ReactNode }) {
  // The month and All time numbers come from the server (the organizer's own from Money Totals). Asked again when the data changes.
  const load = useLoad(() => api<PlayerSummary>('GET', `/api/admin/players/${player.id}/summary`), [player.id, ctx.d.version]);
  const sum = load.data;
  const isMe = ctx.d.me?.id === player.id;
  const { owedCents, creditCents } = balanceOf(ctx.d, player.id);
  const held = isMe ? 0 : heldCents(ctx.d, player.id);
  const cashOut = ctx.d.refundRequests.filter((r) => r.playerId === player.id).reduce((t, r) => t + r.cents, 0);
  const month = sum?.month.label ?? ctx.d.playersRedoMonth ?? '';
  return (
    <div className="pr-cards" data-pr-details={player.name}>
      <section className="pr-cd" aria-label={month} data-pr-card="month">
        <h4>{month}</h4>
        <Kv label="Games played" value={sum ? String(sum.month.played) : null} data="month-played" />
        <Kv label="Spent" value={sum ? spentText(sum.month.spentCents, formatPrice) : null} data="month-spent" />
      </section>
      <section className="pr-cd" aria-label="Money" data-pr-card="money">
        <h4>MONEY</h4>
        {isMe ? (
          <div className="pr-kv pr-zero" data-pr-kv="venue">
            <span>You pay the court directly</span>
          </div>
        ) : (
          <>
            <Kv label="Owes" value={formatPrice(owedCents)} tone="owes" data="owes" />
            <Kv label="Held for a game" value={formatPrice(held)} tone="held" data="held" />
            <Kv label="Credit" value={formatPrice(creditCents)} tone="credit" data="credit" />
            {cashOut > 0 && <Kv label="Cash out request" value={formatPrice(cashOut)} tone="credit" data="cash-out" />}
          </>
        )}
      </section>
      <section className="pr-cd" aria-label="All time" data-pr-card="all">
        <h4>ALL TIME</h4>
        <Kv label="Games played" value={sum ? String(sum.allTime.played) : null} data="all-played" />
        <Kv label="Spent" value={sum ? spentText(sum.allTime.spentCents, formatPrice) : null} data="all-spent" />
      </section>
      {load.error && <p className="small muted">Couldn't load the month and All time numbers. Close and open again.</p>}
      {children}
    </div>
  );
}

/** The edit sheet: "Edit Nathan" with a round ✕; the form is the same one as before, without Plays and Usual days. */
export function PlayerEditSheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open={open} title={title} onClose={onClose} className="pr-sheet pr-edit-sheet">
      {children}
    </Sheet>
  );
}
