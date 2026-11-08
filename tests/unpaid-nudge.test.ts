// Zip 17: Unpaid nudge (UNPAID_NUDGE, ships OFF). The rule in shared/unpaidNudge.ts, the words, and the server's own refusal.
import { describe, expect, it } from 'vitest';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';
import {
  BLOCKED_CODE,
  blockedMessage,
  blockSheet,
  NUDGE_TOAST_MS,
  nudgeAllowed,
  nudgeState,
  nudgeToast,
  oweLine,
  oweTitle,
  UNPAID_LIMIT,
  UNPAID_NUDGE,
  unpaidGames,
  type OwedGame,
} from '../shared/unpaidNudge';
import { readFileSync } from 'node:fs';
import { activityText } from '../shared/activity';
import type { ActivityEntry } from '../shared/api';

const TZ = 'America/Detroit';
const ON = { [UNPAID_NUDGE.header]: 'on' };

// ---------- the rule ----------

const game = (startsAt: string, extra: Partial<OwedGame> = {}): OwedGame => ({
  sessionId: startsAt,
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 2 * HOUR).toISOString(),
  amountCents: 1400,
  finalized: false,
  ...extra,
});

describe('which games count (shared/unpaidNudge.ts)', () => {
  const now = Date.parse('2026-11-08T17:00:00Z'); // Sun Nov 8, noon Eastern
  it('the limit is 3, in one named setting, and the toast stays about 8 seconds (at least double the usual 3 seconds)', () => {
    expect(UNPAID_LIMIT).toBe(3);
    expect(NUDGE_TOAST_MS).toBe(8000);
    // The usual confirmation: 1.5 seconds, or 3 seconds with Animations on (live has them on).
    const ui = readFileSync('src/ui.tsx', 'utf8');
    expect(ui).toMatch(/stay: 1500,/);
    expect(ui).toMatch(/const MOTION_STAY_MS = 3000;/);
    expect(NUDGE_TOAST_MS).toBeGreaterThanOrEqual(2 * 3000);
  });
  it('a game that ended counts; an upcoming game they just signed up for does not', () => {
    const past = game('2026-11-04T00:30:00Z');
    const upcoming = game('2026-11-11T00:30:00Z');
    expect(unpaidGames([upcoming, past], now).map((o) => o.sessionId)).toEqual([past.sessionId]);
  });
  it('a game that started but has not ended does not count yet; once it ends it does', () => {
    const tonight = game('2026-11-08T16:00:00Z'); // 11 AM to 1 PM Eastern
    expect(unpaidGames([tonight], now)).toHaveLength(0);
    expect(unpaidGames([tonight], Date.parse(tonight.endsAt))).toHaveLength(1);
  });
  it('finalized, canceled late and no-show fees count at once; a late drop before its game is over does not', () => {
    const later = '2026-11-12T00:30:00Z';
    expect(unpaidGames([game(later, { finalized: true })], now)).toHaveLength(1);
    expect(unpaidGames([game(later, { lateFee: 'canceled_late' })], now)).toHaveLength(1);
    expect(unpaidGames([game(later, { lateFee: 'no_show' })], now)).toHaveLength(1);
    expect(unpaidGames([game(later, { lateFee: 'late_drop' })], now)).toHaveLength(0);
  });
  it('nothing owed (credit covered it) never counts', () => {
    expect(unpaidGames([game('2026-11-04T00:30:00Z', { amountCents: 0 })], now)).toHaveLength(0);
  });
  it('blocked at 3 or more, oldest first, the amounts added up', () => {
    const owed = [game('2026-11-06T00:30:00Z'), game('2026-11-04T00:30:00Z', { amountCents: 1100 }), game('2026-10-30T00:30:00Z')];
    expect(nudgeState(owed.slice(0, 2), now)).toMatchObject({ count: 2, cents: 2500, blocked: false });
    const st = nudgeState(owed, now);
    expect(st).toMatchObject({ count: 3, cents: 3900, blocked: true });
    expect(st.games.map((o) => o.startsAt)).toEqual(['2026-10-30T00:30:00Z', '2026-11-04T00:30:00Z', '2026-11-06T00:30:00Z']);
    expect(nudgeState(owed, now, 4).blocked).toBe(false);
  });
  it('the kill switch: allowed unless "off"', () => {
    expect(nudgeAllowed(undefined)).toBe(true);
    expect(nudgeAllowed('on')).toBe(true);
    expect(nudgeAllowed(' OFF ')).toBe(false);
  });
});

describe('the words', () => {
  const at = (iso: string, cents = 1400) => ({ startsAt: iso, amountCents: cents });
  it('the owe card: one game', () => {
    expect(oweTitle(1400)).toBe('You owe $14');
    expect(oweLine([at('2026-11-04T00:00:00Z')], TZ)).toBe('For Tue, Nov 3');
  });
  it('the owe card: several games, same amount, different amounts, one month, more than four', () => {
    expect(oweTitle(2800)).toBe('You owe $28');
    expect(oweLine([at('2026-11-06T00:30:00Z'), at('2026-11-04T00:00:00Z')], TZ)).toBe('$14 each: Nov 3 and Nov 5');
    expect(oweLine([at('2026-11-04T00:00:00Z'), at('2026-11-06T00:30:00Z', 1100)], TZ)).toBe('Nov 3 and Nov 5');
    expect(oweLine([at('2026-11-04T00:00:00Z'), at('2026-11-06T00:30:00Z'), at('2026-11-11T00:30:00Z')], TZ)).toBe('$14 each: Nov 3, 5 and 10');
    expect(oweLine([at('2026-10-30T00:00:00Z'), at('2026-11-04T00:00:00Z'), at('2026-11-06T00:30:00Z')], TZ)).toBe('$14 each: Oct 29, Nov 3 and 5');
    const five = ['2026-10-28', '2026-10-30', '2026-11-04', '2026-11-06', '2026-11-11'].map((d) => at(`${d}T00:30:00Z`));
    expect(oweLine(five, TZ)).toBe('$14 each: 5 games since Oct 27');
    // Never "pay to keep it clear".
    expect(oweLine(five, TZ)).not.toMatch(/keep/);
  });
  it('the toast', () => {
    expect(nudgeToast(2, 2800)).toEqual({ title: "You're in!", sub: 'Please pay the $28 you still owe for your 2 previous games.' });
    expect(nudgeToast(1, 1400).sub).toBe('Please pay the $14 you still owe for your previous game.');
  });
  it('the sheet and the server refusal', () => {
    expect(blockSheet(3, 4200)).toEqual({ title: 'You owe $42', line: "For your last 3 games. Once it's paid, you can sign up again.", pay: 'Pay $42' });
    expect(blockedMessage(3, 4200)).toBe("You owe $42 for your last 3 games. Once it's paid, you can sign up again.");
  });
});

// ---------- the server ----------

type W = Awaited<ReturnType<typeof setupGroup>>;

/** The next regular games after now, oldest first (Tue Oct 27, Thu Oct 29, Tue Nov 3, ...). */
async function upcoming(w: W): Promise<{ id: string; startsAt: string; endsAt: string }[]> {
  const d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
  return (d.sessions as any[]).filter((s) => Date.parse(s.startsAt) > w.app.now && s.status !== 'canceled').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
const join = async (w: W, name: string, id: string, headers: Record<string, string> = {}) => {
  const r = await (await playerPhone(w, name)).call('POST', `/api/sessions/${id}/join`, {}, headers);
  await w.app.settle();
  return r;
};
const view = async (w: W, name: string, headers: Record<string, string> = {}) => (await (await playerPhone(w, name)).call('GET', '/api/group', undefined, headers)).data;
const switchOn = (w: W, on = true) => w.organizer.call('PUT', '/api/admin/unpaid-nudge-switch', { on });

/** Blair in the first `n` games, nobody pays, then the clock moves past the last one. Returns the games. */
async function owesFor(w: W, n: number, who = 'Blair') {
  const games = await upcoming(w);
  for (const g of games.slice(0, n)) expect((await join(w, who, g.id)).status).toBe(200);
  w.app.now = Date.parse(games[n - 1].endsAt) + HOUR;
  return games;
}

describe('the server (server/unpaidNudge.ts)', () => {
  it("OFF (the switch as it ships): 3 unpaid games and I'm in works exactly as today; no new key in the player answer", async () => {
    const w = await setupGroup();
    const games = await owesFor(w, 3);
    const v = await view(w, 'Blair');
    expect(v.unpaidNudge).toBeUndefined();
    expect(v.owed).toHaveLength(3);
    expect((await join(w, 'Blair', games[3].id)).status).toBe(200);
  });

  it('ON: 2 unpaid games are allowed; the 3rd is refused by the server itself with a clear message', async () => {
    const w = await setupGroup();
    expect((await switchOn(w)).status).toBe(200);
    const games = await upcoming(w);
    for (const g of games.slice(0, 2)) await join(w, 'Blair', g.id);
    w.app.now = Date.parse(games[1].endsAt) + HOUR;
    // 2 unpaid: allowed.
    expect((await join(w, 'Blair', games[2].id)).status).toBe(200);
    w.app.now = Date.parse(games[2].endsAt) + HOUR;
    // Now 3 unpaid: refused, and the seat is not taken.
    const r = await join(w, 'Blair', games[3].id);
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ error: BLOCKED_CODE, message: "You owe $42 for your last 3 games. Once it's paid, you can sign up again." });
    const v = await view(w, 'Blair');
    expect(v.unpaidNudge).toEqual({ limit: 3 });
    expect(v.sessions.find((s: any) => s.id === games[3].id).mine).toBeFalsy();
  });

  it('signing up works again right after they pay (I paid, waiting for the organizer, like the owe card)', async () => {
    const w = await setupGroup();
    await switchOn(w);
    const games = await owesFor(w, 3);
    expect((await join(w, 'Blair', games[3].id)).status).toBe(409);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${games[0].id}/paid`, { paid: true, cents: 1400 })).status).toBe(200);
    expect((await join(w, 'Blair', games[3].id)).status).toBe(200);
  });

  it('also when the organizer marks one paid', async () => {
    const w = await setupGroup();
    await switchOn(w);
    const games = await owesFor(w, 3);
    await w.organizer.call('POST', `/api/admin/sessions/${games[1].id}/payment`, { playerId: w.byName.Blair, paid: true });
    expect((await join(w, 'Blair', games[3].id)).status).toBe(200);
  });

  it('a game paid with credit is not owed, so it does not count', async () => {
    const w = await setupGroup();
    await switchOn(w);
    const games = await upcoming(w);
    // $14 of credit: Blair paid for a later game that was then canceled.
    const later = games[6];
    await join(w, 'Blair', later.id);
    await w.organizer.call('POST', `/api/admin/sessions/${later.id}/payment`, { playerId: w.byName.Blair, paid: true });
    expect((await w.organizer.call('POST', `/api/admin/sessions/${later.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    // The credit pays the first game at I'm in; the next two stay unpaid.
    for (const g of games.slice(0, 3)) await join(w, 'Blair', g.id);
    w.app.now = Date.parse(games[2].endsAt) + HOUR;
    const v = await view(w, 'Blair');
    expect(v.owed.map((o: any) => o.sessionId)).toEqual([games[1].id, games[2].id]);
    expect((await join(w, 'Blair', games[3].id)).status).toBe(200);
  });

  it('upcoming games they have not paid for yet never count', async () => {
    const w = await setupGroup();
    await switchOn(w);
    const games = await upcoming(w);
    for (const g of games.slice(0, 4)) expect((await join(w, 'Casey', g.id)).status).toBe(200);
    expect((await join(w, 'Casey', games[4].id)).status).toBe(200);
  });

  it('dropping out, I paid and Use credit stay allowed while blocked', async () => {
    const w = await setupGroup();
    await switchOn(w);
    const games = await upcoming(w);
    // In a later game before the balance built up.
    await join(w, 'Blair', games[5].id);
    for (const g of games.slice(0, 3)) await join(w, 'Blair', g.id);
    w.app.now = Date.parse(games[2].endsAt) + HOUR;
    expect((await join(w, 'Blair', games[3].id)).status).toBe(409);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${games[5].id}/withdraw`, {})).status).toBe(200);
    // Already in a game: I'm in again there is not a new sign-up and is never refused.
    await w.organizer.call('POST', `/api/admin/sessions/${games[4].id}/roster`, { playerId: w.byName.Blair, action: 'confirm' });
    expect((await join(w, 'Blair', games[4].id)).status).toBe(200);
  });

  it('the organizer can still add a blocked player from admin', async () => {
    const w = await setupGroup();
    await switchOn(w);
    const games = await owesFor(w, 3);
    expect((await join(w, 'Blair', games[3].id)).status).toBe(409);
    const add = await w.organizer.call('POST', `/api/admin/sessions/${games[3].id}/roster`, { playerId: w.byName.Blair, action: 'confirm' });
    expect(add.status).toBe(200);
    const v = await view(w, 'Blair');
    expect(v.sessions.find((s: any) => s.id === games[3].id).mine.status).toBe('confirmed');
  });

  it('the organizer is never blocked (never owes the group), on admin or on the player page', async () => {
    const w = await setupGroup();
    // Alex is the organizer's own player (the same as on live).
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    await switchOn(w);
    const games = await upcoming(w);
    for (const g of games.slice(0, 3)) expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    w.app.now = Date.parse(games[2].endsAt) + HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${games[3].id}/me`, { in: true })).status).toBe(200);
    const orgId = (await w.organizer.call('GET', '/api/admin/dashboard')).data.group.organizerPlayerId as string | undefined;
    const orgName = orgId ? w.players.find((p) => p.id === orgId)?.name : undefined;
    if (orgName) {
      expect((await join(w, orgName, games[4].id)).status).toBe(200);
      expect((await view(w, orgName)).unpaidNudge).toBeUndefined();
    }
  });

  it('a claim link (a sign-up from a text) is refused too; the private test link alone turns it on for one phone; the kill switch wins', async () => {
    const w = await setupGroup();
    const games = await owesFor(w, 3);
    // No Settings row: only a phone with the private link is blocked.
    expect((await join(w, 'Blair', games[3].id, ON)).status).toBe(409);
    expect((await view(w, 'Blair', ON)).unpaidNudge).toEqual({ limit: 3 });
    // The kill switch: nobody, not even the test link.
    w.app.env.UNPAID_NUDGE = 'off';
    expect((await view(w, 'Blair', ON)).unpaidNudge).toBeUndefined();
    w.app.env.UNPAID_NUDGE = 'on';
    await switchOn(w);
    const links = await w.organizer.call('POST', `/api/admin/sessions/${games[3].id}/links`, { kind: 'claim', playerIds: [w.byName.Blair] });
    expect(links.status).toBe(200);
    const url = links.data.drafts[0]?.url as string | undefined;
    expect(url).toBeTruthy();
    const token = url!.split('/t/')[1];
    const claim = await w.app.client().call('POST', '/api/link/act', { token, action: 'claim' });
    expect(claim.status).toBe(409);
    expect(claim.data.error).toBe(BLOCKED_CODE);
    // Then it is off for everyone: the same link works.
    await switchOn(w, false);
    expect((await w.app.client().call('POST', '/api/link/act', { token, action: 'claim' })).status).toBe(200);
  });

  it('no one sees another player\'s balance: Casey\'s answer carries only Casey\'s own games', async () => {
    const w = await setupGroup();
    await switchOn(w);
    const games = await owesFor(w, 3);
    await join(w, 'Casey', games[4].id);
    const v = await view(w, 'Casey');
    expect(v.owed.map((o: any) => o.sessionId)).toEqual([games[4].id]);
    expect(v.unpaidNudge).toEqual({ limit: 3 });
    expect(JSON.stringify(v)).not.toMatch(/4200|\$42/);
  });

  it('Settings > Feature switches > "Unpaid nudge": on and off, one History line each, the dashboard flag', async () => {
    const w = await setupGroup();
    expect((await w.organizer.call('GET', '/api/admin/dashboard')).data.unpaidNudgeForAll).toBeUndefined();
    await switchOn(w);
    expect((await w.organizer.call('GET', '/api/admin/dashboard')).data.unpaidNudgeForAll).toBe(true);
    await switchOn(w, false);
    expect((await w.organizer.call('GET', '/api/admin/dashboard')).data.unpaidNudgeForAll).toBeUndefined();
    const entries = (await w.organizer.call('GET', '/api/admin/activity')).data.entries as ActivityEntry[];
    expect(entries.map((e) => activityText(e, TZ, 'Alex')).sort()).toEqual(['Alex switched "Unpaid nudge" off', 'Alex switched "Unpaid nudge" on']);
    // A player cannot flip it.
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('PUT', '/api/admin/unpaid-nudge-switch', { on: true })).status).toBe(401);
  });

  it('the owe card and the check read the same numbers (owed moved to server/owed.ts unchanged)', async () => {
    const app = new TestApp();
    const w = await setupGroup(app);
    await switchOn(w);
    const games = await owesFor(w, 2);
    const v = await view(w, 'Blair');
    const st = nudgeState(v.owed, Date.parse(v.now), v.unpaidNudge.limit);
    expect(st).toMatchObject({ count: 2, cents: 2800, blocked: false });
    expect(v.payDue.map((o: any) => o.sessionId)).toEqual(games.slice(0, 2).map((g) => g.id));
  });
});
