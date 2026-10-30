import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { firstSession, playerPhone, setupGroup } from './harness';

// "Cancel with a reason": an optional short note the organizer adds when canceling.

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

async function cancel(ctx: Ctx, id: string, extra: Record<string, unknown> = {}) {
  return ctx.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true, ...extra });
}
async function adminView(ctx: Ctx, id: string) {
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  return dash.data.sessions.find((s: { id: string }) => s.id === id);
}
async function playerView(ctx: Ctx, id: string) {
  const g = await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group');
  return g.data.sessions.find((s: { id: string }) => s.id === id);
}
const stored = (ctx: Ctx, id: string) =>
  (ctx.app.db.raw.prepare('SELECT status, cancel_reason FROM sessions WHERE id = ?').get(id) as { status: string; cancel_reason: string | null });

describe('cancel with a reason', () => {
  it('stores the reason and shows it to the organizer and to players', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const res = await cancel(ctx, s.id, { reason: 'Thanksgiving' });
    expect(res.status).toBe(200);
    expect(stored(ctx, s.id)).toEqual({ status: 'canceled', cancel_reason: 'Thanksgiving' });
    expect((await adminView(ctx, s.id)).cancelReason).toBe('Thanksgiving');
    const p = await playerView(ctx, s.id);
    expect(p.canceled).toBe(true);
    expect(p.cancelReason).toBe('Thanksgiving');
    // The Activity log keeps it too.
    const row = ctx.app.db.raw.prepare("SELECT details_json FROM admin_audit_log WHERE action = 'session_canceled'").get() as { details_json: string };
    expect(JSON.parse(row.details_json).reason).toBe('Thanksgiving');
  });

  it('is null with no reason, and for games that are not canceled', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    expect((await adminView(ctx, s.id)).cancelReason).toBeNull();
    expect((await playerView(ctx, s.id)).cancelReason).toBeNull();
    expect((await cancel(ctx, s.id)).status).toBe(200);
    expect(stored(ctx, s.id).cancel_reason).toBeNull();
    expect((await adminView(ctx, s.id)).cancelReason).toBeNull();
    expect((await playerView(ctx, s.id)).cancelReason).toBeNull();
  });

  it('treats an empty or whitespace-only reason as none', async () => {
    for (const reason of ['', '   ', ' \n\t ', null]) {
      const ctx = await setupGroup();
      const s = await firstSession(ctx);
      expect((await cancel(ctx, s.id, { reason })).status).toBe(200);
      expect(stored(ctx, s.id).cancel_reason).toBeNull();
    }
  });

  it('reopening clears it, and a later cancel can set a new one', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await cancel(ctx, s.id, { reason: 'Rain' });
    const re = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'reopen' });
    expect(re.status).toBe(200);
    expect(stored(ctx, s.id)).toEqual({ status: expect.stringMatching(/planned|booked/), cancel_reason: null });
    expect((await adminView(ctx, s.id)).cancelReason).toBeNull();
    expect((await playerView(ctx, s.id)).cancelReason).toBeNull();
    await cancel(ctx, s.id, { reason: 'Court closed' });
    expect(stored(ctx, s.id).cancel_reason).toBe('Court closed');
  });

  it('tidies the text: spaces collapsed, control characters dropped, cut to 40 characters', async () => {
    const ctx = await setupGroup();
    const sessions = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.filter((x: { startsAt: string }) => Date.parse(x.startsAt) > ctx.app.now);
    const cases: [string, string | null][] = [
      ['  Happy   Thanksgiving\nweek\r\n ', 'Happy Thanksgiving week'],
      ['A\u0000B\u0007C\u001bD\u007fE', 'ABCDE'],
      ['x'.repeat(60), 'x'.repeat(40)],
      ['word '.repeat(20), ('word '.repeat(20)).slice(0, 40).trim()],
      // 41 pizza emoji: cut by whole characters, never in the middle of one.
      ['🍕'.repeat(41), '🍕'.repeat(40)],
      ['a'.repeat(39) + '🍕🍕', 'a'.repeat(39) + '🍕'],
    ];
    for (const [i, [input, want]] of cases.entries()) {
      const id = sessions[i].id;
      expect((await cancel(ctx, id, { reason: input })).status, input).toBe(200);
      expect(stored(ctx, id).cancel_reason, input).toBe(want);
      expect(Array.from(stored(ctx, id).cancel_reason ?? '').length).toBeLessThanOrEqual(40);
      expect((await adminView(ctx, id)).cancelReason).toBe(want);
    }
  });

  it('keeps special characters as plain text, returned unchanged as data', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const weird = '<img src=x onerror=alert(1)> & "q"';
    expect(weird.length).toBeLessThanOrEqual(40);
    expect((await cancel(ctx, s.id, { reason: weird })).status).toBe(200);
    expect(stored(ctx, s.id).cancel_reason).toBe(weird);
    expect((await adminView(ctx, s.id)).cancelReason).toBe(weird);
    expect((await playerView(ctx, s.id)).cancelReason).toBe(weird);
  });

  it('rejects a reason that is not text with invalid_reason, and cancels nothing', async () => {
    for (const reason of [123, true, { a: 1 }, ['x']]) {
      const ctx = await setupGroup();
      const s = await firstSession(ctx);
      const res = await cancel(ctx, s.id, { reason });
      expect(res.status).toBe(400);
      expect(res.data.error).toBe('invalid_reason');
      expect(stored(ctx, s.id)).toEqual({ status: expect.not.stringMatching(/canceled/), cancel_reason: null });
    }
  });

  it('does not change who is credited and ignores reason for other decisions', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    await cancel(ctx, s.id, { reason: 'Holiday' });
    const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(dash.creditLedger.find((l: { playerId: string }) => l.playerId === ctx.byName.Alex).balanceCents).toBeGreaterThan(0);
    const s2 = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.filter((x: { startsAt: string; id: string }) => Date.parse(x.startsAt) > ctx.app.now && x.id !== s.id)[0];
    await ctx.organizer.call('POST', `/api/admin/sessions/${s2.id}/decision`, { decision: 'keep', reason: 'ignored' });
    expect(stored(ctx, s2.id).cancel_reason).toBeNull();
  });
});

describe('migration 0014', () => {
  it('is additive: one nullable column, rows and other columns unchanged', () => {
    const dir = join(process.cwd(), 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain('0014_cancel_reason.sql');
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    for (const f of files.filter((n) => n < '0014')) db.exec(readFileSync(join(dir, f), 'utf8'));
    db.exec("INSERT INTO groups (id, name, group_key, admin_pin_hash, created_at) VALUES ('g1','G','k1','h','2026-01-01T00:00:00Z')");
    const before = db.prepare("PRAGMA table_info(sessions)").all() as { name: string; type: string; notnull: number }[];
    const tablesBefore = (db.prepare("SELECT name FROM sqlite_master ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    db.exec(readFileSync(join(dir, '0014_cancel_reason.sql'), 'utf8'));
    const after = db.prepare("PRAGMA table_info(sessions)").all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
    expect(after.slice(0, before.length)).toEqual(expect.arrayContaining(before.map((c) => expect.objectContaining({ name: c.name, type: c.type, notnull: c.notnull }))));
    expect(after.length).toBe(before.length + 1);
    const added = after.find((c) => c.name === 'cancel_reason')!;
    expect(added).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
    expect((db.prepare("SELECT name FROM sqlite_master ORDER BY name").all() as { name: string }[]).map((r) => r.name)).toEqual(tablesBefore);
    const sql = readFileSync(join(dir, '0014_cancel_reason.sql'), 'utf8').replace(/^--.*$/gm, '');
    expect(sql.match(/\b(ALTER|CREATE|DROP|UPDATE|INSERT|DELETE)\b/gi)).toEqual(['ALTER']);
  });

  it('keeps existing sessions and leaves their reason empty', () => {
    const dir = join(process.cwd(), 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const db = new DatabaseSync(':memory:');
    for (const f of files.filter((n) => n < '0014')) db.exec(readFileSync(join(dir, f), 'utf8'));
    db.exec("INSERT INTO groups (id, name, group_key, admin_pin_hash, created_at) VALUES ('g1','G','k1','h','2026-01-01T00:00:00Z')");
    db.exec("INSERT INTO sessions (id, group_id, starts_at, ends_at, status, created_at, updated_at) VALUES ('s1','g1','2026-11-03T23:00:00Z','2026-11-04T01:00:00Z','canceled','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')");
    db.exec(readFileSync(join(dir, '0014_cancel_reason.sql'), 'utf8'));
    const rows = db.prepare('SELECT id, status, cancel_reason FROM sessions').all();
    expect(rows).toEqual([{ id: 's1', status: 'canceled', cancel_reason: null }]);
  });
});
