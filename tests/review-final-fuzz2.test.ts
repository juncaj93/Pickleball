// Final review: random money walks over a few games; the reworked Totals must agree with the old page's court and collected numbers
// (they are the same money), stay non-negative, add up, and never shrink from "so far" to "projected".
import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
let seed = 987;
const rnd = (n: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const NAMES = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];

describe('review-final: fuzz Totals invariants', () => {
  it('R1 40 random months', async () => {
    const bad: string[] = [];
    let played = 0;
    let canceledCharged = 0;
    let projectedGames = 0;
    for (let run = 0; run < 40; run++) {
      const app = new TestApp();
      const w = await setupGroup(app);
      await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
      const lateFees = rnd(2) === 1;
      if (lateFees) await w.organizer.call('PUT', '/api/admin/late-fees', { on: true });
      if (lateFees && rnd(2)) await w.organizer.call('PUT', '/api/admin/late-fee-split', { on: true });
      const dash = async () => {
        let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, on);
        if (r.status === 401) {
          await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
          r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, on);
        }
        return r.data;
      };
      const games = (await dash()).sessions.filter((s: any) => Date.parse(s.startsAt) > app.now).slice(0, 3);
      const trail: string[] = [];
      let edited = false;
      for (let step = 0; step < 14; step++) {
        const g = games[rnd(games.length)];
        const op = rnd(13);
        const nm = NAMES[rnd(NAMES.length)];
        const ph = await playerPhone(w, nm);
        const sv = (await dash()).sessions.find((s: any) => s.id === g.id);
        const row = sv.roster.find((r: any) => r.name === nm);
        trail.push(`${g.id.slice(0, 2)}:${op}:${nm}`);
        if (op === 0 || op === 1) await ph.call('POST', `/api/sessions/${g.id}/join`, {});
        else if (op === 2) await ph.call('POST', `/api/sessions/${g.id}/withdraw`, {});
        else if (op === 3 && row) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: row.playerId, paid: true, seen: row.moneySeen, cents: row.owesCents });
        else if (op === 4 && row) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: row.playerId, paid: false, seen: row.moneySeen });
        else if (op === 5) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
        else if (op === 6) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/me`, { in: rnd(2) === 0 });
        else if (op === 7 || op === 10 || op === 11 || op === 12) {
          app.now = Math.max(app.now, Date.parse(g.startsAt) - (rnd(2) ? 30 : 5) * HOUR);
          await dash();
          await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: rnd(2) === 0, chargedCents: op === 7 ? (rnd(2) ? 4800 : 0) : 4800 }, on);
        } else if (op === 8) {
          const t = Date.parse(g.endsAt) + HOUR;
          if (t > app.now) {
            app.now = t;
            await dash();
          }
          await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
        } else if (op === 9) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' }, on);
      }
      const month = new Date(games[0].startsAt).toISOString().slice(0, 7);
      for (const m of new Set(games.map((g: any) => new Date(g.startsAt).toISOString().slice(0, 7)))) {
        const oldM = (await w.organizer.call('GET', `/api/admin/money?month=${m}`)).data;
        const nw = (await w.organizer.call('GET', `/api/admin/money?month=${m}`, undefined, on)).data;
        const t = nw.rework;
        const tag = `run ${run} ${m} [${trail.join(' ')}]`;
        if (t.courtCostCents !== oldM.courtCostCents) bad.push(`${tag}: court rework ${t.courtCostCents} old ${oldM.courtCostCents}`);
        if (t.collectedCents !== oldM.collectedCents) bad.push(`${tag}: collected rework ${t.collectedCents} old ${oldM.collectedCents}`);
        played += t.courtSessions;
        projectedGames += t.projected.addedCourts;
        if (t.courtSessions > 0 && oldM.sessions.some((x: any) => x.state === 'canceled' && x.charged)) canceledCharged++;
        const nums = [t.courtCostCents, t.membershipCents, t.owedToVenueCents, t.collectedCents, t.yourCostCents, t.yourCostCourtCents, t.yourCostMembershipCents, t.projected.courtCostCents, t.projected.playersPayCents, t.projected.yourCostCents, t.projected.yourCostCourtCents, t.projected.yourCostMembershipCents];
        if (nums.some((n) => !Number.isInteger(n) || n < 0)) bad.push(`${tag}: negative or fractional`);
        if (t.yourCostCourtCents + t.yourCostMembershipCents !== t.yourCostCents) bad.push(`${tag}: parts`);
        if (t.projected.yourCostCourtCents + t.projected.yourCostMembershipCents !== t.projected.yourCostCents) bad.push(`${tag}: projected parts`);
        if (t.projected.courtCostCents < t.courtCostCents || t.projected.totalCents < t.owedToVenueCents) bad.push(`${tag}: projected below so far`);
        if (t.projected.playersPayCents < t.collectedCents) bad.push(`${tag}: players pay below collected`);
        if (t.owedToVenueCents !== t.courtCostCents + t.membershipCents) bad.push(`${tag}: owed sum`);
      }
      void month;
      void edited;
    }
    expect(bad.slice(0, 15)).toEqual([]);
    expect(played).toBeGreaterThan(3);
    expect(canceledCharged).toBeGreaterThan(3);
    expect(projectedGames).toBeGreaterThan(2);
  }, 180_000);
});
