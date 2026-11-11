// Zip 32: "Players sheet redo" (PLAYERS_SHEET_REDO, ships OFF) and the four polish fixes' server-side facts.
//  - the switch: off at ship, kill switch allowed unless "off", the Settings row, the private link, the History words, the preview list;
//  - the facts the new sheet draws from, so it can never drift from what the server does: who marked a payment (a player's own "I paid" is
//    `selfPaid`, the organizer's Mark paid clears it), the time it was marked, the refusal words when a game is full (the sheet says them
//    itself when it already knows the game is full), and that a declined player can be given a spot again;
//  - no money moved by flipping the switch (nothing but one task_log row changes).
import { describe, expect, it, vi } from 'vitest';
import { activityText } from '../shared/activity';
import { PLAYERS_SHEET_REDO, playersSheetRedoAllowed } from '../shared/playersSheetRedo';
import { DB_LIMIT_MESSAGE } from '../shared/zip10';
import { buildSmallPreview, BUILDING_ON, smallSwitchRows } from '../scripts/preview-world-small';
import { createNodeD1 } from '../dev/nodeD1';
import { HOUR, playerPhone, setupGroup } from './harness';

vi.setConfig({ testTimeout: 120_000 });

type W = Awaited<ReturnType<typeof setupGroup>>;
const dash = async (w: W, h: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, h)).data;

async function game(w: W) {
  w.app.now = Date.parse('2026-11-09T17:00:00.000Z'); // Mon Nov 9, 12:00 PM Eastern
  const startsAt = '2026-11-12T23:00:00.000Z'; // Thu Nov 12, 6:00 PM Eastern
  const res = await w.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt: new Date(Date.parse(startsAt) + 2 * HOUR).toISOString(), note: null });
  expect(res.status, res.text).toBe(200);
  const id = res.data.id as string;
  expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/court-status`, { status: 'booked' })).status).toBe(200);
  return id;
}
const seatOf = async (w: W, id: string, name: string) => (await dash(w)).sessions.find((s: { id: string }) => s.id === id).roster.find((r: { name: string }) => r.name === name);

describe('Players sheet redo: the switch (PLAYERS_SHEET_REDO, ships OFF)', () => {
  it('off at ship; the kill switch is allowed unless "off"; the Settings row; the private link; the organizer only', async () => {
    expect(PLAYERS_SHEET_REDO).toEqual({ task: 'players_sheet_redo_on', header: 'X-Players-Sheet', link: 'playerssheet', env: 'PLAYERS_SHEET_REDO', name: 'Players sheet redo' });
    expect(playersSheetRedoAllowed(undefined)).toBe(true);
    expect(playersSheetRedoAllowed('on')).toBe(true);
    expect(playersSheetRedoAllowed(' OFF ')).toBe(false);
    const w = await setupGroup();
    const d = await dash(w);
    expect(d.playersSheetRedo).toBeUndefined();
    expect(d.playersSheetRedoForAll).toBeUndefined();
    // The private link for one phone: the header turns it on for that request only.
    expect((await dash(w, { 'X-Players-Sheet': 'on' })).playersSheetRedo).toBe(true);
    expect((await dash(w, { 'X-Players-Sheet': 'on' })).playersSheetRedoForAll).toBeUndefined();
    expect((await dash(w)).playersSheetRedo).toBeUndefined();
    // The Settings row: on for every organizer phone.
    expect((await w.organizer.call('PUT', '/api/admin/players-sheet-redo-switch', { on: true })).status).toBe(200);
    expect(await dash(w)).toMatchObject({ playersSheetRedo: true, playersSheetRedoForAll: true });
    // The kill switch ("off" in wrangler.toml) beats the row and the link.
    (w.app.env as unknown as Record<string, unknown>).PLAYERS_SHEET_REDO = 'off';
    expect((await dash(w)).playersSheetRedo).toBeUndefined();
    expect((await dash(w, { 'X-Players-Sheet': 'on' })).playersSheetRedo).toBeUndefined();
    // Players cannot flip it.
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('PUT', '/api/admin/players-sheet-redo-switch', { on: false })).status).toBe(401);
    // Off again: the answer has no trace of it.
    (w.app.env as unknown as Record<string, unknown>).PLAYERS_SHEET_REDO = 'on';
    expect((await w.organizer.call('PUT', '/api/admin/players-sheet-redo-switch', { on: false })).status).toBe(200);
    const off = await dash(w);
    expect(off.playersSheetRedo).toBeUndefined();
    expect(off.playersSheetRedoForAll).toBeUndefined();
  });

  it('History says it in words; the preview has the row on (PREVIEW SWITCHES RULE); the row is not listed twice', async () => {
    const e = { id: 'x', at: '2026-11-12T20:00:00.000Z', sessionId: null, playerId: null, details: {}, actorLabel: 'organizer' } as never;
    expect(activityText({ ...(e as object), action: 'players_sheet_redo_on' } as never, 'America/Detroit', 'Alex')).toBe('Alex switched "Players sheet redo" on');
    expect(activityText({ ...(e as object), action: 'players_sheet_redo_off' } as never, 'America/Detroit', 'Alex')).toBe('Alex switched "Players sheet redo" off');
    expect([...BUILDING_ON]).toContain(PLAYERS_SHEET_REDO.task);
    const rows = smallSwitchRows(Date.parse('2026-11-12T23:00:00.000Z')).trim().split('\n');
    expect(rows.filter((r) => r.includes(`'${PLAYERS_SHEET_REDO.task}'`))).toHaveLength(1);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('switching it on or off changes one task_log row and nothing else (no money, no seat, no database change)', async () => {
    const w = await setupGroup();
    const id = await game(w);
    for (const n of ['Blair', 'Casey']) await w.organizer.call('POST', `/api/admin/sessions/${id}/roster`, { playerId: w.byName[n], action: 'confirm' });
    await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: w.byName.Blair, paid: true });
    const raw = (w.app as unknown as { db: { raw: { prepare: (s: string) => { all: () => unknown[] } } } }).db.raw;
    const snap = () => JSON.stringify(['session_players', 'credit_ledger', 'sessions', 'players'].map((t) => raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
    const before = snap();
    await w.organizer.call('PUT', '/api/admin/players-sheet-redo-switch', { on: true });
    expect(snap()).toBe(before);
    await w.organizer.call('PUT', '/api/admin/players-sheet-redo-switch', { on: false });
    expect(snap()).toBe(before);
  });
});

describe('Players sheet redo: the facts the sheet draws from', () => {
  it('who marked a payment: a player\'s own "I paid" is selfPaid with its time; the organizer\'s Mark paid is not, and also has a time', async () => {
    const w = await setupGroup();
    const id = await game(w);
    for (const n of ['Blair', 'Casey']) await w.organizer.call('POST', `/api/admin/sessions/${id}/roster`, { playerId: w.byName[n], action: 'confirm' });
    w.app.now = Date.parse('2026-11-12T20:15:00.000Z'); // 3:15 PM Eastern
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${id}/paid`, { paid: true, cents: 1400 })).status).toBe(200);
    w.app.now = Date.parse('2026-11-12T21:00:00.000Z'); // 4:00 PM Eastern
    expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: w.byName.Casey, paid: true })).status).toBe(200);
    const b = await seatOf(w, id, 'Blair');
    const c = await seatOf(w, id, 'Casey');
    expect(b).toMatchObject({ paymentStatus: 'paid', selfPaid: true, paidAt: '2026-11-12T20:15:00.000Z' });
    expect(c).toMatchObject({ paymentStatus: 'paid', selfPaid: false, paidAt: '2026-11-12T21:00:00.000Z' });
    // The organizer confirming Blair's claim (Mark paid on the same row) takes the player tag off: from then on the sheet says "You marked it paid".
    expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: w.byName.Blair, paid: true, seen: b.moneySeen })).status).toBe(200);
    expect(await seatOf(w, id, 'Blair')).toMatchObject({ paymentStatus: 'paid', selfPaid: false });
    // The money cell counts both as paid (the sheet's "x of y paid" is the card's own number).
    const s = (await dash(w)).sessions.find((x: { id: string }) => x.id === id);
    expect(s.paidCount).toBe(2);
    expect(s.payableCount).toBe(2);
  });

  it('a declined player can be given a spot again; a full game refuses with the exact words the sheet shows when it already knows', async () => {
    const w = await setupGroup();
    const id = await game(w);
    // Max players 4 (Card cleanup, the no-cap rule, is off here, so the plain "The game is full" words apply).
    expect((await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex', settings: { maxPlayers: 4 } })).status).toBe(200);
    const casey = await playerPhone(w, 'Casey');
    expect((await casey.call('POST', `/api/sessions/${id}/decline`, {})).status).toBe(200);
    expect(await seatOf(w, id, 'Casey')).toMatchObject({ status: 'declined' });
    // Give spot on a declined player (what a chip's Add button runs).
    expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/roster`, { playerId: w.byName.Casey, action: 'confirm' })).status).toBe(200);
    expect(await seatOf(w, id, 'Casey')).toMatchObject({ status: 'confirmed' });
    for (const n of ['Blair', 'Devon', 'Emery']) expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/roster`, { playerId: w.byName[n], action: 'confirm' })).status).toBe(200);
    const full = await w.organizer.call('POST', `/api/admin/sessions/${id}/roster`, { playerId: w.byName.Frankie, action: 'confirm' });
    expect(full.status).toBe(409);
    expect(full.data.message ?? full.text).toContain('The game is full (4 in).');
    // With the no-cap rule the words are the database limit's (the sheet shows the same text without asking).
    expect(DB_LIMIT_MESSAGE).toBe('12 is the most one game can hold right now. Ask Alex.');
  });
});

describe('the preview world has the Players sheet scene', () => {
  it('Reese declined game 1, so the sheet shows "Reese declined" and a chip to give the spot back; still exactly the 10 fixed names', async () => {
    const now = Date.parse('2026-11-12T23:00:00.000Z'); // Thu Nov 12, 6:00 PM Eastern
    const { sql, summary } = await buildSmallPreview(now);
    expect(summary.join('\n')).toContain('Reese declined');
    const db = createNodeD1(':memory:');
    db.raw.exec(sql);
    const declined = db.raw
      .prepare("SELECT p.display_name AS n FROM session_players sp JOIN players p ON p.id = sp.player_id WHERE sp.status = 'declined' AND sp.payment_status <> 'paid' ORDER BY n")
      .all() as { n: string }[];
    expect(declined.map((r) => r.n)).toEqual(['Reese']);
    const names = (db.raw.prepare('SELECT display_name AS n FROM players ORDER BY n').all() as { n: string }[]).length;
    expect(names).toBe(10);
    expect(sql).toContain("'preview-players_sheet_redo_on'");
  });
});
