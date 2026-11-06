// Zip 10, "Card cleanup" (CARD_CLEANUP): no waitlist and no Max players cap behind one switch, both switch states, the private test
// link, the kill switch, the old waitlist moving in, prices with 11 and 12 players (normal and 1.5 hour games), and the credit chain
// with 11 and 12 players, all through the real API with real dollars. The card look is checked by the browser test (e2e/zip10.cjs).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alertMessage } from '../shared/alerts';
import { activityText } from '../shared/activity';
import { finalPrice, creditBack } from '../shared/pricing';
import { gameFinalPrice, gamePrice } from '../shared/gameLength';
import { capOf, DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';
import { wantInSubline } from '../shared/time';
import { DB_LIMIT_MESSAGE, NO_CAP_MAX, zip10Allowed } from '../shared/zip10';
import { DAY, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { byName: Record<string, string> };
type Phone = Awaited<ReturnType<typeof playerPhone>>;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee', 'Max', 'Nico'];
const ON = { 'X-Card-Cleanup': 'on' };

async function group(): Promise<Ctx> {
  const ctx = (await setupGroup()) as Ctx;
  ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
  for (const name of MORE) await ctx.organizer.call('POST', '/api/admin/players', { name, phone: null });
  // The organizer is not one of the players, so N is just the players.
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' });
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  ctx.byName = Object.fromEntries(dash.data.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  return ctx;
}
const ALL = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
const dashboard = async (ctx: Ctx, headers: Record<string, string> = {}) => (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const game = async (ctx: Ctx, id: string) => (await dashboard(ctx)).sessions.find((s: any) => s.id === id);
const potOf = async (ctx: Ctx, name: string) => (await dashboard(ctx)).creditLedger.find((l: any) => l.playerId === ctx.byName[name])?.balanceCents ?? 0;
const phonesOf = async (ctx: Ctx) => {
  const out: Record<string, Phone> = {};
  for (const n of ALL) out[n] = await playerPhone(ctx, n);
  return out;
};
const upcoming = async (ctx: Ctx) => (await dashboard(ctx)).sessions.filter((s: any) => Date.parse(s.startsAt) > ctx.app.now && !s.state.flags.canceled);

/** An extra game on a day from now, 7:30 PM Eastern, `minutes` long. */
async function addGame(ctx: Ctx, daysAhead: number, minutes: number): Promise<string> {
  const day = new Date(ctx.app.now + daysAhead * DAY).toISOString().slice(0, 10);
  const startsAt = new Date(Date.parse(`${day}T00:30:00.000Z`) + DAY).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
  const res = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt, note: null });
  expect(res.status, res.text).toBe(200);
  return (await dashboard(ctx)).sessions.find((x: any) => x.startsAt === startsAt).id;
}

describe('the pieces (shared)', () => {
  it('capOf: the saved Max players with the switch off; the database limit (12) with it on, whatever Max players says', () => {
    expect(capOf(DEFAULT_SETTINGS)).toBe(10);
    expect(capOf({ maxPlayers: 6 })).toBe(6);
    expect(capOf({ maxPlayers: 6, noCap: true })).toBe(12);
    expect(NO_CAP_MAX).toBe(12);
    // Never saved: a settings save drops it (and keeps the real Max players).
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, noCap: true, maxPlayers: 8 })).not.toHaveProperty('noCap');
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, noCap: true, maxPlayers: 8 }).maxPlayers).toBe(8);
  });

  it('the kill switch: allowed unless "off"', () => {
    expect(zip10Allowed(undefined)).toBe(true);
    expect(zip10Allowed('on')).toBe(true);
    expect(zip10Allowed(' OFF ')).toBe(false);
  });

  it('the refusal at 13 never says "full" or "waitlist"', () => {
    expect(DB_LIMIT_MESSAGE).toMatch(/12/);
    expect(DB_LIMIT_MESSAGE).not.toMatch(/full|waitlist|standby/i);
  });

  it('Telegram: with no waitlist, a drop never says "moved up from the waitlist"', () => {
    const base = {
      actor: { playerId: 'a', name: 'Ann' },
      before: [{ playerId: 'a', name: 'Ann' }, { playerId: 'b', name: 'Bo' }, { playerId: 'c', name: 'Cy' }, { playerId: 'd', name: 'Di' }],
      after: [{ playerId: 'b', name: 'Bo' }, { playerId: 'c', name: 'Cy' }, { playerId: 'd', name: 'Di' }, { playerId: 'e', name: 'Ed' }],
      startsAt: '2026-11-10T01:00:00.000Z',
      deadlineMs: Date.parse('2026-11-09T13:00:00.000Z'),
      nowMs: Date.parse('2026-11-09T20:00:00.000Z'),
      timezone: 'America/Detroit',
      prefs: { enabled: true, drop36: true, belowMin: true, reachedMin: true } as any,
    };
    expect(alertMessage(base)).toMatch(/moved up from the waitlist/);
    const off = alertMessage({ ...base, noWaitlist: true })!;
    expect(off).not.toMatch(/waitlist/i);
    expect(off).toMatch(/Ann dropped out/);
    expect(off).toMatch(/4 in now\./);
  });

  it('the "Want in?" line: no waitlist past the old max with no cap', () => {
    expect(wantInSubline(10, 10)).toMatch(/waitlist/);
    expect(wantInSubline(10, Number.POSITIVE_INFINITY)).toBe("10 are in. You'd make it 11.");
    expect(wantInSubline(12, Number.POSITIVE_INFINITY)).toBe("12 are in. You'd make it 13.");
  });

  it('Activity lines for the Settings row', () => {
    const e = (action: string) => ({ action, actor: 'organizer', at: '2026-11-06T15:00:00.000Z', details: {}, sessionStartsAt: null }) as any;
    expect(activityText(e('card_cleanup_on'), 'America/Detroit', 'Alex')).toMatch(/switched "Card cleanup" on/);
    expect(activityText(e('card_cleanup_off'), 'America/Detroit', 'Alex')).toMatch(/switched "Card cleanup" off/);
  });

  it('every rule in src/zip10.css is under <html data-card-cleanup> (dormant with the switch off)', () => {
    const css = readFileSync(new URL('../src/zip10.css', import.meta.url), 'utf8');
    const rules = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((r) => r.split('{')[0].trim())
      .filter((sel) => sel && !sel.startsWith('@'));
    expect(rules.length).toBeGreaterThan(20);
    for (const sel of rules) for (const part of sel.split(',')) expect(part.trim(), part).toMatch(/^(html|:root)\[data-card-cleanup\]/);
  });
});

describe('prices with 11 and 12 players (the same formula past 10)', () => {
  it('normal game: floor(4 x $14 / N): 11 play $5 ($9 back), 12 play $4 ($10 back); the court ($48) stays covered', () => {
    expect(finalPrice(1400, 11)).toBe(500);
    expect(creditBack(1400, 11)).toBe(900);
    expect(finalPrice(1400, 12)).toBe(400);
    expect(creditBack(1400, 12)).toBe(1000);
    expect(11 * 500).toBeGreaterThanOrEqual(4800);
    expect(12 * 400).toBeGreaterThanOrEqual(4800);
  });

  it('1.5 hour game (Zip 9 table, above 10 pays the 10 price): 11 and 12 play $4 each ($7 back); the $36 court stays covered', () => {
    const p = gamePrice({ startsAt: '2026-11-12T00:30:00.000Z', endsAt: '2026-11-12T02:00:00.000Z' }, DEFAULT_SETTINGS, true);
    expect(p.flatCents).toBe(1100);
    expect(gameFinalPrice(p, 11)).toBe(400);
    expect(gameFinalPrice(p, 12)).toBe(400);
    expect(11 * 400).toBeGreaterThanOrEqual(3600);
  });
});

describe('switch OFF: exactly as before', () => {
  it('no flags, the Max players cap holds, the 11th is on the waitlist, Settings row off', async () => {
    const ctx = await group();
    const phones = await phonesOf(ctx);
    const [s] = await upcoming(ctx);
    for (const n of ALL.slice(0, 10)) expect((await phones[n].call('POST', `/api/sessions/${s.id}/join`, {})).data.result).toBe('confirmed');
    const eleventh = await phones[ALL[10]].call('POST', `/api/sessions/${s.id}/join`, {});
    expect(eleventh.data).toMatchObject({ result: 'waitlisted', position: 1 });
    const d = await dashboard(ctx);
    expect(d.cardCleanup).toBeUndefined();
    expect(d.cardCleanupForAll).toBe(false);
    const v = (await phones.Alex.call('GET', '/api/group')).data;
    expect(v.cardCleanup).toBeUndefined();
    expect(v.group.maxPlayers).toBe(10);
    const view = v.sessions.find((x: any) => x.id === s.id);
    expect(view).toMatchObject({ full: true, joinAs: 'waitlist', countText: '10 in, full' });
    expect(view.waitlist.map((w: any) => w.name)).toEqual([ALL[10]]);
  });

  it('the kill switch beats both the Settings row and the private link', async () => {
    const ctx = await group();
    ctx.app.env.CARD_CLEANUP = 'off';
    expect((await ctx.organizer.call('PUT', '/api/admin/card-cleanup-switch', { on: true })).data).toMatchObject({ ok: true, on: true, movedIn: 0 });
    const phones = await phonesOf(ctx);
    const [s] = await upcoming(ctx);
    for (const n of ALL.slice(0, 10)) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {}, ON);
    expect((await phones[ALL[10]].call('POST', `/api/sessions/${s.id}/join`, {}, ON)).data.result).toBe('waitlisted');
    expect((await dashboard(ctx, ON)).cardCleanup).toBeUndefined();
  });
});

describe('switch ON: no cap, no waitlist', () => {
  it('the private link: a player phone gets the look only (the cap and the waitlist stay); the organizer sign-in gets all of it', async () => {
    const ctx = await group();
    const phones = await phonesOf(ctx);
    const [s] = await upcoming(ctx);
    for (const n of ALL.slice(0, 10)) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    const v = (await phones[ALL[10]].call('GET', '/api/group', undefined, ON)).data;
    expect(v.cardCleanup).toBe(true);
    // Seats: exactly as before for a player phone, link or not (a player can never get past Max players with a link).
    expect(v.group.maxPlayers).toBe(10);
    expect((await phones[ALL[10]].call('POST', `/api/sessions/${s.id}/join`, {}, ON)).data.result).toBe('waitlisted');
    expect((await phones.Alex.call('GET', '/api/group')).data.cardCleanup).toBeUndefined();
    // The organizer's sign-in with the link: no cap (the organizer gives the 12th spot).
    expect((await dashboard(ctx, ON)).cardCleanup).toBe(true);
    expect((await dashboard(ctx)).cardCleanup).toBeUndefined();
    const give = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName[ALL[11]], action: 'confirm' }, ON);
    expect(give.status, give.text).toBe(200);
    expect((await game(ctx, s.id)).roster.filter((r: any) => r.status === 'confirmed')).toHaveLength(11);
  });

  it('review A: switch off, a player phone with the link drops: the next in line moves in as before (one, with the notice), never past Max players', async () => {
    const ctx = await group();
    const phones = await phonesOf(ctx);
    const [s] = await upcoming(ctx);
    for (const n of ALL.slice(0, 10)) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    for (const n of ALL.slice(10, 13)) expect((await phones[n].call('POST', `/api/sessions/${s.id}/join`, {})).data.result).toBe('waitlisted');
    expect((await phones.Alex.call('POST', `/api/sessions/${s.id}/withdraw`, {}, ON)).status).toBe(200);
    const g = await game(ctx, s.id);
    expect(g.roster.filter((r: any) => r.status === 'confirmed')).toHaveLength(10);
    expect(g.roster.find((r: any) => r.name === ALL[10])).toMatchObject({ status: 'confirmed', promotionReason: 'spot_opened' });
    expect(g.roster.filter((r: any) => r.status === 'waitlisted')).toHaveLength(2);
  });

  it('review C: switch off, the organizer phone has the link and raises Max players: the people waiting move in first, as on main', async () => {
    const ctx = await group();
    const phones = await phonesOf(ctx);
    const [s] = await upcoming(ctx);
    for (const n of ALL.slice(0, 10)) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await phones[ALL[10]].call('POST', `/api/sessions/${s.id}/join`, {})).data.result).toBe('waitlisted');
    const settings = (await dashboard(ctx)).group.settings;
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { ...settings, maxPlayers: 12 } }, ON)).status).toBe(200);
    expect((await game(ctx, s.id)).roster.find((r: any) => r.name === ALL[10]).status).toBe('confirmed');
  });

  it('Settings row on: 11 and 12 join as normal players (credit on like anyone), the 13th gets the plain refusal, never a waitlist', async () => {
    const ctx = await group();
    expect((await ctx.organizer.call('PUT', '/api/admin/card-cleanup-switch', { on: true })).data).toMatchObject({ ok: true, on: true, movedIn: 0 });
    const d0 = await dashboard(ctx);
    expect(d0.cardCleanup).toBe(true);
    expect(d0.cardCleanupForAll).toBe(true);
    const phones = await phonesOf(ctx);
    const [s] = await upcoming(ctx);
    for (const n of ALL.slice(0, 12)) {
      const r = await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
      expect(r.status, r.text).toBe(200);
      expect(r.data.result).toBe('confirmed');
    }
    const view = (await phones.Alex.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(view.confirmed).toHaveLength(12);
    expect(view).toMatchObject({ full: false, joinAs: 'in', waitlist: [], countText: '12 in' });
    const thirteenth = await phones[ALL[12]].call('POST', `/api/sessions/${s.id}/join`, {});
    expect(thirteenth.status).toBe(409);
    expect(thirteenth.data).toMatchObject({ error: 'game_limit' });
    expect(thirteenth.text).toContain(DB_LIMIT_MESSAGE);
    // Nobody was put on a waitlist, and the organizer's own In is refused the same way.
    const rows = ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM session_players WHERE session_id = ? AND status = 'waitlisted'").get(s.id) as { n: number };
    expect(rows.n).toBe(0);
    const g = await game(ctx, s.id);
    expect(g.state.flags.full).toBe(false);
    // Every one of the 12 owes $14 up front.
    for (const r of g.roster.filter((x: any) => x.status === 'confirmed')) expect(r.owesCents).toBe(1400);
    // The organizer cannot give a 13th spot or move anyone to a waitlist.
    const give = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName[ALL[12]], action: 'confirm' });
    expect(give.status).toBe(409);
    expect(give.data.error).toBe('game_limit');
    const toWait = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Alex, action: 'waitlist' });
    expect(toWait.status).toBe(409);
    expect(toWait.data.error).toBe('no_waitlist');
    // A drop at 12 moves nobody in (there is nobody waiting) and the game is 11.
    expect((await phones.Alex.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    expect((await game(ctx, s.id)).roster.filter((r: any) => r.status === 'confirmed')).toHaveLength(11);
    // Now the 13th person fits.
    expect((await phones[ALL[12]].call('POST', `/api/sessions/${s.id}/join`, {})).data.result).toBe('confirmed');
  });

  it('a Settings save with the switch on keeps the real Max players (never saves 12)', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/card-cleanup-switch', { on: true });
    const d = await dashboard(ctx);
    expect(d.group.settings.maxPlayers).toBe(10);
    const save = await ctx.organizer.call('PUT', '/api/admin/group', { settings: d.group.settings });
    expect(save.status, save.text).toBe(200);
    const row = ctx.app.db.raw.prepare('SELECT settings_json FROM groups').get() as { settings_json: string };
    expect(JSON.parse(row.settings_json).maxPlayers).toBe(10);
    expect(JSON.parse(row.settings_json)).not.toHaveProperty('noCap');
  });

  it('switching it on for everyone ends every waitlist: the people waiting move in, first in line first, as normal players (no "spot opened")', async () => {
    const ctx = await group();
    const phones = await phonesOf(ctx);
    const [s, s2] = await upcoming(ctx);
    for (const n of ALL.slice(0, 10)) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    const w1 = await phones[ALL[10]].call('POST', `/api/sessions/${s.id}/join`, {});
    const w2 = await phones[ALL[11]].call('POST', `/api/sessions/${s.id}/join`, {});
    const w3 = await phones[ALL[12]].call('POST', `/api/sessions/${s.id}/join`, {});
    expect([w1.data.result, w2.data.result, w3.data.result]).toEqual(['waitlisted', 'waitlisted', 'waitlisted']);
    // A second game with one person waiting under an older, smaller Max players.
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { ...(await dashboard(ctx)).group.settings, maxPlayers: 4 } });
    for (const n of ALL.slice(0, 5)) await phones[n].call('POST', `/api/sessions/${s2.id}/join`, {});
    expect((await game(ctx, s2.id)).roster.filter((r: any) => r.status === 'waitlisted')).toHaveLength(1);
    const on = await ctx.organizer.call('PUT', '/api/admin/card-cleanup-switch', { on: true });
    // 2 of the 3 fit on game 1 (12 is the database's limit), 1 on game 2.
    expect(on.data.movedIn).toBe(3);
    const g = await game(ctx, s.id);
    const confirmed = g.roster.filter((r: any) => r.status === 'confirmed');
    expect(confirmed.map((r: any) => r.name).slice(10)).toEqual([ALL[10], ALL[11]]);
    // No "Spot opened" text card for the organizer and no "Good news" for the player.
    expect(confirmed.every((r: any) => r.promotionReason === null && r.promotedAt === null)).toBe(true);
    const v = (await phones[ALL[10]].call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(v.mine).toMatchObject({ status: 'confirmed', promotion: null });
    expect(v.mine.oweCents).toBe(1400);
    // Review B: the one who could not fit (13th) comes off the list (no hidden waitlist left behind), and is not moved in later by a drop.
    expect(g.roster.find((r: any) => r.name === ALL[12]).status).toBe('withdrawn');
    const thirteenth = (await phones[ALL[12]].call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(thirteenth.waitlist).toEqual([]);
    expect(thirteenth.mine?.status ?? 'none').not.toBe('waitlisted');
    expect((await phones.Alex.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    const g2 = await game(ctx, s.id);
    expect(g2.roster.find((r: any) => r.name === ALL[12]).status).toBe('withdrawn');
    expect(g2.roster.filter((r: any) => r.status === 'confirmed')).toHaveLength(11);
    // A spot is open now: the 13th can tap I'm in like anyone.
    expect((await phones[ALL[12]].call('POST', `/api/sessions/${s.id}/join`, {})).data.result).toBe('confirmed');
    expect(ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM session_players WHERE status = 'waitlisted'").get()).toMatchObject({ n: 0 });
    expect((await game(ctx, s2.id)).roster.filter((r: any) => r.status === 'confirmed')).toHaveLength(5);
    // Switching it off again moves nobody back.
    const off = await ctx.organizer.call('PUT', '/api/admin/card-cleanup-switch', { on: false });
    expect(off.data).toMatchObject({ on: false, movedIn: 0 });
    expect((await game(ctx, s.id)).roster.filter((r: any) => r.status === 'confirmed')).toHaveLength(12);
  });

  it('an older "spot opened" move-in shows no Good news notice and no Spot opened card once the switch is on', async () => {
    const ctx = await group();
    const phones = await phonesOf(ctx);
    const [s] = await upcoming(ctx);
    for (const n of ALL.slice(0, 10)) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    await phones[ALL[10]].call('POST', `/api/sessions/${s.id}/join`, {});
    await phones.Alex.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    // Off: the old notice and card are there.
    expect((await phones[ALL[10]].call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id).mine.promotion).toBe('spot_opened');
    expect((await game(ctx, s.id)).roster.find((r: any) => r.name === ALL[10]).promotionReason).toBe('spot_opened');
    await ctx.organizer.call('PUT', '/api/admin/card-cleanup-switch', { on: true });
    expect((await phones[ALL[10]].call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id).mine.promotion).toBeNull();
    expect((await game(ctx, s.id)).roster.find((r: any) => r.name === ALL[10]).promotionReason).toBeNull();
  });
});

describe('credit chain with 11 and 12 players (switch on), normal and 1.5 hour games', () => {
  it('$14 at 12, then credit + cash at 11, then a 1.5 hour game at 12 and at 11: every overpayment comes back, nothing lost', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/card-cleanup-switch', { on: true });
    await ctx.organizer.call('PUT', '/api/admin/short-games-switch', { on: true });
    const phones = await phonesOf(ctx);
    const P = 'Blair';
    const others = ALL.filter((n) => n !== P);
    const g1 = await addGame(ctx, 3, 120);
    const g2 = await addGame(ctx, 5, 120);
    const g3 = await addGame(ctx, 7, 90);
    const g4 = await addGame(ctx, 9, 90);
    // players, flat, final price, credit used at I'm in, cash, credit back, pot after (cents)
    const plan = [
      { id: g1, players: 12, flat: 1400, price: 400, creditUsed: 0, cash: 1400, back: 1000, pot: 1000 },
      { id: g2, players: 11, flat: 1400, price: 500, creditUsed: 1000, cash: 400, back: 900, pot: 900 },
      { id: g3, players: 12, flat: 1100, price: 400, creditUsed: 900, cash: 200, back: 700, pot: 700 },
      { id: g4, players: 11, flat: 1100, price: 400, creditUsed: 700, cash: 400, back: 700, pot: 700 },
    ];
    let cash = 0;
    let prices = 0;
    const report: string[] = [];
    for (const [i, step] of plan.entries()) {
      const join = await phones[P].call('POST', `/api/sessions/${step.id}/join`, {});
      expect(join.status, join.text).toBe(200);
      expect(join.data.creditCents ?? 0, `game ${i + 1}: credit at I'm in`).toBe(step.creditUsed);
      let me = (await game(ctx, step.id)).roster.find((r: any) => r.name === P);
      expect(me.owesCents, `game ${i + 1}: owes`).toBe(step.flat - step.creditUsed);
      for (const n of others.slice(0, step.players - 1)) {
        const r = await phones[n].call('POST', `/api/sessions/${step.id}/join`, {});
        expect(r.data.result, `${n} game ${i + 1}`).toBe('confirmed');
        const o = (await game(ctx, step.id)).roster.find((x: any) => x.name === n);
        if (o.paymentStatus !== 'paid') await ctx.organizer.call('POST', `/api/admin/sessions/${step.id}/payment`, { playerId: ctx.byName[n], paid: true });
      }
      if (step.cash > 0) await ctx.organizer.call('POST', `/api/admin/sessions/${step.id}/payment`, { playerId: ctx.byName[P], paid: true });
      me = (await game(ctx, step.id)).roster.find((r: any) => r.name === P);
      expect(me).toMatchObject({ paymentStatus: 'paid', owesCents: 0, paymentAmountCents: step.flat });
      const s = await game(ctx, step.id);
      ctx.app.now = Date.parse(s.endsAt) + 10 * 60_000;
      const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${step.id}/finalize`, { everyone: true });
      expect(fin.status, fin.text).toBe(200);
      const after = await game(ctx, step.id);
      expect(after.finalized, `game ${i + 1}`).toMatchObject({ priceCents: step.price, playedCount: step.players });
      expect(after.roster.find((r: any) => r.name === P).creditBackCents ?? 0, `game ${i + 1}: back`).toBe(step.back);
      expect(await potOf(ctx, P), `game ${i + 1}: pot`).toBe(step.pot);
      expect(step.creditUsed + step.cash - step.price).toBe(step.back);
      // Everyone else paid the flat price in cash: exactly flat - price came back to each.
      for (const n of others.slice(0, step.players - 1)) expect(after.roster.find((r: any) => r.name === n).creditBackCents ?? 0, `${n}`).toBe(step.flat - step.price);
      cash += step.cash;
      prices += step.price;
      report.push(`Game ${i + 1} (${step.flat === 1100 ? '1.5 hours' : '2 hours'}): ${step.players} play, $${step.price / 100} each. Credit $${step.creditUsed / 100} + cash $${step.cash / 100}; back $${step.back / 100}; credit after $${step.pot / 100}.`);
      // The others start the next game with no credit, so only Blair carries credit forward.
      for (const n of others) {
        const p = await potOf(ctx, n);
        if (p > 0) {
          expect((await phones[n].call('POST', '/api/me/refund-request', { cents: p })).status).toBe(200);
          const req = (await dashboard(ctx)).refundRequests.find((x: any) => x.playerId === ctx.byName[n]);
          expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded' })).status).toBe(200);
        }
      }
    }
    // Cash in = prices + what is left as credit.
    expect(cash).toBe(1400 + 400 + 200 + 400);
    expect(prices).toBe(400 + 500 + 400 + 400);
    expect(cash).toBe(prices + (await potOf(ctx, P)));
    console.log(`CREDIT CHAIN 11 and 12 (${P}):\n${report.join('\n')}\nCash $${cash / 100} = prices $${prices / 100} + credit left $${(await potOf(ctx, P)) / 100}.`);
  });
});
