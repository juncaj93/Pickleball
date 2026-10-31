// Money audit (Oct 31, 2026): findings of the fresh code-reading audit, each
// pinned by a test that failed on the code before its fix.
import { describe, expect, it } from 'vitest';
import { potEffect } from '../shared/credit';
import type { D1Database } from '../server/db';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
type Ctx = Awaited<ReturnType<typeof setupGroup>>;

async function group(organizerName = 'Alex') {
  const ctx = await setupGroup(new TestApp());
  expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName })).status).toBe(200);
  return ctx;
}
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => dayOf(x.startsAt) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
const raw = (ctx: Ctx) => ctx.app.db.raw;
function givePot(ctx: Ctx, name: string, cents: number, oldId: string) {
  raw(ctx).exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}-${Math.random()}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${oldId}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}
function potOf(ctx: Ctx, name: string) {
  const rows = raw(ctx).prepare('SELECT * FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL').all(ctx.byName[name]) as any[];
  return rows.reduce((n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }), 0);
}
const seat = (ctx: Ctx, sid: string, name: string) =>
  raw(ctx).prepare('SELECT status, payment_status, payment_amount_cents, refunded_at FROM session_players WHERE session_id = ? AND player_id = ?').get(sid, ctx.byName[name]) as any;

/** Run `during` right before the first statement matching `re` runs (alone or in a batch). */
function pauseOn(ctx: Ctx, re: RegExp, during: () => Promise<unknown>) {
  const real = ctx.app.db as D1Database;
  let fired = false;
  const gate = async (sql: string) => {
    if (fired || !re.test(sql)) return;
    fired = true;
    await during();
  };
  const wrap = (st: any, sql: string): any => ({
    __inner: st,
    __sql: sql,
    bind: (...v: unknown[]) => wrap(st.bind(...v), sql),
    first: async () => (await gate(sql), st.first()),
    all: async () => (await gate(sql), st.all()),
    run: async () => (await gate(sql), st.run()),
  });
  ctx.app.env = {
    ...ctx.app.env,
    DB: {
      ...real,
      prepare: (sql: string) => wrap(real.prepare(sql), sql),
      batch: async (sts: any[]) => {
        for (const st of sts) await gate(st.__sql);
        return real.batch(sts.map((st) => st.__inner));
      },
    } as any,
  };
  return { fired: () => fired, restore: () => void (ctx.app.env = { ...ctx.app.env, DB: real }) };
}

describe('fresh code audit, Oct 31', () => {
  it('Use credit landing just after Finalize is refused: never $14 of credit on a seat now priced $9', async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${g.id}/join`, {});
    givePot(ctx, 'Blair', 1400, old.id); // credit that arrived after she joined
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    const blair = await playerPhone(ctx, 'Blair');
    const pause = pauseOn(ctx, /'used', \?4, \?5, \?6/, () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true }));
    const use = await blair.call('POST', `/api/sessions/${g.id}/use-credit`, {});
    pause.restore();
    expect(pause.fired()).toBe(true);
    expect(use.status).toBe(409);
    expect(potOf(ctx, 'Blair')).toBe(1400);
    // Looking again, Use credit spends the final $9 only.
    expect((await blair.call('POST', `/api/sessions/${g.id}/use-credit`, {})).data).toMatchObject({ ok: true, usedCents: 900, paid: true });
    expect(potOf(ctx, 'Blair')).toBe(500);
  });

  it("Players tab Undo of Mark refunded with the screen's refund id: a repeat takes back nothing more", async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    givePot(ctx, 'Blair', 1400, old.id);
    const refund = (body: object) => ctx.organizer.call('POST', `/api/admin/players/${ctx.byName.Blair}/credit-refund`, body);
    expect((await refund({ refunded: true, cents: 1400 })).status).toBe(200);
    givePot(ctx, 'Blair', 1400, old.id);
    expect((await refund({ refunded: true, cents: 1400 })).status).toBe(200);
    const ids = (raw(ctx).prepare("SELECT id FROM credit_ledger WHERE kind = 'refunded' ORDER BY rowid").all() as any[]).map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect((await refund({ refunded: false, ledgerId: ids[1] })).data).toMatchObject({ changed: true });
    expect((await refund({ refunded: false, ledgerId: ids[1] })).data).toMatchObject({ changed: false });
    expect(potOf(ctx, 'Blair')).toBe(1400); // the first refund (really sent) still counts
  });

  it("renaming the organizer in Settings never turns their court payment into a player's credit", async () => {
    const ctx = await group('Frankie');
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    // Court paid: the organizer's own row (not playing).
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Frankie, paid: true })).status).toBe(200);
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Frankie R.' })).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    expect(potOf(ctx, 'Frankie')).toBe(0);
    // And Frankie is still the organizer: never uses credit, never owes.
    const later = await on(ctx, '2026-11-05');
    givePot(ctx, 'Frankie', 1400, g.id);
    await ctx.organizer.call('POST', `/api/admin/sessions/${later.id}/me`, { in: true });
    expect((raw(ctx).prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'used' AND player_id = ?").get(ctx.byName.Frankie) as any).n).toBe(0);
  });

  it('Unmark of "Credit $3" racing Finalize gives the $3 back once, not twice', async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    givePot(ctx, 'Devon', 300, old.id);
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${g.id}/join`, {});
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    const played = ['Blair', 'Casey', 'Emery', 'Frankie'].map((n) => ctx.byName[n]); // Devon did not play
    const pause = pauseOn(ctx, /UPDATE credit_ledger SET ended_at = \?1, ended_reason = \?2/, () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played }));
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Devon, paid: false });
    pause.restore();
    expect(pause.fired()).toBe(true);
    expect(potOf(ctx, 'Devon')).toBe(300);
  });

  it('with the price set to $0, a player who has credit can still tap I\'m in', async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    givePot(ctx, 'Blair', 1400, old.id);
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 0 } })).status).toBe(200);
    const g = await on(ctx, '2026-11-03');
    const res = await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${g.id}/join`, {});
    expect(res.status, res.text).toBe(200);
    expect(potOf(ctx, 'Blair')).toBe(1400);
  });

  it('"I booked it" landing just after a cancel never brings the canceled game back', async () => {
    const ctx = await group();
    const g = await on(ctx, '2026-11-03');
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${g.id}/join`, {});
    const pause = pauseOn(ctx, /UPDATE sessions SET booking_status = 'booked'/, () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true }));
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    pause.restore();
    expect(pause.fired()).toBe(true);
    expect(res.status).toBe(409);
    expect((raw(ctx).prepare('SELECT status FROM sessions WHERE id = ?').get(g.id) as any).status).toBe('canceled');
    expect(seat(ctx, g.id, 'Blair').status).toBe('confirmed');
  });

  it('a mistyped organizer name corrected in Settings leaves that player a normal player (second pass)', async () => {
    const ctx = await group('Casey'); // a mistake: matches the player Casey
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' })).status).toBe(200);
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    const casey = await playerPhone(ctx, 'Casey');
    await casey.call('POST', `/api/sessions/${g.id}/join`, {});
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Casey, paid: true })).status).toBe(200);
    expect(seat(ctx, g.id, 'Casey').payment_amount_cents).toBe(1400); // a player's $14, not a court payment
    expect((await casey.call('POST', `/api/sessions/${g.id}/withdraw`, {})).data).toMatchObject({ creditBackCents: 1400 });
    expect(potOf(ctx, 'Casey')).toBe(1400);
  });

  it('Unmark of part credit racing Finalize on a seat that played makes no credit (second pass)', async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    givePot(ctx, 'Blair', 1000, old.id);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${g.id}/join`, {});
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    const pause = pauseOn(ctx, /UPDATE credit_ledger SET ended_at = \?1, ended_reason = \?2/, () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true }));
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false });
    pause.restore();
    expect(pause.fired()).toBe(true);
    // 5 played at $11: the $10 credit stays on the seat, Blair owes $1, nothing made.
    expect(potOf(ctx, 'Blair')).toBe(0);
    const mine = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).data.owed.find((o: any) => o.sessionId === g.id);
    expect(mine?.amountCents).toBe(100);
  });
});
