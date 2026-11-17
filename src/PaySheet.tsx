// The site's Pay sheet (PAY_SHEET), in its own file since Zip 56 so the tournament's ticket screens (src/tournament/, their own download) show
// exactly the same sheet as a game card: "Pay Alex $16", "Have the Venmo app? Click here", "Copy Venmo @handle", the Apple Pay / Zelle / cash
// line and "I paid". Moved from src/pages/PlayerHome.tsx word for word; the only change is that it needs just the three group facts it reads
// (a game card still passes the whole screen's data).
import type { GroupView } from '../shared/api';
import { formatPrice, parseVenmoHandle } from '../shared/money';
import { copyText, demoOn, openVenmo } from './lib';
import { Sheet, useToast } from './ui';

/** View as / Pretend (the demo copy): what Pay and I paid say, since nothing is sent or saved (Zip 31; real phones never see these). */
export const DEMO_PAY_TOAST = 'Demo, nothing saved. Venmo would open here.';

/**
 * PAY_SHEET: the small bottom sheet a Pay button opens. Title with the amount, the Venmo app link (the same link Pay always
 * had), a button that copies the organizer's Venmo handle (so nobody is left on an "invalid address" page), one gray line for
 * Apple Pay / Zelle / cash, and "I paid" (the same action as the card's own). Nothing else.
 */
export function PaySheet({
  g,
  open,
  onClose,
  cents,
  pay,
  onTapPay,
  onPaid,
  busy,
  saving,
}: {
  g: { group: Pick<GroupView['group'], 'organizerName' | 'venmoUrl' | 'zelleNumber'> };
  open: boolean;
  onClose: () => void;
  cents: number;
  pay: { url: string | null; appUrl: string | null };
  onTapPay: () => void;
  onPaid: () => void;
  /** Something about this game is being saved (the button is off). */
  busy: boolean;
  /** This button's own save (its label says so). */
  saving: boolean;
}) {
  const toast = useToast();
  const first = (g.group.organizerName ?? '').trim().split(/\s+/)[0] || 'the organizer';
  const parsed = parseVenmoHandle(g.group.venmoUrl);
  const handle = parsed.ok && parsed.handle && !parsed.handle.startsWith('id:') ? parsed.handle : null;
  const zelle = (g.group.zelleNumber ?? '').trim();
  return (
    <Sheet open={open} title={`Pay ${first} ${formatPrice(cents)}`} onClose={onClose}>
      <div className="pay-sheet" data-pay-sheet>
        <div className="pay-pair">
          <a
            className="btn"
            href={pay.url ?? undefined}
            data-app-href={pay.appUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Pay ${formatPrice(cents)} with the Venmo app`}
            onClick={(e) => {
              // View as / Pretend (the demo copy): Venmo never opens, so the tap says so and marks it paid on the copy (nothing saved).
              if (demoOn()) {
                e.preventDefault();
                toast(DEMO_PAY_TOAST);
                onPaid();
                return;
              }
              onTapPay();
              openVenmo(e, pay);
            }}
          >
            Have the Venmo app? Click here
          </a>
          {handle && (
            <button
              className="btn outline"
              data-copy-venmo
              onClick={async () => {
                onTapPay();
                const copied = await copyText(`@${handle}`);
                toast(copied ? `Copied @${handle}` : "Couldn't copy.", copied ? 'ok' : 'error');
              }}
            >
              Copy Venmo @{handle}
            </button>
          )}
        </div>
        {zelle && <p className="pay-alt">No Venmo? Apple Pay or Zelle {zelle}, or cash.</p>}
        <button className="btn paid-soft" data-sheet-paid disabled={busy} onClick={onPaid}>
          {!saving && (
            <svg className="paid-check" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {saving ? 'Saving…' : 'I paid'}
        </button>
      </div>
    </Sheet>
  );
}
