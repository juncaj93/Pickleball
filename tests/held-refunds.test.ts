import { describe, expect, it } from 'vitest';
import { backupToSql } from '../scripts/backup-sql.mjs';
import { parseVenmoHandle, refundNote, venmoHandleText, venmoRefundUrl } from '../shared/money';
import { balanceOf, buildTodo, heldCents } from '../src/pages/admin/todo';
import { createNodeD1 } from '../dev/nodeD1';
import { DAY, playerPhone, PLAYER_NAMES, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const ME = 'Alex';
/** The note on a Venmo refund of credit (src/pages/admin/HomeCards.tsx and PlayersTab.tsx). */
const CREDIT_NOTE = 'Pickleball credit refund';

async function dash(ctx: Ctx) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
}
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
async function join(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
}
async function pay(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true })).status).toBe(200);
}
const money = async (ctx: Ctx, month: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
const cancel = (ctx: Ctx, id: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true });
const finalize = async (ctx: Ctx, s: any) => {
  ctx.app.now = Math.max(ctx.app.now, Date.parse(s.endsAt) + 60_000);
  const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
  expect(res.status, res.text).toBe(200);
};
const requestRefund = async (ctx: Ctx, name: string, cents: number) => (await playerPhone(ctx, name)).call('POST', '/api/me/refund-request', { cents });
const resolve = (ctx: Ctx, id: string, action: 'refunded' | 'not_now' | 'undo') => ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action });
const requestsOn = (d: any) => buildTodo(d).filter((i) => i.kind === 'refund_request') as { kind: 'refund_request'; request: any }[];
const seat = (d: any, sid: string, n: string) => d.sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === n);
const pot = async (ctx: Ctx, n: string) => (await dash(ctx)).creditLedger.find((p: any) => p.playerId === ctx.byName[n])?.balanceCents ?? 0;
const credit = async (ctx: Ctx, n: string) => (await (await playerPhone(ctx, n)).call('GET', '/api/group')).data.credit;
const putPlayer = (ctx: Ctx, name: string, extra: Record<string, unknown>) =>
  ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName[name]}`, { name, isRegular: true, isActive: true, canReceiveSubstituteInvites: true, ...extra });
const MITCH = 'Casey'; // plays the part of Mitchell: pays ahead for two games

describe('Venmo link or @name', () => {
  it('reads every link form and @name down to just the username', () => {
    for (const input of ['@Mitchel-K', ' @Mitchel-K ', 'venmo.com/u/Mitchel-K', 'https://venmo.com/u/Mitchel-K', 'https://account.venmo.com/u/Mitchel-K?x=1', 'www.venmo.com/Mitchel-K', 'https://venmo.com/Mitchel-K/']) {
      expect(parseVenmoHandle(input), input).toEqual({ ok: true, handle: 'Mitchel-K' });
    }
    expect(parseVenmoHandle('https://venmo.com/code?user_id=1234567890')).toEqual({ ok: true, handle: 'id:1234567890' });
    expect(parseVenmoHandle('')).toEqual({ ok: true, handle: null });
    expect(parseVenmoHandle('   ')).toEqual({ ok: true, handle: null });
    expect(parseVenmoHandle(null)).toEqual({ ok: true, handle: null });
  });
  it('refuses what it cannot read, an apostrophe name, or another website', () => {
    for (const input of ['Mitchel', 'hello there', "@O'Brien", '@', '@a', 'https://example.com/u/Mitchel-K', 'venmo.com/u/', 'venmo.com/code', 'venmo.com/u/bad name', 'https://venmo.com/code?user_id=abc', 'javascript:alert(1)', 42]) {
      expect(parseVenmoHandle(input), String(input)).toEqual({ ok: false });
    }
  });
  it('reads back cleanly', () => {
    expect(venmoHandleText('Mitchel-K')).toBe('@Mitchel-K');
    expect(venmoHandleText('id:123456')).toBe('venmo.com/code?user_id=123456');
    expect(venmoHandleText(null)).toBe('');
    expect(parseVenmoHandle(venmoHandleText('id:123456'))).toEqual({ ok: true, handle: 'id:123456' });
  });
});

describe('Venmo refund link', () => {
  it('has the exact amount and the note, with %20 spaces, addressed when a Venmo is saved', () => {
    const note = refundNote('2026-10-30T00:00:00.000Z', TZ);
    expect(note).toBe('Pickleball Thu Oct 29 refund');
    const a = venmoRefundUrl('Mitchel-K', 1400, note);
    expect(a.url).toBe('https://venmo.com/?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20Thu%20Oct%2029%20refund');
    expect(a.appUrl).toBe('venmo://paycharge?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20Thu%20Oct%2029%20refund');
    expect(a.addressed).toBe(true);
    expect(a.url).not.toContain('+');
    // A $9 amount (a smaller refund request) and a half dollar.
    expect(venmoRefundUrl('x_y', 900, note).url).toContain('amount=9&');
    expect(venmoRefundUrl('x_y', 1450, note).url).toContain('amount=14.50&');
    expect(venmoRefundUrl('id:1234567890', 1400, note).url).toContain('recipients=1234567890&');
  });
  it('without a saved Venmo, leaves the person for you to pick', () => {
    const b = venmoRefundUrl(null, 1400, 'Pickleball Thu Oct 29 refund');
    expect(b.url).toBe('https://venmo.com/?txn=pay&amount=14&note=Pickleball%20Thu%20Oct%2029%20refund');
    expect(b.appUrl).toBe('venmo://paycharge?txn=pay&amount=14&note=Pickleball%20Thu%20Oct%2029%20refund');
    expect(b.addressed).toBe(false);
    expect(b.url).not.toContain('recipients');
  });
});

describe('Venmo on the player Edit screen', () => {
  it('saves a pasted link or @name, shows the username, keeps it when left out, clears when blank', async () => {
    const ctx = await setupGroup();
    const venmoOf = async (n: string) => (await dash(ctx)).players.find((p: any) => p.name === n).venmo;
    expect(await venmoOf(MITCH)).toBeNull(); // blank by default
    expect((await putPlayer(ctx, MITCH, { venmo: 'https://venmo.com/u/Mitchel-K?utm=share' })).status).toBe(200);
    expect(await venmoOf(MITCH)).toBe('Mitchel-K');
    expect((await putPlayer(ctx, MITCH, { phone: '(313) 555-9999' })).status).toBe(200); // field left out: kept
    expect(await venmoOf(MITCH)).toBe('Mitchel-K');
    expect((await putPlayer(ctx, MITCH, { venmo: '@Mitch_2' })).status).toBe(200);
    expect(await venmoOf(MITCH)).toBe('Mitch_2');
    expect((await putPlayer(ctx, MITCH, { venmo: 'https://venmo.com/code?user_id=998877' })).status).toBe(200);
    expect(await venmoOf(MITCH)).toBe('id:998877');
    expect((await putPlayer(ctx, MITCH, { venmo: '' })).status).toBe(200);
    expect(await venmoOf(MITCH)).toBeNull();
  });
  it('a link it cannot read gives a plain message and saves nothing', async () => {
    const ctx = await setupGroup();
    await putPlayer(ctx, MITCH, { venmo: '@Good-One' });
    for (const bad of ['mitch', "@Mitch'", 'https://facebook.com/mitch', 'venmo.com/']) {
      const res = await putPlayer(ctx, MITCH, { name: MITCH, phone: '(313) 555-0000', venmo: bad });
      expect(res.status).toBe(400);
      expect(res.data.message).toMatch(/paste the link from the Venmo app/i);
    }
    const p = (await dash(ctx)).players.find((x: any) => x.name === MITCH);
    expect(p.venmo).toBe('Good-One');
    expect(p.phone).not.toBe('(313) 555-0000'); // nothing else saved either
  });
  it('can be set when adding a person; unusual names work', async () => {
    const ctx = await setupGroup();
    const res = await ctx.organizer.call('POST', '/api/admin/players', { name: "D'Arcy O'Neil", venmo: '@Darcy_ON' });
    expect(res.status).toBe(200);
    const p = (await dash(ctx)).players.find((x: any) => x.name === "D'Arcy O'Neil");
    expect(p.venmo).toBe('Darcy_ON');
  });
  it('is in the backup file and comes back with a restore; old backups without it still restore', async () => {
    const ctx = await setupGroup();
    await putPlayer(ctx, MITCH, { venmo: '@Mitchel-K' });
    const file = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
    expect(file.tables.players.find((p: any) => p.display_name === MITCH).venmo_handle).toBe('Mitchel-K');
    const sql = backupToSql(file);
    expect(sql).toContain('venmo_handle');
    const fresh = createNodeD1(':memory:');
    (fresh as any).raw.exec(sql);
    const row = (fresh as any).raw.prepare('SELECT venmo_handle FROM players WHERE display_name = ?').get(MITCH);
    expect(row.venmo_handle).toBe('Mitchel-K');
    // A backup made before this field existed has no such column; it restores with the field blank.
    const old = JSON.parse(JSON.stringify(file));
    for (const p of old.tables.players) delete p.venmo_handle;
    const fresh2 = createNodeD1(':memory:');
    (fresh2 as any).raw.exec(backupToSql(old));
    expect((fresh2 as any).raw.prepare('SELECT venmo_handle FROM players WHERE display_name = ?').get(MITCH).venmo_handle).toBeNull();
  });
  it('never appears in any player-facing response, View as, or the player list', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    for (const n of PLAYER_NAMES) await putPlayer(ctx, n, { venmo: `@Secret-${n}` });
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [MITCH, 'Blair']);
    await pay(ctx, s.id, [MITCH]);
    await cancel(ctx, s.id);
    const bodies: string[] = [];
    for (const n of PLAYER_NAMES) {
      const phone = await playerPhone(ctx, n);
      bodies.push((await phone.call('GET', '/api/group')).text);
      bodies.push((await phone.call('GET', `/api/sessions/${s.id}/calendar.ics`)).text);
      bodies.push((await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName[n] })).text);
      expect((await phone.call('GET', '/api/admin/dashboard')).status).toBe(401);
      expect((await phone.call('GET', '/api/admin/backup')).status).toBe(401);
    }
    bodies.push((await ctx.app.client().call('GET', '/api/status')).text);
    for (const t of bodies) expect(t).not.toMatch(/Secret-|venmo_handle|"venmo":|"id:\d/i);
    // And it is there for the organizer (so the check means something).
    expect(JSON.stringify(await dash(ctx))).toContain('Secret-Casey');
  });
});

describe('held money', () => {
  it('turns from held to collected when the game is finalized; the Held row is $0 (hidden) when nothing is held', async () => {
    const ctx = await setupGroup();
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    await join(ctx, a.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    expect(heldCents(await dash(ctx))).toBe(0);
    expect((await money(ctx, '2026-11')).heldCents).toBe(0);
    await pay(ctx, a.id, [MITCH]);
    await pay(ctx, b.id, [MITCH]);
    let d = await dash(ctx);
    let m = await money(ctx, '2026-11');
    // Both games are ahead: all of it is held, none collected; Left is untouched.
    expect(m).toMatchObject({ heldCents: 2800, collectedCents: 0, courtCostCents: 0, creditsOwedCents: 0, netCents: 0 });
    expect(heldCents(d)).toBe(2800);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(2800);
    expect(heldCents(d, ctx.byName.Blair)).toBe(0);
    // Tue Nov 3 is over but not finalized: still held, nothing collected, and the Finalize card is up.
    ctx.app.now = Date.parse(a.endsAt) + 60_000;
    d = await dash(ctx);
    m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ heldCents: 2800, collectedCents: 0, courtCostCents: 0 });
    expect(m.sessions.find((x: any) => x.id === a.id).state).toBe('not_finalized');
    expect(buildTodo(d).some((i) => i.kind === 'finalize' && i.session.id === a.id)).toBe(true);
    // Finalized (4 played, $14): its $14 moves to Collected.
    await finalize(ctx, a);
    d = await dash(ctx);
    m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ heldCents: 1400, collectedCents: 1400, courtCostCents: 4800 });
    expect(m.sessions.find((x: any) => x.id === a.id)).toMatchObject({ state: 'played', playedCount: 4, priceCents: 1400, collectedCents: 1400 });
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    // Thu Nov 5 is finalized too: nothing held any more.
    await finalize(ctx, b);
    m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ heldCents: 0, collectedCents: 2800, courtCostCents: 9600 });
    expect(heldCents(await dash(ctx))).toBe(0);
  });

  it('the Players tab and the Money tab agree, and your own court row is never held', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    await join(ctx, a.id, [ME, MITCH, 'Blair', 'Devon']);
    await join(ctx, b.id, [MITCH, 'Blair', 'Emery']);
    await pay(ctx, a.id, [MITCH, 'Blair']);
    await pay(ctx, b.id, [MITCH]);
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/payment`, { playerId: ctx.byName[ME], paid: true }); // Court paid ($48)
    const d = await dash(ctx);
    const m = await money(ctx, '2026-11');
    const perPlayer = d.players.map((p: any) => heldCents(d, p.id));
    expect(perPlayer.reduce((x: number, y: number) => x + y, 0)).toBe(4200);
    expect(m.heldCents).toBe(4200);
    expect(heldCents(d)).toBe(4200);
    expect(heldCents(d, ctx.byName[ME])).toBe(0);
    // Balances are what they owe, not what is held.
    expect(balanceOf(d, ctx.byName[MITCH])).toEqual({ owedCents: 0, creditCents: 0 });
    expect(m.netCents).toBe(0);
  });

  it('a canceled game\'s payment is credit, not held; a refund of that credit changes nothing about Held', async () => {
    const ctx = await setupGroup();
    const a = await on(ctx, '2026-11-03');
    await join(ctx, a.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, a.id, [MITCH]);
    await cancel(ctx, a.id);
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 0, creditsOwedCents: 1400 }); // credit right away, nothing held
    expect(heldCents(await dash(ctx))).toBe(0);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect((await requestRefund(ctx, MITCH, 1400)).status).toBe(200);
    const d = await dash(ctx);
    expect((await resolve(ctx, d.refundRequests[0].id, 'refunded')).status).toBe(200);
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 0, creditsOwedCents: 0 });
    expect(heldCents(await dash(ctx))).toBe(0);
    expect(await pot(ctx, MITCH)).toBe(0);
  });
});

describe('credit back and refund requests', () => {
  it('a canceled game with prepaid money gives credit right away, no card; a payment for another game is untouched', async () => {
    const ctx = await setupGroup();
    const thu = await on(ctx, '2026-10-29');
    const tue = await on(ctx, '2026-11-03');
    await join(ctx, thu.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await join(ctx, tue.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, thu.id, [MITCH]);
    await pay(ctx, tue.id, [MITCH]);
    await cancel(ctx, thu.id);
    let d = await dash(ctx);
    // Nothing for the organizer to decide: the $14 is his credit.
    expect(requestsOn(d)).toEqual([]);
    expect(d.refundRequests).toEqual([]);
    expect(seat(d, thu.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: expect.any(String), creditBackCents: 1400, creditBackReason: 'canceled' });
    expect(await pot(ctx, MITCH)).toBe(1400);
    // Tue Nov 3 keeps the payment: still paid and held.
    expect(seat(d, tue.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: null, creditBackCents: 0 });
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    // He asks for the money back: the card is the first thing on Home, with his name and the amount.
    expect((await requestRefund(ctx, MITCH, 1400)).status).toBe(200);
    d = await dash(ctx);
    const items = buildTodo(d);
    expect(items[0].kind).toBe('refund_request');
    expect(requestsOn(d).map((i) => [i.request.name, i.request.cents])).toEqual([[MITCH, 1400]]);
    // Mark refunded: the card goes away, Tue is still held.
    expect((await resolve(ctx, d.refundRequests[0].id, 'refunded')).status).toBe(200);
    const after = await dash(ctx);
    expect(requestsOn(after)).toEqual([]);
    expect(heldCents(after, ctx.byName[MITCH])).toBe(1400);
    expect(await pot(ctx, MITCH)).toBe(0);
  });

  it('a paid player who drops out of a game ahead gets credit right away, and can ask for it back from their screen', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-11-03');
    await join(ctx, tue.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, tue.id, [MITCH]);
    const phone = await playerPhone(ctx, MITCH);
    const res = await phone.call('POST', `/api/sessions/${tue.id}/withdraw`, {});
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    const d = await dash(ctx);
    expect(requestsOn(d)).toEqual([]);
    expect(seat(d, tue.id, MITCH)).toMatchObject({ status: 'withdrawn', creditBackCents: 1400, creditBackReason: 'dropped' });
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
    // "Your $14 is now credit. Request refund": his screen says so, and the request reserves it.
    let g = (await phone.call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === tue.id).mine).toMatchObject({ status: 'withdrawn', creditBackCents: 1400 });
    expect(g.credit).toMatchObject({ balanceCents: 1400, usableCents: 1400, pending: null });
    expect((await phone.call('POST', '/api/me/refund-request', { cents: 1400 })).status).toBe(200);
    g = (await phone.call('GET', '/api/group')).data;
    expect(g.credit).toMatchObject({ balanceCents: 1400, usableCents: 0, pending: expect.objectContaining({ cents: 1400 }) });
    expect(requestsOn(await dash(ctx))).toHaveLength(1);
    // Cancel request: usable again, the card goes.
    expect((await phone.call('POST', '/api/me/refund-request/cancel', {})).data.changed).toBe(true);
    expect((await phone.call('GET', '/api/group')).data.credit).toMatchObject({ usableCents: 1400, pending: null });
    expect(requestsOn(await dash(ctx))).toEqual([]);
  });

  it('request, Mark refunded, Not now, undo: the cards, the balances and the month follow', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-11-03');
    await join(ctx, tue.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, tue.id, [MITCH, 'Blair']);
    await cancel(ctx, tue.id);
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 0, creditsOwedCents: 2800 });
    expect((await requestRefund(ctx, MITCH, 1400)).status).toBe(200);
    expect((await requestRefund(ctx, 'Blair', 1400)).status).toBe(200);
    let d = await dash(ctx);
    expect(requestsOn(d)).toHaveLength(2);
    // Mark refunded, one person.
    const mitchReq = d.refundRequests.find((r: any) => r.name === MITCH).id;
    const blairReq = d.refundRequests.find((r: any) => r.name === 'Blair').id;
    expect((await resolve(ctx, mitchReq, 'refunded')).data.changed).toBe(true);
    d = await dash(ctx);
    expect(requestsOn(d)).toHaveLength(1); // Blair still to go
    expect((await money(ctx, '2026-11')).creditsOwedCents).toBe(1400);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect(await credit(ctx, MITCH)).toMatchObject({ balanceCents: 0, pending: null });
    // Not now for Blair: the card goes and her credit is usable again.
    expect((await resolve(ctx, blairReq, 'not_now')).status).toBe(200);
    d = await dash(ctx);
    expect(requestsOn(d)).toEqual([]);
    expect(await credit(ctx, 'Blair')).toMatchObject({ balanceCents: 1400, usableCents: 1400, pending: null });
    expect((await resolve(ctx, blairReq, 'refunded')).status).toBe(409); // closed
    // Undo Mitch's: the credit is back and his request waits again.
    expect((await resolve(ctx, mitchReq, 'undo')).data.changed).toBe(true);
    d = await dash(ctx);
    expect(requestsOn(d)).toHaveLength(1);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(await credit(ctx, MITCH)).toMatchObject({ balanceCents: 1400, usableCents: 0, pending: expect.objectContaining({ cents: 1400 }) });
    expect((await money(ctx, '2026-11')).creditsOwedCents).toBe(2800);
    // The log has it, and a canceled game never counts in Collected or Court costs.
    const log = d.audit.map((a: any) => a.action);
    for (const a of ['refund_requested', 'credit_refund_marked', 'refund_request_declined', 'credit_refund_undone']) expect(log).toContain(a);
    expect(await money(ctx, '2026-11')).toMatchObject({ collectedCents: 0, courtCostCents: 0, netCents: 0 });
  });

  it('the refund link uses the player saved Venmo and the exact amount requested (less than the balance too), or falls back', async () => {
    const ctx = await setupGroup();
    await putPlayer(ctx, MITCH, { venmo: 'https://venmo.com/u/Mitchel-K' });
    const s = await on(ctx, '2026-10-29');
    await join(ctx, s.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, s.id, [MITCH, 'Blair']);
    await cancel(ctx, s.id);
    expect((await requestRefund(ctx, MITCH, 1400)).status).toBe(200);
    expect((await requestRefund(ctx, 'Blair', 1500)).status).toBe(409); // more than she has
    expect((await requestRefund(ctx, 'Blair', 950)).status).toBe(400); // whole dollars only
    expect((await requestRefund(ctx, 'Blair', 900)).status).toBe(200); // less than the balance is fine
    const d = await dash(ctx);
    const links = d.refundRequests.map((r: any) => venmoRefundUrl(r.venmo, r.cents, CREDIT_NOTE).url);
    expect(links).toEqual([
      'https://venmo.com/?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20credit%20refund',
      'https://venmo.com/?txn=pay&amount=9&note=Pickleball%20credit%20refund', // Blair has none saved
    ]);
    // Blair keeps the other $5 to spend; the Players tab offers that much to pay back.
    expect(d.creditLedger.find((l: any) => l.playerId === ctx.byName.Blair)).toMatchObject({ balanceCents: 1400, reservedCents: 900, refundCents: 500 });
    expect(await credit(ctx, 'Blair')).toMatchObject({ balanceCents: 1400, usableCents: 500 });
  });
});

describe('money for a game that is over', () => {
  it('stays held until finalized, with a Finalize card and never a refund card by itself', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, s.id, [MITCH]);
    ctx.app.now = Date.parse(s.endsAt) + DAY;
    let d = await dash(ctx);
    expect(heldCents(d)).toBe(1400);
    expect(buildTodo(d).map((i) => i.kind)).toEqual(['finalize', 'owed']);
    expect(requestsOn(d)).toEqual([]);
    await finalize(ctx, s);
    d = await dash(ctx);
    expect(heldCents(d)).toBe(0);
    expect(buildTodo(d).some((i) => i.kind === 'finalize')).toBe(false);
    expect(seat(d, s.id, MITCH)).toMatchObject({ played: true, creditBackCents: 0 });
  });
});
