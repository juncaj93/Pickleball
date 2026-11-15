// Zip 47 audit (late fees): a late-drop debt when the organizer then moves the game to another day.
import { describe, expect, it } from 'vitest';
import { admin, at, DAYMS, drop, game, join, owedOf, PRICE, world } from './w-extra';

describe('F. game moved after a late drop', () => {
  it('F1 Blair drops 5 hours before (game short, owes $14); the organizer moves the game to the next day: Blair still owes $14', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: false });
    const r = await admin(w, 'PUT', `/api/admin/sessions/${g.id}/time`, { startsAt: new Date(g.start + DAYMS + 3600_000).toISOString(), endsAt: new Date(g.end + DAYMS + 3600_000).toISOString() });
    expect(r.status, r.text).toBe(200);
    // The new start is ~30 hours away, far outside any 12-hour window, but the debt from the old time stands.
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: PRICE, lateFee: 'late_drop' });
  });
});
