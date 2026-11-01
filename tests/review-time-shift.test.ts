// Fresh review of "time may shift" (Nov 1 2026). Plain `it`: properties checked and holding.
// `it.fails`: a problem found in review; it passes while the problem is there and starts failing once fixed
// (then turn it into a plain `it`).
import { describe, expect, it } from 'vitest';
import { DAY, HOUR, playerPhone, setupGroup, TestApp, withoutIds } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const adminGame = async (ctx: Ctx, id: string) => (await dash(ctx)).sessions.find((x: any) => x.id === id);
const myGame = async (phone: any, id: string) => (await phone.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === id);
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const moveTo = (ctx: Ctx, id: string, startsAt: string) => ctx.organizer.call('PUT', `/api/admin/sessions/${id}/time`, { startsAt, endsAt: plus(startsAt, 2 * HOUR) });
const roster = (ctx: Ctx, id: string, playerId: string, action: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/roster`, { playerId, action });

async function world(maxPlayers = 4) {
  const app = new TestApp();
  const ctx = await setupGroup(app);
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex', settings: { maxPlayers } });
  await ctx.organizer.call('PUT', '/api/admin/time-shift', { on: true });
  const d = await dash(ctx);
  const later = d.sessions.filter((x: any) => Date.parse(x.startsAt) > app.now + 7 * DAY);
  const phones: Record<string, any> = {};
  for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) phones[n] = await playerPhone(ctx, n);
  return { ctx, s: later[0], other: later[1], phones };
}

function seatsAndMoney(ctx: Ctx) {
  const raw = ctx.app.db.raw;
  return JSON.stringify([
    raw.prepare('SELECT id, kind, amount_cents, ended_at FROM credit_ledger ORDER BY id').all(),
    raw.prepare('SELECT session_id, player_id, status, payment_status, payment_amount_cents, confirm_seq, claim_seq FROM session_players ORDER BY session_id, player_id').all(),
  ]);
}

describe('review: holds', () => {
  it('a move onto another game\'s start (time_taken) rolls back the time_confirmed fill too', async () => {
    const { ctx, s, other, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    const before = ctx.app.db.raw.prepare('SELECT time_confirmed FROM session_players WHERE session_id = ?').all(s.id);
    const res = await moveTo(ctx, s.id, other.startsAt);
    expect(res.status).toBe(409);
    expect(res.text).toMatch(/time_taken/);
    expect(ctx.app.db.raw.prepare('SELECT time_confirmed FROM session_players WHERE session_id = ?').all(s.id)).toEqual(before);
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();
  });

  it('players never get phone numbers or the Waiting on list; View as cannot save Still in', async () => {
    const { ctx, s, phones } = await world();
    for (const n of ['Blair', 'Casey']) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    await moveTo(ctx, s.id, plus(s.startsAt, HOUR));
    expect((await adminGame(ctx, s.id)).timeCheck.waiting.length).toBe(2);
    const text = withoutIds((await phones.Blair.call('GET', '/api/group')).text);
    expect(text).not.toMatch(/555-01|timeCheck|waiting"/);
    const m = seatsAndMoney(ctx);
    const viewAs = await ctx.organizer.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: plus(s.startsAt, HOUR) }, { 'X-View-As': ctx.byName.Casey });
    expect(viewAs.status).toBe(403);
    expect(seatsAndMoney(ctx)).toBe(m);
    expect((await myGame(phones.Casey, s.id)).timeAsk).not.toBeNull();
  });
});

describe('review: problems', () => {
  // Deployed before migration 0016: the stamps fall back, but roster writes name the column unconditionally.
  async function premigration() {
    const w = await world();
    w.ctx.app.db.raw.exec('ALTER TABLE session_players DROP COLUMN time_confirmed');
    return w;
  }

  it('without migration 0016 the reads still work', async () => {
    const { ctx, s, phones } = await premigration();
    expect((await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    expect((await phones.Blair.call('GET', '/api/group')).status).toBe(200);
    expect((await phones.Blair.call('GET', '/api/group/version')).status).toBe(200);
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).status).toBe(200);
    expect((await ctx.organizer.call('GET', '/api/admin/version')).status).toBe(200);
  });

  // Accepted on purpose: migration 0016 always goes on before this code is deployed (STAGE_NOTES, RUNBOOK_TUESDAY).
  it.fails('without migration 0016: rejoin after a drop (I\'m in again) works', async () => {
    const { s, phones } = await premigration();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await phones.Blair.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const res = await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    expect(res.status, res.text).toBe(200); // today: 500 "no such column: time_confirmed"
  });

  it.fails('without migration 0016: the organizer can move a game with players in', async () => {
    const { ctx, s, phones } = await premigration();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    const res = await moveTo(ctx, s.id, plus(s.startsAt, HOUR));
    expect(res.status, res.text).toBe(200); // today: 500
  });

  it('organizer: To waitlist then In for someone who never answered the new time keeps them waiting on it', async () => {
    const { ctx, s, phones } = await world();
    for (const n of ['Blair', 'Casey']) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    await moveTo(ctx, s.id, plus(s.startsAt, HOUR));
    expect((await adminGame(ctx, s.id)).timeCheck.waiting.map((w: any) => w.name)).toEqual(['Blair', 'Casey']);
    await roster(ctx, s.id, ctx.byName.Blair, 'waitlist');
    expect((await roster(ctx, s.id, ctx.byName.Blair, 'confirm')).status).toBe(200);
    // Blair never said Still in to the new time, yet the organizer's In (tryConfirm) cleared it: no notice, and
    // "Waiting on Blair" is gone from the admin card.
    expect((await myGame(phones.Blair, s.id)).timeAsk).not.toBeNull();
  });

  it('back to the time a player joined at, after they said Still in to the move, asks nothing', async () => {
    const { ctx, s, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    const b = plus(s.startsAt, HOUR);
    await moveTo(ctx, s.id, b);
    await phones.Blair.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: b });
    await moveTo(ctx, s.id, s.startsAt);
    // SPEC 3: "back to a time a player already confirmed ... stays confirmed"; joining counts as confirming.
    // One stored value keeps only the last answer, so Blair is asked again "Was 8 PM" for the time they joined at.
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();
  });
});
