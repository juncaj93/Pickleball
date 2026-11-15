// Zip 47 audit probe (security and privacy): what a signed-out visitor, or a player, can read from the player-facing GET answers.
// Read only: it builds its own in-memory world through the real server.
import { describe, expect, it } from 'vitest';
import { firstSession, playerPhone, setupGroup, withoutIds } from '../../harness';

const CASEY_VENMO = '@Casey-Venmo-Zq';
const COURT_CENTS = 4321;
const MEMBERSHIP_CENTS = 7654;
const CREDIT_CENTS = 8900;

async function world() {
  const ctx = await setupGroup();
  const o = ctx.organizer;
  // Distinctive numbers, so any leak is easy to spot.
  expect((await o.call('PUT', '/api/admin/group', { settings: { typicalCourtCostCents: COURT_CENTS, monthlyMembershipCents: MEMBERSHIP_CENTS } })).status).toBe(200);
  const casey = ctx.players.find((p) => p.name === 'Casey')!;
  expect(
    (await o.call('PUT', `/api/admin/players/${casey.id}`, { name: 'Casey', phone: '(313) 555-0102', venmo: CASEY_VENMO })).status,
  ).toBe(200);
  expect((await o.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const adj = await o.call('POST', `/api/admin/players/${casey.id}/credit-adjust`, { direction: 'add', cents: CREDIT_CENTS, seen: 0, reason: 'probe' });
  expect(adj.status, adj.text).toBe(200);
  const s = await firstSession(ctx);
  for (const n of ['Blair', 'Casey', 'Devon']) {
    const p = await playerPhone(ctx, n);
    expect((await p.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
  }
  await o.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Casey, paid: true });
  await o.call('PUT', `/api/admin/sessions/${s.id}/note`, { note: 'Bring balls' }).catch(() => null);
  return { ...ctx, s };
}

function leaks(text: string): string[] {
  const t = withoutIds(text);
  const found: string[] = [];
  const checks: [string, RegExp][] = [
    ['a phone number', /555[-\s.)]*01\d\d|55501\d\d/],
    ["Casey's Venmo name", /Casey-Venmo-Zq/i],
    ['the court cost', /4321|43\.21/],
    ['the membership', /7654|76\.54/],
    ["Casey's credit", /8900|89\.00/],
    ['the PIN hash', /admin_pin_hash|pinHash/i],
  ];
  for (const [what, re] of checks) if (re.test(t)) found.push(what);
  return found;
}

describe('Zip 47 probe: what players and visitors can read', () => {
  it('a different player (Blair) reading every player GET answer sees no phone, other Venmo, court cost, membership or other credit', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    const answers: Record<string, string> = {};
    for (const path of ['/api/group', '/api/group/version', '/api/status', `/api/sessions/${w.s.id}/calendar.ics`]) {
      const r = await blair.call('GET', path);
      answers[path] = r.text;
      expect(leaks(r.text), `${path}: ${r.status}`).toEqual([]);
    }
    // Blair's own screen does carry something: the probe would see a leak if there were one.
    expect(answers['/api/group']).toContain('Casey');
  });

  it('a signed-out visitor (link key, no name picked) and an open-address visitor see none of it either', async () => {
    const w = await world();
    const anon = w.app.client();
    anon.groupKey = w.groupKey;
    for (const path of ['/api/group', '/api/group/version', '/api/status', `/api/sessions/${w.s.id}/calendar.ics`]) {
      const r = await anon.call('GET', path);
      expect(leaks(r.text), `${path}: ${r.status}`).toEqual([]);
    }
    const bare = w.app.client();
    for (const path of ['/api/group', '/api/status', `/api/sessions/${w.s.id}/calendar.ics`, '/api/admin/dashboard', '/api/admin/money', '/api/admin/backup', '/api/admin/export']) {
      const r = await bare.call('GET', path);
      expect(leaks(r.text), `${path}: ${r.status}`).toEqual([]);
    }
  });

  it("Casey's own screen shows her own credit (sanity: the leak check can see a number)", async () => {
    const w = await world();
    const casey = await playerPhone(w, 'Casey');
    const r = await casey.call('GET', '/api/group');
    expect(withoutIds(r.text)).toMatch(/8900/);
  });

  it('the X-View-As header from a player phone (no organizer sign-in) is refused', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    const r = await blair.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Casey });
    expect(r.status).toBe(401);
    expect(leaks(r.text)).toEqual([]);
  });
});

describe('Zip 47 probe: every GET route with every feature switch on', () => {
  it('Blair, a link-key visitor and a bare visitor: organizer GETs refused 401; player GETs show no private data', async () => {
    const { routeList } = await import('../../../server/app');
    const w = await world();
    const o = w.organizer;
    for (const r of routeList().filter((x) => x.method === 'PUT' && /-switch$/.test(x.path))) {
      if (r.path.includes('motion')) {
        await o.call('PUT', r.path, { which: 'player', on: true });
        await o.call('PUT', r.path, { which: 'admin', on: true });
      } else await o.call('PUT', r.path, r.path.includes('christmas') ? { mode: 'all' } : { on: true });
    }
    expect((await o.call('POST', `/api/admin/sessions/${w.s.id}/guest`, { playerId: w.byName.Casey, name: 'Sam' })).status).toBe(200);
    const blair = await playerPhone(w, 'Blair');
    const anon = w.app.client();
    anon.groupKey = w.groupKey;
    const bare = w.app.client();
    const gets = routeList().filter((x) => x.method === 'GET');
    const problems: string[] = [];
    for (const who of [blair, anon, bare]) {
      for (const r of gets) {
        const path = r.path.replace('/sessions/:param', `/sessions/${w.s.id}`).replace('/players/:param', `/players/${w.byName.Casey}`).replace(/:param/g, 'abc');
        // Also with the private test-switch headers a phone could send.
        const res = await who.call('GET', path, undefined, { 'X-Seat-Dots': 'on', 'X-Venue-Alert': 'on', 'X-Acting-Others': 'on' });
        if (r.path.startsWith('/api/admin/')) {
          if (res.status !== 401) problems.push(`${r.path} answered ${res.status}`);
        } else {
          const l = leaks(res.text);
          if (l.length) problems.push(`${r.path}: ${l.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
