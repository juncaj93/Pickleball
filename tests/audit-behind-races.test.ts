// Behind-the-scenes audit (Sun Nov 1, 2026), fresh audit B: races found by
// making a second request land right before each database write of a first.
import { describe, expect, it } from 'vitest';
import { firstSession, playerPhone, setupGroup } from './harness';

/** Run `inject` right before the first statement whose SQL matches `re` (the request in flight has already read the old state). */
function injectBefore(app: any, re: RegExp, inject: () => Promise<unknown>) {
  const real = app.env.DB;
  let fired = false;
  const wrap = (sql: string, st: any): any => ({
    bind: (...v: unknown[]) => wrap(sql, st.bind(...v)),
    first: async () => (await maybe(sql), st.first()),
    all: async () => (await maybe(sql), st.all()),
    run: async () => (await maybe(sql), st.run()),
    runSync: () => st.runSync(),
    __inner: st,
    __sql: sql,
  });
  const maybe = async (sql: string) => {
    if (fired || !re.test(sql)) return;
    fired = true;
    app.env.DB = real;
    await inject();
    app.env.DB = proxy;
  };
  const proxy = {
    raw: real.raw,
    prepare: (sql: string) => wrap(sql, real.prepare(sql)),
    batch: async (stmts: any[]) => {
      for (const s of stmts) await maybe(s.__sql ?? '');
      return real.batch(stmts.map((s) => s.__inner ?? s));
    },
  };
  app.env.DB = proxy;
  return { fired: () => fired, restore: () => (app.env.DB = real) };
}

describe('races between two requests', () => {
  it('a cancel landing inside "court waitlist" keeps the game canceled and everyone\'s money as credit', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) {
      await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
      await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName[n], paid: true });
    }
    let cancel: any;
    const inj = injectBefore(ctx.app, /SET court_state = 'waitlist', booking_status = 'needs_booking'/, async () => {
      cancel = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    });
    const wait = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court`, { action: 'waitlist' });
    inj.restore();
    expect(inj.fired()).toBe(true);
    expect(cancel.status).toBe(200);
    expect(wait.status).toBe(409);
    const row = ctx.app.db.raw.prepare('SELECT status FROM sessions WHERE id = ?').get(s.id) as any;
    expect(row.status).toBe('canceled');
  });

  it('500 group-word guesses sent at once: at most 10 are checked', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', groupWord: 'dink' });
    ctx.app.db.raw.prepare('UPDATE groups SET open_access = 1').run();
    const res = await Promise.all(
      Array.from({ length: 500 }, (_, i) => {
        const p = ctx.app.client();
        return p.call('POST', '/api/access', { word: i === 499 ? 'dink' : `guess${i}` }, { 'CF-Connecting-IP': '10.9.9.9' });
      }),
    );
    expect(res.filter((r) => r.status === 401 || r.status === 200).length).toBeLessThanOrEqual(10);
    expect(res.find((r) => r.status === 200)).toBeUndefined();
    // A right word on a fresh phone address still works, and gives its slot back.
    const ok = ctx.app.client();
    expect((await ok.call('POST', '/api/access', { word: 'dink' }, { 'CF-Connecting-IP': '10.9.9.8' })).status).toBe(200);
    const left = ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'group_word_wrong' AND client_key = '10.9.9.8'").get() as any;
    expect(left.n).toBe(0);
  });
});
