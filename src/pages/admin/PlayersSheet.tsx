import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { DB_LIMIT_MESSAGE } from '../../../shared/zip10';
import { formatTime } from '../../../shared/time';
import { viewFlat } from '../../../shared/gameLength';
import { api } from '../../lib';
import { ConfirmDialog, Pickleball, Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { opTap } from './action';
import { RemindList } from './MoneyV2';
import { ReworkRemind } from './MoneyReworkParts';
import { RowRequest } from './VenmoRequest';
import { payChip, payMoneyLine, useRosterOps } from './Sessions';
import { lateFeeLine } from './LateFees';
import { MAX_PLAYERS_LIMIT } from '../../../shared/spots';
import '../../players-sheet.css';

/**
 * The "Players · Thu, Nov 12" sheet, redone (PLAYERS_SHEET_REDO, Zip 32, Alex's mock mocks/1_players_sheet). Everything on it is an action the
 * old sheet or the money card already has, run by the same code:
 *   - Remind: the Remind sheet the Home money card opens (the Money rework's, or the older list, whichever that card opens).
 *   - Mark paid and Request: the Home money card's own call and its own Request link (VenmoRequest.tsx RowRequest), same Undo.
 *   - Remove (in the three-dot menu): the old Remove, same question, same 5-second Undo (Sessions.tsx useRosterOps).
 *   - Add: the old Give spot (same call, same rules, same refusal messages), for several names one after the other.
 * The sheet draws only what the server sent; nothing here changes a price, a seat or a credit.
 */
export function PlayersSheet({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const toast = useToast();
  const ops = useRosterOps(ctx, s);
  const { busy, run, removing, setRemoving, held, removeHeld, live, act, others, cleanup, full } = ops;
  const [remind, setRemind] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const canceled = s.state.flags.canceled;
  const fin = s.finalized;
  const meId = ctx.d.me?.id ?? null;

  // The host (the organizer) is never a row here: they pay the venue, and their own In / Out is on the game card.
  // A seat that left but still owes (or paid) a late fee is counted in "x of y paid" by the server, so it is a row here too (the old Money list has it).
  const isFee = (r: AdminRosterEntry) => !!r.lateFee && r.status !== 'confirmed' && r.status !== 'waitlisted';
  const listed = s.roster.filter((r) => !r.isOrganizer && (r.status === 'confirmed' || r.status === 'waitlisted' || isFee(r)));
  const declined = s.roster.filter((r) => !r.isOrganizer && r.status === 'declined');
  const owing = (r: AdminRosterEntry) => (r.lateFee ? !r.lateFee.paid && r.owesCents > 0 : !canceled && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.owesCents > 0);
  const anyOwes = listed.some((r) => owing(r));
  const price = fin ? fin.priceCents : viewFlat(s, ctx.d.group.settings.pricePerPlayerCents);

  // The names to tap: everyone eligible and not in the game, never-signed-up first, then the ones who declined or dropped.
  const hadRow = new Set(s.roster.map((r) => r.playerId));
  const chips = [...others.filter((p) => p.id !== meId && !hadRow.has(p.id)), ...others.filter((p) => p.id !== meId && hadRow.has(p.id))];
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chosen = chips.filter((p) => picked.has(p.id));

  const fullWords = cleanup ? DB_LIMIT_MESSAGE : `The game is full (${ctx.d.group.settings.maxPlayers} in).`;
  const spotsLeft = Math.max(0, (cleanup ? MAX_PLAYERS_LIMIT : ctx.d.group.settings.maxPlayers) - s.confirmedCount);
  async function add() {
    if (chosen.length === 0) return;
    // A full game says so, with the server's own words (the old Give spot was a grayed button with no word).
    if (full) {
      toast(fullWords, 'error');
      return;
    }
    // More names than free seats: nothing is added, the picks stay, and it says how many fit (the saves are held 5 seconds for Undo, so the server's
    // "full" for the extra names would only come after the others already showed "got a spot").
    if (chosen.length > spotsLeft) {
      toast(`Only ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left. Pick ${spotsLeft === 1 ? 'one name' : `${spotsLeft} names`} or fewer.`, 'error');
      return;
    }
    setPicked(new Set());
    for (const p of chosen) {
      // The same call and words as Give spot. If the server says no (the game filled up), it says why and the rest are not tried.
      if (!(await act(p.id, 'confirm', `${p.name} got a spot`))) break;
    }
  }

  const markPaid = (r: AdminRosterEntry) =>
    void run(
      () => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents, ...(r.extCents ? { extCents: r.extCents } : {}) }),
      `${r.name} marked paid`,
      opTap({ kind: 'paid', sessionId: s.id, playerId: r.playerId }, 'Mark paid', ctx.d.adminUndo === true),
    );

  return (
    <div className="ps" data-players-sheet>
      <div className="ps-summary" data-ps-summary>
        <p className="ps-count">
          {s.payableCount > 0 ? (
            <>
              <b>
                {s.paidCount} of {s.payableCount} paid
              </b>
              <span className="ps-each"> · {formatPrice(price)} each</span>
            </>
          ) : (
            <>
              <b>{canceled ? 'Canceled' : 'Nobody to pay yet'}</b>
              {!canceled && <span className="ps-each"> · {formatPrice(price)} each</span>}
            </>
          )}
        </p>
        {anyOwes && !canceled && (
          <button type="button" className="ps-remind" data-ps-remind onClick={() => setRemind(true)}>
            Remind
          </button>
        )}
      </div>

      {!live && (
        <p className="ps-closed" data-ps-closed>
          {canceled ? 'Canceled. View only.' : 'Closed. Players cannot be added or removed.'}
        </p>
      )}

      {declined.length > 0 && (
        <p className="ps-declined" data-ps-declined>
          <span className="ps-dot" aria-hidden="true" />
          <span>
            {declined.map((r, i) => (
              <span key={r.playerId}>
                <b>{r.name}</b>
                {i < declined.length - 1 ? ', ' : ''}
              </span>
            ))}{' '}
            declined
          </span>
        </p>
      )}

      {listed.length === 0 ? (
        <p className="ps-empty">Nobody has signed up yet.</p>
      ) : (
        <ul className="ps-card" aria-label="Players in this game" data-ps-list>
          {listed.map((r) => {
            const isHeld = held.has(r.playerId);
            const paid = !isHeld && (r.lateFee ? r.lateFee.paid : r.status === 'confirmed' && r.paymentStatus === 'paid' && !r.refundedAt);
            const owes = !isHeld && owing(r);
            const canEdit = live && !isHeld && (r.status === 'confirmed' || r.status === 'waitlisted');
            const chip = r.status === 'confirmed' ? payChip(r, s) : null;
            // Wide actions (two buttons, or a long chip such as "Paid with credit") drop under the name on a narrow screen; a plain "Paid" stays beside it.
            const wide = !isHeld && (owes || (!paid && !!chip) || (paid && chip?.label === 'Paid with credit'));
            return (
              <li key={r.playerId} className="ps-row" data-ps-row={r.name} data-ps-long={longName(r.name) || undefined} data-ps-wide={wide || undefined} data-ps-state={isHeld ? 'removed' : paid ? 'paid' : owes ? 'owes' : 'other'}>
                <span className="ps-ball" aria-hidden="true">
                  <Pickleball />
                </span>
                <div className="ps-who">
                  <strong className="ps-name">{r.name}</strong>
                  {isHeld ? (
                    <span className="ps-sub">Removed</span>
                  ) : paid ? (
                    <span className="ps-sub" data-ps-paid-line>
                      {r.lateFee ? lateFeeLine(r) : paidLine(r, tz)}
                    </span>
                  ) : owes ? (
                    <span className="ps-sub ps-owes" data-ps-owes-line>
                      Owes {formatPrice(r.owesCents + (r.extCents ?? 0))}
                      {/* Zip 31: extra time riding on this game; Mark paid takes both. */}
                      {r.extCents ? ` (incl. ${formatPrice(r.extCents)} extension)` : ''}
                      {r.lateFee ? <span className="ps-fee"> · {lateFeeLine(r)?.split(' · ')[0]}</span> : null}
                    </span>
                  ) : (
                    <span className="ps-sub">{r.status === 'waitlisted' ? `#${r.waitlistPosition} on waitlist` : payMoneyLine(r, s, tz) || 'Confirmed'}</span>
                  )}
                </div>
                <div className="ps-acts">
                  {paid && (
                    <span className="ps-chip ps-paid" data-ps-paid-chip>
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m3.6 8.4 2.8 2.8 6-6.4" />
                      </svg>
                      {chip?.label === 'Paid with credit' ? 'Paid with credit' : 'Paid'}
                    </span>
                  )}
                  {owes && (
                    <>
                      <button type="button" className="ps-btn ps-amber" disabled={busy} data-ps-markpaid={r.name} aria-label={`Mark ${r.name} paid`} onClick={() => markPaid(r)}>
                        Mark paid
                      </button>
                      {ctx.d.venmoRequest === true && <RowRequest ctx={ctx} s={s} r={r} />}
                    </>
                  )}
                  {canEdit && r.status === 'waitlisted' && (
                    <button type="button" className="ps-btn ps-amber" disabled={busy} data-ps-givespot={r.name} aria-label={`Give ${r.name} a spot`} onClick={() => (full ? toast(fullWords, 'error') : void act(r.playerId, 'confirm', `${r.name} got a spot`))}>
                      Give spot
                    </button>
                  )}
                  {!isHeld && !paid && !owes && chip && (
                    <span className={`ps-chip ps-${chip.tone}`}>{chip.label}</span>
                  )}
                </div>
                {canEdit ? (
                  <RowMenu
                    name={r.name}
                    onRemove={() => setRemoving(r)}
                    onWaitlist={r.status === 'confirmed' && !cleanup ? () => void act(r.playerId, 'waitlist', `${r.name} moved to waitlist`) : undefined}
                  />
                ) : (
                  <span className="ps-dots-gap" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {live && chips.length > 0 && (
        <section className="ps-add" aria-label="Add someone" data-ps-add>
          <h3 className="ps-add-title">Add someone</h3>
          <ul className="ps-chips">
            {chips.map((p) => {
              const on = picked.has(p.id);
              return (
                <li key={p.id}>
                  <button type="button" className="ps-pick" aria-pressed={on} data-ps-chip={p.name} onClick={() => toggle(p.id)}>
                    <span>{p.name}</span>
                    {on && (
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m3.6 8.4 2.8 2.8 6-6.4" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {chosen.length > 0 && (
            <button type="button" className="ps-add-btn" data-ps-add-btn disabled={busy} onClick={() => void add()}>
              {chosen.length === 1 ? `Add ${chosen[0].name}` : `Add ${chosen.length} players`}
            </button>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name}?`}
        body="They'll show as withdrawn. If they held a spot, it opens up for someone else."
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={() => {
          if (removing) removeHeld(removing);
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />

      {/* The same Remind sheet the Home money card opens (one tap per person, "Text all" with the Money rework). */}
      {ctx.d.moneyRework === true ? (
        <ReworkRemind ctx={ctx} s={s} open={remind} onClose={() => setRemind(false)} />
      ) : (
        <Sheet open={remind} title={`Remind · ${remindDay(ctx, s)}`} onClose={() => setRemind(false)}>
          {remind && <RemindList ctx={ctx} s={s} />}
        </Sheet>
      )}
    </div>
  );
}

function remindDay(ctx: AdminCtx, s: AdminSessionView): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ctx.d.group.timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(s.startsAt));
}

/** A name with a long word in it ('Christopher'): its Mark paid and Request go under it sooner, so the name is never broken mid-word. */
const longName = (name: string) => name.split(/\s+/).some((w) => w.length > 9) || name.length > 16;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The grey line on a paid row: who marked it paid and when, from what the site records. A player's own "I paid" (still waiting for your
 * Mark paid) is "Marked paid by Mitchel"; credit that covered the seat is "Paid with credit"; any other paid seat was marked by the organizer.
 */
function paidLine(r: AdminRosterEntry, tz: string): ReactNode {
  // The time never splits ("6:00" and "PM" stay together), and it moves down whole when the line is narrow.
  const at = r.paidAt ? <span className="ps-time"> · {formatTime(r.paidAt, tz).replace(' ', '\u00a0')}</span> : null;
  const who = r.selfPaid ? `Marked paid by ${firstName(r.name)}` : r.creditCents > 0 && r.creditCents >= (r.paymentAmountCents ?? 0) ? 'Paid with credit' : 'You marked it paid';
  return (
    <>
      {who}
      {at}
    </>
  );
}

/** The small three-dot menu at the end of a row. It holds Remove (and To waitlist, the old sheet's other button, when the game has a waitlist). Opens under the dots, or above them when there is no room below. */
function RowMenu({ name, onRemove, onWaitlist }: { name: string; onRemove: () => void; onWaitlist?: () => void }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const el = pop.current;
    const box = wrap.current;
    if (!el || !box) return;
    // The scrolling body of the sheet is the edge to stay inside.
    const body = box.closest('.sheet-body');
    const edge = body ? body.getBoundingClientRect().bottom : window.innerHeight;
    const dots = box.getBoundingClientRect();
    setUp(dots.bottom + el.offsetHeight + 8 > Math.min(edge, window.innerHeight));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);
  return (
    <span
      className="ps-menu"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          setOpen(false);
          wrap.current?.querySelector<HTMLElement>('.ps-dots')?.focus();
        }
      }}
    >
      <button type="button" className="ps-dots" aria-label={`More for ${name}`} aria-haspopup="menu" aria-expanded={open} data-ps-dots={name} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>
      {open && (
        <div className={`ps-pop${up ? ' ps-up' : ''}`} ref={pop} role="menu" aria-label={`Actions for ${name}`}>
          {onWaitlist && (
            <button
              type="button"
              role="menuitem"
              className="ps-pop-item ps-pop-plain"
              data-ps-waitlist={name}
              aria-label={`Move ${name} to the waitlist`}
              onClick={() => {
                setOpen(false);
                onWaitlist();
              }}
            >
              To waitlist
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="ps-pop-item"
            data-ps-remove={name}
            aria-label={`Remove ${name}`}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            Remove
          </button>
        </div>
      )}
    </span>
  );
}
