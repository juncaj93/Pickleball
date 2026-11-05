import type { ReactNode } from 'react';
import type { AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { venmoRequestUrl } from '../../../shared/venmoRequest';
import type { AdminCtx } from '../Admin';
import '../../venmo-request.css';

/** The Venmo link for one person on one game: what THAT person owes now, or null (switch off, no username saved, nothing owed). */
export function requestUrlFor(ctx: AdminCtx, s: AdminSessionView, r: Pick<AdminRosterEntry, 'playerId' | 'owesCents'>): string | null {
  if (ctx.d.venmoRequest !== true) return null;
  const handle = ctx.d.players.find((p) => p.id === r.playerId)?.venmo ?? null;
  return venmoRequestUrl(handle, r.owesCents, s.startsAt, ctx.d.group.timezone);
}

/**
 * "Venmo request ↗" (VENMO_REQUEST): a blue link that opens Venmo with this person, the amount they owe and the note "Pickleball Tue Nov 3".
 * One request per person. Nothing is sent or saved; the organizer still taps Mark paid himself. `short` is the row label "Request ↗".
 */
export function VenmoRequestLink({ ctx, s, r, short }: { ctx: AdminCtx; s: AdminSessionView; r: Pick<AdminRosterEntry, 'playerId' | 'name' | 'owesCents'>; short?: boolean }) {
  const url = requestUrlFor(ctx, s, r);
  if (!url) return null;
  return (
    <a className={`vr-link${short ? ' vr-short' : ''}`} href={url} target="_blank" rel="noopener noreferrer" data-venmo-request={r.name} aria-label={`Venmo request ${formatPrice(r.owesCents)} from ${r.name}`}>
      {short ? 'Request ↗' : 'Venmo request ↗'}
    </a>
  );
}

/**
 * The Remind sheet's buttons for one person: with VENMO_REQUEST on and a Venmo username saved, the blue "Venmo request ↗" link next to
 * `children` (the purple Text button). Otherwise just `children`, exactly as before (no extra wrapper).
 */
export function RequestPair({ ctx, s, r, children }: { ctx: AdminCtx; s: AdminSessionView; r: Pick<AdminRosterEntry, 'playerId' | 'name' | 'owesCents'>; children: ReactNode }) {
  if (!requestUrlFor(ctx, s, r)) return <>{children}</>;
  return (
    <span className="vr-pair">
      <VenmoRequestLink ctx={ctx} s={s} r={r} />
      {children}
    </span>
  );
}
