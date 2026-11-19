import { nightAPart2 } from './nightA2';
import { describe, expect, it } from 'vitest';
import { adminTour, books, card, confirmPaid, dash, dump, finalize, giveCredit, group, liveLike, lockIn, MIN, NAMES, PAY_BY_MS, potOf, signUp, teams, tickets, tourLedger , snap } from './world69';

describe('Night A: 10 players, Locked doubles', () => {
  it('sign up to Publish', async () => {
    const w = await liveLike();
    await signUp(w, NAMES, { votes: { Vic: 'locked', Parker: 'locked', Rowan: 'locked', Zoe: 'locked' } });
    dump('A-admin-signup', await adminTour(w));
    const fin = await finalize(w);
    dump('A-finalize-answer', fin);
    dump('A-admin-finalized', await adminTour(w));
    dump('A-vic-finalized', await card(w, 'Vic'));
    // Credit mix: 3 full ($18), 3 part ($10), 3 none.
    const credit: Record<string, number> = { Vic: 1800, Parker: 1800, Rowan: 2500, Zoe: 1000, Wren: 1000, Quinn: 500 };
    for (const [n, c] of Object.entries(credit)) await giveCredit(w, n, c);
    const before = Object.fromEntries(NAMES.map((n) => [n, potOf(w, n)]));
    const answers: Record<string, unknown> = {};
    for (const n of NAMES) answers[n] = await lockIn(w, n);
    dump('A-lock-answers', answers);
    dump('A-admin-locked', await adminTour(w));
    dump('A-tickets-before-confirm', tickets(w));
    for (const n of ['Zoe', 'Wren', 'Quinn', 'Reese', 'Sage', 'Christopher Vanderberg']) dump(`A-confirm-${n}`, await confirmPaid(w, n));
    dump('A-tickets-confirmed', tickets(w));
    const after = Object.fromEntries(NAMES.map((n) => [n, potOf(w, n)]));
    dump('A-pots', { before, after });
    books(w, 'after confirm');
    // Countdown cards: the day before Pay by and an hour before.
    w.app.now = PAY_BY_MS - 60 * MIN;
    snap(w, 'A1-hour-before-payby');
    dump('A-vic-hour-before-payby', await card(w, 'Vic'));
    dump('A-admin-hour-before-payby', await adminTour(w));
    w.app.now = PAY_BY_MS + MIN;
    dump('A-admin-after-payby', await adminTour(w));
    dump('A-vic-after-payby', await card(w, 'Vic'));
    const d = await teams(w, { action: 'draft' });
    dump('A-draft', d.data);
    expect(d.status, d.text).toBe(200);
    dump('A-admin-drafted', await adminTour(w));
    snap(w, 'A2-drafted');
    dump('A-dash-keys', Object.keys(await dash(w)));
    dump('A-group-vic', await group(w, 'Vic'));
    dump('A-ledger', tourLedger(w));
    await nightAPart2(w);
  });
});
