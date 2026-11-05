// Final review helper: with MONEY_REWORK off (ship state), dump what the server answers for a busy scenario. The same file runs on main
// (output path in DUMP_OUT) and the two dumps are compared by hand; without DUMP_OUT it only checks that loading screens writes nothing.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const norm = (x: unknown) => {
  const ids = new Map<string, string>();
  return JSON.stringify(x, null, 1).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => {
    if (!ids.has(m)) ids.set(m, `<id${ids.size}>`);
    return ids.get(m)!;
  }).replace(/"(privateLink|playerLink|token|key)": "[^"]*"/g, '"$1": "<x>"');
};

describe('review-final: ship state (switch off)', () => {
  it('Z1 dump + loading screens writes nothing', async () => {
    const app = new TestApp();
    const w = await setupGroup(app);
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    await w.organizer.call('PUT', '/api/admin/late-fees', { on: true });
    const s0 = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/booked`, {});
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s0.id}/join`, {});
    let sv = (await w.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((s: any) => s.id === s0.id);
    for (const n of ['Blair', 'Casey']) {
      const r = sv.roster.find((x: any) => x.name === n);
      await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    }
    app.now = Date.parse(s0.endsAt) + HOUR;
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    const games = (await w.organizer.call('GET', '/api/admin/dashboard')).data.sessions.filter((s: any) => Date.parse(s.startsAt) > app.now);
    const g = games[1];
    await w.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    await (await playerPhone(w, 'Frankie')).call('POST', `/api/sessions/${g.id}/join`, {});
    app.now = Date.parse(g.startsAt) - 5 * HOUR;
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    const c = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false, chargedCents: 4800 });
    expect(c.status, c.text).toBe(200);
    const snap = () => JSON.stringify(['sessions', 'session_players', 'credit_ledger', 'task_log', 'admin_audit_log', 'players', 'groups'].map((t) => app.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    await w.organizer.call('GET', '/api/admin/dashboard'); // ensureSessions may add games the clock reached
    const before = snap();
    const month = new Date(s0.startsAt).toISOString().slice(0, 7);
    const out: Record<string, unknown> = {};
    out.dashboard = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    out.money = (await w.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
    out.activity = (await w.organizer.call('GET', '/api/admin/activity')).data;
    out.version = (await w.organizer.call('GET', '/api/admin/version')).status;
    expect(snap()).toBe(before);
    if (process.env.DUMP_OUT) writeFileSync(process.env.DUMP_OUT, norm(out));
  });
});
