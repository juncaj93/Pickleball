// Zip 47 probes: the Remind / Request texts with a pair on the game.
import { describe, expect, it } from 'vitest';
import { gamePriceCents, groupRemindText } from '../../../src/pages/admin/moneyRework';
import { reminderText } from '../../../src/pages/admin/textMenu';
import { addGuest, adminGame, dash, game, join, markPaid, world } from './w';

describe('G-T texts', () => {
  it('T1 "Text all" group reminder: one other unpaid player and an unpaid pair host: what price does the group chat read?', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Devon');
    await markPaid(w, g.id, 'Emery');
    const d = await dash(w);
    const s = await adminGame(w, g.id);
    console.log('T1 price', gamePriceCents(d, s));
    console.log('T1 text', JSON.stringify(groupRemindText(d, s)));
    console.log('T1 Blair', JSON.stringify(reminderText(d, w.byName.Blair, 'Blair', s)));
    expect(gamePriceCents(d, s)).toBe(1400);
  });
});
