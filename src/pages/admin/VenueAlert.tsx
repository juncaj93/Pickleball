// Zip 43, "Venue charge alert" (VENUE_ALERT, shared/venueAlert.ts, server/venueAlert.ts). The amber cards at the very top of organizer Home that say what the
// venue SHOULD have charged on its charge day, with ONE button, Mark paid. No Dismiss: a card stays until Mark paid. Organizer only, display only (the one write is
// the "marked paid" record and its History line). The same amber money card family as the other Home money cards (AlertCard); without the Alert cards switch it is
// the older plain card. With the switch off ctx.d.venueAlerts is absent and nothing here draws.
import { api } from '../../lib';
import type { AdminCtx } from '../Admin';
import { AlertCard } from '../../AlertCard';
import { useAction } from './action';
import type { VenueAlert } from '../../../shared/venueAlert';

const keyOf = (a: VenueAlert) => a.keys.join('+');

export function VenueAlertCards({ ctx }: { ctx: AdminCtx }) {
  const alerts = ctx.d.venueAlerts;
  if (ctx.d.venueAlert !== true || !alerts || alerts.length === 0) return null;
  return (
    <section className="stack" aria-label="Venue charges" data-venue-alerts>
      {alerts.map((a) => (
        <VenueCard key={keyOf(a)} ctx={ctx} a={a} />
      ))}
    </section>
  );
}

function VenueCard({ ctx, a }: { ctx: AdminCtx; a: VenueAlert }) {
  const { busy, run } = useAction(ctx);
  // Instant taps: the card leaves at once (the answer is certain; the server only refuses a card that changed); a failed save brings it back.
  const markPaid = () =>
    run(() => api('POST', '/api/admin/venue-alert/paid', { keys: a.keys, cents: a.cents }), 'Marked paid', {
      key: `venue:${keyOf(a)}`,
      patch: (d) => ({ ...d, venueAlerts: (d.venueAlerts ?? []).filter((x) => keyOf(x) !== keyOf(a)) }),
      what: 'Mark paid',
    });
  if (ctx.d.alertCards === true) {
    return (
      <AlertCard
        tone="amber"
        icon="owe"
        titleAs="h3"
        title={a.title}
        sub={a.line}
        label={a.title}
        data={{ 'data-venue-alert': a.kinds.join('+') }}
        actions={
          <button className="ac-btn" disabled={busy} data-venue-paid onClick={() => void markPaid()}>
            Mark paid
          </button>
        }
      />
    );
  }
  return (
    <article className="card stack" aria-label={a.title} data-venue-alert={a.kinds.join('+')}>
      <h3>{a.title}</h3>
      <p className="small muted">{a.line}</p>
      <button className="btn" disabled={busy} data-venue-paid onClick={() => void markPaid()}>
        Mark paid
      </button>
    </article>
  );
}
