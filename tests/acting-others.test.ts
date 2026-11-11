// Zip 30: phone tag (migration 0018) and "Acting for others" (ACTING_FOR_OTHERS, ships OFF). Organizer only, look only.
import { mkdtempSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { ACTING_OTHERS, actingOthersAllowed, afterDismiss, cardRows, cardVerb, fromNote, isPlayerTap, judgeTaps, PHONE_TAG_HEADER, type TaggedLine, validPhoneTag } from '../shared/actingForOthers';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { phoneTagOf } from '../server/phoneTag';
import { makeCtx } from '../server/context';
import { audit } from '../server/repo';
import { DAY, firstSession, HOUR, playerPhone, setupGroup, TestApp } from './harness';

// ---------------------------------------------------------------- the rule, on its own
let seq = 0;
const T0 = Date.parse('2026-11-10T20:00:00.000Z');
const line = (tag: string, name: string, action = 'player_join', details: Record<string, unknown> = {}): TaggedLine => {
  seq += 1;
  return { id: `l${seq}`, tag, name, action, details: { player: name, ...details }, createdAt: new Date(T0 + seq * 60_000).toISOString() };
};
const verdicts = (lines: TaggedLine[], exempt?: (n: string) => boolean) => {
  const j = judgeTaps(lines, exempt);
  return lines.map((l) => {
    const f = j.get(l.id);
    return f ? fromNote(f) : null;
  });
};

describe('the rule: when is a tap "for someone else"?', () => {
  it('Mitchel acts as Mitchel 3 times, then as Brandon: the Brandon tap is flagged "from Mitchel\'s phone"', () => {
    const lines = [line('M', 'Mitchel'), line('M', 'Mitchel', 'player_withdraw'), line('M', 'Mitchel', 'player_self_paid'), line('M', 'Brandon')];
    expect(verdicts(lines)).toEqual([null, null, null, "from Mitchel's phone"]);
    // ...and then backs out for Brandon: flagged again.
    lines.push(line('M', 'Brandon', 'player_withdraw'));
    expect(verdicts(lines).at(-1)).toBe("from Mitchel's phone");
  });

  it('a brand-new phone is never flagged on its first tap, and its own name over and over is never flagged', () => {
    expect(verdicts([line('N', 'Nathan', 'player_self_paid')])).toEqual([null]);
    expect(verdicts([line('N', 'Nathan'), line('N', 'Nathan'), line('N', 'Nathan'), line('N', 'Nathan', 'player_withdraw')])).toEqual([null, null, null, null]);
  });

  it('a phone too new to have a usual name (1 or 2 taps) that acts as a NEW name: "from a new phone"', () => {
    expect(verdicts([line('P', 'Mitchel'), line('P', 'Nathan', 'player_self_paid')])).toEqual([null, 'from a new phone']);
    // ...but going back to a name it already used is not flagged.
    expect(verdicts([line('Q', 'Mitchel'), line('Q', 'Nathan'), line('Q', 'Mitchel')])).toEqual([null, 'from a new phone', null]);
  });

  it('two people sharing one phone: flagged both ways while one of them is the clear majority, quiet while it is a tie', () => {
    const lines = [line('S', 'Mitchel'), line('S', 'Mitchel'), line('S', 'Mitchel')];
    for (let i = 0; i < 5; i++) lines.push(line('S', 'Brandon'));
    lines.push(line('S', 'Mitchel'));
    // Mitchel x3, then Brandon: flagged while Mitchel has more than half (3 of 3, 3 of 4, 3 of 5); quiet at the 3 to 3 tie; Brandon's own
    // once Brandon has more than half (4 of 7); then Mitchel's tap is flagged the other way, "from Brandon's phone" (5 of 8).
    expect(verdicts(lines)).toEqual([null, null, null, "from Mitchel's phone", "from Mitchel's phone", "from Mitchel's phone", null, null, "from Brandon's phone"]);
  });

  it('cleared browser data (or a private window, or another browser) is a new code: it looks like a brand-new phone', () => {
    const before = [line('OLD', 'Mitchel'), line('OLD', 'Mitchel'), line('OLD', 'Mitchel')];
    const after = [line('NEW', 'Brandon')];
    expect(verdicts([...before, ...after])).toEqual([null, null, null, null]);
  });

  it("Alex's own player name: a phone it has acted from is Alex's and is never flagged, whoever it acts as", () => {
    const alex = (n: string) => n === 'Alex';
    expect(verdicts([line('A', 'Alex'), line('A', 'Alex'), line('A', 'Alex'), line('A', 'Brandon'), line('A', 'Nathan', 'player_self_paid')], alex)).toEqual([null, null, null, null, null]);
    // Without the exemption the same taps would be flagged (the test proves the exemption is what keeps them quiet).
    expect(verdicts([line('B', 'Alex'), line('B', 'Alex'), line('B', 'Alex'), line('B', 'Brandon')])).toEqual([null, null, null, "from Alex's phone"]);
  });

  it('only a player\'s own taps count: the automatic credit on I\'m in, the organizer\'s own I\'m in and organizer lines are left out', () => {
    expect(isPlayerTap({ action: 'player_join', details: {} })).toBe(true);
    expect(isPlayerTap({ action: 'credit_used', details: { auto: true } })).toBe(false);
    expect(isPlayerTap({ action: 'credit_used', details: {} })).toBe(true);
    expect(isPlayerTap({ action: 'player_join', details: { organizer: true } })).toBe(false);
    expect(isPlayerTap({ action: 'marked_paid', details: {} })).toBe(false);
    expect(isPlayerTap({ action: 'credit_back', details: {} })).toBe(false);
    // An automatic credit line between taps changes nothing.
    const lines = [line('C', 'Mitchel'), line('C', 'Mitchel', 'credit_used', { auto: true }), line('C', 'Mitchel'), line('C', 'Brandon', 'credit_used', { auto: true })];
    expect(verdicts(lines)).toEqual([null, null, null, null]);
  });

  it('each tap is judged on the taps before it: later taps never change an earlier verdict', () => {
    const lines = [line('D', 'Mitchel'), line('D', 'Mitchel'), line('D', 'Mitchel'), line('D', 'Brandon')];
    const first = verdicts(lines);
    for (let i = 0; i < 6; i++) lines.push(line('D', 'Brandon'));
    expect(verdicts(lines).slice(0, 4)).toEqual(first);
  });

  it('names match regardless of capitals and spaces', () => {
    expect(verdicts([line('E', 'Mitchel'), line('E', 'mitchel '), line('E', 'MITCHEL'), line('E', 'Mitchel')])).toEqual([null, null, null, null]);
  });

  it('the card: newest first, the last 7 days only, the verb from the tap; the X hides what was there, a newer tap shows again', () => {
    const lines = [line('F', 'Mitchel'), line('F', 'Mitchel'), line('F', 'Mitchel'), line('F', 'Brandon'), line('F', 'Brandon', 'player_withdraw')];
    const j = judgeTaps(lines);
    const now = Date.parse(lines.at(-1)!.createdAt) + HOUR;
    const rows = cardRows(lines, j, now);
    expect(rows.map((r) => `${r.by} ${r.verb} for ${r.name}`)).toEqual(['Mitchel backed out for Brandon', 'Mitchel signed up for Brandon']);
    expect(cardRows(lines, j, now + 8 * DAY)).toEqual([]);
    expect(afterDismiss(rows, rows[0].at)).toEqual([]);
    expect(afterDismiss(rows, rows[1].at).map((r) => r.verb)).toEqual(['backed out']);
    expect(afterDismiss(rows, null)).toEqual(rows);
    expect(cardVerb('player_self_paid')).toBe('marked paid');
    expect(cardVerb('player_still_in')).toBe('said still in');
    expect(cardVerb('refund_requested')).toBe('asked for a refund');
  });

  it('a phone code is 16 to 40 safe characters; anything else is no code', () => {
    expect(validPhoneTag('abcdefghijklmnopqrstuv')).toBe(true);
    expect(validPhoneTag('a-b_c'.repeat(4))).toBe(true);
    expect(validPhoneTag('short')).toBe(false);
    expect(validPhoneTag('x'.repeat(41))).toBe(false);
    expect(validPhoneTag('abcdefghijklmnop qrs')).toBe(false);
    expect(validPhoneTag("abcdefghijklmnop';--")).toBe(false);
    expect(validPhoneTag(null)).toBe(false);
  });

  it('History wording: the note is added only when the server sent one', () => {
    const e = { id: '1', actorLabel: 'Brandon', action: 'player_join', details: { player: 'Brandon', result: 'confirmed' }, createdAt: '2026-11-10T23:12:00.000Z', sessionStartsAt: '2026-11-11T00:00:00.000Z' };
    expect(activityText(e, 'America/Detroit', 'Alex')).toBe("Brandon said I'm in for Tue, Nov 10");
    expect(activityText({ ...e, from: "from Mitchel's phone" }, 'America/Detroit', 'Alex')).toBe("Brandon said I'm in for Tue, Nov 10 (from Mitchel's phone)");
    expect(activityText({ ...e, from: 'from a new phone' }, 'America/Detroit', 'Alex')).toBe("Brandon said I'm in for Tue, Nov 10 (from a new phone)");
    expect(activityText({ ...e, action: 'acting_others_on', actorLabel: 'organizer', details: {} }, 'America/Detroit', 'Alex')).toBe('Alex switched "Acting for others" on');
  });
});

// ---------------------------------------------------------------- the site
const TAG_M = 'mitchelsphone0000000001';
const TAG_N = 'brandnewphone0000000002';
const ON = { [ACTING_OTHERS.header]: 'on' };

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const tags = (w: W) => w.app.db.raw.prepare("SELECT actor_label, action, device_tag FROM admin_audit_log WHERE action NOT IN ('acting_others_on','acting_others_off') ORDER BY created_at, rowid").all() as { actor_label: string; action: string; device_tag: string | null }[];
const tagged = (w: W) => tags(w).filter((r) => r.device_tag !== null);
const dash = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const history = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/activity', undefined, headers)).data.entries as { action: string; actorLabel: string; from?: string }[];

/** Blair's phone (code TAG_M) acts as Blair: I'm in, Drop out, I'm in on the first game. */
async function blairThreeTimes(w: W) {
  const s = await firstSession(w);
  const phone = await playerPhone(w, 'Blair');
  const h = { [PHONE_TAG_HEADER]: TAG_M };
  expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {}, h)).status).toBe(200);
  w.app.advance(60_000);
  expect((await phone.call('POST', `/api/sessions/${s.id}/withdraw`, {}, h)).status).toBe(200);
  w.app.advance(60_000);
  expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {}, h)).status).toBe(200);
  w.app.advance(60_000);
  return { s, phone, h };
}
/** The same phone taps "Not you?" and picks Casey, then signs Casey up. */
async function asCasey(w: W, phone: Awaited<ReturnType<typeof playerPhone>>, s: { id: string }, h: Record<string, string>) {
  expect((await phone.call('POST', '/api/me', { playerId: w.byName.Casey })).status).toBe(200);
  expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {}, h)).status).toBe(200);
  w.app.advance(60_000);
}

describe('recording the phone code (migration 0018)', () => {
  it('migration 0018 is additive only: one nullable column and one partial index, nothing else', () => {
    const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    expect(files.at(-1)).toBe('0018_phone_tag.sql');
    const sql = readFileSync('migrations/0018_phone_tag.sql', 'utf8').replace(/--.*$/gm, '').trim().split(';').map((x) => x.trim()).filter(Boolean);
    expect(sql).toEqual([
      'ALTER TABLE admin_audit_log ADD COLUMN device_tag TEXT',
      'CREATE INDEX idx_audit_phone ON admin_audit_log (group_id, created_at) WHERE device_tag IS NOT NULL',
    ]);
  });

  it("a player's own tap writes the phone's code into the History line it already makes; organizer lines never get one", async () => {
    const w = await world();
    const { s } = await blairThreeTimes(w);
    expect(tagged(w).map((r) => [r.actor_label, r.action])).toEqual([
      ['Blair', 'player_join'],
      ['Blair', 'player_withdraw'],
      ['Blair', 'player_join'],
    ]);
    expect(new Set(tagged(w).map((r) => r.device_tag))).toEqual(new Set([TAG_M]));
    // The organizer marks someone paid: no code (and no code from the cookie either).
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName.Blair, paid: true });
    expect(tags(w).filter((r) => r.action === 'marked_paid').map((r) => r.device_tag)).toEqual([null]);
  });

  it('every kind of player tap in History carries it: I\'m in, Drop out, I paid, Didn\'t pay, and the texted-link taps', async () => {
    const w = await world();
    const s = await firstSession(w);
    const phone = await playerPhone(w, 'Devon');
    const h = { [PHONE_TAG_HEADER]: TAG_M };
    await phone.call('POST', `/api/sessions/${s.id}/join`, {}, h);
    await w.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked' });
    expect((await phone.call('POST', `/api/sessions/${s.id}/paid`, { paid: true }, h)).status).toBe(200);
    expect((await phone.call('POST', `/api/sessions/${s.id}/paid`, { paid: false }, h)).status).toBe(200);
    expect((await phone.call('POST', `/api/sessions/${s.id}/withdraw`, {}, h)).status).toBe(200);
    const kinds = tagged(w).map((r) => r.action);
    expect(kinds).toEqual(expect.arrayContaining(['player_join', 'player_self_paid', 'player_self_unpaid', 'player_withdraw']));
  });

  it('the cookie is the backup: with no header, the pb_phone cookie is used', async () => {
    const w = await world();
    const s = await firstSession(w);
    const phone = await playerPhone(w, 'Emery');
    phone.cookies.set('pb_phone', TAG_N);
    await phone.call('POST', `/api/sessions/${s.id}/join`, {});
    expect(tagged(w).map((r) => r.device_tag)).toEqual([TAG_N]);
  });

  it("the organizer's phone (signed in) records no code, even on the player screen: Alex's own taps are never flagged", async () => {
    const w = await world();
    const s = await firstSession(w);
    // The organizer's browser also picks a player name (as Alex does on his own player page).
    w.organizer.groupKey = w.groupKey;
    await w.organizer.call('POST', '/api/me', { playerId: w.byName.Blair });
    expect((await w.organizer.call('POST', `/api/sessions/${s.id}/join`, {}, { [PHONE_TAG_HEADER]: TAG_M })).status).toBe(200);
    expect(tags(w).filter((r) => r.action === 'player_join').map((r) => r.device_tag)).toEqual([null]);
  });

  it('View as never saves a tap on the real site, and the demo copy never records a code', async () => {
    const w = await world();
    const s = await firstSession(w);
    const r = await w.organizer.call('POST', `/api/sessions/${s.id}/join`, {}, { 'X-View-As': w.byName.Blair, [PHONE_TAG_HEADER]: TAG_M });
    expect(r.status).not.toBe(200);
    expect(tagged(w)).toEqual([]);
    const req = new Request('https://club.example/api/sessions/x/join', { method: 'POST', headers: { [PHONE_TAG_HEADER]: TAG_M } });
    expect(phoneTagOf(makeCtx(req, { DB: w.app.db, SANDBOX: true }, w.app.now))).toBeNull();
    expect(phoneTagOf(makeCtx(req, { DB: w.app.db }, w.app.now))).toBe(TAG_M);
  });

  it('the kill switch "off" stops the recording too; a bad code is ignored', async () => {
    const w = await world({ ACTING_FOR_OTHERS: 'off' });
    await blairThreeTimes(w);
    expect(tagged(w)).toEqual([]);
    const w2 = await world();
    const s = await firstSession(w2);
    const phone = await playerPhone(w2, 'Blair');
    await phone.call('POST', `/api/sessions/${s.id}/join`, {}, { [PHONE_TAG_HEADER]: 'not a code!' });
    expect(tagged(w2)).toEqual([]);
    expect(actingOthersAllowed(undefined)).toBe(true);
    expect(actingOthersAllowed(' OFF ')).toBe(false);
  });

  it('NO extra database reads: a player screen with a code makes exactly the reads it makes without one, and a tap makes the same trips', async () => {
    const w = await world();
    const s = await firstSession(w);
    const counted = (c: Counted) => countingDb(w.app.db, c);
    const real = w.app.env.DB;
    const run = async (h: Record<string, string>, fn: (p: Awaited<ReturnType<typeof playerPhone>>) => Promise<unknown>, name: string) => {
      const phone = await playerPhone(w, name);
      const c: Counted = { trips: 0, statements: 0, sql: [] };
      w.app.env.DB = counted(c);
      try {
        await fn(phone);
      } finally {
        w.app.env.DB = real;
      }
      return c;
    };
    const screenWith = await run({}, (p) => p.call('GET', '/api/group', undefined, { [PHONE_TAG_HEADER]: TAG_M }), 'Blair');
    const screenWithout = await run({}, (p) => p.call('GET', '/api/group'), 'Blair');
    expect(screenWith.trips).toBe(screenWithout.trips);
    expect(screenWith.sql).toEqual(screenWithout.sql);
    expect(screenWith.sql.some((q) => /device_tag/.test(q))).toBe(false);
    const tapWith = await run({}, (p) => p.call('POST', `/api/sessions/${s.id}/join`, {}, { [PHONE_TAG_HEADER]: TAG_M }), 'Casey');
    const tapWithout = await run({}, (p) => p.call('POST', `/api/sessions/${s.id}/join`, {}), 'Devon');
    expect(tapWith.trips).toBe(tapWithout.trips);
    // The only difference: the History INSERT names one more column.
    const diff = tapWith.sql.filter((q, i) => q !== tapWithout.sql[i]);
    expect(diff.length).toBe(1);
    expect(diff[0]).toMatch(/INSERT INTO admin_audit_log .*device_tag/s);
  });

  it('a database without migration 0018 still takes every tap (the line is written without the code), and main\'s write works on a migrated one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-mig-'));
    for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql') && f < '0018')) copyFileSync(join('migrations', f), join(dir, f));
    const app = new TestApp();
    app.db = createNodeD1(':memory:', dir);
    app.env = { ...app.env, DB: app.db };
    const w = await setupGroup(app);
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    await w.organizer.call('PUT', '/api/admin/acting-others-switch', { on: true });
    const { s, phone, h } = await blairThreeTimes(w as unknown as W);
    expect((w.app.db.raw.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'player_join'").get() as { n: number }).n).toBe(2);
    // The organizer screens with the switch on read nothing and show nothing (no column to read).
    const d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.actingOthers).toEqual([]);
    expect((await w.organizer.call('GET', '/api/admin/activity')).status).toBe(200);
    expect((await phone.call('POST', `/api/sessions/${s.id}/withdraw`, {}, h)).status).toBe(200);
    // A different database error is still an error (only the missing column is forgiven).
    const broken = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1_ERROR: disk full'); } }) }) } as never;
    await expect(audit(broken, 'g', null, 'player_join', {}, new Date().toISOString(), 'Blair', TAG_M)).rejects.toThrow('disk full');
    // Main's INSERT (no device_tag) on a migrated database: the line is written with NULL.
    const w2 = await world();
    const gid = (w2.app.db.raw.prepare('SELECT id FROM groups').get() as { id: string }).id;
    await audit(w2.app.db, gid, null, 'player_join', { player: 'Blair' }, new Date(w2.app.now).toISOString(), 'Blair');
    expect(tags(w2).at(-1)).toEqual({ actor_label: 'Blair', action: 'player_join', device_tag: null });
  });

  it('the organizer screens read the codes through the small index (only lines that have a code)', async () => {
    const w = await world();
    const plan = w.app.db.raw
      .prepare("EXPLAIN QUERY PLAN SELECT id, device_tag, actor_label, action, details_json, created_at FROM admin_audit_log WHERE group_id = ? AND device_tag IS NOT NULL AND created_at > ? ORDER BY created_at, rowid")
      .all('g', '2026') as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' | ')).toMatch(/idx_audit_phone/);
  });
});

describe('the switch (ships OFF)', () => {
  it('OFF: the dashboard and History answers have no new keys and no notes, even with codes recorded', async () => {
    const w = await world();
    const { s, phone, h } = await blairThreeTimes(w);
    await asCasey(w, phone, s, h);
    const d = await dash(w);
    expect(d.actingOthers).toBeUndefined();
    expect(d.actingOthersForAll).toBeUndefined();
    expect((await history(w)).some((e) => 'from' in e)).toBe(false);
  });

  it('ON (private link on one phone): "Casey said I\'m in (from Blair\'s phone)" in History, and the Home card row "Blair signed up for Casey"', async () => {
    const w = await world();
    const { s, phone, h } = await blairThreeTimes(w);
    await asCasey(w, phone, s, h);
    const d = await dash(w, ON);
    expect(d.actingOthers.map((r: { by: string; verb: string; name: string }) => `${r.by} ${r.verb} for ${r.name}`)).toEqual(['Blair signed up for Casey']);
    expect(d.actingOthersForAll).toBeUndefined();
    const entries = await history(w, ON);
    const casey = entries.find((e) => e.actorLabel === 'Casey' && e.action === 'player_join')!;
    expect(casey.from).toBe("from Blair's phone");
    expect(entries.filter((e) => e.from).length).toBe(1);
    // Casey backs out from the same phone: a second row, newest first.
    await phone.call('POST', `/api/sessions/${s.id}/withdraw`, {}, h);
    const d2 = await dash(w, ON);
    expect(d2.actingOthers.map((r: { verb: string }) => r.verb)).toEqual(['backed out', 'signed up']);
  });

  it('a brand-new phone that acts as one name, then another: "A new phone ... for"; its very first tap is never on the card', async () => {
    const w = await world();
    const s = await firstSession(w);
    const phone = await playerPhone(w, 'Devon');
    const h = { [PHONE_TAG_HEADER]: TAG_N };
    await phone.call('POST', `/api/sessions/${s.id}/join`, {}, h);
    w.app.advance(60_000);
    expect((await dash(w, ON)).actingOthers).toEqual([]);
    await phone.call('POST', '/api/me', { playerId: w.byName.Emery });
    await phone.call('POST', `/api/sessions/${s.id}/join`, {}, h);
    const rows = (await dash(w, ON)).actingOthers;
    expect(rows.map((r: { by: string | null; verb: string; name: string }) => `${r.by ?? 'A new phone'} ${r.verb} for ${r.name}`)).toEqual(['A new phone signed up for Emery']);
  });

  it("Alex's own player name acting from a phone (not signed in) makes that phone Alex's: never on the card", async () => {
    const w = await world();
    const s = await firstSession(w);
    const phone = await playerPhone(w, 'Alex');
    const h = { [PHONE_TAG_HEADER]: TAG_M };
    for (let i = 0; i < 3; i++) {
      await phone.call('POST', `/api/sessions/${s.id}/${i % 2 ? 'withdraw' : 'join'}`, {}, h);
      w.app.advance(60_000);
    }
    await phone.call('POST', '/api/me', { playerId: w.byName.Blair });
    await phone.call('POST', `/api/sessions/${s.id}/join`, {}, h);
    expect((await dash(w, ON)).actingOthers).toEqual([]);
  });

  it('Settings row: on for everyone with no deploy, an Activity line each way; refused for players and the read-only PIN; the kill switch hides it', async () => {
    const w = await world({ ORGANIZER_READONLY_PIN: '13572468' });
    const { s, phone, h } = await blairThreeTimes(w);
    await asCasey(w, phone, s, h);
    expect((await phone.call('PUT', '/api/admin/acting-others-switch', { on: true })).status).toBe(401);
    const ro = w.app.client();
    expect((await ro.call('POST', '/api/admin/login', { pin: '13572468' })).status).toBe(200);
    expect((await ro.call('PUT', '/api/admin/acting-others-switch', { on: true })).status).toBe(403);
    expect((await w.organizer.call('PUT', '/api/admin/acting-others-switch', { on: true })).data).toEqual({ ok: true, on: true });
    const d = await dash(w);
    expect(d.actingOthersForAll).toBe(true);
    expect(d.actingOthers.length).toBe(1);
    const lines = await history(w);
    expect(lines[0].action).toBe('acting_others_on');
    await w.organizer.call('PUT', '/api/admin/acting-others-switch', { on: false });
    expect((await dash(w)).actingOthers).toBeUndefined();
    // The kill switch: the row can be on, the screens still show nothing.
    await w.organizer.call('PUT', '/api/admin/acting-others-switch', { on: true });
    w.app.env.ACTING_FOR_OTHERS = 'off';
    const killed = await dash(w);
    expect(killed.actingOthers).toBeUndefined();
    expect(killed.actingOthersForAll).toBe(true);
  });

  it('players never see any of it: the player answer has no phone codes, no notes and no card', async () => {
    const w = await world();
    const { s, phone, h } = await blairThreeTimes(w);
    await asCasey(w, phone, s, h);
    await w.organizer.call('PUT', '/api/admin/acting-others-switch', { on: true });
    const text = (await phone.call('GET', '/api/group', undefined, { ...h, ...ON })).text;
    expect(text).not.toMatch(/phone|actingOthers|device_tag/i);
    expect(text).not.toContain(TAG_M);
    // Nor does the organizer: the code itself is never sent to any screen.
    expect(JSON.stringify(await dash(w))).not.toContain(TAG_M);
    expect(JSON.stringify(await history(w))).not.toContain(TAG_M);
  });

  it('taps older than 7 days leave the card but keep their History note', async () => {
    const w = await world();
    const { s, phone, h } = await blairThreeTimes(w);
    await asCasey(w, phone, s, h);
    w.app.advance(8 * DAY);
    expect((await dash(w, ON)).actingOthers).toEqual([]);
    expect((await history(w, ON)).find((e) => e.actorLabel === 'Casey')?.from).toBe("from Blair's phone");
  });
});

describe('rollback safety of the demo copy (View as / Pretend)', () => {
  it('a backup taken with phone codes loads into a demo copy built WITHOUT 0018 (the build before Zip 30: the column is left out)', async () => {
    const { default: initSqlJs } = await import('sql.js');
    const { createSandbox } = await import('../src/demo/sandbox');
    const { ORIGIN } = await import('./harness');
    const w = await world();
    await blairThreeTimes(w);
    const backup = (await w.organizer.call('GET', '/api/admin/backup')).data;
    expect(backup.tables.admin_audit_log.some((r: { device_tag?: string }) => r.device_tag === TAG_M)).toBe(true);
    const all = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    const SQL = await initSqlJs();
    const old = await createSandbox(SQL, backup, all.filter((f) => f < '0018').map((f) => readFileSync(`migrations/${f}`, 'utf8')), ORIGIN);
    expect((await old.request('GET', '/api/admin/dashboard', undefined, {}, w.app.now)).status).toBe(200);
    expect((await old.request('GET', '/api/admin/activity', undefined, {}, w.app.now)).status).toBe(200);
    const now = await createSandbox(SQL, backup, all.map((f) => readFileSync(`migrations/${f}`, 'utf8')), ORIGIN);
    expect((await now.request('GET', '/api/admin/dashboard', undefined, ON, w.app.now)).status).toBe(200);
  });
});

describe('preview (PREVIEW SWITCHES RULE)', () => {
  it('the preview seed has the Acting for others row on, and the preview vars allow it', async () => {
    const { BUILDING_ON } = await import('../scripts/preview-world-small');
    expect([...BUILDING_ON]).toContain(ACTING_OTHERS.task);
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect(toml.match(/^ACTING_FOR_OTHERS = "on"$/gm)?.length).toBe(2);
  });
});
