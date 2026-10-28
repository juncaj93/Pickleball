import { describe, expect, it } from 'vitest';
import { backupToSql } from '../scripts/backup-sql.mjs';
import { parseVenmoHandle, refundNote, venmoHandleText, venmoRefundUrl } from '../shared/money';
import { balanceOf, buildTodo, heldCents, refundRows } from '../src/pages/admin/todo';
import { createNodeD1 } from '../dev/nodeD1';
import { DAY, playerPhone, PLAYER_NAMES, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const ME = 'Alex';

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
const refund = (ctx: Ctx, id: string, name: string, refunded: boolean) =>
  ctx.organizer.call('POST', `/api/admin/sessions/${id}/refund`, { playerId: ctx.byName[name], refunded });
const cancel = (ctx: Ctx, id: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true });
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
    // The $9 discount and a half dollar.
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
    for (const t of bodies) expect(t).not.toMatch(/Secret-|venmo_handle|"venmo":|id:\d/i);
    // And it is there for the organizer (so the check means something).
    expect(JSON.stringify(await dash(ctx))).toContain('Secret-Casey');
  });
});

describe('held money', () => {
  it('turns from held to collected when the game is played; the Held row is $0 (hidden) when nothing is held', async () => {
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
    // Tue Nov 3 is played: its $14 moves to Collected.
    ctx.app.now = Date.parse(a.endsAt) + 60_000;
    d = await dash(ctx);
    m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ heldCents: 1400, collectedCents: 1400, courtCostCents: 4800 });
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    // Thu Nov 5 is played too: nothing held any more.
    ctx.app.now = Date.parse(b.endsAt) + 60_000;
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

  it('a refunded payment is no longer held', async () => {
    const ctx = await setupGroup();
    const a = await on(ctx, '2026-11-03');
    await join(ctx, a.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, a.id, [MITCH]);
    await cancel(ctx, a.id);
    expect((await money(ctx, '2026-11')).heldCents).toBe(1400); // canceled, not paid back yet: still held
    await refund(ctx, a.id, MITCH, true);
    expect((await money(ctx, '2026-11')).heldCents).toBe(0);
    expect(heldCents(await dash(ctx))).toBe(0);
  });
});

describe('refund prompt', () => {
  it('a canceled game with prepaid money shows a card; a payment for another game is untouched', async () => {
    const ctx = await setupGroup();
    const thu = await on(ctx, '2026-10-29');
    const tue = await on(ctx, '2026-11-03');
    await join(ctx, thu.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await join(ctx, tue.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, thu.id, [MITCH]);
    await pay(ctx, tue.id, [MITCH]);
    await cancel(ctx, thu.id);
    const d = await dash(ctx);
    const items = buildTodo(d);
    const refunds = items.filter((i) => i.kind === 'refund') as any[];
    expect(refunds).toHaveLength(1);
    expect(refunds[0].session.id).toBe(thu.id);
    expect(refundRows(refunds[0].session).map((r: any) => [r.name, r.paymentAmountCents])).toEqual([[MITCH, 1400]]);
    // It is the first card on Home.
    expect(items[0].kind).toBe('refund');
    // Tue Nov 3 keeps the payment: no card, still paid and held.
    const tueNow = d.sessions.find((x: any) => x.id === tue.id);
    expect(refundRows(tueNow)).toEqual([]);
    expect(tueNow.roster.find((r: any) => r.name === MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: null });
    // Refund Thu: the card goes away, Tue is still held.
    expect((await refund(ctx, thu.id, MITCH, true)).status).toBe(200);
    const after = await dash(ctx);
    expect(buildTodo(after).some((i) => i.kind === 'refund')).toBe(false);
    expect(heldCents(after, ctx.byName[MITCH])).toBe(1400);
  });

  it('a paid player who drops out of a game ahead gets a card too', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-11-03');
    await join(ctx, tue.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, tue.id, [MITCH]);
    expect((await (await playerPhone(ctx, MITCH)).call('POST', `/api/sessions/${tue.id}/withdraw`, {})).status).toBe(200);
    const d = await dash(ctx);
    const card = buildTodo(d).find((i) => i.kind === 'refund' || i.kind === 'latedrop') as any;
    expect(card).toBeDefined();
    const row = refundRows(d.sessions.find((x: any) => x.id === tue.id))[0];
    expect([row.name, row.paymentAmountCents]).toEqual([MITCH, 1400]);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
  });

  it('refund, Mark refunded, undo: Held, the card and the month follow, using the existing refund records', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-11-03');
    await join(ctx, tue.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, tue.id, [MITCH, 'Blair']);
    await cancel(ctx, tue.id);
    let d = await dash(ctx);
    expect(refundRows(d.sessions.find((x: any) => x.id === tue.id)).filter((r: any) => !r.refundedAt)).toHaveLength(2);
    expect((await money(ctx, '2026-11')).heldCents).toBe(2800);
    // Mark refunded (the record), one person.
    expect((await refund(ctx, tue.id, MITCH, true)).data.changed).toBe(true);
    d = await dash(ctx);
    expect(buildTodo(d).filter((i) => i.kind === 'refund')).toHaveLength(1); // Blair still to go
    expect((await money(ctx, '2026-11')).heldCents).toBe(1400);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
    expect((await refund(ctx, tue.id, 'Blair', true)).status).toBe(200);
    d = await dash(ctx);
    expect(buildTodo(d).some((i) => i.kind === 'refund')).toBe(false);
    expect((await money(ctx, '2026-11')).heldCents).toBe(0);
    // Undo.
    expect((await refund(ctx, tue.id, MITCH, false)).data.changed).toBe(true);
    d = await dash(ctx);
    expect(buildTodo(d).filter((i) => i.kind === 'refund')).toHaveLength(1);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    expect((await money(ctx, '2026-11')).heldCents).toBe(1400);
    // The log has it, and a canceled game never counts in Collected or Court costs.
    const log = d.audit.map((a: any) => a.action);
    expect(log).toContain('refund_marked');
    expect(log).toContain('refund_cleared');
    expect(await money(ctx, '2026-11')).toMatchObject({ collectedCents: 0, courtCostCents: 0, netCents: 0 });
  });

  it('the refund link uses the player saved Venmo and the exact amount they paid (the $9 discount too), or falls back', async () => {
    const ctx = await setupGroup();
    await putPlayer(ctx, MITCH, { venmo: 'https://venmo.com/u/Mitchel-K' });
    const s = await on(ctx, '2026-10-29');
    await join(ctx, s.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, s.id, [MITCH, 'Blair']);
    await cancel(ctx, s.id);
    const d = await dash(ctx);
    const sess = d.sessions.find((x: any) => x.id === s.id);
    const links = refundRows(sess).map((r: any) =>
      venmoRefundUrl(d.players.find((p: any) => p.id === r.playerId).venmo, r.paymentAmountCents, refundNote(sess.startsAt, TZ)).url,
    );
    expect(links).toEqual([
      'https://venmo.com/?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20Thu%20Oct%2029%20refund',
      'https://venmo.com/?txn=pay&amount=14&note=Pickleball%20Thu%20Oct%2029%20refund', // Blair has none saved
    ]);
  });
});

describe('late credits never get lost in a held refund', () => {
  it('game over: money for a played game is not held and cannot be a refund card unless the player dropped', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await pay(ctx, s.id, [MITCH]);
    ctx.app.now = Date.parse(s.endsAt) + DAY;
    const d = await dash(ctx);
    expect(heldCents(d)).toBe(0);
    expect(buildTodo(d).some((i) => i.kind === 'refund')).toBe(false);
  });
});
