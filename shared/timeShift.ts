// "Time may shift": who still has to say yes to a game's new start time.
//
// session_players.time_confirmed holds "<starts_at they agreed to>[,<another>...] <when>",
// or NULL. Every start time they said Still in to is kept (a change back to any of
// them asks nothing); the last one is what the notice shows as "Was". NULL means they agreed to the game's current time (they joined at it).
// Edit game fills NULL for the seats that are in, with the old time, in the
// same step that moves the game, so a value that differs from the game's
// starts_at means "waiting". A change back to a time they agreed to needs no
// update: the value matches again. Display only: nothing here moves money or a seat.

/** Every start time this seat agreed to, oldest first (empty: the current time, they joined at it). */
export function agreedStarts(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(' ')[0].split(',').filter(Boolean);
}

/** The start time a seat last agreed to, or null when it agreed to the current time. */
export function agreedStart(value: string | null | undefined): string | null {
  const all = agreedStarts(value);
  return all.length ? all[all.length - 1] : null;
}

/** When they last tapped Still in (null for a fill by Edit game, which records no answer). */
export function agreedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.split(' ')[1] || null;
}

/** The stored value after Still in to `startsAt` at `atIso`: added to the times already agreed to (the last 8 kept). */
export function agreedValue(startsAt: string, atIso: string, before: string | null = null): string {
  const keep = agreedStarts(before).filter((s) => s !== startsAt);
  return `${[...keep, startsAt].slice(-8).join(',')} ${atIso}`;
}

/** True when this seat still has to answer for the game's current start time. */
export function isWaitingOnTime(value: string | null | undefined, startsAt: string): boolean {
  const all = agreedStarts(value);
  return all.length > 0 && !all.includes(startsAt);
}

/** The TIME_SHIFT switch (a wrangler.toml var): on unless it says "off". */
export function timeShiftOn(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
