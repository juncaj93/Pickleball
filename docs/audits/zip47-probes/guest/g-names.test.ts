// Zip 47 probes: odd guest names, and a guest left waiting with room after the organizer's To waitlist / Give spot.
import { describe, expect, it } from 'vitest';
import { cleanGuestName } from '../../../shared/guestSpot';
import { addGuest, admin, adminGame, game, join, lines, mineOn, rowOf, world } from './w';

describe('G-G names', () => {
  it('G1 the name rule, case by case', () => {
    const cases: [string, string | null][] = [
      ['<script>alert(1)</script>', null],
      ['Sam😀', null],
      ['"Sam"', null],
      ["O'Neil", "O'Neil"],
      ['a'.repeat(20), 'A' + 'a'.repeat(19)],
      ['a'.repeat(21), null],
      ['   ', null],
      ['José', 'José'],
      ['Zoë', 'Zoë'],
      ['ßam', null],
      ['Sam​X', null],
      ['محمد', 'محمد'],
      ['Ana Maria', 'Ana Maria'],
      ['Sam (guest)', null],
      ['-', null],
    ];
    for (const [i, want] of cases) console.log('G1', JSON.stringify(i), '->', JSON.stringify(cleanGuestName(i)));
    // A first letter plus 19 combining marks passes (stacked marks, "Zalgo" text): stays within 20 code units, so length is fine.
    console.log('G1 zalgo', JSON.stringify(cleanGuestName('a' + '́'.repeat(19))));
    // German sharp s capitalizes to two letters: 20 typed characters become 21 stored.
    const sharp = cleanGuestName('ß' + 'a'.repeat(19));
    console.log('G1 sharp-s', JSON.stringify(sharp), sharp?.length);
    expect(cleanGuestName('<b>x</b>')).toBeNull();
  });
  it('G2 a guest with the same first name as a player in the game, and unicode names, through the server', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await addGuest(w, g.id, 'Blair', 'Casey')).status).toBe(200);
    expect((await addGuest(w, g.id, 'Devon', 'Zoë Ana-Marie O’Neil')).status).toBe(200);
    const s = await mineOn(w, 'Casey', g.id);
    console.log('G2 names', JSON.stringify(s.confirmed));
    const a = await adminGame(w, g.id);
    console.log('G2', a.confirmedCount, JSON.stringify(a.roster.map((r: any) => [r.name, r.guest?.name])));
    expect(a.confirmedCount).toBe(5);
    console.log((await lines(w, g.start)).slice(0, 3).join('\n'));
    const long = await addGuest(w, g.id, 'Casey', 'Bartholomew-Alexander');
    console.log('G2 21 chars', long.status, long.text.slice(0, 120));
    expect(long.status).toBe(400);
  });
});

describe('G-H waitlist after organizer moves', () => {
  it('H1 To waitlist then Give spot on a host with a guest: is the guest left waiting while there is room?', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'waitlist' })).status).toBe(200);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'confirm' })).status).toBe(200);
    const s = await mineOn(w, 'Casey', g.id);
    const b = await rowOf(w, g.id, 'Blair');
    console.log('H1', s.countText, s.openSpots, JSON.stringify(s.waitlist), JSON.stringify(b.guest), b.shareCents);
    expect(b.guest.status).toBe('confirmed');
  });
});
