// Zip 86 (🎾86.clean admin, pictures 1, 2, 3 and 9): the slim dark tournament row in a week list, on the tournament's day. The same look in
// light and dark (the tournament ticket's own tokens). The organizer's Home shows it with no button (his big card is at the top); a player's
// Home shows it only when the tournament is NEXT WEEK OR LATER, with no button next week and the big card's main button two weeks or more
// ahead (lime Sign up or Lock in, or gray Who's in; never Drop out). Tapping the row itself does nothing.
//
// Small on purpose (the player download, tests/zip48-split.test.ts): the button only sends a window event; the big card (its own download,
// src/tournament/TournamentHome.tsx) listens and opens the very same sheet or flow its own button does.
import { stubParts } from '../shared/tournament';
import './tour-week-row.css';

/** The event the row's button sends; TournamentHome answers it exactly as its own main button. */
export const TOUR_ROW_ACTION = 'pb:tour-row-action';
export type TourRowAction = 'signup' | 'lock' | 'who';

export function TourWeekRow({ day, name, sub, action, data }: { day: string; name: string; sub: string; action?: TourRowAction | null; data?: string }) {
  const p = stubParts(day);
  const label = action === 'signup' ? 'Sign up' : action === 'lock' ? 'Lock in' : action === 'who' ? 'Who’s in' : null;
  return (
    <section className="tw-row" aria-label={`Tournament: ${name}, ${p.weekday} ${p.day} ${p.month}. ${sub}`} data-tour-row={data ?? (action ?? 'none')}>
      <div className="tw-stub" aria-hidden="true">
        <span className="tw-wd">{p.weekday}</span>
        <span className="tw-day">{p.day}</span>
        <span className="tw-mon">{p.month}</span>
      </div>
      <div className="tw-main">
        <span className="tw-kicker">Tournament</span>
        <span className="tw-name">{name}</span>
        <span className="tw-sub">{sub}</span>
      </div>
      {action && label && (
        <button
          type="button"
          className={action === 'who' ? 'tw-act tw-act-gray' : 'tw-act tw-row-lime'}
          onClick={() => window.dispatchEvent(new CustomEvent<TourRowAction>(TOUR_ROW_ACTION, { detail: action }))}
          data-tour-row-btn={action}
        >
          {label}
        </button>
      )}
    </section>
  );
}
