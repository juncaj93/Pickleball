// Zip 8, item E: "Last call texts" (LAST_CALL_TEXTS, shared/lastCall.ts). Alex's rules for the night-before last call:
// 4 or more in: a group chat text (no recipients) asking if everyone is still in and if anyone else is in;
// 3 or fewer in: a group chat text "we need X more or tomorrow's game is canceled to avoid fees".
// Ships OFF: with the switch off every word is exactly what live sends today.
import { describe, expect, it } from 'vitest';
import { makeGoToken } from '../server/go';
import { checkInTextLastCall, needPlayersTextLastCall, whichGame } from '../shared/lastCall';
import { checkInTextR2, needPlayersTextR2 } from '../shared/textsR2';
import { sessionTexts } from '../src/pages/admin/textMenu';
import { playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const SECRET = 'test-cron-secret-0123456789abcdef0123456789';
const LINK = 'pickleball.juncaj.net';
const tue7 = { startsAt: '2026-11-04T00:00:00.000Z', endsAt: '2026-11-04T02:00:00.000Z' }; // Tue Nov 3, 7:00 PM Eastern
const mon6pm = Date.parse('2026-11-02T23:00:00Z'); // the night before, 6:00 PM (the last call)

describe('the words', () => {
  it('4 or more in: is everyone still in, anyone else in (old words kept for comparison)', () => {
    expect(checkInTextR2(tue7, TZ, mon6pm, 5, LINK)).toBe(
      'Pickleball tomorrow @ 7pm!\n5 in so far. Want in? Join now.\nNeed to back out? Do it tonight to avoid cancel fees.\n\npickleball.juncaj.net',
    );
    expect(checkInTextLastCall(tue7, TZ, mon6pm, 5, LINK)).toBe(
      'Pickleball tomorrow @ 7pm!\n5 in so far. Is everyone still in? Anyone else in?\nNeed to back out? Do it tonight to avoid cancel fees.\n\npickleball.juncaj.net',
    );
  });

  it('3 or fewer in: we need X more or tomorrow\'s game is canceled to avoid fees', () => {
    expect(needPlayersTextR2(tue7, TZ, mon6pm, 3, 1, LINK)).toBe(
      "Pickleball tomorrow @ 7pm!\n3 in, need 1 more.\nWant in? Join tonight, otherwise we'll have to cancel.\n\npickleball.juncaj.net",
    );
    expect(needPlayersTextLastCall(tue7, TZ, mon6pm, 3, 1, LINK)).toBe(
      "Pickleball tomorrow @ 7pm!\n3 in. We need 1 more or tomorrow's game is canceled to avoid fees.\nWant in? Join tonight.\n\npickleball.juncaj.net",
    );
    expect(needPlayersTextLastCall(tue7, TZ, mon6pm, 1, 3, LINK)).toContain('1 in. We need 3 more or tomorrow\'s game is canceled to avoid fees.');
    expect(needPlayersTextLastCall(tue7, TZ, mon6pm, 0, 4, LINK)).toContain('0 in. We need 4 more');
  });

  it('names the right game on other days', () => {
    expect(whichGame(tue7.startsAt, TZ, Date.parse('2026-11-03T15:00:00Z'))).toBe("tonight's game");
    expect(whichGame('2026-11-03T15:00:00.000Z', TZ, Date.parse('2026-11-03T12:00:00Z'))).toBe("today's game"); // 10:00 AM game
    expect(whichGame(tue7.startsAt, TZ, Date.parse('2026-10-30T15:00:00Z'))).toBe('the Tue Nov 3 game');
    expect(needPlayersTextLastCall(tue7, TZ, Date.parse('2026-10-30T15:00:00Z'), 2, 2, LINK)).toContain('Want in? Join early.');
  });

  it('never uses a dash or names anyone', () => {
    for (const t of [checkInTextLastCall(tue7, TZ, mon6pm, 6, LINK), needPlayersTextLastCall(tue7, TZ, mon6pm, 2, 2, LINK)]) {
      expect(t).not.toMatch(/[–—]/);
      expect(t.endsWith('\n\npickleball.juncaj.net')).toBe(true);
    }
  });
});

async function world(flag?: string) {
  const app = new TestApp();
  app.env = { ...app.env, CRON_SECRET: SECRET, GO_LINKS: 'on', SITE_URL: 'https://pickleball.juncaj.net', ...(flag ? { LAST_CALL_TEXTS: flag } : {}) };
  const ctx = await setupGroup(app);
  app.now = Date.parse('2026-11-02T17:00:00Z'); // Mon noon
  await ctx.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
  const dash = async (h: Record<string, string> = {}) => (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, h)).data;
  const tue = (await dash()).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === '2026-11-03');
  await ctx.organizer.call('PUT', `/api/admin/sessions/${tue.id}/booking`, { bookingStatus: 'booked' });
  return { ...ctx, dash, tue };
}

async function goBody(w: Awaited<ReturnType<typeof world>>, headers: Record<string, string> = {}) {
  const token = await makeGoToken(SECRET, w.tue.id, w.tue.startsAt, w.app.now);
  const c = w.app.client();
  const res = await c.call('POST', '/api/go', { token }, headers);
  expect(res.status, res.text).toBe(200);
  return res.data.body as string;
}

describe('the switch', () => {
  it('ships off: the dashboard has no flag, the alert link and the Text menu give the old words', async () => {
    const w = await world();
    for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${w.tue.id}/join`, {});
    w.app.now = Date.parse('2026-11-02T23:05:00Z');
    const d = await w.dash();
    expect(d.lastCallTexts).toBeUndefined();
    expect(d.lastCallTextsForAll).toBe(false);
    expect(await goBody(w)).toContain('3 in, need 1 more.');
    const s = d.sessions.find((x: any) => x.id === w.tue.id);
    expect(sessionTexts(d, s, w.app.now).find((i) => i.id === 'need')!.body).toContain("otherwise we'll have to cancel");
  });

  it('this phone only (/admin?lastcall=on header): the new words on the alert link and in the Text menu, no recipients', async () => {
    const w = await world();
    const H = { 'X-Last-Call': 'on' };
    for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${w.tue.id}/join`, {});
    w.app.now = Date.parse('2026-11-02T23:05:00Z');
    expect(await goBody(w, H)).toContain("3 in. We need 1 more or tomorrow's game is canceled to avoid fees.");
    let d = await w.dash(H);
    expect(d.lastCallTexts).toBe(true);
    let need = sessionTexts(d, d.sessions.find((x: any) => x.id === w.tue.id), w.app.now).find((i) => i.id === 'need')!;
    expect(need.body).toContain('canceled to avoid fees');
    expect(need.chat).toBe(true);
    expect(need.phones ?? []).toEqual([]);
    // A 4th joins: the check-in, still to the group chat with no recipients.
    await (await playerPhone(w, 'Emery')).call('POST', `/api/sessions/${w.tue.id}/join`, {});
    expect(await goBody(w, H)).toContain('4 in so far. Is everyone still in? Anyone else in?');
    d = await w.dash(H);
    const check = sessionTexts(d, d.sessions.find((x: any) => x.id === w.tue.id), w.app.now).find((i) => i.id === 'checkin')!;
    expect(check.body).toContain('Is everyone still in? Anyone else in?');
    expect(check.chat).toBe(true);
    expect(check.phones ?? []).toEqual([]);
    // Other phones are unchanged.
    expect(await goBody(w)).toContain('4 in so far. Want in? Join now.');
  });

  it('Settings row: on for everyone with no deploy, logged in Activity; off again gives the old words', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/last-call-switch', { on: true })).status).toBe(200);
    w.app.now = Date.parse('2026-11-02T23:05:00Z');
    expect((await w.dash()).lastCallTextsForAll).toBe(true);
    expect(await goBody(w)).toContain("We need 4 more or tomorrow's game is canceled to avoid fees.");
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => e.action);
    expect(act).toContain('last_call_texts_on');
    expect((await w.organizer.call('PUT', '/api/admin/last-call-switch', { on: false })).status).toBe(200);
    expect(await goBody(w)).toContain('0 in, need 4 more.');
  });

  it('the kill switch (LAST_CALL_TEXTS = "off") wins over the Settings row and the private link', async () => {
    const w = await world('off');
    await w.organizer.call('PUT', '/api/admin/last-call-switch', { on: true });
    w.app.now = Date.parse('2026-11-02T23:05:00Z');
    expect((await w.dash({ 'X-Last-Call': 'on' })).lastCallTexts).toBeUndefined();
    expect(await goBody(w, { 'X-Last-Call': 'on' })).toContain('0 in, need 4 more.');
  });

  it('needs round 2 texts on: with TEXTS_R2 off the oldest words stay', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/texts-r2', { on: false });
    await w.organizer.call('PUT', '/api/admin/last-call-switch', { on: true });
    w.app.now = Date.parse('2026-11-02T23:05:00Z');
    expect(await goBody(w)).toMatch(/^Need 4 more for pickleball/);
  });
});
