// Zip 47 audit (late fees): the organizer putting a late dropper back in (Players sheet "In") vs the player rejoining themselves.
import { describe, expect, it } from 'vitest';
import { at, dash, drop, finalize, game, HOUR, join, owedOf, roster, world } from './w';

const lateCount = async (w: any, name: string) => (await dash(w)).players.find((p: any) => p.name === name).lateDrops;

describe('E. late dropper put back in', () => {
  it('E1 self rejoin clears the late-drop mark; the organizer re-adding them keeps it (count stays 1)', async () => {
    for (const how of ['self', 'organizer'] as const) {
      const w = await world();
      const g = await game(w);
      await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
      at(w, g.start, 4);
      await drop(w, g.id, 'Blair'); // 4 left: no fee, but a late drop
      expect(await lateCount(w, 'Blair')).toBe(1);
      if (how === 'self') await join(w, g.id, ['Blair']);
      else expect((await roster(w, g.id, 'Blair', 'confirm')).status).toBe(200);
      expect([how, await lateCount(w, 'Blair')]).toEqual([how, how === 'self' ? 0 : 1]);
    }
  });

  it('E2 an owing late dropper re-added by the organizer settles their own debt (no double charge), not someone else\'s', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 4);
    await drop(w, g.id, 'Blair');
    w.app.now += 60_000;
    await drop(w, g.id, 'Casey');
    expect((await roster(w, g.id, 'Blair', 'confirm')).status).toBe(200);
    // Casey's debt is still open (Blair coming back is not a sub); Blair owes only the normal $14 seat.
    expect(await owedOf(w, 'Casey', g.id)).toMatchObject({ lateFee: 'late_drop' });
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 1400 });
    expect((await owedOf(w, 'Blair', g.id))!.lateFee ?? null).toBeNull();
    w.app.now = g.start + 3 * HOUR;
    expect((await finalize(w, g.id, ['Blair', 'Devon', 'Emery'])).status).toBe(200);
  });
});
