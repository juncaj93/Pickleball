import '../../admin-r3.css';
import type { AdminPlayer } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { GearIcon } from '../../ui';
import type { AdminCtx } from '../Admin';
import { balanceOf, heldCents } from './todo';

/**
 * The Players list, "Admin screens, round 3" (ADMIN_R3). Same people, same numbers, same Edit sheet, one tidy layout:
 * every row the same height, the name on line 1, "9 played · $108 spent" on line 2 (small, gray), then a blue "$28 held" and
 * a green "$3 credit" pill ONLY when that amount is not zero. The round gray gear opens the same Edit sheet as before.
 * "Add a person" is the last row inside the card. Display only: nothing here saves, charges or sends anything.
 *
 * Where the numbers come from (nothing new is worked out on the phone):
 *  - played: the all-time count the Players page already showed ("N played").
 *  - spent: money paid for games played, worked out on the server from existing rows (server/adminR3.ts), same math as Money's "collected".
 *  - held: heldCents(), what Home and the old Players row call "$28 held".
 *  - credit: the credit pot, balanceOf().creditCents.
 */
export function PlayersListR3({
  ctx,
  players,
  onView,
  onEdit,
  onAdd,
}: {
  ctx: AdminCtx;
  players: AdminPlayer[];
  onView: (id: string) => void;
  onEdit: (p: AdminPlayer) => void;
  onAdd: () => void;
}) {
  return (
    <ul className="card player-list r3-players" aria-label="Players" data-r3-players>
      {players.map((p) => {
        const isMe = ctx.d.me?.id === p.id;
        // You pay the venue, so there is no held money or credit on your own row.
        const held = isMe ? 0 : heldCents(ctx.d, p.id);
        const credit = isMe ? 0 : balanceOf(ctx.d, p.id).creditCents;
        const line = p.isActive ? `${p.played} played · ${formatPrice(p.spentCents ?? 0)} spent` : `Hidden · ${p.played} played`;
        return (
          <li key={p.id} className="player-row r3-row" data-player={p.name}>
            <button type="button" className="player-open r3-open" onClick={() => onView(p.id)} aria-label={`${p.name}, ${line}${held > 0 ? `, ${formatPrice(held)} held` : ''}${credit > 0 ? `, ${formatPrice(credit)} credit` : ''}. Money and sessions`}>
              <span className="r3-name">{p.name}</span>
              <span className="r3-sub">
                <span className="r3-stats" data-r3-stats>
                  {line}
                </span>
                {held > 0 && (
                  <span className="r3-pill r3-held" data-r3-held>
                    {formatPrice(held)} held
                  </span>
                )}
                {credit > 0 && (
                  <span className="r3-pill r3-credit" data-r3-credit>
                    {formatPrice(credit)} credit
                  </span>
                )}
              </span>
            </button>
            <button type="button" className="icon-round r3-gear" onClick={() => onEdit(p)} aria-label={`Edit ${p.name}`} data-r3-gear>
              <GearIcon />
            </button>
          </li>
        );
      })}
      <li className="player-row r3-row r3-add">
        <button type="button" className="r3-add-btn" onClick={onAdd} data-r3-add>
          <span className="r3-plus" aria-hidden="true">
            <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M9 2v14M2 9h14" />
            </svg>
          </span>
          Add a person
        </button>
      </li>
    </ul>
  );
}
