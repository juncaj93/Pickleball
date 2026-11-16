// Zip 51b (Alex, Mon Nov 16): the Money change note (shared/moneyNote.ts, server/moneyNote.ts). Fake world, fake clock, Eastern time; Late
// fees and Guest spot ON (as on live). Exact words for Alex's four events, and the rules: only the person whose money changed, once per event
// (Got it), never for their own action, never before the switch went on, nothing at all while it is off, and no money moves because of it.
import { describe, expect, it } from 'vitest';
import { MONEY_NOTE, moneyNoteText, weekdayOf } from '../shared/moneyNote';
import { addGuest, admin, at, call, credit, dash, drop, game, health, HOUR, join, markPaid, owedOf, PRICE, roster, view, type W, world } from './zip49-world';

const DAY = 24 * HOUR;
const on = async (w: W) => expect((await admin(w, 'PUT', '/api/admin/money-note-switch', { on: true })).status).toBe(200);
const off = async (w: W) => expect((await admin(w, 'PUT', '/api/admin/money-note-switch', { on: false })).status).toBe(200);
const notes = async (w: W, name: string) => (await view(w, name)).moneyNotes ?? [];
const texts = async (w: W, name: string) => (await notes(w, name)).map((n) => n.text);
const gotIt = (w: W, name: string, id: string) => call(w, name, 'POST', '/api/money-note/seen', { id });
const raw = (w: W) => (w.app.db as any).raw as { prepare: (s: string) => { all: (...a: unknown[]) => any[]; get: (...a: unknown[]) => any } };
const noteRows = (w: W) => raw(w).prepare("SELECT task FROM task_log WHERE task LIKE 'money_note%' ORDER BY task").all().map((r: any) => r.task as string);
const moveBy = (w: W, g: { id: string; start: number; end: number }, ms: number) =>
  admin(w, 'PUT', `/api/admin/sessions/${g.id}/time`, { startsAt: new Date(g.start + ms).toISOString(), endsAt: new Date(g.end + ms).toISOString() });
const guests = () => world({ guests: true });

describe('the words, exactly as Alex wrote them', () => {
  it('four sentences, whole dollars and cents', () => {
    expect(moneyNoteText({ kind: 'sub', sub: 'Rowan', clearedCents: 1400 })).toBe('Rowan took your spot. Your $14 is cleared.');
    expect(moneyNoteText({ kind: 'sub_one', sub: 'Rowan', clearedCents: 1400, stillCents: 1400 })).toBe('Rowan took one of your 2 spots. $14 is cleared, $14 still owed.');
    expect(moneyNoteText({ kind: 'moved', day: 'Thu' })).toBe("Thu's game moved. Your late drop is cleared.");
    expect(moneyNoteText({ kind: 'back_in' })).toBe("You're back in. Your late drop is cleared.");
    expect(moneyNoteText({ kind: 'sub', sub: 'Rowan', clearedCents: 1100 })).toBe('Rowan took your spot. Your $11 is cleared.');
    expect(moneyNoteText({ kind: 'sub', sub: 'Rowan', clearedCents: 1350 })).toBe('Rowan took your spot. Your $13.50 is cleared.');
    expect(weekdayOf('2026-11-20T00:00:00.000Z', 'America/Detroit')).toBe('Thu'); // Thu Nov 19, 7:00 PM Eastern
  });
});

describe('switch OFF (as it ships on live): nothing new anywhere', () => {
  it('a sub, a move and a back In: no note, no new row, the Settings row reads off, the old Good news line as before', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    await join(w, g.id, ['Gale']); // the sub
    const v = await view(w, 'Blair');
    expect('moneyNotes' in v).toBe(false);
    expect(v.feeNotices).toHaveLength(1); // the Good news line, exactly as before
    await drop(w, g.id, 'Casey');
    expect((await roster(w, g.id, 'Casey', 'confirm')).status).toBe(200);
    await drop(w, g.id, 'Devon');
    expect((await moveBy(w, g, DAY)).status).toBe(200);
    expect('moneyNotes' in (await view(w, 'Casey'))).toBe(false);
    expect('moneyNotes' in (await view(w, 'Devon'))).toBe(false);
    expect(noteRows(w)).toEqual([]);
    expect((await dash(w)).moneyNoteForAll).toBeUndefined();
    // The moved History line carries no extra field while off.
    const moved = raw(w).prepare("SELECT details_json FROM admin_audit_log WHERE action = 'late_fee_cleared' AND details_json LIKE '%moved%'").get();
    expect(JSON.parse(moved.details_json).from).toBeUndefined();
    expect(health(w)).toEqual({});
  });
});

describe('a sub takes your late-dropped spot', () => {
  it('unpaid $14: "Gale took your spot. Your $14 is cleared." for Blair only; Got it once; the money is the same as with it off', async () => {
    const w = await world();
    await on(w);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: false });
    expect(await notes(w, 'Blair')).toEqual([]); // her own drop: nothing
    await join(w, g.id, ['Gale']);
    const n = await notes(w, 'Blair');
    expect(n).toEqual([{ id: expect.any(String), kind: 'sub', text: 'Gale took your spot. Your $14 is cleared.' }]);
    // Never twice: the Good news line for the same clear is left out while the note shows.
    expect((await view(w, 'Blair')).feeNotices).toEqual([]);
    // Only Blair: not the sub, not the others, not the organizer.
    for (const who of ['Gale', 'Casey', 'Devon', 'Emery', 'Alex']) expect(await notes(w, who), who).toEqual([]);
    // Money: Blair owes nothing and has no credit (she had not paid), exactly the Zip 49 numbers.
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
    expect(await credit(w, 'Blair')).toBe(0);
    // Someone else cannot close it; Blair can, once.
    expect((await gotIt(w, 'Casey', n[0].id)).status).toBe(404);
    expect((await gotIt(w, 'Blair', n[0].id)).data).toEqual({ ok: true, already: false });
    expect((await gotIt(w, 'Blair', n[0].id)).data).toEqual({ ok: true, already: true });
    expect(await notes(w, 'Blair')).toEqual([]);
    expect((await view(w, 'Blair')).feeNotices).toEqual([]); // the Good news line does not come back in its place
    expect(noteRows(w)).toEqual([MONEY_NOTE.task, `${MONEY_NOTE.seenPrefix}${n[0].id}`]);
    expect(health(w)).toEqual({});
  });

  it('paid $14 (confirmed): the same words; the $14 is credit, as before', async () => {
    const w = await world();
    await on(w);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: true });
    await join(w, g.id, ['Gale']);
    expect(await texts(w, 'Blair')).toEqual(['Gale took your spot. Your $14 is cleared.']);
    expect(await credit(w, 'Blair')).toBe(1400);
  });

  it('a host with a guest, 2 short ($28): first sub "took one of your 2 spots. $14 is cleared, $14 still owed.", second sub "Your $14 is cleared."', async () => {
    const w = await guests();
    await on(w);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200); // Blair + Sam, Casey, Devon: 4
    at(w, g.start, 5);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: 2 * PRICE, paid: false });
    await join(w, g.id, ['Gale']);
    expect(await texts(w, 'Blair')).toEqual(['Gale took one of your 2 spots. $14 is cleared, $14 still owed.']);
    expect((await owedOf(w, 'Blair', g.id))?.amountCents).toBe(PRICE);
    w.app.now += 60_000; // a later moment (one clear per game per moment, server/roster.ts)
    await join(w, g.id, ['Harper']);
    expect(await texts(w, 'Blair')).toEqual(['Gale took one of your 2 spots. $14 is cleared, $14 still owed.', 'Harper took your spot. Your $14 is cleared.']);
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
    expect(health(w)).toEqual({});
  });
});

describe('a game moved to another day (Zip 49)', () => {
  it('"<old day>\'s game moved. Your late drop is cleared." with the day it was on, for the late dropper only', async () => {
    const w = await world();
    await on(w);
    const g = await game(w);
    const oldDay = weekdayOf(new Date(g.start).toISOString(), 'America/Detroit');
    expect(['Tue', 'Thu']).toContain(oldDay);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    expect((await moveBy(w, g, DAY)).status).toBe(200);
    expect(await texts(w, 'Blair')).toEqual([`${oldDay}'s game moved. Your late drop is cleared.`]);
    for (const who of ['Casey', 'Devon', 'Emery']) expect(await notes(w, who), who).toEqual([]);
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
    expect(health(w)).toEqual({});
  });
  it('a move with no open late drop gives nobody a note; a move on the same day clears nothing and says nothing', async () => {
    const w = await world();
    await on(w);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await moveBy(w, g, DAY)).status).toBe(200);
    for (const who of ['Blair', 'Casey']) expect(await notes(w, who)).toEqual([]);
    const g2 = await game(w, 1);
    await join(w, g2.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g2.start, 5);
    await drop(w, g2.id, 'Blair');
    expect((await moveBy(w, g2, HOUR / 2)).status).toBe(200);
    expect(await notes(w, 'Blair')).toEqual([]);
  });
});

describe('the organizer puts you back In after a late drop (F-15)', () => {
  it('"You\'re back in. Your late drop is cleared." when the drop still owed; nothing after a free late drop', async () => {
    const w = await world();
    await on(w);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Gale']);
    at(w, g.start, 5);
    // Gale's late drop leaves 4: free. Back In: nothing changed about money, so no note.
    expect((await drop(w, g.id, 'Gale')).lateFee ?? null).toBeNull();
    expect((await roster(w, g.id, 'Gale', 'confirm')).status).toBe(200);
    expect(await notes(w, 'Gale')).toEqual([]);
    // Now 5 in again; two drop: Blair's leaves 4 (free), Casey's leaves 3 (owes $14). Back In for Casey: the note.
    await drop(w, g.id, 'Blair');
    expect((await drop(w, g.id, 'Casey')).lateFee).toEqual({ cents: PRICE, paid: false });
    expect((await roster(w, g.id, 'Casey', 'confirm')).status).toBe(200);
    expect(await texts(w, 'Casey')).toEqual(["You're back in. Your late drop is cleared."]);
    expect(await texts(w, 'Blair')).toEqual([]);
    // Casey is a normal seat again: owes the game's $14 like everyone in, no late fee.
    expect((await owedOf(w, 'Casey', g.id))?.lateFee ?? null).toBeNull();
    expect(health(w)).toEqual({});
  });
  it('her own I\'m in after her late drop: no note (she did it herself)', async () => {
    const w = await world();
    await on(w);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    await join(w, g.id, ['Blair']);
    expect(await notes(w, 'Blair')).toEqual([]);
    expect(noteRows(w)).toEqual([MONEY_NOTE.task]);
  });
});

describe('no backfill, off hides, once is once', () => {
  it('a sub before the switch went on: no note; after: yes; off hides it, on again shows it (not tapped), a second on keeps the start', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Harper']);
    at(w, g.start, 6);
    await drop(w, g.id, 'Harper'); // free
    await drop(w, g.id, 'Blair'); // owes
    await join(w, g.id, ['Gale']); // clears Blair, before the switch
    w.app.now += 60_000;
    await on(w);
    expect(await notes(w, 'Blair')).toEqual([]);
    w.app.now += 60_000;
    await drop(w, g.id, 'Casey'); // owes
    w.app.now += 60_000;
    await join(w, g.id, ['Indy']);
    expect(await texts(w, 'Casey')).toEqual(['Indy took your spot. Your $14 is cleared.']);
    await off(w);
    expect('moneyNotes' in (await view(w, 'Casey'))).toBe(false);
    w.app.now += 60_000;
    await on(w); // a new start: the earlier note is before it now
    expect(await notes(w, 'Casey')).toEqual([]);
    w.app.now += 60_000;
    expect((await admin(w, 'PUT', '/api/admin/money-note-switch', { on: true })).status).toBe(200); // on while on: the start stays
    const rows = raw(w).prepare("SELECT at FROM task_log WHERE task = 'money_note_on'").all();
    expect(rows).toHaveLength(1);
    expect(health(w)).toEqual({});
  });
  it('Got it is kept across a move to another day (the game\'s own marks are cleared then; the note\'s rows are not on the game)', async () => {
    const w = await world();
    await on(w);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Gale']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair'); // free (leaves 4)
    expect((await drop(w, g.id, 'Casey')).lateFee).toEqual({ cents: PRICE, paid: false });
    await join(w, g.id, ['Harper']);
    const [n] = await notes(w, 'Casey');
    expect(n.text).toBe('Harper took your spot. Your $14 is cleared.');
    expect((await gotIt(w, 'Casey', n.id)).status).toBe(200);
    expect((await moveBy(w, g, DAY)).status).toBe(200);
    expect(await notes(w, 'Casey')).toEqual([]);
  });
  it('the organizer\'s Settings row reads on, and the History says who switched it', async () => {
    const w = await world();
    await on(w);
    expect((await dash(w)).moneyNoteForAll).toBe(true);
    const acts = (await dash(w)).audit.map((a: any) => a.action);
    expect(acts).toContain('money_note_on');
  });
});
