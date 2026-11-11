// Zip 14: the court number per game (migration 0017) and the Game day card switch (GAME_DAY_CARD, ships OFF).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { COURT_ROWS, GAME_DAY_CARD, GAME_DAY_TEST, courtOrNull, tbdText } from '../shared/gameDay';
import { DAY, firstSession, HOUR, playerPhone, setupGroup, TestApp } from './harness';
import { DatabaseSync } from 'node:sqlite';
import { PREVIEW_SWITCHES_ON, ZIP14_SWITCHES_ON } from '../scripts/seed-preview-world';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const group = async (w: W, name = 'Blair', headers: Record<string, string> = {}) => (await (await playerPhone(w, name)).call('GET', '/api/group', undefined, headers)).data;
const ON = { [GAME_DAY_CARD.header]: 'on' };
const setCourt = (w: W, id: string, court: unknown, headers: Record<string, string> = ON) => w.organizer.call('PUT', `/api/admin/sessions/${id}/court-number`, { court }, headers);
const courtOf = (w: W, id: string) => (w.app.db.raw.prepare('SELECT court FROM sessions WHERE id = ?').get(id) as { court: number | null }).court;

describe('migration 0017: one nullable court column, 1 to 16', () => {
  it('adds only sessions.court (it was the newest migration until Zip 30 added 0018), and existing games stay empty', () => {
    const files = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.filter((f) => f > '0017_court.sql' && f <= '0018_phone_tag.sql')).toEqual(['0018_phone_tag.sql']);
    const sql = readFileSync(new URL('../migrations/0017_court.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '').trim();
    // Additive only: exactly one statement, an ADD COLUMN. Nothing dropped, renamed, updated or copied.
    expect(sql.split(';').filter((x) => x.trim())).toHaveLength(1);
    expect(sql).toMatch(/^ALTER TABLE sessions ADD COLUMN court INTEGER CHECK/);
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP|RENAME|INSERT/i);
  });
  it('on a database with games already in it (the live shape before 0017): every game reads NULL, notes untouched; the database refuses 0 and 17', () => {
    const db = { raw: new DatabaseSync(':memory:') };
    const all = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    for (const f of all.filter((f) => f < '0017')) db.raw.exec(readFileSync(`migrations/${f}`, 'utf8'));
    db.raw.exec(`INSERT INTO groups (id, name, timezone, admin_pin_hash, group_key, created_at) VALUES ('g', 'G', 'America/Detroit', 'h', 'k', 'x')`);
    db.raw.exec(`INSERT INTO sessions (id, group_id, starts_at, ends_at, note, court_number, created_at, updated_at) VALUES ('s1', 'g', '2026-11-11T00:30:00Z', '2026-11-11T02:30:00Z', 'Court 3', '7', 'x', 'x')`);
    db.raw.exec(readFileSync('migrations/0017_court.sql', 'utf8'));
    const row = db.raw.prepare('SELECT court, note, court_number FROM sessions').get() as Record<string, unknown>;
    expect(row).toEqual({ court: null, note: 'Court 3', court_number: '7' });
    expect(() => db.raw.exec("UPDATE sessions SET court = 0 WHERE id = 's1'")).toThrow();
    expect(() => db.raw.exec("UPDATE sessions SET court = 17 WHERE id = 's1'")).toThrow();
    db.raw.exec("UPDATE sessions SET court = 16 WHERE id = 's1'");
    db.raw.exec("UPDATE sessions SET court = NULL WHERE id = 's1'");
  });
  it('backward safe: the build before Zip 14 never names the column, so it works the same with it there (insert, select *, backup)', async () => {
    // The insert every old path uses lists its columns, so the new one defaults to NULL; reads are by name or SELECT *.
    const w = await world();
    const s = await firstSession(w);
    expect(courtOf(w, s.id)).toBeNull();
    const backup = (await w.organizer.call('GET', '/api/admin/backup')).data;
    expect(backup.tables.sessions[0]).toHaveProperty('court', null);
  });
});

describe('GAME_DAY_CARD ships off: every answer exactly as before', () => {
  it('off: no flag, no court on any game (player or organizer), and the court cannot be set', async () => {
    const w = await world();
    const s = await firstSession(w);
    w.app.db.raw.prepare('UPDATE sessions SET court = 3 WHERE id = ?').run(s.id);
    const d = await dash(w);
    expect(d.gameDayCard).toBeUndefined();
    expect(d.gameDayCardForAll).toBeUndefined();
    expect(d.sessions.every((x: any) => !('courtNum' in x))).toBe(true);
    const g = await group(w);
    expect(g.gameDayCard).toBeUndefined();
    expect(g.gameDayTest).toBeUndefined();
    expect(g.sessions.every((x: any) => !('court' in x))).toBe(true);
    expect((await setCourt(w, s.id, 5, {})).status).toBe(404);
    expect(courtOf(w, s.id)).toBe(3);
  });
  it('the Settings row turns it on for everyone (Activity line, the player stamp changes); the private link for one phone; the kill switch beats both', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    const v0 = (await blair.call('GET', '/api/group/version')).data.v;
    expect((await group(w, 'Blair', ON)).gameDayCard).toBe(true);
    expect((await dash(w, ON)).gameDayCard).toBe(true);
    expect((await w.organizer.call('PUT', '/api/admin/game-day-card-switch', { on: true })).status).toBe(200);
    const d = await dash(w);
    expect(d.gameDayCard).toBe(true);
    expect(d.gameDayCardForAll).toBe(true);
    expect((await group(w)).gameDayCard).toBe(true);
    expect((await blair.call('GET', '/api/group/version')).data.v).not.toBe(v0);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === 'game_day_card_on');
    expect(activityText(act, 'America/Detroit', 'Alex')).toBe('Alex switched "Game day card" on');
    expect((await blair.call('PUT', '/api/admin/game-day-card-switch', { on: false })).status).toBe(401);
    await w.organizer.call('PUT', '/api/admin/game-day-card-switch', { on: false });
    expect((await group(w)).gameDayCard).toBeUndefined();
    expect((await blair.call('GET', '/api/group/version')).data.v).toBe(v0);
    const k = await world({ GAME_DAY_CARD: 'off' });
    await k.organizer.call('PUT', '/api/admin/game-day-card-switch', { on: true });
    expect((await group(k, 'Blair', ON)).gameDayCard).toBeUndefined();
    expect((await dash(k, ON)).gameDayCard).toBeUndefined();
  });
});

describe('setting a court (organizer only)', () => {
  it('Edit game: sets 1 to 16, clears with null, refuses anything else; logged; players see it only with the switch on', async () => {
    const w = await world();
    const s = await firstSession(w);
    const r = await setCourt(w, s.id, 3);
    expect(r.status, r.text).toBe(200);
    expect(courtOf(w, s.id)).toBe(3);
    expect((await dash(w, ON)).sessions.find((x: any) => x.id === s.id).courtNum).toBe(3);
    expect((await group(w, 'Blair', ON)).sessions.find((x: any) => x.id === s.id).court).toBe(3);
    // A player without the switch: nothing.
    expect('court' in (await group(w)).sessions.find((x: any) => x.id === s.id)).toBe(false);
    for (const bad of [0, 17, 2.5, '3', true, -1]) expect((await setCourt(w, s.id, bad)).status, String(bad)).toBe(400);
    expect(courtOf(w, s.id)).toBe(3);
    expect((await setCourt(w, s.id, 3)).data.changed).toBe(false);
    expect((await setCourt(w, s.id, null)).status).toBe(200);
    expect(courtOf(w, s.id)).toBeNull();
    const acts = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.filter((e: any) => e.action === 'session_court_changed');
    expect(acts).toHaveLength(2);
    const texts = acts.map((a: any) => activityText(a, 'America/Detroit', 'Alex'));
    expect(texts.some((t: string) => /set the court .*to Court 3/.test(t))).toBe(true);
    expect(texts.some((t: string) => /cleared the court/.test(t))).toBe(true);
    // The note is never touched.
    expect((w.app.db.raw.prepare('SELECT note FROM sessions WHERE id = ?').get(s.id) as { note: string | null }).note).toBe(s.note ?? null);
  });
  it('Add game takes a court with the switch on, and ignores one with it off (as main does)', async () => {
    const w = await world();
    const at = new Date(w.app.now + 3 * DAY).toISOString().slice(0, 13) + ':00:00.000Z';
    const end = new Date(Date.parse(at) + 2 * HOUR).toISOString();
    const off = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: new Date(Date.parse(at) + 5 * DAY).toISOString(), endsAt: new Date(Date.parse(at) + 5 * DAY + 2 * HOUR).toISOString(), note: null, court: 4 });
    expect(off.status, off.text).toBe(200);
    expect(courtOf(w, off.data.id)).toBeNull();
    const r = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at, endsAt: end, note: null, court: 4 }, ON);
    expect(r.status, r.text).toBe(200);
    expect(courtOf(w, r.data.id)).toBe(4);
    const at2 = new Date(Date.parse(at) + DAY).toISOString();
    const r2 = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at2, endsAt: new Date(Date.parse(at2) + 2 * HOUR).toISOString(), note: null }, ON);
    expect(courtOf(w, r2.data.id)).toBeNull();
    expect((await w.organizer.call('POST', '/api/admin/sessions', { startsAt: new Date(Date.parse(at) + 2 * DAY).toISOString(), endsAt: new Date(Date.parse(at) + 2 * DAY + 2 * HOUR).toISOString(), court: 99 }, ON)).status).toBe(400);
  });
  it('a player, a phone with no sign-in and the read-only PIN can never set a court', async () => {
    const w = await world();
    w.app.env.ORGANIZER_READONLY_PIN = '86420975';
    const s = await firstSession(w);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('PUT', `/api/admin/sessions/${s.id}/court-number`, { court: 5 }, ON)).status).toBe(401);
    expect((await blair.call('PUT', `/api/sessions/${s.id}/court-number`, { court: 5 }, ON)).status).toBe(404);
    expect((await blair.call('POST', '/api/admin/sessions', { startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-01-01T02:00:00Z', court: 5 }, ON)).status).toBe(401);
    const ro = w.app.client();
    expect((await ro.call('POST', '/api/admin/login', { pin: '86420975' })).status).toBe(200);
    const res = await ro.call('PUT', `/api/admin/sessions/${s.id}/court-number`, { court: 5 }, ON);
    expect(res.status).toBe(403);
    expect(courtOf(w, s.id)).toBeNull();
  });
});

describe('preview-only "see the next game as today" (GAME_DAY_TEST)', () => {
  it('never without GAME_DAY_TEST (live has no such var), only with the switch on, and only for the phone that asks', async () => {
    const test = { ...ON, [GAME_DAY_TEST.header]: 'on' };
    const live = await world();
    expect((await group(live, 'Blair', test)).gameDayTest).toBeUndefined();
    const prev = await world({ GAME_DAY_TEST: 'on' });
    expect((await group(prev, 'Blair', test)).gameDayTest).toBe(true);
    expect((await group(prev, 'Blair', ON)).gameDayTest).toBeUndefined();
    expect((await group(prev, 'Blair', { [GAME_DAY_TEST.header]: 'on' })).gameDayTest).toBeUndefined();
  });
  it('wrangler.toml: GAME_DAY_CARD allowed on live and the preview; GAME_DAY_TEST only in [env.preview.vars]; the preview seed has the row on (and older local worlds do not)', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml.match(/^GAME_DAY_CARD = "on"$/gm)).toHaveLength(2);
    const [live, preview] = toml.split('[env.preview.vars]');
    expect(live).not.toMatch(/^GAME_DAY_TEST/m);
    expect(preview).toMatch(/^GAME_DAY_TEST = "on"$/m);
    expect(ZIP14_SWITCHES_ON).toContain(GAME_DAY_CARD.task);
    // Not in the list every older local test starts from (their screens stay main's).
    expect(PREVIEW_SWITCHES_ON as readonly string[]).not.toContain(GAME_DAY_CARD.task);
  });
});

describe('shared helpers', () => {
  it('courts 1 to 16, the map has each once, and the pop-up uses the organizer first name', () => {
    expect([0, 1, 16, 17, 3.5, '3', null].map(courtOrNull)).toEqual([null, 1, 16, null, null, null, null]);
    expect(COURT_ROWS.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(tbdText('Alex Juncaj')).toBe('Alex will add it soon.');
    expect(tbdText('')).toBe('The organizer will add it soon.');
  });
});

describe('rollback safety of the demo copy (View as / Pretend), Zip 14 review', () => {
  it('a backup taken with sessions.court set still loads into a demo copy built WITHOUT 0017 (the column is left out), and with it the court survives', async () => {
    const { default: initSqlJs } = await import('sql.js');
    const { createSandbox } = await import('../src/demo/sandbox');
    const { ORIGIN } = await import('./harness');
    const w = await world();
    const s = await firstSession(w);
    w.app.db.raw.prepare('UPDATE sessions SET court = 5 WHERE id = ?').run(s.id);
    const backup = (await w.organizer.call('GET', '/api/admin/backup')).data;
    expect(backup.tables.sessions.find((x: any) => x.id === s.id).court).toBe(5);
    const all = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    const SQL = await initSqlJs();
    const old = await createSandbox(SQL, backup, all.filter((f) => f < '0017').map((f) => readFileSync(`migrations/${f}`, 'utf8')), ORIGIN);
    expect((await old.request('GET', '/api/admin/dashboard', undefined, {}, w.app.now)).status).toBe(200);
    const now = await createSandbox(SQL, backup, all.map((f) => readFileSync(`migrations/${f}`, 'utf8')), ORIGIN);
    const d = await (await now.request('GET', '/api/admin/dashboard', undefined, ON, w.app.now)).json();
    expect(d.sessions.find((x: any) => x.id === s.id).courtNum).toBe(5);
  });
});
