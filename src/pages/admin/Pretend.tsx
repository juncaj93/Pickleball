import { useState } from 'react';
import type { AdminDashboard } from '../../../shared/api';
import { formatShortDate, formatTime, fromLocalInputValue, localParts, toLocalInputValue, zonedTimeToUtc } from '../../../shared/time';
import { nightLastCallMs } from '../../../shared/tasks';
import { resetDemo, setPretend, useDemoOn, usePretend } from '../../lib';

// "Pretend it's...": see the site as it will look at another moment, to
// check the time-based cards. Part of the demo: taps work on a throwaway
// copy, nothing is saved. This tab only, 30 minutes at most.

/** "Tue Nov 3, 8:30 AM" in the group's time zone. */
export function pretendLabel(ms: number, tz: string): string {
  const iso = new Date(ms).toISOString();
  return `${formatShortDate(iso, tz).replace(',', '')}, ${formatTime(iso, tz)}`;
}

/** Wall-clock time on the game's date (plus `dayShift` days), in the group's zone. */
function onGameDay(startsAt: string, tz: string, hour: number, minute: number, dayShift = 0): number {
  const p = localParts(Date.parse(startsAt), tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + dayShift));
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, tz);
}

export function pretendPresets(d: AdminDashboard, realNowMs: number) {
  const tz = d.group.timezone;
  const ahead = d.sessions.filter((s) => s.status !== 'canceled' && Date.parse(s.startsAt) > realNowMs);
  const game = ahead[0];
  if (!game) return { game: null, presets: [] as { label: string; atMs: number }[] };
  const opening = ahead.find((s) => Date.parse(s.bookingOpensAt) > realNowMs) ?? game;
  return {
    game,
    opening,
    presets: [
      { label: 'Game day, 7:00 AM', atMs: onGameDay(game.startsAt, tz, 7, 0) },
      { label: 'Game day, 8:30 AM', atMs: onGameDay(game.startsAt, tz, 8, 30) },
      { label: `Day before, ${formatTime(new Date(nightLastCallMs(game.startsAt, tz)).toISOString(), tz)}`, atMs: nightLastCallMs(game.startsAt, tz) },
      { label: 'Last call', atMs: Date.parse(game.startsAt) - d.group.settings.lastCallHours * 3600_000 },
      { label: 'Booking opens, 12:00 AM', atMs: Date.parse(opening.bookingOpensAt) },
      { label: 'After the game', atMs: Date.parse(game.endsAt) + 30 * 60_000 },
    ],
  };
}

/** The "Pretend it's..." section in the View as menu. */
export function PretendPicker({ d, onPicked }: { d: AdminDashboard; onPicked: () => void }) {
  const tz = d.group.timezone;
  const on = usePretend();
  const [value, setValue] = useState(() => toLocalInputValue(new Date(on ?? Date.now()).toISOString(), tz));
  const { game, opening, presets } = pretendPresets(d, Date.now());
  const pick = (ms: number) => {
    setPretend(ms);
    onPicked();
  };
  const typed = fromLocalInputValue(value, tz);
  return (
    <section className="stack pretend-pick" aria-labelledby="pretend-title">
      <h3 id="pretend-title">Pretend it's…</h3>
      <p className="small muted">Taps work, nothing is saved. Ends in 30 minutes.</p>
      {game && (
        <>
          <p className="small">
            For {formatShortDate(game.startsAt, tz)}
            {opening && opening.id !== game.id ? ` (booking: ${formatShortDate(opening.startsAt, tz)})` : ''}
          </p>
          <div className="pretend-presets">
            {presets.map((p) => (
              <button key={p.label} className="btn small secondary" onClick={() => pick(p.atMs)}>
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
      <form
        className="pretend-custom"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed) pick(Date.parse(typed));
        }}
      >
        <label htmlFor="pretend-at">Date and time (Eastern)</label>
        <input id="pretend-at" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} required />
        <button className="btn small" type="submit" disabled={!typed}>
          Pretend
        </button>
      </form>
    </section>
  );
}

/**
 * "Demo, nothing is saved" at the top while View as or Pretend it's... is on,
 * with the pretend time if there is one. Reset throws away the demo changes;
 * End stops pretending.
 */
export function DemoBar({ tz }: { tz: string }) {
  const on = useDemoOn();
  const at = usePretend();
  if (!on) return null;
  return (
    <div className="pretend-bar" role="status">
      <span>
        <strong>Demo, nothing is saved</strong>
        {at !== null && <> · {pretendLabel(at, tz)}</>}
      </span>
      <span className="pretend-bar-btns">
        <button className="btn small" onClick={resetDemo}>
          Reset
        </button>
        {at !== null && (
          <button className="btn small" onClick={() => setPretend(null)}>
            End
          </button>
        )}
      </span>
    </div>
  );
}
