// Zip 13, the projected costs fix: Money > Totals "Projected" now counts EVERY game still to come in the month as if it will be played
// (Booked, Not booked or Waitlist), until or unless it is canceled. The older Totals tests were written when only Booked games counted;
// with this they say exactly what the new rule adds: `n` more courts, each the usual $48 court, $42 from 3 players and $6 of your cost.

type Caller = { call: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ data: any }> };

/** Games of `month` still to come, not canceled and not booked, other than `except` (each one is a court Projected now adds). */
export async function comingUnbooked(organizer: Caller, month: string, except: string[] = [], headers: Record<string, string> = {}): Promise<number> {
  const m = (await organizer.call('GET', `/api/admin/money?month=${month}`, undefined, headers)).data;
  const d = (await organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
  const booked = new Map<string, string>((d.sessions as { id: string; bookingStatus: string }[]).map((s) => [s.id, s.bookingStatus]));
  return (m.sessions as { id: string; state: string }[]).filter((s) => s.state === 'upcoming' && !except.includes(s.id) && booked.get(s.id) !== 'booked').length;
}

/** The usual court ($48), what 3 players pay for it ($42), and so what each extra court adds to your estimated cost ($6). */
export const COURT = 4800;
export const PLAYERS = 4200;
export const YOURS = COURT - PLAYERS;
