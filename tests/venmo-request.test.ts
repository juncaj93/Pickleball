// "Venmo request" (VENMO_REQUEST, Nov 2026): one blue "Venmo request" link per person who owes, only where that player has a Venmo username
// saved. The link is https://venmo.com/USER?txn=charge&amount=PRICE&note=Pickleball%20Tue%20Nov%203 (tested by Alex on his phone): real %20
// spaces, never "+", one person per link, the amount THAT person owes. The switch and its Settings row, and that with it off nothing is there.
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { ADJUST_CREDIT_HEADER } from '../shared/adjustCredit';
import { venmoNote } from '../shared/money';
import { VENMO_REQUEST_HEADER, venmoRequestAllowed, venmoRequestUrl, venmoUsername } from '../shared/venmoRequest';
import { unpaidRows } from '../src/pages/admin/moneyList';
import { firstSession, PIN, playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
/** Tue Nov 3, 2026, 8:00 PM Eastern. */
const TUE_NOV_3 = '2026-11-04T01:00:00.000Z';
const on = { [VENMO_REQUEST_HEADER]: 'on' };

describe('Venmo request link', () => {
  it('V1 the exact format Alex tested: username, txn=charge, amount, note with %20 spaces', () => {
    expect(venmoRequestUrl('Harper-K', 1400, TUE_NOV_3, TZ)).toBe('https://venmo.com/Harper-K?txn=charge&amount=14&note=Pickleball%20Tue%20Nov%203');
  });
  it('V2 the note is "Pickleball <weekday> <month> <day>" and never has a plus sign or a raw space', () => {
    const url = venmoRequestUrl('kai', 1400, TUE_NOV_3, TZ) as string;
    expect(venmoNote(TUE_NOV_3, TZ)).toBe('Pickleball Tue Nov 3');
    expect(url).toContain('note=Pickleball%20Tue%20Nov%203');
    expect(url).not.toMatch(/\+/);
    expect(url).not.toMatch(/ /);
    expect(new URL(url).searchParams.get('note')).toBe('Pickleball Tue Nov 3');
    // Thursday, and a date after midnight UTC but still the evening before in Eastern time.
    expect(venmoRequestUrl('kai', 1400, '2026-11-06T01:00:00.000Z', TZ)).toContain('note=Pickleball%20Thu%20Nov%205');
  });
  it('V3 the amount is what THAT person owes: $14, $11 (fee split or part credit), $9, cents when there are cents', () => {
    const amount = (cents: number) => new URL(venmoRequestUrl('kai', cents, TUE_NOV_3, TZ) as string).searchParams.get('amount');
    expect(amount(1400)).toBe('14');
    expect(amount(1100)).toBe('11');
    expect(amount(900)).toBe('9');
    expect(amount(950)).toBe('9.50');
  });
  it('V4 no button without a Venmo username: nothing saved, only an id link, a bad name, or nothing owed', () => {
    expect(venmoRequestUrl(null, 1400, TUE_NOV_3, TZ)).toBeNull();
    expect(venmoRequestUrl(undefined, 1400, TUE_NOV_3, TZ)).toBeNull();
    expect(venmoRequestUrl('', 1400, TUE_NOV_3, TZ)).toBeNull();
    expect(venmoRequestUrl('id:1234567', 1400, TUE_NOV_3, TZ)).toBeNull();
    expect(venmoRequestUrl('a b', 1400, TUE_NOV_3, TZ)).toBeNull();
    expect(venmoRequestUrl('x', 1400, TUE_NOV_3, TZ)).toBeNull();
    expect(venmoRequestUrl('kai', 0, TUE_NOV_3, TZ)).toBeNull();
    expect(venmoUsername('Kai_99')).toBe('Kai_99');
    expect(venmoUsername('id:99999')).toBeNull();
  });
  it('V5 one person per link: the link carries exactly one account, never a list (Venmo would turn that into a split)', () => {
    const url = new URL(venmoRequestUrl('kai', 1400, TUE_NOV_3, TZ) as string);
    expect(url.pathname).toBe('/kai');
    expect(url.searchParams.has('recipients')).toBe(false);
    expect([...url.searchParams.keys()].sort()).toEqual(['amount', 'note', 'txn']);
    expect(url.searchParams.get('txn')).toBe('charge');
    expect(url.pathname).not.toContain(',');
  });
  it('V6 the var is allowed unless it says off', () => {
    expect(venmoRequestAllowed(undefined)).toBe(true);
    expect(venmoRequestAllowed('on')).toBe(true);
    expect(venmoRequestAllowed(' Off ')).toBe(false);
  });
});

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W, headers: Record<string, string> = {}) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}

describe('Venmo request switch', () => {
  it('W1 ships off: the dashboard carries only the Settings row value; the players list still carries Venmo names (as before)', async () => {
    const w = await world();
    const d = await dash(w);
    expect(d.venmoRequest).toBeUndefined();
    expect(d.venmoRequestForAll).toBe(false);
  });
  it('W2 the private header turns it on for that phone only', async () => {
    const w = await world();
    expect((await dash(w, on)).venmoRequest).toBe(true);
    expect((await dash(w, {})).venmoRequest).toBeUndefined();
    expect((await dash(w, { [VENMO_REQUEST_HEADER]: 'yes' })).venmoRequest).toBeUndefined();
    // The other new switch's header does nothing here.
    expect((await dash(w, { [ADJUST_CREDIT_HEADER]: 'on' })).venmoRequest).toBeUndefined();
  });
  it('W3 the Settings switch turns it on for everyone and off again (no deploy), one row, logged, organizer only', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/venmo-request-switch', { on: true })).status).toBe(200);
    await w.organizer.call('PUT', '/api/admin/venmo-request-switch', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'venmo_request_on'").first<{ n: number }>())?.n).toBe(1);
    const d = await dash(w);
    expect(d.venmoRequest).toBe(true);
    expect(d.venmoRequestForAll).toBe(true);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: { action: string }) => e.action === 'venmo_request_on');
    expect(activityText({ ...act }, TZ, 'Alex')).toBe('Alex switched "Venmo request" on');
    const alex = await playerPhone(w, 'Alex');
    expect((await w.app.client().call('PUT', '/api/admin/venmo-request-switch', { on: true })).status).toBe(401);
    expect((await alex.call('PUT', '/api/admin/venmo-request-switch', { on: false })).status).toBe(401);
    await w.organizer.call('PUT', '/api/admin/venmo-request-switch', { on: false });
    expect((await dash(w)).venmoRequest).toBeUndefined();
  });
  it('W4 the kill switch beats both the header and Settings', async () => {
    const w = await world({ VENMO_REQUEST: 'off' });
    await w.organizer.call('PUT', '/api/admin/venmo-request-switch', { on: true });
    expect((await dash(w, on)).venmoRequest).toBeUndefined();
  });
  it('W5 players never see the switch, other people\'s Venmo names or anything about it', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/venmo-request-switch', { on: true });
    const p = (await dash(w)).players.find((x: any) => x.name === 'Blair');
    await w.organizer.call('PUT', `/api/admin/players/${p.id}`, { name: 'Blair', venmo: '@blair-fake' });
    const casey = await playerPhone(w, 'Casey');
    const text = JSON.stringify((await casey.call('GET', '/api/group')).data);
    expect(text).not.toContain('blair-fake');
    expect(text).not.toMatch(/venmoRequest/i);
  });
});

describe('Venmo request: the amount is what each person owes right now', () => {
  it('X1 a game where one person has used $3 credit: they owe $11, the others $14, and each link says exactly that', async () => {
    const w = await world();
    const s = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    // Blair has $3 credit (an organizer adjustment), so joining uses it and leaves $11 owed.
    await w.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true });
    const adj = await w.organizer.call('POST', `/api/admin/players/${w.byName.Blair}/credit-adjust`, { direction: 'add', cents: 300, reason: 'Test credit', seen: 0 });
    expect(adj.status, adj.text).toBe(200);
    for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    const d = await dash(w, on);
    for (const n of ['Blair', 'Casey']) await w.organizer.call('PUT', `/api/admin/players/${w.byName[n]}`, { name: n, venmo: `@${n.toLowerCase()}-fake` });
    const d2 = await dash(w, on);
    const game = d2.sessions.find((x: any) => x.id === s.id);
    const rows = unpaidRows(game);
    const owes = Object.fromEntries(rows.map((r) => [r.name, r.owesCents]));
    expect(owes).toEqual({ Blair: 1100, Casey: 1400, Devon: 1400 });
    const handle = (n: string) => d2.players.find((p: any) => p.name === n).venmo;
    const link = (n: string) => venmoRequestUrl(handle(n), owes[n], game.startsAt, d.group.timezone);
    expect(new URL(link('Blair') as string).searchParams.get('amount')).toBe('11');
    expect(new URL(link('Casey') as string).searchParams.get('amount')).toBe('14');
    // Devon has no Venmo saved: no link at all.
    expect(handle('Devon')).toBeNull();
    expect(link('Devon')).toBeNull();
  });
});
