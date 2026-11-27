// 🎾96 audit (read-only): the days around The Cold Open on today's code, shaped like live (10 sign-ups, 7 tickets: Alex free, 5 paid $18, one
// Lock in with nothing paid yet (variant A) or an I paid waiting (variant B)). At each moment: the players' scheduled notice, the organizer's
// status line, Remind, pill, style; and the same reads with Early bird pricing ON must be identical (but the gear row). Runs with ZIP96_AUDIT=1.
import { describe, expect, it } from 'vitest';
import { cardButtons, pillOf, statusWords } from '../shared/tournamentCard';
import { ORIGIN, PIN, playerPhone, setupGroup } from './harness';

const DATE = '2026-12-01';
const OTHERS = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules'];
const LEVELS = [360, 350, 340, 320, 320, 300, 275, 250, 340, 320];
const TZ = 'America/Detroit';
const MOMENTS: [string, string][] = [
  ['Sun Nov 29 12:00 PM', '2026-11-29T17:00:00Z'],
  ['Mon Nov 30 12:01 AM', '2026-11-30T05:01:00Z'],
  ['Mon Nov 30 9:00 AM', '2026-11-30T14:00:00Z'],
  ['Mon Nov 30 6:59 PM', '2026-11-30T23:59:00Z'],
  ['Mon Nov 30 7:05 PM', '2026-12-01T00:05:00Z'],
  ['Mon Nov 30 11:59 PM', '2026-12-01T04:59:00Z'],
  ['Tue Dec 1 12:01 AM', '2026-12-01T05:01:00Z'],
  ['Tue Dec 1 9:00 AM', '2026-12-01T14:00:00Z'],
  ['Tue Dec 1 7:00 PM', '2026-12-02T00:00:00Z'],
];

async function world(variant: 'A' | 'B', early: boolean) {
  const base = await setupGroup();
  const ok = (r: { status: number; text: string }, w: string) => expect(r.status, `${w}: ${r.text.slice(0, 200)}`).toBe(200);
  ok(await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' }), 'name');
  for (const [i, name] of OTHERS.slice(5).entries()) ok(await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-04${String(i).padStart(2, '0')}` }), name);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  ok(await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true }), 'tour on');
  const c = await base.organizer.call('POST', '/api/admin/tournament', { name: 'The Cold Open', dates: ['2026-11-24', DATE, '2026-12-08'], ticketCents: 1800, creditCents: 1400, secondCreditCents: 700, visibility: 'all', format: 'vote' });
  ok(c, 'create');
  const tid = c.data.id as string;
  const names = ['Alex', ...OTHERS];
  const phone = async (n: string) => {
    if (n !== 'Alex') return playerPhone({ ...base, byName } as never, n);
    const o = base.organizer;
    o.groupKey = base.groupKey;
    ok(await o.call('POST', '/api/me', { playerId: byName.Alex }), 'me');
    return o;
  };
  for (const [i, n] of names.entries()) ok(await (await phone(n)).call('POST', '/api/tournament/signup', { tournamentId: tid, level: LEVELS[i], dates: [DATE], formatVote: i % 5 === 3 ? 'americano' : 'locked' }), `signup ${n}`);
  base.app.now = Date.parse('2026-11-20T17:00:00.000Z');
  ok(await base.organizer.call('PUT', `/api/admin/tournament/${tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: 150, courts: 2 }), 'date');
  ok(await (await phone('Alex')).call('POST', '/api/tournament/lock', { tournamentId: tid, intent: 'lock', priceCents: 0 }), 'Alex');
  for (const n of names.slice(1, 6)) {
    const l = await (await phone(n)).call('POST', '/api/tournament/lock', { tournamentId: tid, intent: 'lock', priceCents: 1800 });
    ok(l, `lock ${n}`);
    ok(await (await phone(n)).call('POST', '/api/tournament/paid', { tournamentId: tid, cents: 1800 }), `paid ${n}`);
    ok(await base.organizer.call('POST', `/api/admin/tournament/${tid}/ticket`, { playerId: byName[n], action: 'confirm' }), `confirm ${n}`);
    base.app.now += 3_600_000;
  }
  ok(await (await phone('Gale')).call('POST', '/api/tournament/lock', { tournamentId: tid, intent: 'lock', priceCents: 1800 }), 'lock Gale');
  if (variant === 'B') ok(await (await phone('Gale')).call('POST', '/api/tournament/paid', { tournamentId: tid, cents: 1800 }), 'I paid Gale');
  if (early) ok(await base.organizer.call('PUT', '/api/admin/early-bird-switch', { on: true }), 'early bird on');
  return { base, tid, byName, phone, names };
}

const strip = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (['now', 'serverNow', 'updatedAt', 'updated_at', 'early', 'at', 'id', 'playerId', 'tournamentId', 'key', 'ticketId'].includes(k) ? undefined : v)));

describe.skipIf(!process.env.ZIP96_AUDIT)('🎾96 the days around the night', () => {
  for (const variant of ['A', 'B'] as const)
    it(`variant ${variant}`, async () => {
      const off = await world(variant, false);
      const read = async (iso: string) => {
        off.base.app.now = Date.parse(iso);
        let d = await off.base.organizer.call('GET', '/api/admin/dashboard');
        if (d.status === 401) {
          await off.base.organizer.call('POST', '/api/admin/login', { pin: PIN }, { Origin: ORIGIN });
          d = await off.base.organizer.call('GET', '/api/admin/dashboard');
        }
        const seen: Record<string, any> = {};
        for (const n of ['Blair', 'Gale', 'Harper']) seen[n] = (await (await off.phone(n)).call('GET', '/api/group')).data;
        return { t: d.data.tournament, seen };
      };
      for (const [label, iso] of MOMENTS) {
        await read(iso); // the first read after Pay by settles the style (upkeep)
        const a = await read(iso);
        expect((await off.base.organizer.call('PUT', '/api/admin/early-bird-switch', { on: true })).status).toBe(200);
        const b = await read(iso);
        expect((await off.base.organizer.call('PUT', '/api/admin/early-bird-switch', { on: false })).status).toBe(200);
        const t = a.t;
        const lines: string[] = [];
        const btn = cardButtons(t, iso, TZ).map((x) => `${x.title}: ${x.sub} [${x.tone}]`).join(' | ');
        lines.push(`ADMIN: ${statusWords(t, iso, TZ, undefined)} | pill ${pillOf(t).words} | format ${t.format} | lockedIn ${t.lockedIn} | ${btn} | oddSwitch ${t.oddSwitch ? 'yes' : 'no'}`);
        for (const n of ['Blair', 'Gale', 'Harper']) {
          const g = a.seen[n];
          lines.push(`${n}: alert ${g.tournament?.formatAlert ? JSON.stringify(g.tournament.formatAlert.title) + ' / ' + JSON.stringify(g.tournament.formatAlert.sub) : 'none'}; styleNote ${JSON.stringify(g.tournament?.styleNote ?? null)}; format ${g.tournament?.format}; me ${JSON.stringify(g.tournament?.me ?? null).slice(0, 160)}; owed ${JSON.stringify(g.tourOwed ?? null)}`);
        }
        const diffs: string[] = [];
        const dd = (x: any, y: any, path: string): void => {
          if (JSON.stringify(x) === JSON.stringify(y)) return;
          if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) dd(x[k], y[k], `${path}.${k}`); return; }
          diffs.push(`${path}: ${JSON.stringify(x)?.slice(0, 90)} vs ${JSON.stringify(y)?.slice(0, 90)}`);
        };
        dd(strip(a.t), strip(b.t), 'admin');
        dd(strip(a.seen), strip(b.seen), 'player');
        console.log(`[days ${variant}] ${label}\n   ${lines.join('\n   ')}\n   early bird on vs off: ${diffs.length ? diffs.join(', ') : 'identical'}`);
      }
      // A tap at the price with the switch on: the same $18 (the last unpaid player locks in on Mon at 9 AM in both worlds).
      for (const w of [await world(variant, false), await world(variant, true)]) {
        w.base.app.now = Date.parse('2026-11-30T14:30:00Z');
        const r = await (await w.phone('Harper')).call('POST', '/api/tournament/lock', { tournamentId: w.tid, intent: 'lock', priceCents: 1800 });
        console.log(`[days ${variant}] Harper Lock in $18 : ${r.status} due ${r.data?.dueCents}`);
      }
    }, 600_000);
});
