// A game whose court is not booked looks like a normal game to players (src/courtDisplay.ts):
// "Court not booked", "3 of 4 in", "I'm in" / "You're in", no waitlist, waiting or standby words,
// and no money prompts until the court is booked. Display only: the records behind it never change.
//
// The cards below are the real player card, rendered on data from the real API.
vi.hoisted(() => {
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GroupView, PlayerSessionView } from '../shared/api';
import { courtStatus } from '../shared/court';
import { courtDisplay, isNoCourt } from '../src/courtDisplay';
// The page is TSX and is type-checked in the app project; this test only renders it.
// @ts-ignore
import { joinedText, ScheduleRow } from '../src/pages/PlayerHome';
import { playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const FORBIDDEN = /waitlist|waiting|standby/i;
const PAY = /\bdue\b|\bleft to pay\b|\bPay\b|I paid|Use credit/;

const sessionsOf = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.filter((s: any) => Date.parse(s.startsAt) > ctx.app.now);
const raw = async (ctx: Ctx, name: string): Promise<GroupView> => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data;
const shown = async (ctx: Ctx, name: string) => courtDisplay(await raw(ctx, name));
const post = async (ctx: Ctx, name: string, path: string, body: unknown = {}) => (await playerPhone(ctx, name)).call('POST', path, body);

/** The player's card for one game, as text (screen-reader text included). */
function card(g: GroupView, id: string): string {
  const s = g.sessions.find((x) => x.id === id) as PlayerSessionView;
  const html = renderToStaticMarkup(createElement(ScheduleRow, { s, g, tier: 'next', onChanged: async () => {}, setOverlay: () => {}, joinToast: () => {} }));
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** Three games: [0] no court booked, [1] on the court waitlist, [2] court booked. Three people in the court-waitlist game before it went on the list. */
async function scene() {
  const ctx = await setupGroup();
  const [noCourt, waitlisted, booked] = (await sessionsOf(ctx)).slice(2, 5);
  await ctx.organizer.call('POST', `/api/admin/sessions/${booked.id}/booked`, {});
  for (const n of ['Alex', 'Blair', 'Casey']) await post(ctx, n, `/api/sessions/${waitlisted.id}/join`);
  await ctx.organizer.call('POST', `/api/admin/sessions/${waitlisted.id}/court`, { action: 'waitlist' });
  return { ctx, noCourt, waitlisted, booked };
}
const unbook = (ctx: Ctx, id: string) => ctx.organizer.call('PUT', `/api/admin/sessions/${id}/booking`, { bookingStatus: 'needs_booking', courtCostCents: null });

describe('which games count as having no court', () => {
  it('not booked, booking not open yet, and on the court waitlist; not booked games that are booked, canceled or played', async () => {
    const { ctx, noCourt, waitlisted, booked } = await scene();
    const g = await raw(ctx, 'Devon');
    const by = (id: string) => g.sessions.find((x) => x.id === id)!;
    expect(isNoCourt(by(noCourt.id))).toBe(true);
    expect(isNoCourt(by(waitlisted.id))).toBe(true);
    expect(isNoCourt(by(booked.id))).toBe(false);
    expect(courtStatus(by(waitlisted.id)).playerText).toBe('Court not booked');
  });
});

describe('(a) no words about waiting on a game with no court', () => {
  it('the card never says waitlist, waiting or standby, for someone not in, someone in, and someone put on the list', async () => {
    const { ctx, noCourt, waitlisted } = await scene();
    for (const n of ['Emery', 'Frankie']) await post(ctx, n, `/api/sessions/${waitlisted.id}/join`); // answered "standby" behind the scenes
    expect((await raw(ctx, 'Emery')).sessions.find((s) => s.id === waitlisted.id)!.mine!.status).toBe('waitlisted'); // the record is unchanged
    await post(ctx, 'Blair', `/api/sessions/${noCourt.id}/join`);
    for (const who of ['Devon', 'Alex', 'Emery', 'Frankie', 'Blair']) {
      const g = await shown(ctx, who);
      for (const id of [noCourt.id, waitlisted.id]) expect(card(g, id), `${who}: ${card(g, id)}`).not.toMatch(FORBIDDEN);
      expect(card(g, waitlisted.id)).toContain('Court not booked');
    }
    // The Want in prompt too.
    const g = await shown(ctx, 'Devon');
    if (g.suggestion) expect(JSON.stringify(g.suggestion)).not.toMatch(FORBIDDEN);
  });
  it('the count reads "3 of 4 in" with everyone who tapped I\'m in counted, never "0 on standby"', async () => {
    const { ctx, waitlisted } = await scene();
    let g = await shown(ctx, 'Devon');
    expect(card(g, waitlisted.id)).toContain('3 of 4 in');
    await post(ctx, 'Emery', `/api/sessions/${waitlisted.id}/join`);
    await post(ctx, 'Frankie', `/api/sessions/${waitlisted.id}/join`);
    g = await shown(ctx, 'Devon');
    expect(card(g, waitlisted.id)).toContain('5 in');
    expect(card(g, waitlisted.id)).toMatch(/Alex.*Blair.*Casey.*Emery.*Frankie/);
    expect(card(g, waitlisted.id)).not.toMatch(/on standby/i);
  });
  it('the button says I\'m in to join and You\'re in with Drop out once joined, never Join standby', async () => {
    const { ctx, waitlisted } = await scene();
    expect(card(await shown(ctx, 'Devon'), waitlisted.id)).toMatch(/I'm in/);
    await post(ctx, 'Devon', `/api/sessions/${waitlisted.id}/join`);
    const text = card(await shown(ctx, 'Devon'), waitlisted.id);
    expect(text).toContain("You're in");
    expect(text).toContain('Drop out');
    expect(text).not.toMatch(/Join standby|Leave standby|in line/i);
  });
});

describe('(b) to (e) no money prompts until a court is booked', () => {
  it('(b) no court + an unpaid player: no due line, no Pay, no I paid, no top Pay card; Drop out stays', async () => {
    const { ctx, noCourt } = await scene();
    await post(ctx, 'Devon', `/api/sessions/${noCourt.id}/join`);
    const before = await raw(ctx, 'Devon');
    expect(before.sessions.find((s) => s.id === noCourt.id)!.mine!.oweCents).toBe(1400); // the record still says $14: only the screen changes
    const g = courtDisplay(before);
    expect(g.payDue.some((o) => o.sessionId === noCourt.id)).toBe(false);
    const text = card(g, noCourt.id);
    expect(text).not.toMatch(PAY);
    expect(text).toContain("You're in");
    expect(text).toContain('Drop out');
  });
  it('(c) no court + already paid: still paid, and says so', async () => {
    const { ctx, noCourt } = await scene();
    await post(ctx, 'Blair', `/api/sessions/${noCourt.id}/join`);
    expect((await post(ctx, 'Blair', `/api/sessions/${noCourt.id}/paid`, { paid: true })).status).toBe(200);
    const g = await shown(ctx, 'Blair');
    const mine = g.sessions.find((s) => s.id === noCourt.id)!.mine!;
    expect(mine.paymentStatus).toBe('paid');
    expect(card(g, noCourt.id)).toMatch(/Paid/);
    expect(card(g, noCourt.id)).not.toMatch(/\bdue\b|I paid|Pay \$/);
  });
  it('(d) court booked: the pay prompts show for someone who is in and unpaid', async () => {
    const { ctx, booked } = await scene();
    await post(ctx, 'Devon', `/api/sessions/${booked.id}/join`);
    const g = await shown(ctx, 'Devon');
    expect(card(g, booked.id)).toMatch(/\$14 due|Pay/);
    expect(card(g, booked.id)).toContain('Court booked');
  });
  it('(e) booked, then changed back to not booked: the prompts go away again and a payment already made stays paid', async () => {
    const { ctx, booked } = await scene();
    for (const n of ['Devon', 'Blair']) await post(ctx, n, `/api/sessions/${booked.id}/join`);
    await post(ctx, 'Blair', `/api/sessions/${booked.id}/paid`, { paid: true });
    expect(card(await shown(ctx, 'Devon'), booked.id)).toMatch(/\$14 due|Pay/);
    expect((await unbook(ctx, booked.id)).status).toBe(200);
    const devon = await shown(ctx, 'Devon');
    expect(card(devon, booked.id)).not.toMatch(PAY);
    expect(card(devon, booked.id)).toContain('Court not booked');
    const blair = await shown(ctx, 'Blair');
    expect(blair.sessions.find((s) => s.id === booked.id)!.mine!.paymentStatus).toBe('paid');
    expect(card(blair, booked.id)).toMatch(/Paid/);
    // Booked again: the prompt comes back.
    await ctx.organizer.call('POST', `/api/admin/sessions/${booked.id}/booked`, {});
    expect(card(await shown(ctx, 'Devon'), booked.id)).toMatch(/\$14 due|Pay/);
  });
  it('the top Pay card (game day) lists only games with a booked court', async () => {
    const { ctx, noCourt, booked } = await scene();
    const g = await raw(ctx, 'Devon');
    const entry = (id: string) => ({ sessionId: id, startsAt: g.sessions.find((s) => s.id === id)!.startsAt, endsAt: g.sessions.find((s) => s.id === id)!.endsAt, amountCents: 1400, creditCents: 0, finalized: false });
    const withDue = { ...g, payDue: [entry(noCourt.id), entry(booked.id)], owed: [entry(noCourt.id), entry(booked.id)] } as unknown as GroupView;
    const out = courtDisplay(withDue);
    expect(out.payDue.map((o) => o.sessionId)).toEqual([booked.id]);
    expect(out.owed.map((o) => o.sessionId)).toEqual([booked.id]);
  });
});

describe('(f) dropping out and joining again on a game with no court', () => {
  it('uses the normal words each time', async () => {
    const { ctx, waitlisted } = await scene();
    const id = waitlisted.id;
    const join = async () => (await post(ctx, 'Emery', `/api/sessions/${id}/join`)).data;
    const res = await join();
    expect(res.result).toBe('standby'); // what the server calls it
    expect(joinedText(res, true)).toBe("You're in");
    expect(card(await shown(ctx, 'Emery'), id)).toMatch(/You're in.*Drop out/);
    expect((await post(ctx, 'Emery', `/api/sessions/${id}/withdraw`)).status).toBe(200);
    let text = card(await shown(ctx, 'Emery'), id);
    expect(text).toMatch(/I'm in/);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toContain('Drop out');
    const again = await join();
    expect(joinedText(again, true)).toBe("You're in");
    text = card(await shown(ctx, 'Emery'), id);
    expect(text).toMatch(/You're in.*Drop out/);
    expect(text).not.toMatch(FORBIDDEN);
  });
  it('on a game that is not on any list the same words work, and a booked, full game keeps its waitlist words', async () => {
    const { ctx, noCourt, booked } = await scene();
    expect(joinedText({ result: 'confirmed' }, true)).toBe("You're in");
    expect(joinedText({ result: 'standby', position: 2 }, false)).toBe("You're on standby, #2");
    expect(joinedText({ result: 'waitlisted', position: 1 }, false)).toBe("You're #1 on the waitlist");
    expect(card(await shown(ctx, 'Devon'), noCourt.id)).toMatch(/I'm in/);
    // A booked game that is full still says waitlist.
    const max = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.group.settings.maxPlayers;
    expect(max).toBeGreaterThanOrEqual(4);
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { ...(await ctx.organizer.call('GET', '/api/admin/dashboard')).data.group.settings, maxPlayers: 4 } });
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await post(ctx, n, `/api/sessions/${booked.id}/join`);
    const text = card(await shown(ctx, 'Emery'), booked.id);
    expect(text).toMatch(/Join waitlist/);
  });
});
