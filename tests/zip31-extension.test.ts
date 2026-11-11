// Zip 31, "Extended time" (EXTENDED_TIME, ships OFF): the rule, the money, every decision Alex made, and the switch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTENDED_TIME, extAlerts, extensionSplit, gameWhenWords, splitLine } from '../shared/extension';
import { activityText } from '../shared/activity';
import { creditChanges } from '../shared/credit';
import { DAY, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const ON = { [EXTENDED_TIME.header]: 'on' };
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const EXT_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-extension.sql'), 'utf8');

// ---------- THE RULE ----------

describe('the rule: ROUND UP(cost / N) each for everyone but Alex, never more than the cost', () => {
  it("Alex's examples (N counts Alex)", () => {
    const ex = (m: number, n: number) => {
      const s = extensionSplit(m, n, true);
      return [s.shareCents / 100, s.organizerCents / 100];
    };
    expect(ex(30, 4)).toEqual([3, 3]);
    expect(ex(30, 5)).toEqual([3, 0]);
    expect(ex(30, 6)).toEqual([2, 2]);
    expect(ex(60, 4)).toEqual([6, 6]);
    expect(ex(60, 5)).toEqual([5, 4]);
    expect(ex(60, 6)).toEqual([4, 4]);
  });

  it('the cap: 9 players, +30 min ($12): rounding up would collect $16, so $1 each ($8) and Alex covers $4', () => {
    const s = extensionSplit(30, 9, true);
    expect(Math.ceil(12 / 9) * 8).toBe(16); // what plain rounding up would collect
    expect(s.shareCents).toBe(100);
    expect(s.shareCents * s.payers).toBe(800);
    expect(s.organizerCents).toBe(400);
  });

  it('the whole table, 1 to 12 players, +30 min and +1 hr, Alex in and Alex out', () => {
    // [minutes, N, alexPlayed] -> [share, alexCovers], worked out by hand from the rule.
    const table: Record<string, [number, number]> = {};
    for (const m of [30, 60]) {
      const cost = m === 30 ? 12 : 24;
      for (let n = 1; n <= 12; n++) {
        for (const alex of [true, false]) {
          const payers = alex ? n - 1 : n;
          let share = payers === 0 ? 0 : Math.ceil(cost / n);
          if (share * payers > cost) share = Math.floor(cost / n);
          table[`${m}:${n}:${alex}`] = [share, cost - share * payers];
        }
      }
    }
    // A few rows written out so the table above is not just the code again.
    expect(table['30:1:true']).toEqual([0, 12]); // Alex alone
    expect(table['30:1:false']).toEqual([12, 0]); // one player, Alex absent
    expect(table['30:7:true']).toEqual([2, 0]); // ceil(1.71)=2 x 6 = 12
    expect(table['30:8:true']).toEqual([1, 5]); // ceil 2 x 7 = 14 > 12: $1 x 7, Alex $5
    expect(table['30:12:true']).toEqual([1, 1]); // $1 x 11
    expect(table['60:9:true']).toEqual([3, 0]); // ceil(2.67)=3 x 8 = $24, exactly the cost
    expect(table['60:11:true']).toEqual([2, 4]); // ceil(2.18)=3 x 10 = 30 > 24: $2 x 10, Alex $4
    for (const [k, [share, alex]] of Object.entries(table)) {
      const [m, n, a] = k.split(':');
      const s = extensionSplit(Number(m), Number(n), a === 'true');
      expect([s.shareCents / 100, s.organizerCents / 100], k).toEqual([share, alex]);
      // Never more than the cost, never below $0, whole dollars.
      expect(s.shareCents * s.payers, k).toBeLessThanOrEqual(s.costCents);
      expect(s.organizerCents, k).toBeGreaterThanOrEqual(0);
      expect(s.shareCents % 100, k).toBe(0);
    }
  });

  it('Alex absent: split among the players who played, he covers the rest', () => {
    expect(extensionSplit(30, 4, false)).toMatchObject({ payers: 4, shareCents: 300, organizerCents: 0 });
    expect(extensionSplit(30, 5, false)).toMatchObject({ payers: 5, shareCents: 200, organizerCents: 200 });
    expect(extensionSplit(60, 5, false)).toMatchObject({ payers: 5, shareCents: 400, organizerCents: 400 });
  });

  it('None costs nothing; the sheet line reads like the mock', () => {
    expect(extensionSplit(0, 4, true)).toMatchObject({ costCents: 0, shareCents: 0 });
    expect(splitLine(extensionSplit(30, 4, true))).toEqual({ left: '3 others pay $3 each', right: 'You cover $3' });
    expect(splitLine(extensionSplit(30, 2, true))).toEqual({ left: '1 other pays $6', right: 'You cover $6' });
  });
});

describe('the alert words', () => {
  const at = (iso: string) => Date.parse(iso);
  it('tonight, yesterday, else the date', () => {
    expect(gameWhenWords('2026-11-13T00:00:00Z', at('2026-11-13T03:30:00Z'), TZ)).toBe("tonight's game"); // Thu 7 PM, Thu 10:30 PM
    expect(gameWhenWords('2026-11-13T00:00:00Z', at('2026-11-13T15:00:00Z'), TZ)).toBe("yesterday's game"); // Fri 10 AM
    expect(gameWhenWords('2026-11-11T00:00:00Z', at('2026-11-13T15:00:00Z'), TZ)).toBe('the Nov 10 game');
  });
  it('one game, two games (one combined alert), credit full and part', () => {
    const now = at('2026-11-13T15:00:00Z');
    const one = extAlerts([{ sessionId: 'a', startsAt: '2026-11-13T00:00:00Z', minutes: 30, shareCents: 300, creditCents: 0, owedCents: 300, seen: false }], now, TZ);
    expect(one).toHaveLength(1);
    expect(one[0].text.before + one[0].text.amount + one[0].text.after).toBe("You owe $3 for yesterday's extra 30 min. It's added to your next game.");
    const two = extAlerts(
      [
        { sessionId: 'a', startsAt: '2026-11-11T00:00:00Z', minutes: 30, shareCents: 200, creditCents: 0, owedCents: 200, seen: true },
        { sessionId: 'b', startsAt: '2026-11-13T00:00:00Z', minutes: 30, shareCents: 300, creditCents: 0, owedCents: 300, seen: false },
      ],
      now,
      TZ,
    );
    expect(two).toHaveLength(1);
    expect(two[0].text.before + two[0].text.amount + two[0].text.after).toBe("You owe $5 for extra time on past games. It's added to your next game.");
    // Both closed: nothing.
    expect(extAlerts([{ sessionId: 'a', startsAt: '2026-11-13T00:00:00Z', minutes: 30, shareCents: 300, creditCents: 0, owedCents: 300, seen: true }], now, TZ)).toHaveLength(0);
    const full = extAlerts([{ sessionId: 'a', startsAt: '2026-11-13T00:00:00Z', minutes: 30, shareCents: 300, creditCents: 300, owedCents: 0, seen: false }], now, TZ);
    expect(full[0].text.before + full[0].text.amount + full[0].text.after).toBe("Your $3 credit was used for yesterday's extra 30 min.");
    const part = extAlerts([{ sessionId: 'a', startsAt: '2026-11-13T00:00:00Z', minutes: 30, shareCents: 300, creditCents: 200, owedCents: 100, seen: false }], now, TZ);
    expect(part[0].text.before + part[0].text.amount + part[0].text.after).toBe("$2 of your credit was used for yesterday's extra 30 min. You owe $1 more, added to your next game.");
  });
});

// ---------- THE MONEY, through the real site ----------

const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];

async function world(opts: { switchOn?: boolean } = { switchOn: true }) {
  const app = new TestApp();
  const w = await setupGroup(app);
  for (const name of MORE) await w.organizer.call('POST', '/api/admin/players', { name, phone: null });
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  const dash = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
  w.players = dash.players;
  w.byName = Object.fromEntries(dash.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  if (opts.switchOn) expect((await w.organizer.call('PUT', '/api/admin/extended-time-switch', { on: true })).status).toBe(200);
  // Money page rework is on live: Totals ("So far") read the reworked way.
  expect((await w.organizer.call('PUT', '/api/admin/money-rework', { on: true })).status).toBe(200);
  return w;
}
type W = Awaited<ReturnType<typeof world>>;

const dash = async (w: W) => (await w.organizer.call('GET', '/api/admin/dashboard')).data;
async function upcoming(w: W) {
  return ((await dash(w)).sessions as any[]).filter((s) => Date.parse(s.startsAt) > w.app.now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
async function fill(w: W, s: any, names: string[], paid: string[] = names) {
  expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' })).status).toBe(200);
  for (const n of names) {
    const r = n === 'Alex' ? await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true }) : await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    expect(r.status, `${n}: ${r.text}`).toBe(200);
  }
  for (const n of paid) if (n !== 'Alex') expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName[n], paid: true })).status).toBe(200);
}
async function finalize(w: W, s: any, played: string[], extraMinutes?: number) {
  w.app.now = Math.max(w.app.now, Date.parse(s.endsAt) + HOUR);
  return w.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { played: played.map((n) => w.byName[n]), ...(extraMinutes === undefined ? {} : { extraMinutes }) });
}
const seat = (w: W, s: any, name: string) =>
  w.app.db.raw.prepare('SELECT * FROM session_players WHERE session_id = ? AND player_id = ?').get(s.id, w.byName[name]) as Record<string, any>;
const pot = (w: W, name: string) =>
  Number(
    (w.app.db.raw
      .prepare("SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL")
      .get(w.byName[name]) as { c: number }).c,
  );
const checks = (w: W) => {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(w.app.db.raw.prepare(OLD_SQL).get() as Record<string, number>)) if (!k.startsWith('info_')) out[k] = Number(n);
  for (const [k, n] of Object.entries(w.app.db.raw.prepare(EXT_SQL).get() as Record<string, number>)) if (!k.startsWith('info_')) out[k] = Number(n);
  return out;
};
const allZero = (w: W) => expect(Object.entries(checks(w)).filter(([, n]) => n !== 0)).toEqual([]);
async function month(w: W, s: any) {
  const m = new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
  return (await w.organizer.call('GET', `/api/admin/money?month=${m}`)).data;
}
const group = async (w: W, name: string) => (await (await playerPhone(w, name)).call('GET', '/api/group')).data;
const giveCredit = async (w: W, name: string, cents: number) => {
  const r = await w.organizer.call('POST', `/api/admin/players/${w.byName[name]}/credit-adjust`, { direction: 'add', cents, reason: 'test', seen: pot(w, name) }, { 'X-Adjust-Credit': 'on' });
  expect(r.status, r.text).toBe(200);
};
const FOUR = ['Alex', 'Blair', 'Casey', 'Devon'];

describe('switch OFF: exactly main', () => {
  it('extraMinutes is ignored, nothing is written, no flags, no extension on any screen', async () => {
    const w = await world({ switchOn: false });
    const [s] = await upcoming(w);
    await fill(w, s, FOUR);
    const r = await finalize(w, s, FOUR, 30);
    expect(r.status).toBe(200);
    expect(r.data.extension).toBeUndefined();
    expect(seat(w, s, 'Blair').ext_cents).toBeNull();
    const row = w.app.db.raw.prepare('SELECT extra_minutes, extra_cost_cents FROM sessions WHERE id = ?').get(s.id) as any;
    expect(row).toEqual({ extra_minutes: null, extra_cost_cents: null });
    const d = await dash(w);
    expect(d.extendedTime).toBeUndefined();
    expect(d.extendedTimeForAll).toBeUndefined();
    expect(d.extensionOwed).toBeUndefined();
    expect((await group(w, 'Blair')).extension).toBeUndefined();
    expect((await w.organizer.call('PUT', '/api/admin/extended-time-switch', { on: false })).status).toBe(200);
    allZero(w);
  });
  it('the kill switch beats the Settings row and the private link', async () => {
    const w = await world();
    w.app.env.EXTENDED_TIME = 'off';
    expect((await dash(w)).extendedTime).toBeUndefined();
    const p = await playerPhone(w, 'Blair');
    expect((await p.call('GET', '/api/group', undefined, ON)).data.extension).toBeUndefined();
  });
});

describe('Alex at Finalize: +30 min with 4 played', () => {
  it('3 others pay $3 each, Alex covers $3; court cost written; the player sees $17 due on the next game; Totals move', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Alex', 'Blair', 'Casey'], []);
    const before = await month(w, s);
    const r = await finalize(w, s, FOUR, 30);
    expect(r.status, r.text).toBe(200);
    expect(r.data.extension).toEqual({ minutes: 30, costCents: 1200, shareCents: 300, payers: 3, organizerCents: 300 });
    expect(w.app.db.raw.prepare('SELECT extra_minutes AS m, extra_cost_cents AS c FROM sessions WHERE id = ?').get(s.id)).toEqual({ m: 30, c: 1200 });
    for (const n of ['Blair', 'Casey', 'Devon']) expect(seat(w, s, n).ext_cents).toBe(300);
    expect(seat(w, s, 'Alex').ext_cents).toBeNull();
    // The normal price did not move: 4 played, $14 each.
    expect(w.app.db.raw.prepare('SELECT final_price_cents AS p FROM sessions WHERE id = ?').get(s.id)).toEqual({ p: 1400 });
    const g = await group(w, 'Blair');
    expect(g.extension.owedCents).toBe(300);
    expect(g.extension.nextSessionId).toBe(next.id);
    const nextView = g.sessions.find((x: any) => x.id === next.id);
    expect(nextView.mine.oweCents).toBe(1400); // the seat itself; the card adds the $3
    // Devon is in no next game: alert only.
    expect((await group(w, 'Devon')).extension.nextSessionId).toBeNull();
    // Totals: the court line is $12 higher, collected is unchanged until someone pays.
    const after = await month(w, s);
    expect(after.courtCostCents - before.courtCostCents).toBe(1200 + 4800); // this game's court + its extra time
    expect(after.rework.courtCostCents - (before.rework?.courtCostCents ?? 0)).toBe(1200 + 4800);
    const game = after.sessions.find((x: any) => x.id === s.id);
    expect(game).toMatchObject({ extraMinutes: 30, extraCostCents: 1200, extraCollectedCents: 0 });
    // Admin rows: three shares owed.
    expect((await dash(w)).extensionOwed.map((x: any) => [x.name, x.owedCents])).toEqual([
      ['Blair', 300],
      ['Casey', 300],
      ['Devon', 300],
    ]);
    allZero(w);

    // Blair pays $17 together with the next game (I paid), Alex's Mark paid on that seat confirms both.
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400, extCents: 300 })).status).toBe(200);
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_claim_cents: 300, ext_paid_cents: 0 });
    expect((await group(w, 'Blair')).extension.owedCents).toBe(0);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${next.id}/payment`, { playerId: w.byName.Blair, paid: true })).status).toBe(200);
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_claim_cents: 0, ext_paid_cents: 300, ext_last_cents: 300 });
    // Casey: Pay now instead, then Alex confirms on the extension row.
    const casey = await playerPhone(w, 'Casey');
    expect((await casey.call('POST', '/api/me/extension-paid', { cents: 300 })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Casey, paid: true })).status).toBe(200);
    // Devon: Alex marks it paid himself, then Undo (Unmark), then again.
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Devon, paid: true, cents: 300 })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Devon, paid: false })).status).toBe(200);
    expect(seat(w, s, 'Devon')).toMatchObject({ ext_paid_cents: 0 });
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Devon, paid: true, cents: 300 })).status).toBe(200);
    const paid = await month(w, s);
    expect(paid.collectedCents - after.collectedCents).toBe(900);
    expect(paid.sessions.find((x: any) => x.id === s.id).extraCollectedCents).toBe(900);
    expect((await dash(w)).extensionOwed).toBeUndefined(); // nothing left owed: not sent at all
    allZero(w);
  });

  it('a wrong amount is refused, nothing moves (I paid with the next game, Pay now)', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 60)).status).toBe(200);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400, extCents: 300 })).status).toBe(409);
    expect((await blair.call('POST', '/api/me/extension-paid', { cents: 300 })).status).toBe(409);
    expect(seat(w, s, 'Blair').ext_claim_cents).toBe(0);
    expect(seat(w, next, 'Blair').payment_status).toBe('unpaid');
  });

  it('Everyone played is the shortcut: no extension', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, FOUR);
    w.app.now = Date.parse(s.endsAt) + HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(seat(w, s, 'Blair').ext_cents).toBeNull();
  });
});

describe('credit is used at once (exactly, more, less, none)', () => {
  it('credit = share, bigger, smaller, zero', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // 5 played: $11 each, $3 back each
    // Zero the $3 back for Emery by making him owe nothing back: give the others different credit up front.
    await giveCredit(w, 'Casey', 500);
    const potBefore = { Blair: pot(w, 'Blair'), Casey: pot(w, 'Casey'), Devon: pot(w, 'Devon'), Emery: pot(w, 'Emery') };
    expect((await finalize(w, s, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'], 60)).status).toBe(200); // +1 hr, 5 played: $5 each, Alex $4
    // Blair: $3 back from the game, share $5: $3 credit used, owes $2 (credit SMALLER than the share).
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_cents: 500, ext_credit_cents: 300 });
    expect(pot(w, 'Blair')).toBe(potBefore.Blair + 300 - 300);
    // Casey: $5 + $3 = $8 credit, share $5: all of it from credit (credit BIGGER), $3 left.
    expect(seat(w, s, 'Casey')).toMatchObject({ ext_cents: 500, ext_credit_cents: 500 });
    expect(pot(w, 'Casey')).toBe(300);
    const g = await group(w, 'Casey');
    expect(g.extension.owedCents).toBe(0);
    expect(g.extension.shares[0]).toMatchObject({ creditCents: 500, owedCents: 0 });
    allZero(w);
  });

  it('credit EXACTLY the share, and ZERO credit', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, FOUR); // 4 played: $14, nothing back
    await giveCredit(w, 'Blair', 300);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_cents: 300, ext_credit_cents: 300 });
    expect(pot(w, 'Blair')).toBe(0);
    expect(seat(w, s, 'Casey')).toMatchObject({ ext_cents: 300, ext_credit_cents: 0 });
    const hist = (await group(w, 'Blair')).credit.history;
    const lines = creditChanges(hist, TZ, 'Alex').map((c) => c.text);
    expect(lines.some((l) => /\$3 used for extra time on /.test(l))).toBe(true);
    allZero(w);
  });

  it('a pending cash out holds its credit back (never used for a share)', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, FOUR);
    await giveCredit(w, 'Blair', 300);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', '/api/me/refund-request', { cents: 300 })).status).toBe(200);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_cents: 300, ext_credit_cents: 0 });
    allZero(w);
  });
});

describe("Alex's edge-case decisions", () => {
  it('reopen + redo with a player toggled off after he paid: his share comes back as credit, the others recompute, no double charge', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    const FIVE = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'];
    await fill(w, s, FIVE, FIVE.filter((n) => n !== 'Alex'));
    await fill(w, next, ['Blair', 'Casey'], []);
    // 5 played, +30 min: $3 each, Alex $0. Everyone got $3 back from the $11 price, so the share is paid from credit at once.
    expect((await finalize(w, s, FIVE, 30)).status).toBe(200);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) expect(seat(w, s, n)).toMatchObject({ ext_cents: 300, ext_credit_cents: 300 });
    // Reopen: shares to $0, credit back; then Emery did not play after all, and +1 hr.
    const re = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {});
    expect(re.status, re.text).toBe(200);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) expect(seat(w, s, n)).toMatchObject({ ext_cents: 0, ext_credit_cents: 0 });
    allZero(w);
    expect((await finalize(w, s, ['Alex', 'Blair', 'Casey', 'Devon'], 60)).status).toBe(200);
    // 4 played, +1 hr: $6 each, Alex $6. Price $14: nothing back from the game now, so the $3 earlier credit pays half.
    for (const n of ['Blair', 'Casey', 'Devon']) expect(seat(w, s, n)).toMatchObject({ ext_cents: 600 });
    expect(seat(w, s, 'Emery').ext_cents).toBe(0);
    // Emery: $14 paid, did not play: $14 back; no share; pot is exactly that.
    expect(pot(w, 'Emery')).toBe(1400);
    const total = ['Blair', 'Casey', 'Devon'].reduce((sum, n) => sum + seat(w, s, n).ext_cents, 0);
    expect(total).toBe(1800);
    allZero(w);
  });

  it('extension changed after someone paid cash: more paid than the new share becomes credit; less: owed again', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, FOUR);
    expect((await finalize(w, s, FOUR, 60)).status).toBe(200); // $6 each
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Blair, paid: true, cents: 600 })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {})).status).toBe(200);
    expect(pot(w, 'Blair')).toBe(600); // the $6 cash is credit while reopened
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200); // now $3 each
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_cents: 300, ext_paid_cents: 600, ext_credit_cents: -300 });
    expect(pot(w, 'Blair')).toBe(300); // $3 more than the new share, as credit
    const lines = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => activityText(e, TZ, 'Alex'));
    expect(lines.some((l: string) => /Blair's extra time share went from \$6 to \$0/.test(l))).toBe(true);
    expect(lines.some((l: string) => /Blair's extra time share set to \$3/.test(l))).toBe(true);
    // Totals: collected counts $3 (cash $6 minus $3 back as credit).
    const m = await month(w, s);
    expect(m.sessions.find((x: any) => x.id === s.id).extraCollectedCents).toBe(300);
    allZero(w);
  });

  it('an unconfirmed I paid on a share stops a change that would hand it back (confirm or clear it first)', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, FOUR);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    expect((await (await playerPhone(w, 'Blair')).call('POST', '/api/me/extension-paid', { cents: 300 })).status).toBe(200);
    const re = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {});
    expect(re.status).toBe(409);
    expect(re.data.code ?? re.data.error).toBe('unconfirmed_ext');
    // Still finalized, nothing moved.
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_cents: 300, ext_claim_cents: 300 });
    allZero(w);
  });

  it('never plays again: the debt stays on the organizer screens long after 90 days', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, FOUR);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    w.app.now += 200 * DAY;
    expect((await w.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    const rows = (await dash(w)).extensionOwed;
    expect(rows.map((x: any) => x.name).sort()).toEqual(['Blair', 'Casey', 'Devon']);
    expect((await group(w, 'Blair')).extension.owedCents).toBe(300);
  });

  it('drops out of the next game: the debt stays (it belongs to the person)', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    expect((await (await playerPhone(w, 'Blair')).call('POST', `/api/sessions/${next.id}/withdraw`, {})).status).toBe(200);
    const g = await group(w, 'Blair');
    expect(g.extension.owedCents).toBe(300);
    expect(g.extension.nextSessionId).toBeNull();
  });

  it('paid with Pay now, then signs up: the next game is the normal amount again', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    expect((await (await playerPhone(w, 'Blair')).call('POST', '/api/me/extension-paid', { cents: 300 })).status).toBe(200);
    await fill(w, next, ['Blair'], []);
    const g = await group(w, 'Blair');
    expect(g.extension.owedCents).toBe(0);
    expect(g.extension.nextSessionId).toBeNull();
  });

  it('owes from two games: one combined total; the X closes it; a new extension brings it back', async () => {
    const w = await world();
    const [a, b] = await upcoming(w);
    await fill(w, a, FOUR);
    await fill(w, b, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    expect((await finalize(w, a, FOUR, 30)).status).toBe(200);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', '/api/me/extension-seen', { sessionIds: [a.id] })).status).toBe(200);
    let g = (await blair.call('GET', '/api/group')).data;
    expect(extAlerts(g.extension.shares, Date.parse(g.now), TZ)).toHaveLength(0);
    // A new extension on the second game brings an alert back: 4 played there with no credit (Emery's seat is unpaid), so it owes.
    expect((await finalize(w, b, ['Alex', 'Blair', 'Casey', 'Devon'], 60)).status).toBe(200);
    g = (await blair.call('GET', '/api/group')).data;
    const alerts = extAlerts(g.extension.shares, Date.parse(g.now), TZ);
    expect(alerts.map((x) => x.kind)).toEqual(['owe']);
    // One combined alert with the total of both games.
    expect(alerts[0].cents).toBe(g.extension.owedCents);
    expect(alerts[0].text.after).toBe(" for extra time on past games. It's added to your next game.");
  });

  it('the organizer never pays a share and never uses credit for one', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, FOUR);
    expect((await finalize(w, s, FOUR, 60)).status).toBe(200);
    expect(seat(w, s, 'Alex').ext_cents).toBeNull();
    expect(Number((w.app.db.raw.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE player_id = ? AND reason LIKE 'ext:%'").get(w.byName.Alex) as any).n)).toBe(0);
  });

  it('the history lines are plain', () => {
    const e = (action: string, details: Record<string, unknown>) => activityText({ id: 'x', action, details, actorLabel: 'organizer', createdAt: '2026-11-13T03:00:00Z', sessionId: 's', sessionStartsAt: '2026-11-13T00:00:00Z' } as any, TZ, 'Alex');
    expect(e('extension_set', { minutes: 30, costCents: 1200, shareCents: 300, payers: 3, organizerCents: 300 })).toBe('Alex added 30 min of extra time for Thu, Nov 12: $12 court, 3 pay $3 each, you cover $3');
    expect(e('extension_share', { player: 'Blair', fromCents: 600, toCents: 300, backCents: 300, creditUsedCents: 0 })).toBe("Blair's extra time share went from $6 to $3 for Thu, Nov 12, $3 back as credit");
  });
});

// ---------- No extra database reads on player screens (D1 free tier) ----------

describe('reads: the player screen makes no extra database read', () => {
  it('a player with a share owed: the same trips and the same statements as with the switch off (Fewer database trips on, as on live)', async () => {
    const { countingDb } = await import('../dev/countingDb');
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    // Fewer database trips on for everyone (live has it on).
    for (const t of ['speed_fewer_queries_on']) w.app.db.raw.exec(`INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'x-${t}', id, NULL, '${t}', 'mark', 'x' FROM groups`);
    const c = { trips: 0, statements: 0, sql: [] as string[] };
    w.app.env.DB = countingDb(w.app.db, c);
    const blair = await playerPhone(w, 'Blair');
    const measure = async () => {
      c.trips = 0;
      c.statements = 0;
      c.sql = [];
      const g = (await blair.call('GET', '/api/group')).data;
      if (process.env.DEBUG_READS) console.log(c.sql.map((x) => x.replace(/\s+/g, ' ').slice(0, 120)).join('\n') + '\n----');
      return { trips: c.trips, statements: c.statements, g };
    };
    // (The first look after the setup does its one-time upkeep, a write; it is not part of either measure.)
    await measure();
    const on = await measure();
    expect(on.g.extension.owedCents).toBe(300);
    expect((await w.organizer.call('PUT', '/api/admin/extended-time-switch', { on: false })).status).toBe(200);
    const off = await measure();
    expect(off.g.extension).toBeUndefined();
    expect(on.trips).toBe(off.trips);
    expect(on.statements).toBe(off.statements);
  });
});

describe('the preview and the switch files', () => {
  it('EXTENDED_TIME_PREVIEW is preview only (never in [vars]); EXTENDED_TIME is allowed on both; the preview seed has the row on', async () => {
    const toml = readFileSync(join(process.cwd(), 'wrangler.toml'), 'utf8');
    const live = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
    const preview = toml.slice(toml.indexOf('[env.preview.vars]'));
    expect(live).not.toMatch(/EXTENDED_TIME_PREVIEW/);
    expect(live).toMatch(/^EXTENDED_TIME = "on"/m);
    expect(preview).toMatch(/^EXTENDED_TIME_PREVIEW = "on"/m);
    const { BUILDING_ON } = await import('../scripts/preview-world-small');
    expect(BUILDING_ON).toContain('extended_time_on');
  });
  it('the preview-only var shows it with the Settings row off; the kill switch still wins', async () => {
    const w = await world({ switchOn: false });
    w.app.env.EXTENDED_TIME_PREVIEW = 'on';
    expect((await dash(w)).extendedTime).toBe(true);
    w.app.env.EXTENDED_TIME = 'off';
    expect((await dash(w)).extendedTime).toBeUndefined();
  });
  it('migration 0019 is additive only (ADD COLUMN and one CREATE INDEX), and the 21 older checks still run on a database without it', () => {
    const sql = readFileSync(join(process.cwd(), 'migrations/0019_extended_time.sql'), 'utf8').replace(/--.*$/gm, '');
    const stmts = sql.split(';').map((x) => x.trim()).filter(Boolean);
    expect(stmts.every((x) => /^ALTER TABLE (sessions|session_players) ADD COLUMN /.test(x) || /^CREATE INDEX /.test(x))).toBe(true);
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP|RENAME|INSERT/i);
    expect(OLD_SQL).not.toMatch(/ext_|extra_/);
  });
});

// ---------- Fixes from the fresh review (each fails on the code before the fix) ----------

describe('review round 1 fixes', () => {
  const confirmSeat = (w: W, s: any, name: string, paid = true) => w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName[name], paid });

  it('1. paid together with the next game, then the share went to $0 (credit back), then Alex unmarks that seat: the credit is taken back, no hidden debt', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400, extCents: 300 })).status).toBe(200);
    expect((await confirmSeat(w, next, 'Blair')).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {})).status).toBe(200);
    expect((await finalize(w, s, ['Alex', 'Casey', 'Devon'], 30)).status).toBe(200); // Blair did not play
    const potBefore = pot(w, 'Blair');
    expect((await confirmSeat(w, next, 'Blair', false)).status).toBe(200);
    // The $17 never came: the $3 that was handed back as credit comes back off her credit (as main does for a seat's own credit back).
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_cents: 0, ext_paid_cents: 0, ext_credit_cents: 0 });
    expect(pot(w, 'Blair')).toBe(potBefore - 300);
    expect((await group(w, 'Blair')).extension.owedCents).toBe(0);
    allZero(w);
  });

  it('1b. the same, but she already cashed that credit out: the seat Unmark is refused and nothing moves', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400, extCents: 300 })).status).toBe(200);
    expect((await confirmSeat(w, next, 'Blair')).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {})).status).toBe(200);
    expect((await finalize(w, s, ['Alex', 'Casey', 'Devon'], 30)).status).toBe(200);
    // Blair's $14 (did not play) and $3 are credit now; she asks for all of it back and Alex refunds it.
    expect((await blair.call('POST', '/api/me/refund-request', { cents: pot(w, 'Blair') })).status).toBe(200);
    const before = { pot: pot(w, 'Blair'), seat: seat(w, s, 'Blair') };
    const r = await confirmSeat(w, next, 'Blair', false);
    expect(r.status).toBe(409);
    expect(r.data.code ?? r.data.error).toBe('extension_handed_back');
    expect(pot(w, 'Blair')).toBe(before.pot);
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_paid_cents: before.seat.ext_paid_cents, ext_credit_cents: before.seat.ext_credit_cents });
    expect(seat(w, next, 'Blair').payment_status).toBe('paid');
    allZero(w);
  });

  it('1c. confirmed on the extension row itself, then a later seat Unmark never takes that $3 off', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400, extCents: 300 })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Blair, paid: true })).status).toBe(200);
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: false })).status).toBe(200);
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400 })).status).toBe(200);
    expect((await confirmSeat(w, next, 'Blair', false)).status).toBe(200);
    expect(seat(w, s, 'Blair').ext_paid_cents).toBe(300);
    allZero(w);
  });

  it('2. an I paid made with the switch on is settled by Mark paid after the switch is turned off, and the game can be reopened', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    expect((await (await playerPhone(w, 'Blair')).call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400, extCents: 300 })).status).toBe(200);
    expect((await w.organizer.call('PUT', '/api/admin/extended-time-switch', { on: false })).status).toBe(200);
    expect((await confirmSeat(w, next, 'Blair')).status).toBe(200);
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_claim_cents: 0, ext_paid_cents: 300 });
    // Shares still open stay on the organizer's screen with the switch off, so they can be settled.
    expect((await dash(w)).extensionOwed.map((x: any) => x.name).sort()).toEqual(['Casey', 'Devon']);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {})).status).toBe(200);
    allZero(w);
  });

  it('3. the Home claim card: "Didn\'t pay" clears the extra time I paid too; "Paid" confirms it', async () => {
    for (const answer of [false, true]) {
      const w = await world();
      const [s, next] = await upcoming(w);
      await fill(w, s, FOUR);
      await fill(w, next, ['Blair'], []);
      expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
      const blair = await playerPhone(w, 'Blair');
      expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400, extCents: 300 })).status).toBe(200);
      expect((await blair.call('POST', `/api/sessions/${next.id}/withdraw`, {})).status).toBe(200);
      expect((await w.organizer.call('POST', `/api/admin/sessions/${next.id}/claim`, { playerId: w.byName.Blair, paid: answer })).status).toBe(200);
      expect(seat(w, s, 'Blair')).toMatchObject(answer ? { ext_claim_cents: 0, ext_paid_cents: 300 } : { ext_claim_cents: 0, ext_paid_cents: 0 });
      expect((await group(w, 'Blair')).extension.owedCents).toBe(answer ? 0 : 300);
      allZero(w);
    }
  });

  it('4. a Reopen that is refused moves no money and writes no history', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    const FIVE = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'];
    await fill(w, s, FIVE, ['Blair', 'Casey']);
    expect((await finalize(w, s, FIVE, 30)).status).toBe(200); // $11 each; Devon and Emery owe; shares $3
    await giveCredit(w, 'Devon', 500);
    expect((await (await playerPhone(w, 'Emery')).call('POST', `/api/sessions/${s.id}/paid`, { paid: true, cents: 1100 })).status).toBe(200);
    const before = { devon: pot(w, 'Devon'), rows: Number((w.app.db.raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get() as any).n) };
    const re = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {});
    expect(re.status).toBe(409);
    expect(pot(w, 'Devon')).toBe(before.devon);
    expect(Number((w.app.db.raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get() as any).n)).toBe(before.rows);
    const acts = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.filter((e: any) => e.action === 'extension_share' && e.details.why === 'reopen');
    expect(acts).toHaveLength(0);
    allZero(w);
  });

  it("5. the player's Didn't pay? never undoes an extra time payment Alex confirmed", async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: true, cents: 1400, extCents: 300 })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Blair, paid: true })).status).toBe(200);
    expect((await blair.call('POST', `/api/sessions/${next.id}/paid`, { paid: false })).status).toBe(200);
    expect(seat(w, s, 'Blair').ext_paid_cents).toBe(300);
    allZero(w);
  });

  it('6. Money "Credits owed" counts credit handed back from extra time', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, FOUR);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Blair, paid: true, cents: 300 })).status).toBe(200);
    const m0 = await month(w, s);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {})).status).toBe(200);
    expect((await finalize(w, s, ['Alex', 'Casey', 'Devon'], 30)).status).toBe(200);
    const m1 = await month(w, s);
    // Blair did not play: her $14 and her $3 come back as credit, both counted.
    expect(m1.creditsOwedCents - m0.creditsOwedCents).toBe(1400 + 300);
  });

  it('7. the share never rides on a game the top "You owe" card already asks for (game day)', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    // Game day of the next game, mid-afternoon: its $14 is on the top card.
    w.app.now = Date.parse(next.startsAt) - 4 * HOUR;
    const g = await group(w, 'Blair');
    if (g.payDue.some((o: any) => o.sessionId === next.id)) expect(g.extension.nextSessionId).not.toBe(next.id);
    expect(g.extension.owedCents).toBe(300);
  });
});

describe("Alex's answers after the first report: the seat's Mark paid takes both parts; Unmark and Mark paid again", () => {
  const rowOf = async (w: W, sid: string, name: string) => (await dash(w)).sessions.find((x: any) => x.id === sid).roster.find((r: any) => r.name === name);
  const mark = (w: W, sid: string, name: string, body: Record<string, unknown>) => w.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], ...body });

  it('combined due showing ($14 + $3): ONE Mark paid records both; Unmark (Undo) reverses both; Mark paid again takes both again', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    let r = await rowOf(w, next.id, 'Blair');
    expect([r.owesCents, r.extCents]).toEqual([1400, 300]); // the row reads "$17 (incl. $3 extension)"
    expect((await group(w, 'Blair')).extension.nextSessionId).toBe(next.id); // the same game the player's card shows it on
    expect((await mark(w, next.id, 'Blair', { paid: true, cents: 1400, extCents: 300, seen: r.moneySeen })).status).toBe(200);
    expect(seat(w, next, 'Blair').payment_status).toBe('paid');
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_paid_cents: 300, ext_claim_cents: 0 });
    expect((await group(w, 'Blair')).extension.owedCents).toBe(0);
    expect((await dash(w)).extensionOwed.map((x: any) => x.name)).not.toContain('Blair');
    allZero(w);
    // Unmark (what Undo sends): both come off.
    r = await rowOf(w, next.id, 'Blair');
    expect((await mark(w, next.id, 'Blair', { paid: false, seen: r.moneySeen })).status).toBe(200);
    expect(seat(w, next, 'Blair').payment_status).toBe('unpaid');
    expect(seat(w, s, 'Blair').ext_paid_cents).toBe(0);
    // Mark paid again: the row shows $17 again and takes both; nothing is left showing as owed.
    r = await rowOf(w, next.id, 'Blair');
    expect([r.owesCents, r.extCents]).toEqual([1400, 300]);
    expect((await mark(w, next.id, 'Blair', { paid: true, cents: 1400, extCents: 300, seen: r.moneySeen })).status).toBe(200);
    expect(seat(w, s, 'Blair').ext_paid_cents).toBe(300);
    expect((await group(w, 'Blair')).extension.owedCents).toBe(0);
    expect((await dash(w)).extensionOwed?.map((x: any) => x.name) ?? []).not.toContain('Blair');
    const m = await month(w, s);
    expect(m.sessions.find((x: any) => x.id === s.id).extraCollectedCents).toBe(300);
    allZero(w);
  });

  it('only the game part owed: no extCents on the row, Mark paid is exactly the old one', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Emery'], []); // Emery did not play the extended game: no share
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    const r = await rowOf(w, next.id, 'Emery');
    expect(r.extCents).toBeUndefined();
    expect((await mark(w, next.id, 'Emery', { paid: true, cents: 1400, seen: r.moneySeen })).status).toBe(200);
    expect(seat(w, next, 'Emery').payment_status).toBe('paid');
    allZero(w);
  });

  it('only the extension owed (the next game already paid): nothing rides on that seat; the extension row\'s Mark paid takes the $3', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair']); // already paid $14
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    expect((await rowOf(w, next.id, 'Blair')).extCents).toBeUndefined();
    expect((await group(w, 'Blair')).extension.nextSessionId).toBeNull();
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/extension-payment`, { playerId: w.byName.Blair, paid: true, cents: 300 })).status).toBe(200);
    expect(seat(w, s, 'Blair').ext_paid_cents).toBe(300);
    allZero(w);
  });

  it('a stale combined amount is refused and nothing moves (the share changed, or the seat payment is refused)', async () => {
    const w = await world();
    const [s, next] = await upcoming(w);
    await fill(w, s, FOUR);
    await fill(w, next, ['Blair'], []);
    expect((await finalize(w, s, FOUR, 30)).status).toBe(200);
    const r = await rowOf(w, next.id, 'Blair');
    expect((await mark(w, next.id, 'Blair', { paid: true, cents: 1400, extCents: 600, seen: r.moneySeen })).status).toBe(409);
    expect((await mark(w, next.id, 'Blair', { paid: true, cents: 900, extCents: 300, seen: r.moneySeen })).status).toBe(409); // seat amount wrong
    expect(seat(w, s, 'Blair')).toMatchObject({ ext_paid_cents: 0, ext_last_cents: 0 });
    expect(seat(w, next, 'Blair').payment_status).toBe('unpaid');
    allZero(w);
  });
});
