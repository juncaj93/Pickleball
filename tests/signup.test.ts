import { describe, expect, it } from 'vitest';
import { DAY, firstSession, playerPhone, setupGroup, SETUP_TOKEN, TestApp } from './harness';

describe('setup', () => {
  it('creates the group, six players, and six weeks of sessions', async () => {
    const ctx = await setupGroup();
    expect(ctx.players.map((p) => p.name)).toEqual(['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    expect(ctx.dashboard.sessions).toHaveLength(12);
    expect(ctx.dashboard.group.playerLink).toMatch(/^https:\/\/club\.example\/g\/[A-Za-z0-9_-]{24}$/);
  });

  it('only works once and needs the setup code', async () => {
    const app = new TestApp();
    const c = app.client();
    const wrong = await c.call('POST', '/api/setup', { setupToken: 'nope', groupName: 'X', pin: '123456', players: [{ name: 'A' }] });
    expect(wrong.status).toBe(401);
    await setupGroup(app);
    const again = await c.call('POST', '/api/setup', { setupToken: SETUP_TOKEN, groupName: 'X', pin: '123456', players: [{ name: 'A' }] });
    expect(again.status).toBe(409);
  });

  it('refuses setup when no SETUP_TOKEN is configured', async () => {
    const app = new TestApp();
    (app.env as any).SETUP_TOKEN = undefined;
    const res = await app.client().call('POST', '/api/setup', { setupToken: '', groupName: 'X', pin: '123456', players: [{ name: 'A' }] });
    expect(res.status).toBe(503);
  });

  it('does not duplicate sessions when pages reload or generation reruns', async () => {
    const ctx = await setupGroup();
    for (let i = 0; i < 3; i++) {
      await ctx.organizer.call('POST', '/api/admin/sessions/generate', {});
      const p = ctx.app.client();
      p.groupKey = ctx.groupKey;
      await p.call('GET', '/api/group');
    }
    const count = ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(count.n).toBe(12);
  });

  it('rolls the horizon forward as time passes', async () => {
    const ctx = await setupGroup();
    ctx.app.advance(7 * DAY);
    await ctx.organizer.call('GET', '/api/admin/dashboard');
    const count = ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(count.n).toBe(14);
  });
});

describe('claiming spots and the waitlist', () => {
  it('confirms the first four players and waitlists the rest in order', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const results: any[] = [];
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) {
      const phone = await playerPhone(ctx, name);
      results.push((await phone.call('POST', `/api/sessions/${s.id}/join`, {})).data);
    }
    expect(results.slice(0, 4)).toEqual(Array(4).fill({ result: 'confirmed' }));
    expect(results[4]).toEqual({ result: 'waitlisted', position: 1 });
    expect(results[5]).toEqual({ result: 'waitlisted', position: 2 });

    const view = await (await playerPhone(ctx, 'Frankie')).call('GET', '/api/group');
    const session = view.data.sessions.find((x: any) => x.id === s.id);
    expect(session.confirmed.map((c: any) => c.name)).toEqual(['Alex', 'Blair', 'Casey', 'Devon']);
    expect(session.waitlist.map((c: any) => c.name)).toEqual(['Emery', 'Frankie']);
    expect(session.mine).toMatchObject({ status: 'waitlisted', waitlistPosition: 2 });
  });

  it('is idempotent: tapping twice never takes two spots', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'confirmed' });
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'already_confirmed' });
    await Promise.all([alex.call('POST', `/api/sessions/${s.id}/join`, {}), alex.call('POST', `/api/sessions/${s.id}/join`, {})]);
    const rows = ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM session_players WHERE session_id = ?').get(s.id) as { n: number };
    expect(rows.n).toBe(1);
  });

  it('frees a spot on withdrawal, and a substitute can take it', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const phones: Record<string, any> = {};
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) {
      phones[name] = await playerPhone(ctx, name);
      await phones[name].call('POST', `/api/sessions/${s.id}/join`, {});
    }
    expect((await phones.Blair.call('POST', `/api/sessions/${s.id}/withdraw`, {})).data).toEqual({ result: 'withdrawn' });
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const after = dash.data.sessions.find((x: any) => x.id === s.id);
    expect(after.confirmedCount).toBe(3);
    expect(after.state.flags.openSpots).toBe(1);
    expect(after.eligibleSubstitutes[0]).toMatchObject({ name: 'Emery', source: 'waitlist' });
    expect(after.eligibleSubstitutes.map((e: any) => e.name)).toContain('Blair');

    // Emery (waitlisted) taps "Claim open spot".
    expect((await phones.Emery.call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'confirmed' });
  });

  it('lets exactly one of two simultaneous claims win the last spot', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey']) {
      await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${s.id}/join`, {});
    }
    const links = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/links`, { kind: 'claim' });
    const emeryLink = links.data.drafts.find((d: any) => d.name === 'Emery').url.split('/t/')[1];
    const frankieLink = links.data.drafts.find((d: any) => d.name === 'Frankie').url.split('/t/')[1];
    const devonLink = links.data.drafts.find((d: any) => d.name === 'Devon').url.split('/t/')[1];
    const anon = ctx.app.client();
    const results = await Promise.all([
      anon.call('POST', '/api/link/act', { token: emeryLink, action: 'claim' }),
      anon.call('POST', '/api/link/act', { token: frankieLink, action: 'claim' }),
      anon.call('POST', '/api/link/act', { token: devonLink, action: 'claim' }),
    ]);
    const outcomes = results.map((r) => r.data.outcome).sort();
    expect(outcomes).toEqual(['claimed', 'spot_taken', 'spot_taken']);
    const n = ctx.app.db.raw
      .prepare("SELECT COUNT(*) AS n FROM session_players WHERE session_id = ? AND status = 'confirmed'")
      .get(s.id) as { n: number };
    expect(n.n).toBe(4);
  });

  it('blocks a fifth confirmed player at the database level', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const insert = ctx.app.db.raw.prepare(
      "INSERT INTO session_players (id, session_id, player_id, status, claimed_at, updated_at) VALUES (?, ?, ?, 'confirmed', '2026-01-01', '2026-01-01')",
    );
    ctx.players.slice(0, 4).forEach((p, i) => insert.run(`row-${i}`, s.id, p.id));
    expect(() => insert.run('row-5', s.id, ctx.players[4].id)).toThrow(/session_full/);
  });

  it('does not let anyone join a canceled or started session', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(409);

    const next = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions[1];
    ctx.app.now = Date.parse(next.startsAt) + 60_000;
    expect((await alex.call('POST', `/api/sessions/${next.id}/join`, {})).data.error).toBe('session_started');
  });

  it('records attendance confirmations', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('POST', `/api/sessions/${s.id}/confirm`, {})).status).toBe(409);
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await alex.call('POST', `/api/sessions/${s.id}/confirm`, {})).data).toEqual({ result: 'confirmed_attendance' });
    const view = await alex.call('GET', '/api/group');
    expect(view.data.sessions.find((x: any) => x.id === s.id).mine.attendanceConfirmed).toBe(true);
  });
});
