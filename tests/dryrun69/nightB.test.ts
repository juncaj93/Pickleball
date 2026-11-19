import { nightBPart2 } from './nightB2';
import { describe, it } from 'vitest';
import { adminTour, books, card, confirmPaid, dash, dump, finalize, giveCredit, group, liveLike, lockIn, MIN, NAMES, PAY_BY_MS, START_MS, signUp, tourLedger , snap } from './world69';

const NINE = NAMES.slice(0, 9);
describe('Night B: 9 players, Americano', () => {
  it('odd count at Pay by', async () => {
    const w = await liveLike();
    await signUp(w, NINE, { votes: { Vic: 'locked', Parker: 'locked', Rowan: 'locked', Zoe: 'locked', Wren: 'locked' } });
    await finalize(w);
    for (const [n, c] of Object.entries({ Vic: 1800, Parker: 900, Rowan: 300 })) await giveCredit(w, n, c);
    for (const n of NINE) await lockIn(w, n);
    for (const n of ['Parker', 'Rowan', 'Zoe', 'Wren', 'Quinn', 'Reese', 'Sage']) await confirmPaid(w, n);
    books(w);
    dump('B-admin-before-payby', await adminTour(w));
    w.app.now = PAY_BY_MS + MIN;
    const [a1, a2] = await Promise.all([dash(w), group(w, 'Vic')]);
    dump('B-admin-after-payby', a1.tournament);
    snap(w, 'B1-switched');
    dump('B-vic-after-payby', a2.tournament);
    dump('B-audit-after-payby', a1.audit?.slice?.(0, 8));
    dump('B-telegram', w.app.background.length);
    w.app.now = START_MS - 30 * MIN;
    dump('B-admin-30-before', (await adminTour(w)).day ?? (await adminTour(w)));
    dump('B-vic-30-before', await card(w, 'Vic'));
    dump('B-ledger', tourLedger(w));
    await nightBPart2(w);
  });
});
