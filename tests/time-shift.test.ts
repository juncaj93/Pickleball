// "Time may shift" (Nov 2026): who is asked to confirm a changed start time, Still in, Can't make it (the normal
// drop), the organizer's Confirmed x of y, the TIME_SHIFT switch, and random sequences with money proving that
// Still in never moves money or a seat.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agreedStart, isWaitingOnTime, timeShiftOn } from '../shared/timeShift';
import { stillInText, tsKind, tsLines, tsTime } from '../src/timeShiftText';
import { DAY, HOUR, playerPhone, setupGroup, TestApp } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const INTEGRITY = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const adminGame = async (ctx: Ctx, id: string) => (await dash(ctx)).sessions.find((x: any) => x.id === id);
const myGame = async (phone: any, id: string) => (await phone.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === id);
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const move = (ctx: Ctx, s: { id: string; startsAt: string; endsAt: string }, ms: number) =>
  ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: plus(s.startsAt, ms), endsAt: plus(s.endsAt, ms) });

/** A game two weeks out (so nothing is near a deadline), and the group's organizer as a player (Alex). */
async function world(opts: { maxPlayers?: number; env?: Record<string, string> } = {}) {
  const app = new TestApp();
  if (opts.env) Object.assign(app.env, opts.env);
  const ctx = await setupGroup(app);
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex', ...(opts.maxPlayers ? { settings: { maxPlayers: opts.maxPlayers } } : {}) });
  const d = await dash(ctx);
  const s = d.sessions.find((x: any) => Date.parse(x.startsAt) > app.now + 7 * DAY);
  const phones: Record<string, any> = {};
  for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) phones[n] = await playerPhone(ctx, n);
  return { ctx, s, phones };
}

function money(ctx: Ctx) {
  const raw = ctx.app.db.raw;
  return JSON.stringify([
    raw.prepare('SELECT id, kind, amount_cents, ended_at, session_id, player_id FROM credit_ledger ORDER BY id').all(),
    raw.prepare('SELECT session_id, player_id, status, payment_status, payment_amount_cents, paid_at, self_paid_at, refunded_at, confirm_seq, claim_seq FROM session_players ORDER BY session_id, player_id').all(),
    raw.prepare('SELECT id, status, amount_cents FROM refund_requests ORDER BY id').all(),
  ]);
}

function integrity(ctx: Ctx): [string, number][] {
  const row = ctx.app.db.raw.prepare(INTEGRITY).get() as Record<string, number>;
  return Object.entries(row)
    .map(([k, n]) => [k, Number(n)] as [string, number])
    .filter(([k, n]) => n !== 0 && !k.startsWith('info_'));
}

describe('the helpers', () => {
  it('reads the stored value', () => {
    expect(agreedStart(null)).toBeNull();
    expect(agreedStart('2026-11-06T00:00:00.000Z')).toBe('2026-11-06T00:00:00.000Z');
    expect(agreedStart('2026-11-06T00:00:00.000Z 2026-11-01T20:00:00.000Z')).toBe('2026-11-06T00:00:00.000Z');
    expect(isWaitingOnTime(null, 'x')).toBe(false);
    expect(isWaitingOnTime('a 1', 'a')).toBe(false);
    expect(isWaitingOnTime('a 1', 'b')).toBe(true);
    expect(timeShiftOn(undefined)).toBe(true);
    expect(timeShiftOn('on')).toBe(true);
    expect(timeShiftOn('OFF')).toBe(false);
  });

  it('words: the notice, the text, the tilde', () => {
    // Thu Nov 5 7:00 PM -> 7:30 PM Eastern.
    expect(tsLines({ startsAt: '2026-11-06T00:30:00.000Z', wasStartsAt: '2026-11-06T00:00:00.000Z' }, TZ)).toEqual({ title: 'Thu Nov 5 moved to 7:30\u00a0PM', was: 'Was 7:00\u00a0PM' });
    expect(tsLines({ startsAt: '2026-11-06T00:30:00.000Z', wasStartsAt: '2026-11-04T00:00:00.000Z' }, TZ).was).toBe('Was Tue Nov 3, 7:00\u00a0PM');
    expect(stillInText('2026-11-06T00:30:00.000Z', TZ, 'pickleball.juncaj.net')).toBe('Thu Nov 5 is now 7:30 PM. Still in? Open the site and tap Still in. pickleball.juncaj.net');
    expect(tsTime('7 PM', 'wait')).toBe('~7 PM');
    expect(tsTime('7 PM', 'none')).toBe('7 PM');
    expect(tsTime('7 PM', 'booked')).toBe('7 PM');
    expect(tsKind('booked', false)).toBe('booked');
    expect(tsKind('waitlist', false)).toBe('wait');
    expect(tsKind('needs', true)).toBe('wait');
    expect(tsKind('later', true)).toBe('wait');
    expect(tsKind('needs', false)).toBe('none');
    expect(tsKind('off', true)).toBeNull();
    for (const l of [tsLines({ startsAt: '2026-11-06T00:30:00.000Z', wasStartsAt: '2026-11-06T00:00:00.000Z' }, TZ).title, stillInText('2026-11-06T00:30:00.000Z', TZ, 'x')]) {
      expect(l).not.toMatch(/drop out|back out|—/i);
    }
  });
});

describe('who is asked', () => {
  it('a player in before the change is asked; Still in answers; a second change asks again; back to an answered time does not', async () => {
    const { ctx, s, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();

    expect((await move(ctx, s, 30 * 60_000)).data).toMatchObject({ changed: true });
    let g = await myGame(phones.Blair, s.id);
    expect(g.timeAsk).toEqual({ wasStartsAt: s.startsAt });

    // A reload or the 5-second refresh does not remove it: it is the server's answer.
    expect((await myGame(phones.Blair, s.id)).timeAsk).toEqual({ wasStartsAt: s.startsAt });

    const before = money(ctx);
    expect((await phones.Blair.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: g.startsAt })).data).toEqual({ result: 'confirmed_time' });
    expect(money(ctx)).toBe(before);
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();

    // A second change: asked again, "Was" is the time they said yes to.
    const s2 = await adminGame(ctx, s.id);
    await move(ctx, s2, 30 * 60_000);
    g = await myGame(phones.Blair, s.id);
    expect(g.timeAsk).toEqual({ wasStartsAt: s2.startsAt });

    // Back to the time they confirmed: no new ask.
    const s3 = await adminGame(ctx, s.id);
    await move(ctx, s3, -30 * 60_000);
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();

    // Back to the very first time (the time they joined at, so agreed to): no ask either.
    const s4 = await adminGame(ctx, s.id);
    await move(ctx, s4, -30 * 60_000);
    expect((await adminGame(ctx, s.id)).startsAt).toBe(s.startsAt);
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();
    // A time never agreed to asks again, showing the last time they said yes to.
    await move(ctx, await adminGame(ctx, s.id), 90 * 60_000);
    expect((await myGame(phones.Blair, s.id)).timeAsk).toEqual({ wasStartsAt: s2.startsAt });
    // A double tap of Still in is fine (the second has nothing to add).
    const g5 = await myGame(phones.Blair, s.id);
    const [t1, t2] = await Promise.all([1, 2].map(() => phones.Blair.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: g5.startsAt })));
    expect([t1.status, t2.status]).toEqual([200, 200]);
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();
  });

  it("I'm in after the change counts as confirmed; a later change asks them", async () => {
    const { ctx, s, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await move(ctx, s, HOUR);
    await phones.Casey.call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await myGame(phones.Casey, s.id)).timeAsk).toBeNull();
    expect((await myGame(phones.Blair, s.id)).timeAsk).not.toBeNull();
    const s2 = await adminGame(ctx, s.id);
    await move(ctx, s2, HOUR);
    expect((await myGame(phones.Casey, s.id)).timeAsk).toEqual({ wasStartsAt: s2.startsAt });
    // Blair still answers for the time she joined at.
    expect((await myGame(phones.Blair, s.id)).timeAsk).toEqual({ wasStartsAt: s.startsAt });
  });

  it("the organizer's In or To waitlist keeps a pending ask (only the player's own I'm in answers it)", async () => {
    const { ctx, s, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await move(ctx, s, HOUR);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Blair, action: 'waitlist' });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Blair, action: 'confirm' });
    expect((await myGame(phones.Blair, s.id)).mine.status).toBe('confirmed');
    expect((await myGame(phones.Blair, s.id)).timeAsk).toEqual({ wasStartsAt: s.startsAt });
    expect((await adminGame(ctx, s.id)).timeCheck.waiting.map((w: any) => w.name)).toEqual(['Blair']);
    // The organizer adding someone new: counts as confirmed (the organizer told them).
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Casey, action: 'confirm' });
    expect((await myGame(phones.Casey, s.id)).timeAsk).toBeNull();
  });

  it('only the end time changing asks nobody', async () => {
    const { ctx, s, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: s.startsAt, endsAt: plus(s.endsAt, 30 * 60_000) });
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();
    expect((await adminGame(ctx, s.id)).timeCheck).toBeNull();
  });

  it('not the organizer, not a dropped player, not a real standby seat; a standby moved in later is asked', async () => {
    const { ctx, s, phones } = await world({ maxPlayers: 4 });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    for (const n of ['Blair', 'Casey', 'Devon']) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await phones.Emery.call('POST', `/api/sessions/${s.id}/join`, {})).data.result).toBe('waitlisted');
    await phones.Devon.call('POST', `/api/sessions/${s.id}/withdraw`, {}); // Emery moves in
    await phones.Devon.call('POST', `/api/sessions/${s.id}/join`, {}); // now on the real waitlist
    await phones.Casey.call('POST', `/api/sessions/${s.id}/withdraw`, {}); // Devon moves in
    await phones.Frankie.call('POST', `/api/sessions/${s.id}/join`, {}); // full: real waitlist
    await phones.Casey.call('POST', `/api/sessions/${s.id}/join`, {}); // waitlist
    await move(ctx, s, HOUR);
    const view = (await ctx.organizer.call('GET', '/api/group')).data;
    const organizerGame = view?.sessions?.find((x: any) => x.id === s.id);
    if (organizerGame) expect(organizerGame.timeAsk).toBeNull();
    expect((await myGame(phones.Blair, s.id)).timeAsk).not.toBeNull();
    const casey = await myGame(phones.Casey, s.id);
    expect(casey.mine.status).toBe('waitlisted');
    expect(casey.timeAsk).toBeNull();

    const check = (await adminGame(ctx, s.id)).timeCheck;
    // Alex (organizer, confirmed automatically) + Blair, Emery, Devon/Frankie: 4 in, 1 confirmed (Alex).
    expect(check.inCount).toBe(4);
    expect(check.confirmedCount).toBe(1);
    expect(check.waiting.map((w: any) => w.name).sort()).toEqual(['Blair', 'Devon', 'Emery']);
    expect(check.waiting.every((w: any) => w.name !== 'Alex')).toBe(true);

    // A standby who moves in after the change answers for the time they joined at (Frankie is first in line).
    expect((await myGame(phones.Frankie, s.id)).mine.status).toBe('waitlisted');
    await phones.Blair.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const moved = await myGame(phones.Frankie, s.id);
    expect(moved.mine.status).toBe('confirmed');
    expect(moved.timeAsk).toEqual({ wasStartsAt: s.startsAt });
    // Blair dropped: no ask.
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();
  });

  it("Can't make it is the normal drop: the same money back, and I'm in again counts as confirmed", async () => {
    const { ctx, s, phones } = await world();
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    await move(ctx, s, HOUR);
    const g = await myGame(phones.Blair, s.id);
    expect(g.timeAsk).not.toBeNull();
    const out = (await phones.Blair.call('POST', `/api/sessions/${s.id}/withdraw`, {})).data;
    expect(out).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();
    // Rejoin at the new time: confirmed, the credit goes on the seat as usual.
    const back = (await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {})).data;
    expect(back.result).toBe('confirmed');
    const again = await myGame(phones.Blair, s.id);
    expect(again.timeAsk).toBeNull();
    expect(again.mine.paidWithCredit).toBe(true);
    expect(integrity(ctx)).toEqual([]);
  });

  it('refuses a stale time, a canceled game, a player not in, and View as on the live site', async () => {
    const { ctx, s, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await move(ctx, s, HOUR);
    const r1 = await phones.Blair.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: s.startsAt });
    expect(r1.status).toBe(409);
    expect(r1.text).toMatch(/time_changed/);
    const r2 = await phones.Casey.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: plus(s.startsAt, HOUR) });
    expect(r2.status).toBe(409);
    expect((await myGame(phones.Blair, s.id)).timeAsk).not.toBeNull();

    // View as on the live server: never saved.
    const viewAs = await ctx.organizer.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: plus(s.startsAt, HOUR) }, { 'X-View-As': ctx.byName.Blair });
    expect(viewAs.status).not.toBe(200);
    expect((await myGame(phones.Blair, s.id)).timeAsk).not.toBeNull();

    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    const r3 = await phones.Blair.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: plus(s.startsAt, HOUR) });
    expect(r3.status).toBe(409);
    expect((await myGame(phones.Blair, s.id)).timeAsk).toBeNull();
    expect((await adminGame(ctx, s.id)).timeCheck).toBeNull();
  });

  it('no ask once the game started', async () => {
    const { ctx, s, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await move(ctx, s, HOUR);
    ctx.app.now = Date.parse(s.startsAt) + HOUR + 60_000;
    expect((await myGame(phones.Blair, s.id))?.timeAsk ?? null).toBeNull();
    expect((await adminGame(ctx, s.id))?.timeCheck ?? null).toBeNull();
  });
});

describe('the organizer side', () => {
  it('Confirmed x of y and Waiting on, with phone numbers for the Text button', async () => {
    const { ctx, s, phones } = await world();
    for (const n of ['Blair', 'Casey', 'Devon']) await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await adminGame(ctx, s.id)).timeCheck).toBeNull();
    await move(ctx, s, 30 * 60_000);
    let c = (await adminGame(ctx, s.id)).timeCheck;
    expect(c).toMatchObject({ confirmedCount: 0, inCount: 3 });
    expect(c.waiting.map((w: any) => w.name)).toEqual(['Blair', 'Casey', 'Devon']);
    expect(c.waiting[0].phone).toMatch(/555/);
    const g = await myGame(phones.Blair, s.id);
    const v1 = (await ctx.organizer.call('GET', '/api/admin/version')).data.v;
    await phones.Blair.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: g.startsAt });
    await phones.Casey.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: g.startsAt });
    // The organizer's 5-second refresh sees the answers.
    expect((await ctx.organizer.call('GET', '/api/admin/version')).data.v).not.toBe(v1);
    c = (await adminGame(ctx, s.id)).timeCheck;
    expect(c).toMatchObject({ confirmedCount: 2, inCount: 3 });
    expect(c.waiting.map((w: any) => w.name)).toEqual(['Devon']);
    // The Activity log has the answers under the player's name.
    const act = (await ctx.organizer.call('GET', '/api/admin/activity')).text;
    expect(act).toMatch(/still_in/);
  });

  it("the player's own refresh sees an answer from their other phone", async () => {
    const { ctx, s, phones } = await world();
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await move(ctx, s, HOUR);
    const other = await playerPhone(ctx, 'Blair');
    const v1 = (await phones.Blair.call('GET', '/api/group/version')).data.v;
    await other.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: plus(s.startsAt, HOUR) });
    expect((await phones.Blair.call('GET', '/api/group/version')).data.v).not.toBe(v1);
  });

  it('TIME_SHIFT off: nothing asked, nothing shown, Still in refused, but answers stay right for later', async () => {
    const { ctx, s, phones } = await world({ env: { TIME_SHIFT: 'off' } });
    await phones.Blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await move(ctx, s, HOUR);
    const g = await myGame(phones.Blair, s.id);
    expect(g.timeAsk).toBeNull();
    expect((await phones.Blair.call('GET', '/api/group')).data.timeShift).toBe(false);
    expect((await adminGame(ctx, s.id)).timeCheck).toBeNull();
    expect((await dash(ctx)).timeShift).toBe(false);
    expect((await phones.Blair.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: g.startsAt })).status).toBe(404);
    (ctx.app.env as any).TIME_SHIFT = 'on';
    expect((await myGame(phones.Blair, s.id)).timeAsk).toEqual({ wasStartsAt: s.startsAt });
  });
});

describe('random sequences with money', () => {
  function prng(seed: number) {
    let x = seed >>> 0;
    const next = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    return { next, pick: <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)] };
  }

  it('join, drop, rejoin, pay, credit, time changes (twice, and back), Still in, game full, waitlist: the ask matches a model of the rule and Still in never moves money', async () => {
    let answered = 0;
    let asked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const { ctx, s, phones } = await world({ maxPlayers: 4 });
      const r = prng(seed);
      const names = Object.keys(phones);
      if (r.next() < 0.5) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
      if (r.next() < 0.5) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
      // Some players start with credit (it goes on their seat at I'm in).
      const old = (await dash(ctx)).sessions.find((x: any) => Date.parse(x.startsAt) < ctx.app.now);
      for (const n of names.slice(0, 2))
        ctx.app.db.raw.exec(
          `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
           SELECT 'pot-${seed}-${n}', id, '${ctx.byName[n]}', 'kept', 1400, ${old ? `'${old.id}'` : 'NULL'}, '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
        );
      const statuses = () =>
        new Map((ctx.app.db.raw.prepare('SELECT player_id, status FROM session_players WHERE session_id = ?').all(s.id) as any[]).map((x) => [x.player_id, x.status as string]));
      // The model: the start time each player has agreed to. undefined: the game's current time (joined at it).
      const agreed = new Map<string, string[] | undefined>();
      const offsets = [0, 30, 60, 90].map((m) => m * 60_000);
      let current = s.startsAt;
      for (let step = 0; step < 80; step++) {
        const who = r.pick(names);
        const id = ctx.byName[who];
        const p = phones[who];
        const x = r.next();
        const before = statuses();
        let stillInOk = false;
        if (x < 0.25) {
          await p.call('POST', `/api/sessions/${s.id}/join`, {});
        } else if (x < 0.4) {
          await p.call('POST', `/api/sessions/${s.id}/withdraw`, {});
        } else if (x < 0.5) {
          await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: id, paid: r.next() < 0.8 });
        } else if (x < 0.55) {
          await p.call('POST', `/api/sessions/${s.id}/paid`, { paid: true });
        } else if (x < 0.7) {
          const to = plus(s.startsAt, r.pick(offsets));
          if (to !== current) {
            const res = await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: to, endsAt: plus(to, 2 * HOUR) });
            expect(res.status, res.text).toBe(200);
            // Everyone in or waiting who had agreed to the current time keeps the old one as theirs.
            for (const [pid, st] of before) if ((st === 'confirmed' || st === 'waitlisted') && agreed.get(pid) === undefined) agreed.set(pid, [current]);
            current = to;
          }
        } else {
          const g = await myGame(p, s.id);
          const m = money(ctx);
          const res = await p.call('POST', `/api/sessions/${s.id}/still-in`, { startsAt: r.next() < 0.85 ? g.startsAt : s.startsAt });
          expect(money(ctx), `seed ${seed} step ${step}: Still in moved money or a seat`).toBe(m);
          stillInOk = res.status === 200;
          if (stillInOk) {
            expect(g.mine?.status).toBe('confirmed');
            agreed.set(id, [...(agreed.get(id) ?? []).filter((t) => t !== current), current]);
            answered++;
          }
        }
        await ctx.app.settle();
        const after = statuses();
        // A fresh seat (or a fresh place on the waitlist) taken by the player themselves: agreed to the current time.
        if (x < 0.25) {
          const was = before.get(id);
          const now = after.get(id);
          if ((now === 'confirmed' || now === 'waitlisted') && was !== now) agreed.delete(id);
        }
        for (const [pid, st] of after) if (st !== 'confirmed' && st !== 'waitlisted') agreed.delete(pid);

        const game = await adminGame(ctx, s.id);
        expect(game.startsAt).toBe(current);
        const askedNow: string[] = [];
        for (const n of names) {
          const pid = ctx.byName[n];
          const view = await myGame(phones[n], s.id);
          const a = agreed.get(pid);
          const shouldAsk = after.get(pid) === 'confirmed' && a !== undefined && !a.includes(current);
          expect(!!view?.timeAsk, `seed ${seed} step ${step}: ${n}`).toBe(shouldAsk);
          if (shouldAsk) {
            expect(view.timeAsk.wasStartsAt).toBe(a![a!.length - 1]);
            askedNow.push(n);
            asked++;
          }
        }
        // The organizer's numbers agree with the players' own screens.
        if (game.timeCheck) {
          expect(game.timeCheck.waiting.map((w: any) => w.name).sort(), `seed ${seed} step ${step}`).toEqual(askedNow.sort());
          expect(game.timeCheck.inCount).toBe(game.confirmedCount);
          expect(game.timeCheck.confirmedCount).toBe(game.confirmedCount - askedNow.length);
        } else {
          expect(askedNow, `seed ${seed} step ${step}: asked but no Confirmed line`).toEqual([]);
        }
      }
      expect(integrity(ctx), `seed ${seed}`).toEqual([]);
    }
    // The sequences really exercised the rule.
    expect(answered).toBeGreaterThan(10);
    expect(asked).toBeGreaterThan(50);
  }, 400_000);
});
