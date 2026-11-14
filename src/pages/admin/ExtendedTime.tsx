// Zip 31, "Extended time" (EXTENDED_TIME, shared/extension.ts): the organizer's screens.
//  - WhoPlayedTiles: the Who played sheet redone as big tiles (option A, chosen by Alex), with EXTENDED TIME None | +30 min | +1 hr and
//    the amber "3 others pay $3 each / You cover $3" line. Confirm finalizes exactly as the old sheet did, plus the extra time.
//  - ExtensionOwedCard: Home's money card rows for shares still owed ("$3 extension · Thu, Nov 12") with Mark paid / Request / Text / Remind.
// Only drawn while the switch is on for this phone; off, Admin draws the old sheet and no card, exactly as main.
import { useState } from 'react';
import type { AdminDashboard, AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { type ExtraMinutes, extensionSplitHeads, splitLine } from '../../../shared/extension';
import { whoPlayedNotes } from '../../../shared/guestSpot';
import { type GamePrice, gameFinalPreview } from '../../../shared/gameLength';
import { formatShortDate } from '../../../shared/time';
import { siteAddress, smsHref } from '../../../shared/messages';
import { venmoRequestLinks } from '../../../shared/venmoRequest';
import { unconfirmedPaidWarning } from '../../../shared/credit';
import { api, isIOS, openVenmo } from '../../lib';
import { Pickleball } from '../../ui';
import { AcIcon, AcTitle } from '../../AlertCard';
import type { AdminCtx } from '../Admin';
import { useAction } from './action';
import '../../extended-time.css';
import '../../guest-spot.css';

const CHOICES: { m: ExtraMinutes; label: string }[] = [
  { m: 0, label: 'None' },
  { m: 30, label: '+30 min' },
  { m: 60, label: '+1 hr' },
];

/** The sheet: a summary line, a two-column grid of tiles (tap to say who played), EXTENDED TIME, the amber split line, Confirm. */
export function WhoPlayedTiles({
  s,
  gp,
  busy,
  unconfirmedNames,
  onConfirm,
}: {
  s: AdminSessionView;
  gp: GamePrice;
  busy: boolean;
  unconfirmedNames: string[];
  onConfirm: (ids: string[], extraMinutes: ExtraMinutes, guestsOut: string[]) => void;
}) {
  const price = gp.flatCents;
  const inNow = s.roster.filter((r) => r.status === 'confirmed');
  const [played, setPlayed] = useState<Set<string>>(() => new Set(inNow.map((r) => r.playerId)));
  const [extra, setExtra] = useState<ExtraMinutes>(0);
  // Zip 42 round 2 (Alex): each guest is its own tile right after the host. A host tapped off takes the guest off too (dimmed, cannot be
  // turned on until the host is back on). No guest: exactly as before.
  const [guestOut, setGuestOut] = useState<Set<string>>(() => new Set());
  const hasGuest = (r: AdminRosterEntry) => r.guest?.status === 'confirmed';
  const guestOn = (r: AdminRosterEntry) => played.has(r.playerId) && !guestOut.has(r.playerId);
  const n = played.size + inNow.filter((r) => hasGuest(r) && guestOn(r)).length;
  const organizerPlayed = inNow.some((r) => r.isOrganizer && played.has(r.playerId));
  const orgGuest = inNow.some((r) => r.isOrganizer && hasGuest(r) && guestOn(r));
  const split = extensionSplitHeads(extra, n, organizerPlayed ? (orgGuest ? 2 : 1) : 0);
  const notes = whoPlayedNotes(inNow.filter(hasGuest).map((r) => ({ host: r.name, guest: r.guest!.name, hostPlayed: played.has(r.playerId), guestOut: guestOut.has(r.playerId) })));
  const toggleGuest = (id: string) =>
    setGuestOut((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const line = splitLine(split);
  const unconfirmed = unconfirmedPaidWarning(unconfirmedNames);
  const summary = n < 4 ? `${n} played · ${formatPrice(price)} each` : gameFinalPreview(gp, n, formatPrice);
  const [lead, ...rest] = summary.split(' · ');
  const toggle = (id: string) =>
    setPlayed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="xt-sheet" data-who-played data-who-played-tiles>
      <p className="xt-summary" data-finalize-live aria-live="polite">
        <b>{lead}</b>
        {rest.length > 0 && <span className="xt-summary-rest"> · {rest.join(' · ')}</span>}
      </p>
      <ul className="xt-grid xt-scroll" aria-label="Who played">
        {inNow.flatMap((r) => {
          const on = played.has(r.playerId);
          const tile = (
            <li key={r.playerId}>
              <button
                type="button"
                className={`xt-tile${on ? ' on' : ' off'}`}
                aria-pressed={on}
                aria-label={`${r.name}${r.isOrganizer ? ' (you)' : ''} ${on ? 'played' : 'did not play'}`}
                data-tile={r.name}
                onClick={() => toggle(r.playerId)}
              >
                <span className="xt-ball" aria-hidden="true">
                  <Pickleball />
                </span>
                <span className="xt-name">
                  <b>{r.name}</b>
                  {r.isOrganizer && <span className="xt-you"> (you)</span>}
                </span>
                {on && (
                  <span className="xt-check" aria-hidden="true">
                    <svg viewBox="0 0 20 20" width="14" height="14">
                      <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </button>
            </li>
          );
          if (!hasGuest(r)) return [tile];
          const g = r.guest!;
          const gOn = guestOn(r);
          const locked = !on;
          return [
            tile,
            <li key={`${r.playerId}:guest`}>
              <button
                type="button"
                className={`xt-tile xt-guest${gOn || locked ? ' on' : ' off'}${locked ? ' locked' : ''}`}
                aria-pressed={gOn}
                aria-disabled={locked || undefined}
                aria-label={`${g.name}, ${r.name}'s guest, ${gOn ? 'played' : 'did not play'}${locked ? ` (${r.name} did not play)` : ''}`}
                data-tile={g.name}
                data-guest-tile={g.name}
                onClick={() => {
                  if (!locked) toggleGuest(r.playerId);
                }}
              >
                <span className="xt-ball" aria-hidden="true">
                  <Pickleball />
                </span>
                <span className="xt-name">
                  <b>{g.name}</b>
                  <span className="xt-guest-of">{r.name}'s guest</span>
                </span>
                {(gOn || locked) && (
                  <span className="xt-check" aria-hidden="true">
                    <svg viewBox="0 0 20 20" width="14" height="14">
                      <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </button>
            </li>,
          ];
        })}
      </ul>
      {notes.length > 0 && (
        <p className="xt-guest-note" data-who-played-note aria-live="polite">
          {notes.join(' ')}
        </p>
      )}
      <div className="xt-extra">
        <span className="xt-label" id={`xt-label-${s.id}`}>
          EXTENDED TIME
        </span>
        <div className="segmented xt-seg" role="group" aria-labelledby={`xt-label-${s.id}`}>
          {CHOICES.map((c) => (
            <button key={c.m} type="button" aria-pressed={extra === c.m} data-extra={c.m} onClick={() => setExtra(c.m)}>
              {c.label}
            </button>
          ))}
        </div>
        {extra > 0 && (
          <p className="xt-split" data-extra-split aria-live="polite">
            <span className="xt-split-l">{splitWords(line.left, split.shareCents)}</span>
            <span className="xt-split-r">{splitWords(line.right, split.organizerCents)}</span>
          </p>
        )}
      </div>
      {unconfirmed && (
        <p className="finalize-warn" role="note" data-unconfirmed-paid>
          {unconfirmed}
        </p>
      )}
      <div className="xt-confirm">
        <button className="btn block" disabled={busy} data-confirm-played onClick={() => onConfirm([...played], extra, [...guestOut].filter((id) => played.has(id)))}>
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}

/** "3 others pay **$3** each": the dollar amount in bold amber. */
function splitWords(text: string, cents: number) {
  const amount = formatPrice(cents);
  const at = text.indexOf(amount);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <b>{amount}</b>
      {text.slice(at + amount.length)}
    </>
  );
}

type Owed = NonNullable<AdminDashboard['extensionOwed']>[number];

/**
 * Home: shares of extra court time still owed, one card ("Extra time: 3 haven't paid"), a row per player: bold name, "$3 extension · Thu,
 * Nov 12", Mark paid (or Confirm when they tapped I paid), Request / Text / "no Venmo saved", and Remind (one text to all of them). The same
 * look and buttons as the "Who hasn't paid" card. Undo: the site's usual toast.
 */
export function ExtensionOwedCard({ ctx }: { ctx: AdminCtx }) {
  // Nothing owed: nothing at all is drawn and no hook runs, so the page is exactly main's. (Shown also after the switch is turned off while
  // shares are still open, so they can be settled.)
  const rows = ctx.d.extensionOwed ?? [];
  if (rows.length === 0) return null;
  return <OwedCard ctx={ctx} rows={rows} />;
}

function OwedCard({ ctx, rows }: { ctx: AdminCtx; rows: Owed[] }) {
  const { run, busy } = useAction(ctx);
  const cards = ctx.d.alertCards === true;
  const phones = rows.map((r) => ctx.d.players.find((p) => p.id === r.playerId)?.phone).filter((x): x is string => !!x);
  const remindBody = `Hey, you owe for the extra court time we added. It goes on your next game, or pay any time: ${siteAddress(ctx.d.group.playerLink)}`;
  const remind = phones.length > 0 ? smsHref(phones.join(','), remindBody, isIOS) : null;
  const pay = (r: Owed, paid: boolean) =>
    run(
      () => api('POST', `/api/admin/sessions/${r.sessionId}/extension-payment`, { playerId: r.playerId, paid, ...(paid && r.claimCents === 0 ? { cents: r.owedCents } : {}) }),
      paid ? `${r.name} marked paid` : `${r.name} unmarked`,
      {
        key: `ext:${r.sessionId}:${r.playerId}`,
        what: paid ? 'Mark paid' : 'Unmark',
        // Certain: the row leaves at once (instant taps); with Undo on the toasts the save waits 5 seconds and Undo drops it.
        patch: (d) => ({ ...d, extensionOwed: (d.extensionOwed ?? []).filter((x) => !(x.sessionId === r.sessionId && x.playerId === r.playerId)) }),
        ...(ctx.d.adminUndo === true ? { undo: true } : {}),
      },
    );
  return (
    <section className={cards ? 'ac-stack vr-cards' : 'stack vr-cards'} aria-label="Extra time owed" data-ext-owed>
      <article className={cards ? 'ac ac-amber vr-card-ac' : 'card vr-card'} {...(cards ? { 'data-alert-card': 'amber' } : {})}>
        <div className="vr-head">
          {cards && <AcIcon name="owe" />}
          <div className="vr-title-wrap">
            {cards ? (
              <AcTitle as="h3" className="vr-title">
                Extra time: {rows.length} {rows.length === 1 ? "hasn't" : "haven't"} paid
              </AcTitle>
            ) : (
              <h3 className="vr-title">
                Extra time: {rows.length} {rows.length === 1 ? "hasn't" : "haven't"} paid
              </h3>
            )}
          </div>
          {remind && (
            <a className={cards ? 'ac-btn vr-remind-ac' : 'vr-remind'} data-ac-tone={cards ? 'purple' : undefined} href={remind} data-ext-remind>
              Remind
            </a>
          )}
        </div>
        <ExtRows ctx={ctx} rows={rows} busy={busy} pay={pay} />
      </article>
    </section>
  );
}

/** The rows: bold name, "$3 extension · Thu, Nov 12", Mark paid (Confirm after an I paid), then Request / Text / "no Venmo saved". */
function ExtRows({ ctx, rows, busy, pay }: { ctx: AdminCtx; rows: Owed[]; busy: boolean; pay: (r: Owed, paid: boolean) => unknown }) {
  const tz = ctx.d.group.timezone;
  return (
    <ul className="mp-rows" aria-label="Who owes for extra time">
          {rows.map((r) => {
            const p = ctx.d.players.find((x) => x.id === r.playerId);
            const amount = r.claimCents > 0 ? r.claimCents : r.owedCents;
            const link = venmoRequestLinks(p?.venmo ?? null, amount, r.startsAt, tz);
            return (
              <li key={`${r.sessionId}:${r.playerId}`} className="mp-row xt-row" data-ext-row={r.name}>
                <span className="mp-name">
                  <strong>{r.name}</strong>
                  <span className="mp-price xt-what">
                    {formatPrice(amount)} extension · <span className="xt-nowrap">{formatShortDate(r.startsAt, tz)}</span>
                    {r.claimCents > 0 ? ' · tapped I paid' : ''}
                  </span>
                </span>
                <button type="button" className="mp-btn mp-amber" disabled={busy} data-ext-markpaid={r.name} aria-label={`Mark ${r.name}'s ${formatPrice(amount)} extension paid`} onClick={() => void pay(r, true)}>
                  {r.claimCents > 0 ? 'Confirm' : 'Mark paid'}
                </button>
                {link ? (
                  <a className="sc-req" href={link.url} data-app-href={link.appUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => openVenmo(e, link)} data-ext-request={r.name}>
                    Request
                  </a>
                ) : p?.phone ? (
                  <a className="sc-req sc-req-text" href={smsHref(p.phone, `Hey ${r.name.split(/\s+/)[0]}, you owe ${formatPrice(amount)} for the extra court time on ${formatShortDate(r.startsAt, tz)}. ${siteAddress(ctx.d.group.playerLink)}`, isIOS)} data-ext-text={r.name}>
                    Text
                  </a>
                ) : (
                  <span className="mp-none">no Venmo saved</span>
                )}
              </li>
            );
          })}
    </ul>
  );
}

/** Money page: the same rows inside one game's card (only that game's shares still owed). */
export function ExtensionRowsFor({ ctx, sessionId }: { ctx: AdminCtx; sessionId: string }) {
  const rows = (ctx.d.extensionOwed ?? []).filter((r) => r.sessionId === sessionId);
  if (rows.length === 0) return null;
  return <RowsFor ctx={ctx} sessionId={sessionId} rows={rows} />;
}

function RowsFor({ ctx, sessionId, rows }: { ctx: AdminCtx; sessionId: string; rows: Owed[] }) {
  const { run, busy } = useAction(ctx);
  const pay = (r: Owed, paid: boolean) =>
    run(() => api('POST', `/api/admin/sessions/${r.sessionId}/extension-payment`, { playerId: r.playerId, paid, ...(paid && r.claimCents === 0 ? { cents: r.owedCents } : {}) }), paid ? `${r.name} marked paid` : `${r.name} unmarked`, {
      key: `ext:${r.sessionId}:${r.playerId}`,
      what: paid ? 'Mark paid' : 'Unmark',
      patch: (d) => ({ ...d, extensionOwed: (d.extensionOwed ?? []).filter((x) => !(x.sessionId === r.sessionId && x.playerId === r.playerId)) }),
      ...(ctx.d.adminUndo === true ? { undo: true } : {}),
    });
  return (
    <div className="xt-money" data-ext-money={sessionId}>
      <p className="xt-label">EXTRA TIME</p>
      <ExtRows ctx={ctx} rows={rows} busy={busy} pay={pay} />
    </div>
  );
}
