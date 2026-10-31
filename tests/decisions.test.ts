import { describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { BACKUP_TABLES } from '../server/admin';
import { checkInMessage } from '../shared/messages';
import { backupToSql, TABLES } from '../scripts/restore-backup.mjs';
import { DAY, HOUR, PIN, firstSession, playerPhone, setupGroup, TestApp } from './harness';

// The organizer's answers to the audit's decision list (docs/AUDIT.md).

const TZ = 'America/Detroit';

/** Every row of every backed-up table, sorted, so two databases can be compared. */
function snapshot(db: ReturnType<typeof createNodeD1>) {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = db.raw.prepare(`SELECT * FROM ${t} ORDER BY id`).all().map((r) => ({ ...r }));
  return out;
}

/** A group with a bit of everything: 6 in, payments, a finalized game with credit back, a canceled game with people in it, a refund request, texts, activity. */
async function busyGroup() {
  const ctx = await setupGroup();
  const s = await firstSession(ctx);
  const names = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
  for (const n of names) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
  await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
  await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/links`, { kind: 'attendance' });
  const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const later = dash.sessions.filter((x: { startsAt: string }) => Date.parse(x.startsAt) > Date.parse(s.startsAt))[1];
  await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${later.id}/join`, {});
  await ctx.organizer.call('POST', `/api/admin/sessions/${later.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
  await ctx.organizer.call('POST', `/api/admin/sessions/${later.id}/decision`, { decision: 'cancel', confirm: true });
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin', venueAddress: "O'Brien's Courts, Northville" });
  await ctx.organizer.call('POST', '/api/admin/players', { name: 'Zoë O’Neil 🏓', phone: '(248) 555-0199' });
  ctx.app.advance(Date.parse(s.endsAt) - ctx.app.now + HOUR); // the 6-player game ends
  // Finalized at 6 played: Alex paid $14 and gets $5 back as credit. Blair's canceled $14 is credit too, and asks for it back.
  const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
  if (fin.status !== 200) throw new Error(fin.text);
  const req = await (await playerPhone(ctx, 'Blair')).call('POST', '/api/me/refund-request', { cents: 1400 });
  if (req.status !== 200) throw new Error(req.text);
  await ctx.organizer.call('GET', '/api/admin/dashboard');
  return { ctx, s, later };
}

describe('backup file', () => {
  it('is organizer only', async () => {
    const ctx = await setupGroup();
    expect((await ctx.app.client().call('GET', '/api/admin/backup')).status).toBe(401);
    expect((await (await playerPhone(ctx, 'Alex')).call('GET', '/api/admin/backup')).status).toBe(401);
  });

  it('downloads as a dated file with every table the restore needs', async () => {
    const { ctx } = await busyGroup();
    const res = await ctx.organizer.call('GET', '/api/admin/backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="pickleball-backup-2026-10-2\d\.json"/);
    expect(res.data.format).toBe('pickleball-backup');
    expect([...BACKUP_TABLES]).toEqual(TABLES);
    for (const t of TABLES) expect(Array.isArray(res.data.tables[t]), t).toBe(true);
    // Alex's $5 from the finalized game and Blair's $14 from the canceled one; Blair's open request.
    expect(res.data.tables.credit_ledger.map((e: { kind: string; amount_cents: number }) => [e.kind, e.amount_cents]).sort((a: [string, number], b: [string, number]) => a[1] - b[1])).toEqual([['kept', 500], ['kept', 1400]]);
    expect(res.data.tables.refund_requests).toHaveLength(1);
    expect(res.data.tables.sessions.filter((x: { finalized_at: string | null }) => x.finalized_at)).toHaveLength(1);
    expect(res.data.tables.players.some((p: { phone_number: string }) => p.phone_number === '(248) 555-0199')).toBe(true);
  });

  it('restores into an empty database exactly, row for row', async () => {
    const { ctx } = await busyGroup();
    const backup = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
    const fresh = createNodeD1(':memory:');
    fresh.raw.exec(backupToSql(backup));
    expect(snapshot(fresh)).toEqual(snapshot(ctx.app.db));
  });

  it('restores over changed data, and the site works on the restored copy (PIN, phones, money)', async () => {
    const { ctx, later } = await busyGroup();
    const backup = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
    const want = snapshot(ctx.app.db);
    // Things go wrong after the backup.
    await ctx.organizer.call('DELETE', `/api/admin/players/${ctx.byName.Frankie}`);
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Oops' });
    ctx.app.db.raw.exec(backupToSql(backup));
    expect(snapshot(ctx.app.db)).toEqual(want);
    // Organizer devices were signed out; the PIN from the backup works.
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).status).toBe(401);
    expect((await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.group.name).toBe('Tuesday Thursday Dinks');
    expect(d.creditLedger.map((l: { playerId: string; balanceCents: number }) => [l.playerId, l.balanceCents]).sort()).toEqual([[ctx.byName.Alex, 500], [ctx.byName.Blair, 1400]].sort());
    expect(d.refundRequests).toMatchObject([{ name: 'Blair', cents: 1400 }]);
    expect(d.sessions.find((x: { id: string }) => x.id === later.id).status).toBe('canceled');
    expect(d.players.some((p: { name: string }) => p.name === 'Frankie')).toBe(true);
  });

  it('refuses a file that is not a backup', () => {
    expect(() => backupToSql({ hello: 1 })).toThrow('not a Pickleball Bros backup');
    expect(() => backupToSql({ format: 'pickleball-backup', version: 1, tables: { groups: [] } })).toThrow('missing');
  });

  it('works on an empty group too (no games played yet)', async () => {
    const app = new TestApp();
    const { setupGroup: setup } = await import('./harness');
    const ctx = await setup(app);
    const backup = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
    const fresh = createNodeD1(':memory:');
    fresh.raw.exec(backupToSql(backup));
    expect(snapshot(fresh)).toEqual(snapshot(ctx.app.db));
  });
});

describe('unpaid amounts stay until paid', () => {
  it('a game 4 months ago that was never paid still shows to the player and the organizer', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    ctx.app.advance(120 * DAY);
    const g = (await alex.call('GET', '/api/group')).data;
    expect(g.owed.map((o: { sessionId: string }) => o.sessionId)).toContain(s.id);
    expect(g.payDue.map((o: { sessionId: string }) => o.sessionId)).toContain(s.id);
    // The organizer's 30-day sign-in ran out meanwhile.
    await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN });
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const row = d.sessions.find((x: { id: string }) => x.id === s.id)?.roster.find((r: { name: string }) => r.name === 'Alex');
    expect(row?.paymentStatus).toBe('unpaid');
    // Once paid, it goes away like before.
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    expect((await alex.call('GET', '/api/group')).data.owed).toEqual([]);
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.some((x: { id: string }) => x.id === s.id)).toBe(false);
  });
});

describe('check-in wording', () => {
  it('says "tonight" for the usual game and "today" for one before 5:00 PM', () => {
    const at = (start: string, end: string) => ({ startsAt: start, endsAt: end });
    const noon = (iso: string) => Date.parse(iso);
    expect(checkInMessage(at('2026-11-04T01:00:00Z', '2026-11-04T03:00:00Z'), TZ, noon('2026-11-03T15:00:00Z'), 'L')).toBe('Pickleball tonight, 8:00 PM. Can\'t make it? Update here: L');
    expect(checkInMessage(at('2026-11-07T15:00:00Z', '2026-11-07T17:00:00Z'), TZ, noon('2026-11-07T11:00:00Z'), 'L')).toBe('Pickleball today, 10:00 AM. Can\'t make it? Update here: L');
    expect(checkInMessage(at('2026-11-07T21:30:00Z', '2026-11-07T23:30:00Z'), TZ, noon('2026-11-07T11:00:00Z'), 'L')).toBe('Pickleball today, 4:30 PM. Can\'t make it? Update here: L');
    expect(checkInMessage(at('2026-11-07T22:00:00Z', '2026-11-08T00:00:00Z'), TZ, noon('2026-11-07T11:00:00Z'), 'L')).toBe('Pickleball tonight, 5:00 PM. Can\'t make it? Update here: L');
  });
});

describe('the 5th and 6th simply join, and a drop from 6 moves nobody', () => {
  it('no promotion, no "we now have 6", to the player or on the organizer\'s roster; the count reads "6 in" then "5 in"', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const names = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    for (const n of names) expect((await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'confirmed' });
    const emery = await playerPhone(ctx, 'Emery');
    const view = async () => (await emery.call('GET', '/api/group')).data.sessions.find((x: { id: string }) => x.id === s.id);
    let v = await view();
    expect(v.mine.promotion).toBeNull();
    expect(v.mine.shareCents).toBe(1400);
    expect(v.countText).toBe('6 in');
    await (await playerPhone(ctx, 'Frankie')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    v = await view();
    expect(v.mine.promotion).toBeNull();
    expect(v.countText).toBe('5 in');
    expect(v.confirmed).toHaveLength(5);
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const x = d.sessions.find((x: { id: string }) => x.id === s.id);
    expect(x.confirmedCount).toBe(5);
    expect(x.roster.filter((r: { status: string }) => r.status === 'confirmed').every((r: { promotionReason: string | null; promotedAt: string | null }) => r.promotionReason === null && r.promotedAt === null)).toBe(true);
    expect(x.roster.find((r: { name: string }) => r.name === 'Emery')).not.toHaveProperty('discount');
  });
});

describe('credit shows once, where it applies', () => {
  it('player screen: in the pot until used, then on the game it comes off; Players tab: "credit $5" until it is used, then "owes $9", never both', async () => {
    const { balanceOf } = await import('../src/pages/admin/todo');
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const names = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    for (const n of names) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    ctx.app.advance(Date.parse(s.endsAt) - ctx.app.now + HOUR);
    // Finalized at 6 played ($9 each): Alex paid $14 and gets $5 back as credit.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    const alex = await playerPhone(ctx, 'Alex');
    let g = (await alex.call('GET', '/api/group')).data;
    expect(g.credit).toMatchObject({ balanceCents: 500, usableCents: 500, pending: null });
    expect(g.credit.history).toMatchObject([{ kind: 'kept', cents: 500, reason: 'finalized', playedCount: 6, sessionId: s.id }]);
    // Not in any upcoming game: no credit used on any card.
    expect(g.sessions.every((x: any) => !x.mine || x.mine.creditCents === 0)).toBe(true);
    let d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(balanceOf(d, ctx.byName.Alex)).toEqual({ owedCents: 0, creditCents: 500 });
    // He joins a game: the $5 is used on it as he joins (credit at sign-up is automatic). It sits on that game only, $9 left to pay.
    const next = g.sessions.find((x: any) => !x.mine && !x.past);
    expect((await alex.call('POST', `/api/sessions/${next.id}/join`, {})).data).toEqual({ result: 'confirmed', creditCents: 500, paidWithCredit: false });
    g = (await alex.call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === next.id).mine).toMatchObject({ oweCents: 900, creditCents: 500, useCreditCents: 0, shareCents: 1400, paymentStatus: 'unpaid' });
    expect((await alex.call('POST', `/api/sessions/${next.id}/use-credit`, {})).status).toBe(409); // nothing left to tap
    expect(g.credit.balanceCents).toBe(0);
    expect(g.sessions.filter((x: any) => x.mine?.creditCents > 0).map((x: any) => [x.id, x.mine.oweCents, x.mine.creditCents])).toEqual([[next.id, 900, 500]]);
    // From the day before: Players tab says owes $9, and no extra credit.
    ctx.app.now = Date.parse(next.startsAt) - 20 * HOUR;
    await ctx.organizer.call('POST', '/api/admin/login', { pin: '246810' });
    d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(balanceOf(d, ctx.byName.Alex)).toEqual({ owedCents: 900, creditCents: 0 });
    const row = d.sessions.find((x: any) => x.id === next.id).roster.find((r: any) => r.name === 'Alex');
    expect(row).toMatchObject({ owesCents: 900, creditCents: 500, shareCents: 1400, paymentStatus: 'unpaid' });
    // The game-day pay card on the player's screen agrees.
    ctx.app.now = Date.parse(next.startsAt) - 11 * HOUR;
    g = (await alex.call('GET', '/api/group')).data;
    expect(g.payDue.map((o: any) => [o.amountCents, o.creditCents, o.finalized])).toEqual([[900, 500, false]]);
  });
});
