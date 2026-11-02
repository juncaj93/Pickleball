import type { CSSProperties } from 'react';
import type { CourtSwitch as CourtSwitchValue } from '../../../shared/court';
import { useMotion } from '../../motion';

const OPTIONS: { value: CourtSwitchValue; label: string; lines?: [string, string] }[] = [
  { value: 'not_booked', label: 'Not booked', lines: ['Not', 'booked'] },
  { value: 'waitlist', label: 'Waitlist' },
  { value: 'booked', label: 'Booked' },
];

/**
 * Not booked | Waitlist | Booked: always visible, no dropdown. The chosen
 * segment is filled (amber, blue or green, each with a mark besides the
 * color so it reads in both themes). The card saves on tap; the Edit game
 * sheet holds the choice until Save.
 */
export function CourtSwitch({
  value,
  onPick,
  disabled,
  label = 'Court status',
}: {
  value: CourtSwitchValue;
  onPick: (v: CourtSwitchValue) => void;
  disabled?: boolean;
  label?: string;
}) {
  const motion = useMotion();
  return (
    <div className="court-switch" role="group" aria-label={label} data-value={value}>
      {/* Motion: the highlight glides between the options (transform only); the buttons keep their own place and height. */}
      {motion && <span className="cs-glide" aria-hidden="true" style={{ '--i': OPTIONS.findIndex((o) => o.value === value) } as CSSProperties} />}
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          data-seg={o.value}
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => {
            if (o.value !== value) onPick(o.value);
          }}
        >
          {o.lines ? (
            <>
              <span className="seg-line">{o.lines[0]}</span> <span className="seg-line">{o.lines[1]}</span>
            </>
          ) : (
            o.label
          )}
        </button>
      ))}
    </div>
  );
}
