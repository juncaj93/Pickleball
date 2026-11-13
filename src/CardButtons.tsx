import { COURT_NAME, directionsUrl } from '../shared/zip9';

// Zip 9, "Card time and buttons" (CARD_TIME_BUTTONS). Player cards only, display only.
//
// One small joined button at the top right of the "You're in" line: two halves in one outlined box (calendar left, directions
// right, a thin divider between). Blue outline and icons, about 26 px tall with 15 px icons, but each half's tap area is a full
// 44 px tall (the drawing is smaller than the finger). Built as a row of halves so a third half can be added later: add one
// more <a> or <button> with the class "z9-half" and it gets the divider and the same size.

const ICON = { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

/** A plain outline calendar page (no plus). */
export const CalendarOutlineIcon = () => (
  <svg {...ICON} data-icon="calendar">
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

/** An outline navigation arrow (not filled). */
export const DirectionsArrowIcon = () => (
  <svg {...ICON} data-icon="directions">
    <path d="M20.5 3.5 3.5 10.6l7.2 2.7 2.7 7.2z" />
  </svg>
);

/** The joined Add to calendar | Directions button. `calendarHref` is the game's existing calendar file. */
export function CalendarDirections({ calendarHref, dayLabel }: { calendarHref: string; dayLabel: string }) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return (
    <span className="z9-joined" role="group" aria-label={`${dayLabel}: calendar and directions`} data-card-buttons>
      <a className="z9-half" href={calendarHref} aria-label="Add to calendar" data-card-calendar>
        <CalendarOutlineIcon />
      </a>
      <a className="z9-half" href={directionsUrl(COURT_NAME, ua)} target="_blank" rel="noopener noreferrer" aria-label="Directions" data-card-directions>
        <DirectionsArrowIcon />
      </a>
    </span>
  );
}
