// Zip 47 audit (late fees, words vs money): the "You no longer owe $14" notice a player sees once a debt is cleared, and the pair no-show.
import { describe, expect, it } from 'vitest';
import { feeClearedNotice } from '../../../shared/lateFees';
import { formatPrice } from '../../../shared/money';
import { formatShortDate } from '../../../shared/time';
import { addGuest, admin, at, drop, finalize, game, HOUR, join, owedOf, PRICE, rowOf, view, type W, world } from './w';

/** The words src/pages/PlayerHome.tsx draws for each notice (line ~1281). */
async function noticeWords(w: W, name: string) {
  const v = await view(w, name);
  return (v.feeNotices ?? []).map((n) => feeClearedNotice(n.why, formatShortDate(n.startsAt, v.group.timezone), formatPrice(n.feeCents ?? v.group.priceCents), n.creditCents > 0 ? formatPrice(n.creditCents) : null));
}
const clear = (w: W, sid: string, name: string) => admin(w, 'POST', `/api/admin/sessions/${sid}/late-fee`, { playerId: w.byName[name], why: 'choice' });

describe('D. cleared-debt notice amounts', () => {
  it('D1 a host + guest late drop owing $28 (unpaid), cleared by the organizer: the notice says "$14"', async () => {
    const w = await world({ guests: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    at(w, g.start, 5);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: 2 * PRICE, paid: false });
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 2 * PRICE });
    expect((await clear(w, g.id, 'Blair')).data.changed).toBe(true);
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
    const words = await noticeWords(w, 'Blair');
    expect(words).toHaveLength(1);
    // Money: $28 no longer owed. Words:
    expect(words[0]).toMatch(/^You no longer owe \$14 for /);
  });

  it('D2 a late cancel with the split ($11 at 5 in), unpaid seat cleared by the organizer: the notice says "$14"', async () => {
    const w = await world({ split: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    at(w, g.start, 3);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 1100 });
    expect((await clear(w, g.id, 'Blair')).data.changed).toBe(true);
    const words = await noticeWords(w, 'Blair');
    expect(words).toHaveLength(1);
    expect(words[0]).toMatch(/^You no longer owe \$14 for /);
  });

  it('D3 the guest half of a $28 pair debt taken by a sub: "You no longer owe $14" while $14 is still owed', async () => {
    const w = await world({ guests: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    await join(w, g.id, ['Emery']);
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: PRICE });
    const words = await noticeWords(w, 'Blair');
    expect(words).toEqual([expect.stringMatching(/^Good news: someone took your spot for .*\. You no longer owe \$14\.$/)]);
  });
});

describe('D. pair no-show vs pair late drop (round 3 "spots short" rule)', () => {
  it('D4 host + guest + 3 others (5 heads): late drop of the pair owes $14 (short 1), a no-show of the pair at Finalize owes $28', async () => {
    // Late drop, 5 hours before: 3 left, short by 1.
    const a = await world({ guests: true });
    const ga = await game(a);
    await join(a, ga.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await addGuest(a, ga.id, 'Blair')).status).toBe(200);
    at(a, ga.start, 5);
    expect((await drop(a, ga.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: false });
    // No-show: the same 3 others played, the pair did not.
    const b = await world({ guests: true });
    const gb = await game(b);
    await join(b, gb.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await addGuest(b, gb.id, 'Blair')).status).toBe(200);
    b.app.now = gb.end + HOUR;
    const f = await finalize(b, gb.id, ['Casey', 'Devon', 'Emery']);
    expect(f.status, f.text).toBe(200);
    expect(f.data.played).toBe(3);
    expect((await rowOf(b, gb.id, 'Blair')).lateFee).toMatchObject({ kind: 'no_show', oweCents: 2 * PRICE });
  });
});

import { activityText } from '../../../shared/activity';
import { dash } from './w';

describe('D. History lines for pair and split debts', () => {
  it('D5 a $28 pair late-drop debt reads "owes their $14" in History, and its Clear "cleared Blair\'s $14"', async () => {
    const w = await world({ guests: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    at(w, g.start, 5);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: 2 * PRICE, paid: false });
    expect((await clear(w, g.id, 'Blair')).data.changed).toBe(true);
    const lines = (await dash(w)).audit.map((a: any) => activityText({ ...a, sessionStartsAt: new Date(g.start).toISOString() }, 'America/Detroit', 'Alex'));
    expect(lines.some((l: string) => /Blair owes their \$14 \(late drop, game short\)/.test(l))).toBe(true);
    expect(lines.some((l: string) => /cleared Blair's \$14 \(my choice\)/.test(l))).toBe(true);
  });
});
