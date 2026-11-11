// "Admin screens, round 3" (ADMIN_R3, Nov 2026): the switch, the Players "spent" number, and the proof that it changes no money.
// The screens themselves are checked in e2e/admin-r3.cjs. Display only: nothing saved, charged or sent may depend on it.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_R2_HEADER } from '../shared/adminR2';
import { ADMIN_R3_HEADER, adminR3Allowed } from '../shared/adminR3';
import { firstSession, PIN, playerPhone, setupGroup, TestApp } from './harness';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  return setupGroup(app);
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = {}) => {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const r2 = { [ADMIN_R2_HEADER]: 'on' };
const both = { [ADMIN_R2_HEADER]: 'on', [ADMIN_R3_HEADER]: 'on' };
const r3only = { [ADMIN_R3_HEADER]: 'on' };

describe('ADMIN_R3 switch', () => {
  it('S1 the var is allowed unless it says off', () => {
    expect(adminR3Allowed(undefined)).toBe(true);
    expect(adminR3Allowed('on')).toBe(true);
    expect(adminR3Allowed(' OFF ')).toBe(false);
  });
  it('S2 ship state: off for everyone', async () => {
    const d = await dash(await world());
    expect(d.adminR3).toBe(false);
    expect(d.adminR3ForAll).toBe(false);
    expect(d.players.every((p: any) => p.spentCents === undefined)).toBe(true);
  });
  it('S3 the private header turns it on for that request only, and only with round 2 on too', async () => {
    const w = await world();
    expect((await dash(w, both)).adminR3).toBe(true);
    expect((await dash(w, r3only)).adminR3).toBe(false);
    expect((await dash(w, { ...both, [ADMIN_R3_HEADER]: 'yes' })).adminR3).toBe(false);
    expect((await dash(w, r2)).adminR3).toBe(false);
    expect((await dash(w)).adminR3).toBe(false);
  });
  it('S4 the Settings switch turns it on for everyone (with round 2), and off again, no deploy', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/admin-r3', { on: true })).status).toBe(200);
    let d = await dash(w, r2);
    expect(d.adminR3).toBe(true);
    expect(d.adminR3ForAll).toBe(true);
    // Round 2 off: the round 3 screens do not show (they only rearrange round 2 screens).
    expect((await dash(w)).adminR3).toBe(false);
    await w.organizer.call('PUT', '/api/admin/admin-r3', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'admin_r3_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/admin-r3', { on: false })).status).toBe(200);
    d = await dash(w, r2);
    expect(d.adminR3).toBe(false);
    expect(d.adminR3ForAll).toBe(false);
  });
  it('S5 the kill switch beats both the header and Settings', async () => {
    const w = await world({ ADMIN_R3: 'off' });
    await w.organizer.call('PUT', '/api/admin/admin-r3', { on: true });
    expect((await dash(w, both)).adminR3).toBe(false);
    expect((await dash(w, r2)).adminR3).toBe(false);
  });
  it('S6 the change shows in Activity', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/admin-r3', { on: true });
    const act = await w.organizer.call('GET', '/api/admin/activity');
    expect(act.data.entries.some((e: { action: string }) => e.action === 'admin_r3_on')).toBe(true);
  });
  it('S7 only the organizer can flip it', async () => {
    const w = await world();
    expect((await w.app.client().call('PUT', '/api/admin/admin-r3', { on: true })).status).toBe(401);
  });
  it('S8 no migration was added for it', () => {
    const files = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
    expect(files.filter((f) => f <= '0018_phone_tag.sql').at(-1)).toBe('0018_phone_tag.sql'); // Zip 33: newer migrations (0019, 0020) come from other zips, so look at the newest up to 0018 // Zip 14 added 0017 (the court column), Zip 30 0018 (the phone code); this feature itself still adds none
  });
});

/** Three players in a booked game, all paid $14; five play and it is finalized at $11 each. Returns the world. */
async function playedGame() {
  const w = await world();
  const names = ['Blair', 'Casey', 'Devon', 'Emery'];
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  const s0 = await firstSession(w);
  await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/booked`, {});
  for (const n of names) {
    const ph = await playerPhone(w, n);
    await ph.call('POST', `/api/sessions/${s0.id}/join`, {});
  }
  await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/me`, { in: true });
  const d = await dash(w);
  const sv = d.sessions.find((s: any) => s.id === s0.id);
  for (const n of ['Blair', 'Casey', 'Devon']) {
    const r = sv.roster.find((x: any) => x.name === n);
    const res = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    expect(res.status, res.text).toBe(200);
  }
  w.app.now = Date.parse(s0.endsAt) + 60 * 60_000;
  const fin = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
  expect(fin.status, fin.text).toBe(200);
  return { w, s0 };
}

describe('Players "spent" (round 3)', () => {
  it('P1 spent is what a player paid for games they played, net of what came back as credit; unpaid and the organizer count nothing', async () => {
    const { w } = await playedGame();
    const d = await dash(w, both);
    const by = (n: string) => d.players.find((p: any) => p.name === n);
    // Five played (four players and the organizer): price floor(4 x 14 / 5) = $11.
    for (const n of ['Blair', 'Casey', 'Devon']) {
      expect(by(n).spentCents, n).toBe(1100);
      expect(by(n).played, n).toBe(1);
    }
    // Emery was in but never paid: nothing spent (they owe). The organizer pays the venue: nothing.
    expect(by('Emery').spentCents).toBe(0);
    expect(by('Alex').spentCents).toBe(0);
    expect(by('Frankie').spentCents).toBe(0);
    // Same as the credit pot: $14 paid, $11 spent, $3 back.
    expect(d.creditLedger.find((l: any) => l.playerId === by('Blair').id).balanceCents).toBe(300);
  });
  it('P2 turning round 3 on changes no money, seat or amount anywhere (only the switch fields and spent appear)', async () => {
    const { w } = await playedGame();
    const strip = (x: Record<string, unknown>) => {
      const { adminR3, adminR3ForAll, version, now, players, ...rest } = x as any;
      return JSON.stringify({ ...rest, players: players.map(({ spentCents, ...p }: any) => p) });
    };
    expect(strip(await dash(w, both))).toBe(strip(await dash(w, r2)));
    const month = new Date(w.app.now).toISOString().slice(0, 7);
    const m1 = JSON.stringify((await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, both)).data);
    const m2 = JSON.stringify((await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, r2)).data);
    expect(m1).toBe(m2);
  });
  it('P3 reading the dashboard with round 3 on writes nothing', async () => {
    const { w } = await playedGame();
    await dash(w, both);
    const books = () =>
      JSON.stringify([
        w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all(),
        w.app.db.raw.prepare('SELECT * FROM session_players ORDER BY session_id, player_id').all(),
      ]);
    const before = books();
    await dash(w, both);
    expect(books()).toBe(before);
  });
});
