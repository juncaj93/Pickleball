import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { createSandbox, type Sandbox } from '../src/demo/sandbox';
import { DAY, HOUR, ORIGIN, firstSession, playerPhone, setupGroup } from './harness';

// The organizer's demo ("View as..." and "Pretend it's..."): taps run the real
// rules on a throwaway copy. The real database must not change at all.

const TABLES = ['groups', 'players', 'sessions', 'session_players', 'credits', 'session_action_tokens', 'player_devices', 'admin_audit_log', 'admin_sessions', 'rate_events', 'login_attempts'];
type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const snapshot = (ctx: Ctx) => Object.fromEntries(TABLES.map((t) => [t, ctx.app.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const migrations = () => readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join('migrations', f), 'utf8'));

async function demo(ctx: Ctx): Promise<Sandbox> {
  const backup = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
  return createSandbox(await initSqlJs(), backup, migrations(), ORIGIN);
}
async function call(sb: Sandbox, now: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await sb.request(method, path, body, headers, now);
  return { status: res.status, data: await res.json() };
}

describe('demo copy', () => {
  it('player taps in View as work on the copy (4 or 6, waitlist, I paid) and the real data never changes', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    const before = snapshot(ctx);
    const sb = await demo(ctx);
    const now = ctx.app.now;
    const as = (name: string) => ({ 'X-View-As': ctx.byName[name] });
    // Emery: 5th, waits. Frankie: 6th, brings both in.
    expect((await call(sb, now, 'POST', `/api/sessions/${s.id}/join`, {}, as('Emery'))).data).toEqual({ result: 'waitlisted', position: 1 });
    expect((await call(sb, now, 'POST', `/api/sessions/${s.id}/join`, {}, as('Frankie'))).data).toMatchObject({ result: 'confirmed', madeSix: true });
    let g = (await call(sb, now, 'GET', '/api/group', undefined, as('Frankie'))).data;
    let row = g.sessions.find((x: any) => x.id === s.id);
    expect(row.confirmed.length).toBe(6);
    expect(row.mine.oweCents).toBe(900);
    expect((await call(sb, now, 'POST', `/api/sessions/${s.id}/paid`, { paid: true }, as('Frankie'))).status).toBe(200);
    g = (await call(sb, now, 'GET', '/api/group', undefined, as('Frankie'))).data;
    row = g.sessions.find((x: any) => x.id === s.id);
    expect(row.mine.paymentStatus).toBe('paid');
    expect(row.mine.selfPaid).toBe(true);
    // Devon drops: 5 going, nothing moves by itself.
    await call(sb, now, 'POST', `/api/sessions/${s.id}/withdraw`, {}, as('Devon'));
    const d = (await call(sb, now, 'GET', '/api/admin/dashboard')).data;
    expect(d.sessions.find((x: any) => x.id === s.id).state.flags.fiveGoing).toBe(true);
    // The demo has its own Activity; the real one has nothing new.
    expect(d.audit.some((a: any) => a.action === 'player_self_paid')).toBe(true);
    expect(snapshot(ctx)).toEqual(before);
    const real = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(real.sessions.find((x: any) => x.id === s.id).confirmedCount).toBe(4);
  });

  it('organizer taps work on the copy (Mark paid, Unmark, Refunded, Add game, Move, Cancel, I booked it, settings) and the real data never changes', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    const before = snapshot(ctx);
    const sb = await demo(ctx);
    const now = ctx.app.now;
    const ok = async (method: string, path: string, body?: unknown) => {
      const r = await call(sb, now, method, path, body);
      expect(r.status, `${method} ${path}: ${JSON.stringify(r.data)}`).toBe(200);
      return r.data;
    };
    await ok('POST', `/api/admin/sessions/${s.id}/booked`, {});
    await ok('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    await ok('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    await ok('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: false });
    const game = await ok('POST', '/api/admin/sessions', { startsAt: new Date(now + 5 * DAY).toISOString(), endsAt: new Date(now + 5 * DAY + 2 * HOUR).toISOString(), note: 'Demo' });
    const later = (await ok('GET', '/api/admin/dashboard')).sessions.filter((x: any) => Date.parse(x.startsAt) > now + 2 * DAY && !x.extra);
    await ok('PUT', `/api/admin/sessions/${later[0].id}/time`, { startsAt: new Date(Date.parse(later[0].startsAt) + DAY).toISOString(), endsAt: new Date(Date.parse(later[0].endsAt) + DAY).toISOString() });
    await ok('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    await ok('POST', `/api/admin/sessions/${s.id}/refund`, { playerId: ctx.byName.Alex, refunded: true });
    await ok('PUT', '/api/admin/group', { name: 'Demo name' });
    await ok('POST', '/api/admin/players', { name: 'Demo Person' });
    const d = await ok('GET', '/api/admin/dashboard');
    expect(d.group.name).toBe('Demo name');
    expect(d.sessions.some((x: any) => x.id === game.id && x.extra)).toBe(true);
    expect(d.sessions.find((x: any) => x.id === s.id).status).toBe('canceled');
    expect(d.players.some((p: any) => p.name === 'Demo Person')).toBe(true);
    expect(snapshot(ctx)).toEqual(before);
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.group.name).toBe('Tuesday Thursday Dinks');
  });

  it('with Pretend it\'s..., taps happen at the pretend time: credits after a 6-player game, a late drop after the deadline', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    const before = snapshot(ctx);
    const sb = await demo(ctx);
    // 9:00 AM on game day, after the 8:00 AM deadline: Frankie drops (a late drop).
    const nineAm = Date.parse(s.startsAt) - 11 * HOUR;
    await call(sb, nineAm, 'POST', `/api/sessions/${s.id}/withdraw`, {}, { 'X-View-As': ctx.byName.Frankie });
    let d = (await call(sb, nineAm, 'GET', '/api/admin/dashboard')).data;
    expect(d.sessions.find((x: any) => x.id === s.id).roster.find((r: any) => r.name === 'Frankie').lateDropAt).toBe(new Date(nineAm).toISOString());
    // Back to 6, then the evening after the game: the first four get $5 credits.
    await call(sb, nineAm, 'POST', `/api/sessions/${s.id}/join`, {}, { 'X-View-As': ctx.byName.Frankie });
    d = (await call(sb, Date.parse(s.endsAt) + HOUR, 'GET', '/api/admin/dashboard')).data;
    expect(d.credits.map((c: any) => c.balanceCents)).toEqual([500, 500, 500, 500]);
    expect(snapshot(ctx)).toEqual(before);
  });

  it('players and strangers cannot read the snapshot the demo starts from', async () => {
    const ctx = await setupGroup();
    expect((await (await playerPhone(ctx, 'Alex')).call('GET', '/api/admin/backup')).status).toBe(401);
  });
});
