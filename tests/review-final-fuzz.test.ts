// Final review: random walks over one game; the screen's "can hide" must equal the server's answer, and hiding must never move money.
import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { canHide } from '../src/pages/admin/moneyRework';
import { HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
let seed = 12345;
const rnd = (n: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const NAMES = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];

describe('review-final: fuzz canHide against the server', () => {
  it('Q1 30 random games, every step', async () => {
    const bad: string[] = [];
    for (let run = 0; run < 30; run++) {
      const app = new TestApp();
      const w = await setupGroup(app);
      await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
      if (rnd(2)) await w.organizer.call('PUT', '/api/admin/late-fees', { on: true });
      const dash = async () => {
        let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, on);
        if (r.status === 401) {
          await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
          r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, on);
        }
        return r.data;
      };
      const g = (await dash()).sessions.filter((s: any) => Date.parse(s.startsAt) > app.now)[1];
      const trail: string[] = [];
      for (let step = 0; step < 8; step++) {
        const op = rnd(8);
        const nm = NAMES[rnd(NAMES.length)];
        const ph = await playerPhone(w, nm);
        const sv = (await dash()).sessions.find((s: any) => s.id === g.id);
        const row = sv.roster.find((r: any) => r.name === nm);
        trail.push(`${op}:${nm}`);
        if (op === 0) await ph.call('POST', `/api/sessions/${g.id}/join`, {});
        else if (op === 1) await ph.call('POST', `/api/sessions/${g.id}/withdraw`, {});
        else if (op === 2 && row) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: row.playerId, paid: true, seen: row.moneySeen, cents: row.owesCents });
        else if (op === 3 && row) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: row.playerId, paid: false, seen: row.moneySeen });
        else if (op === 4) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
        else if (op === 5) {
          app.now = Math.max(app.now, Date.parse(g.startsAt) - (rnd(2) ? 30 : 5) * HOUR);
          await dash();
          await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: rnd(2) === 0, chargedCents: rnd(2) ? 4800 : 0 }, on);
        } else if (op === 6) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' }, on);
        else if (op === 7) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/charge`, { charged: rnd(2) === 0, cents: 2500 }, on);
        const now = (await dash()).sessions.find((s: any) => s.id === g.id);
        const before = JSON.stringify([w.app.db.raw.prepare('SELECT * FROM session_players ORDER BY session_id, player_id').all(), w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all()]);
        const r = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/hide-from-list`, { hidden: true }, on);
        const after = JSON.stringify([w.app.db.raw.prepare('SELECT * FROM session_players ORDER BY session_id, player_id').all(), w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all()]);
        if (before !== after) bad.push(`run ${run} money moved by hide after ${trail.join(',')}`);
        const server = r.status === 200;
        if (server) {
          // hidden: the dashboard flag and Totals must agree, then restore.
          const d = await dash();
          if (d.sessions.find((s: any) => s.id === g.id).hiddenFromList !== true) bad.push(`run ${run} hide said ok but flag missing after ${trail.join(',')}`);
          await w.organizer.call('POST', `/api/admin/sessions/${g.id}/hide-from-list`, { hidden: false }, on);
        }
        if (canHide(now) !== server) bad.push(`run ${run} screen canHide=${canHide(now)} server=${r.status} after ${trail.join(',')}`);
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
