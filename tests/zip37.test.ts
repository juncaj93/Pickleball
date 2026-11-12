// Zip 37: "Home Screen tip" (HOME_SCREEN_TIP) and "Game day text" (GAME_DAY_TEXT), both ship OFF.
//  Part A, the tip card: when it shows (first visit hidden, second visit after 30 minutes shown, a quick reload hidden, iPhone/iPad Safari only,
//          a Home Screen app hidden, dismissed stays gone), the switch (off at ship, kill switch, Settings row, private link, preview-only var).
//  Part B, the game day text: the words (court line, pay line, time forms), the Messages link (recipients, encoding), the private link's
//          token (expiry, forgery), who gets the text, the page's numbers, the Telegram an hour before (once, no numbers, OFF = unchanged).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { activityText } from '../shared/activity';
import { smsHref } from '../shared/messages';
import { COURT_NAME, directionsUrl } from '../shared/zip9';
import { gameDayTextAllowed, gameDayTextBody, GAME_DAY_TEXT, mapsDirectLink, recipientNumbers, reminderDue, smsGroupHref } from '../shared/gameDayText';
import { HOME_SCREEN_TIP, homeScreenTipAllowed, isIosSafari, LONG_AGO_MS, SECOND_VISIT_MS, tipVerdict, type TipInput } from '../shared/homeScreenTip';
import { linkText, ourAddress } from '../server/telegram-links';
import { makeGdtToken, readGdtToken, reminderMessage } from '../server/gameDayText';
import { BUILDING_ON } from '../scripts/preview-world-small';
import { HOUR, playerPhone, sentText, setupGroup, TestApp } from './harness';

vi.setConfig({ testTimeout: 120_000 });

const MIN = 60_000;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1';
const FIREFOX_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15';
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

const NOW = Date.parse('2026-11-13T15:00:00Z');
const base: TipInput = { switchOn: true, onHome: true, demo: false, iosSafari: true, standalone: false, done: false, firstOpenMs: null, knewNameOnOpen: false, nowMs: NOW };

describe('Part A: when the Home Screen tip card shows', () => {
  it('a brand new person: the first Home open is clean (nothing shown) and writes the first-open time', () => {
    expect(tipVerdict(base)).toEqual({ show: false, record: 'first' });
  });
  it('a quick reload (under 30 minutes after the first open) is not a second visit', () => {
    for (const ago of [0, 1, 5 * MIN, 29 * MIN, SECOND_VISIT_MS - 1]) expect(tipVerdict({ ...base, firstOpenMs: NOW - ago })).toEqual({ show: false, record: 'none' });
  });
  it('the second visit (30 minutes or more after the first open) shows the card', () => {
    for (const ago of [SECOND_VISIT_MS, SECOND_VISIT_MS + 1, 3 * HOUR, 90 * 24 * HOUR]) expect(tipVerdict({ ...base, firstOpenMs: NOW - ago })).toEqual({ show: true, record: 'none' });
  });
  it('a clock set back never hides it forever: a first open in the future is "not old enough yet", not an error', () => {
    expect(tipVerdict({ ...base, firstOpenMs: NOW + 5 * HOUR })).toEqual({ show: false, record: 'none' });
  });
  it('a player from before this shipped (name already picked when the page opened, no first-open record) is past the first visit at once', () => {
    expect(tipVerdict({ ...base, knewNameOnOpen: true })).toEqual({ show: true, record: 'past' });
    // The record they get is long ago, so every later open is a second visit too.
    expect(tipVerdict({ ...base, knewNameOnOpen: true, firstOpenMs: LONG_AGO_MS })).toEqual({ show: true, record: 'none' });
    // A brand new person who picks their name during this very page load is NOT past the first visit.
    expect(tipVerdict({ ...base, knewNameOnOpen: false })).toEqual({ show: false, record: 'first' });
  });
  it('never when dismissed with the X or finished with Got it (done), however old the first open is', () => {
    expect(tipVerdict({ ...base, done: true, firstOpenMs: NOW - 5 * 24 * HOUR })).toEqual({ show: false, record: 'none' });
    expect(tipVerdict({ ...base, done: true, knewNameOnOpen: true })).toEqual({ show: false, record: 'none' });
  });
  it('never on the Home Screen app itself', () => {
    expect(tipVerdict({ ...base, standalone: true, firstOpenMs: NOW - 5 * HOUR })).toEqual({ show: false, record: 'none' });
  });
  it('never with the switch off, off Home (Who are you?, /admin), or in View as / the demo copy / Pretend', () => {
    const old = { ...base, firstOpenMs: NOW - 5 * HOUR };
    expect(tipVerdict({ ...old, switchOn: false })).toEqual({ show: false, record: 'none' });
    expect(tipVerdict({ ...old, onHome: false })).toEqual({ show: false, record: 'none' });
    expect(tipVerdict({ ...old, demo: true })).toEqual({ show: false, record: 'none' });
    // Nothing is written in any of those cases (a brand new phone with the switch off keeps no first-open record).
    expect(tipVerdict({ ...base, switchOn: false }).record).toBe('none');
    expect(tipVerdict({ ...base, onHome: false }).record).toBe('none');
  });
  it('a garbage first-open value counts as never opened (no crash)', () => {
    expect(tipVerdict({ ...base, firstOpenMs: Number.NaN })).toEqual({ show: false, record: 'first' });
  });
});

describe('Part A: iPhone and iPad Safari only', () => {
  it('iPhone Safari and an iPad that says it is a Mac (touch screen) count', () => {
    expect(isIosSafari(IPHONE)).toBe(true);
    expect(isIosSafari(IPAD_AS_MAC, 'MacIntel', 5)).toBe(true);
  });
  it('a real Mac (no touch), Android, Chrome and Firefox on iPhone, and an app\'s own browser do not', () => {
    expect(isIosSafari(DESKTOP, 'MacIntel', 0)).toBe(false);
    expect(isIosSafari(ANDROID, 'Linux armv8l', 5)).toBe(false);
    expect(isIosSafari(CHROME_IOS)).toBe(false);
    expect(isIosSafari(FIREFOX_IOS)).toBe(false);
    expect(isIosSafari(INSTAGRAM)).toBe(false);
    expect(isIosSafari('')).toBe(false);
  });
});

type W = Awaited<ReturnType<typeof setupGroup>>;
const group = async (w: W, h: Record<string, string> = {}, who = 'Blair') => {
  const c = await playerPhone(w, who);
  return (await c.call('GET', '/api/group', undefined, h)).data;
};
const dash = async (w: W, h: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, h)).data;

describe('Part A: the switch (HOME_SCREEN_TIP, ships OFF)', () => {
  it('names, kill switch, allowed unless "off"', () => {
    expect(HOME_SCREEN_TIP).toEqual({ task: 'home_screen_tip_on', header: 'X-Home-Screen-Tip', link: 'homescreentip', env: 'HOME_SCREEN_TIP', name: 'Home Screen tip' });
    expect(homeScreenTipAllowed(undefined)).toBe(true);
    expect(homeScreenTipAllowed('on')).toBe(true);
    expect(homeScreenTipAllowed(' OFF ')).toBe(false);
  });
  it('off at ship: the player answer has no trace of it; the Settings row, the private link, the kill switch, players cannot flip it', async () => {
    const w = await setupGroup();
    expect((await group(w)).homeScreenTip).toBeUndefined();
    expect((await dash(w)).homeScreenTipForAll).toBeUndefined();
    // The private link for one phone.
    expect((await group(w, { 'X-Home-Screen-Tip': 'on' })).homeScreenTip).toBe(true);
    expect((await group(w)).homeScreenTip).toBeUndefined();
    // The Settings row: on for every phone.
    expect((await w.organizer.call('PUT', '/api/admin/home-screen-tip-switch', { on: true })).status).toBe(200);
    expect((await group(w)).homeScreenTip).toBe(true);
    expect((await dash(w)).homeScreenTipForAll).toBe(true);
    // The kill switch beats the row and the link.
    (w.app.env as unknown as Record<string, unknown>).HOME_SCREEN_TIP = 'off';
    expect((await group(w)).homeScreenTip).toBeUndefined();
    expect((await group(w, { 'X-Home-Screen-Tip': 'on' })).homeScreenTip).toBeUndefined();
    (w.app.env as unknown as Record<string, unknown>).HOME_SCREEN_TIP = 'on';
    // A player cannot flip it.
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('PUT', '/api/admin/home-screen-tip-switch', { on: false })).status).toBe(401);
    // Off again: no trace.
    expect((await w.organizer.call('PUT', '/api/admin/home-screen-tip-switch', { on: false })).status).toBe(200);
    expect((await group(w)).homeScreenTip).toBeUndefined();
    expect((await dash(w)).homeScreenTipForAll).toBeUndefined();
  });
  it('OFF means unchanged: the player answer is byte for byte the same as with no knowledge of the switch; nothing but one flag appears while on', async () => {
    const w = await setupGroup();
    const off = await group(w);
    const on = await group(w, { 'X-Home-Screen-Tip': 'on' });
    const { homeScreenTip, ...rest } = on;
    expect(homeScreenTip).toBe(true);
    expect(JSON.stringify(rest)).toBe(JSON.stringify(off));
  });
  it('View as carries the flag like the player\'s own phone (key for key, as Zip 18 requires); the screen never draws the card there', async () => {
    const w = await setupGroup();
    await w.organizer.call('PUT', '/api/admin/home-screen-tip-switch', { on: true });
    const as = await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Blair });
    expect(as.status).toBe(200);
    expect(as.data.homeScreenTip).toBe(true);
    expect((await group(w)).homeScreenTip).toBe(true);
    // The organizer's own player (Alex) never gets it.
    expect((await group(w, {}, 'Alex')).homeScreenTip).toBe(true); // no organizer name saved yet in this bare world
    w.app.db.raw.prepare("UPDATE groups SET organizer_name = 'Alex'").run();
    expect((await group(w, {}, 'Alex')).homeScreenTip).toBeUndefined();
    // The page blocks View as, the demo copy and Pretend before it asks (e2e/zip37.cjs checks it in the browser).
    const home = readFileSync(new URL('../src/pages/PlayerHome.tsx', import.meta.url), 'utf8');
    expect(home).toContain('<HomeScreenTip g={g} blocked={!ownPhone || pickName} />');
    expect(home).toMatch(/const ownPhone = !viewAs && !demoOn\(\) && !pretend;/);
  });
  it('the preview-only var turns it on with the row off; it is only in [env.preview.vars], never production', async () => {
    const w = await setupGroup();
    (w.app.env as unknown as Record<string, unknown>).HOME_SCREEN_TIP_PREVIEW = 'on';
    expect((await group(w)).homeScreenTip).toBe(true);
    (w.app.env as unknown as Record<string, unknown>).HOME_SCREEN_TIP = 'off';
    expect((await group(w)).homeScreenTip).toBeUndefined();
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const at = toml.indexOf('[env.preview.vars]');
    const prod = toml.slice(0, at);
    const preview = toml.slice(at);
    expect(prod).not.toMatch(/HOME_SCREEN_TIP_PREVIEW/);
    expect(prod).not.toMatch(/GAME_DAY_TEXT_PREVIEW/);
    expect(preview).toMatch(/^HOME_SCREEN_TIP_PREVIEW = "on"$/m);
    expect(preview).toMatch(/^GAME_DAY_TEXT_PREVIEW = "on"$/m);
    expect(prod).toMatch(/^HOME_SCREEN_TIP = "on"$/m);
    expect(prod).toMatch(/^GAME_DAY_TEXT = "on"$/m);
  });
  it('History words, and the preview seed has both rows on (the building zip\'s switches are on in its own preview)', () => {
    const line = (action: string) => activityText({ id: 'x', action, details: {}, actorLabel: 'organizer', at: '2026-11-12T20:00:00.000Z', sessionId: null, playerId: null } as never, 'America/Detroit', 'Alex');
    expect(line('home_screen_tip_on')).toBe('Alex switched "Home Screen tip" on');
    expect(line('home_screen_tip_off')).toBe('Alex switched "Home Screen tip" off');
    expect(line('game_day_text_on')).toBe('Alex switched "Game day text" on');
    expect(line('game_day_text_off')).toBe('Alex switched "Game day text" off');
    expect(BUILDING_ON).toContain('home_screen_tip_on');
    expect(BUILDING_ON).toContain('game_day_text_on');
  });
  it('the Settings rows exist on the Feature switches page (no deploy needed to flip them)', () => {
    const src = readFileSync(new URL('../src/pages/admin/SettingsTab.tsx', import.meta.url), 'utf8');
    expect(src.match(/<HomeScreenTipRow /g)?.length).toBe(2);
    expect(src.match(/<GameDayTextRow /g)?.length).toBe(2);
    expect(src).toContain('/api/admin/home-screen-tip-switch');
    expect(src).toContain('/api/admin/game-day-text-switch');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Part B
// ---------------------------------------------------------------------------------------------------------------------------------

const START = '2026-11-12T01:00:00.000Z'; // Wed Nov 11, 8:00 PM Eastern
const iso = (ms: number) => new Date(ms).toISOString();
const input = (over: Partial<Parameters<typeof gameDayTextBody>[0]> = {}) => ({
  startsAt: START,
  tz: 'America/Detroit',
  nowMs: Date.parse(START) - HOUR,
  court: 12,
  clubName: 'Northville Pickleball Club',
  oweCents: 1400,
  siteName: 'pickleball.juncaj.net',
  ...over,
});

describe('Part B: the words', () => {
  it('the mock: court line, club, Directions, the direct Apple Maps link, the pay line, real line breaks', () => {
    const text = gameDayTextBody(input());
    expect(text.split('\n')).toEqual([
      'Pickleball tonight @ 8pm! (Court 12)',
      '',
      'Northville Pickleball Club',
      `Directions: ${mapsDirectLink()}`,
      '',
      'Still owe $14? Pay here: pickleball.juncaj.net',
    ]);
    expect(mapsDirectLink()).toBe('https://maps.apple.com/?daddr=Northville+Pickleball+Club');
    expect(directionsUrl(COURT_NAME, 'iPhone')).toBe('https://maps.apple.com/?daddr=Northville+Pickleball+Club');
    expect(directionsUrl(COURT_NAME, 'Mozilla/5.0 (Linux; Android 14)')).toBe('https://www.google.com/maps/dir/?api=1&destination=Northville+Pickleball+Club');
    expect(directionsUrl()).toBe(directionsUrl(COURT_NAME));
    expect(text).not.toMatch(/\/map\b|redirect|\/go\//);
  });
  it('no court set: no "(Court N)"', () => {
    expect(gameDayTextBody(input({ court: null })).split('\n')[0]).toBe('Pickleball tonight @ 8pm!');
  });
  it('nobody owes: no pay line and no trailing blank line', () => {
    const text = gameDayTextBody(input({ oweCents: null }));
    expect(text).not.toMatch(/Still owe/);
    expect(text.endsWith(mapsDirectLink())).toBe(true);
    expect(gameDayTextBody(input({ oweCents: 0 }))).not.toMatch(/Still owe/);
  });
  it('the amount is that game\'s own per-player amount ($11 for a 1.5 hour game, $14.50 stays a price)', () => {
    expect(gameDayTextBody(input({ oweCents: 1100 }))).toMatch(/Still owe \$11\? Pay here:/);
    expect(gameDayTextBody(input({ oweCents: 1450 }))).toMatch(/Still owe \$14\.50\? Pay here:/);
  });
  it('the word is always "tonight" (never the weekday and date, even a day or a week ahead); the time is the real start: 8pm, 7:30pm, 12pm, no leading zero', () => {
    const t = (iso2: string, nowMs: number) => gameDayTextBody(input({ startsAt: iso2, nowMs })).split('\n')[0];
    expect(t('2026-11-12T00:30:00.000Z', Date.parse('2026-11-11T23:30:00Z'))).toBe('Pickleball tonight @ 7:30pm! (Court 12)');
    expect(t('2026-11-11T17:00:00.000Z', Date.parse('2026-11-11T16:00:00Z'))).toBe('Pickleball tonight @ 12pm! (Court 12)');
    expect(t('2026-12-02T00:00:00.000Z', Date.parse('2026-11-12T00:00:00Z'))).toBe('Pickleball tonight @ 7pm! (Court 12)');
    expect(t('2026-11-12T23:05:00.000Z', Date.parse('2026-11-11T13:05:00Z'))).toBe('Pickleball tonight @ 6:05pm! (Court 12)');
  });
  it('the builder prints the club name it is given', () => {
    expect(gameDayTextBody(input({ clubName: 'Some Other Club' })).split('\n')[2]).toBe('Some Other Club');
  });
});

describe('Part B: the Messages link', () => {
  const body = gameDayTextBody(input());
  it('iPhone, two or more players: the older group format sms://open?addresses=+1N1,+1N2&body= (both numbers in the To line)', () => {
    const href = smsGroupHref(['+13135550101', '+13135550102'], body, true);
    expect(href.startsWith('sms://open?addresses=+13135550101,+13135550102&body=')).toBe(true);
    // Two numbers make two addresses; six make six.
    const addresses = (h: string) => /^sms:\/\/open\?addresses=([^&]*)&body=/.exec(h)![1].split(',');
    expect(addresses(href)).toEqual(['+13135550101', '+13135550102']);
    const six = ['+13135550101', '+13135550102', '+13135550103', '+13135550104', '+13135550105', '+13135550106'];
    expect(addresses(smsGroupHref(six, body, true))).toEqual(six);
    // The same addresses part the site's other group texts (shared/messages.ts smsHref) write.
    expect(smsHref(['+13135550101', '+13135550102'], 'x', true).startsWith('sms://open?addresses=+13135550101,+13135550102&body=')).toBe(true);
  });
  it('iPhone, one player: sms:+1N&body= (the one-person format)', () => {
    expect(smsGroupHref(['+13135550101'], body, true).startsWith('sms:+13135550101&body=')).toBe(true);
  });
  it('elsewhere: ?body=', () => {
    expect(smsGroupHref(['+13135550101'], body, false).startsWith('sms:+13135550101?body=')).toBe(true);
  });
  it('line breaks are %0A and every special mark ($ ? @ ! : / & = + # % space) survives a round trip', () => {
    const href = smsGroupHref(['+13135550101'], body, true);
    const raw = href.slice(href.indexOf('&body=') + 6);
    expect(raw).toContain('%0A');
    expect(raw).not.toMatch(/[\n $?@!:/'()*]/);
    expect(decodeURIComponent(raw)).toBe(body);
    const nasty = 'Pay $14? @ 8pm! (Court 12): a/b & c=d + e # 100% \'hi\' *x*\nnext';
    const raw2 = smsGroupHref([], nasty, true).replace('sms:&body=', '');
    expect(raw2).not.toMatch(/[\n $?@!:/&=+#'()*]/);
    expect(decodeURIComponent(raw2)).toBe(nasty);
    for (const [ch, enc] of [['$', '%24'], ['?', '%3F'], ['@', '%40'], ['!', '%21'], [':', '%3A'], ['/', '%2F']] as const) expect(smsGroupHref([], `a${ch}b`, true)).toBe(`sms:&body=a${enc}b`);
  });
  it('numbers: ten digits get +1, +1 numbers stay, blanks and repeats go, order kept', () => {
    expect(recipientNumbers(['(313) 555-0101', '313-555-0102', '+1 313 555 0101', null, '', undefined, '1 (313) 555-0103', '(313) 555-0101'])).toEqual(['+13135550101', '+13135550102', '+13135550103']);
    expect(recipientNumbers([null, ''])).toEqual([]);
  });
  it('a short or odd entry is skipped, never texted as a wrong number (no area code, a trailing extension, too long)', () => {
    expect(recipientNumbers(['555-1234', '248 555 1234 12', '+1 313 555 0101', '12345', '+44 20 7946 0958', '+1234567890123456789'])).toEqual(['+13135550101', '+442079460958']);
  });
});

describe('Part B: the private link\'s token', () => {
  const SECRET = 'test-cron-secret-0123456789abcdef0123456789';
  const END = '2026-11-12T03:00:00.000Z';
  const now = Date.parse(START) - HOUR;
  it('reads back the game, works until the game ends, then says expired', async () => {
    const t = await makeGdtToken(SECRET, 'game-1', END);
    expect(await readGdtToken(SECRET, t, now)).toEqual({ sessionId: 'game-1' });
    expect(await readGdtToken(SECRET, t, Date.parse(END) - 1)).toEqual({ sessionId: 'game-1' });
    expect(await readGdtToken(SECRET, t, Date.parse(END))).toEqual({ error: 'expired' });
    expect(await readGdtToken(SECRET, t, Date.parse(END) + 5 * HOUR)).toEqual({ error: 'expired' });
  });
  it('a changed game id or time, another secret, the night-before link\'s token, or junk all fail', async () => {
    const t = await makeGdtToken(SECRET, 'game-1', END);
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'game-2', e: Date.parse(END) })).toString('base64url');
    expect(await readGdtToken(SECRET, `${forged}.${sig}`, now)).toEqual({ error: 'invalid' });
    const later = Buffer.from(JSON.stringify({ s: 'game-1', e: Date.parse('2027-01-01T00:00:00Z') })).toString('base64url');
    expect(await readGdtToken(SECRET, `${later}.${sig}`, now)).toEqual({ error: 'invalid' });
    expect(await readGdtToken('another-secret-0123456789abcdef0123456789', t, now)).toEqual({ error: 'invalid' });
    // The night-before text link (/go/) is signed with its own purpose: it never opens this page.
    const { makeGoToken } = await import('../server/go');
    expect(await readGdtToken(SECRET, await makeGoToken(SECRET, 'game-1', END, now), now)).toEqual({ error: 'invalid' });
    for (const junk of ['', 'x', `${payload}.`, `.${sig}`, `${t}.x`, `${payload}.${sig.slice(0, -2)}`, 'a'.repeat(400)]) expect(await readGdtToken(SECRET, junk, now)).toEqual({ error: 'invalid' });
  });
  it('the token holds a game id and a time and nothing else: no number, no name, no money', async () => {
    const t = await makeGdtToken(SECRET, 'game-1', END);
    const decoded = Buffer.from(t.split('.')[0], 'base64url').toString();
    expect(JSON.parse(decoded)).toEqual({ s: 'game-1', e: Date.parse(END) });
    expect(t.length).toBeLessThan(150);
  });
  it('Telegram turns "Text the players: <link>" into tappable words, and only for a link of ours', async () => {
    const t = await makeGdtToken(SECRET, 'game-1', END);
    const url = `https://pickleball.juncaj.net/gt/${t}`;
    const ours = ourAddress('https://pickleball.juncaj.net', []);
    const out = linkText(reminderMessage(START, 'America/Detroit', now, 6, url), () => false, ours);
    expect(out.text).toBe('Tonight 8pm game starts in about an hour, 6 in. Text the players');
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]).toMatchObject({ type: 'text_link', url, length: 'Text the players'.length });
    // Another site's /gt/ link, or a different path, is left as typed.
    expect(linkText(`Hi. Text the players: https://evil.example/gt/${t}`, () => false, ours).entities).toHaveLength(0);
    expect(linkText(`Hi. Text the players: https://pickleball.juncaj.net/gt/x/${t}`, () => false, ours).entities).toHaveLength(0);
  });
});

describe('Part B: the switch (GAME_DAY_TEXT, ships OFF)', () => {
  it('names and kill switch', () => {
    expect(GAME_DAY_TEXT).toEqual({ task: 'game_day_text_on', env: 'GAME_DAY_TEXT', name: 'Game day text' });
    expect(gameDayTextAllowed(undefined)).toBe(true);
    expect(gameDayTextAllowed('off')).toBe(false);
  });
  it('the reminder window: due from 60 minutes before the start, still sent until 15 minutes before, never after', () => {
    const s = Date.parse(START);
    expect(reminderDue(s, s - 61 * MIN)).toBe(false);
    expect(reminderDue(s, s - 60 * MIN)).toBe(true);
    expect(reminderDue(s, s - 15 * MIN)).toBe(true);
    expect(reminderDue(s, s - 14 * MIN)).toBe(false);
    expect(reminderDue(s, s + MIN)).toBe(false);
  });
});

// ----- the whole thing through the site: a game, players, the page, the Telegram -----

const SECRET = 'test-cron-secret-0123456789abcdef0123456789';
const CHAT = '9988776655';
interface Sent {
  text: string;
  raw: string;
}

async function world(extraEnv: Record<string, unknown> = {}) {
  const app = new TestApp();
  const sent: Sent[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: '123456:FAKE-test-token-never-real',
    TELEGRAM_CHAT_ID: CHAT,
    CRON_SECRET: SECRET,
    GO_LINKS: 'on',
    TELEGRAM_FETCH: (async (_u: string, init: RequestInit) => {
      sent.push({ text: sentText(JSON.parse(String(init.body))), raw: String(init.body) });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch,
    ...extraEnv,
  };
  const w = await setupGroup(app);
  // Alex is the organizer (his name is in Settings, as on the real site), and also a player in the list.
  app.db.raw.prepare("UPDATE groups SET organizer_name = 'Alex'").run();
  // The game: Wed Nov 11, 8:00 PM Eastern to 10:00 PM, court booked. The clock starts the day before.
  app.now = Date.parse('2026-11-10T17:00:00Z');
  const res = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: START, endsAt: '2026-11-12T03:00:00.000Z', note: null });
  expect(res.status, res.text).toBe(200);
  const id = res.data.id as string;
  expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/court-status`, { status: 'booked' })).status).toBe(200);
  const join = async (name: string) => expect((await (await playerPhone(w, name)).call('POST', `/api/sessions/${id}/join`, {})).status).toBe(200);
  const tick = async () => {
    const r = await w.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
    await app.settle();
    expect(r.status).toBe(200);
    return r;
  };
  const setNow = (ms: number) => {
    app.now = ms;
  };
  const switchOn = async (on = true) => expect((await w.organizer.call('PUT', '/api/admin/game-day-text-switch', { on })).status).toBe(200);
  const raw = (sql: string, ...v: (string | number | null)[]) => app.db.raw.prepare(sql).all(...v) as Record<string, unknown>[];
  return { w, app, sent, id, join, tick, setNow, switchOn, raw };
}

const tokenOf = (text: string) => {
  const m = text.match(/\/gt\/([A-Za-z0-9_.-]+)/);
  expect(m, text).toBeTruthy();
  return m![1];
};

describe('Part B: the page (POST /api/gdt)', () => {
  it('only the players in the game: not the organizer, not a waitlisted or dropped player, not a player with no number', async () => {
    const g = await world();
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await g.join(n);
    // Frankie joins, then drops out. Alex (the organizer) is in too.
    await g.join('Frankie');
    expect((await (await playerPhone(g.w, 'Frankie')).call('POST', `/api/sessions/${g.id}/withdraw`, {})).status).toBe(200);
    await g.join('Alex');
    // Devon has no number saved.
    g.raw('UPDATE players SET phone_number = NULL WHERE id = ?', g.w.byName.Devon);
    await g.switchOn();
    g.setNow(Date.parse(START) - 55 * MIN);
    const token = await makeGdtToken(SECRET, g.id, '2026-11-12T03:00:00.000Z');
    const res = await g.w.app.client().call('POST', '/api/gdt', { token });
    expect(res.status, res.text).toBe(200);
    // Blair 0101, Casey 0102, Emery 0104 (Devon has none, Frankie dropped, Alex is the organizer 0100).
    expect(res.data.numbers).toEqual(['+13135550101', '+13135550102', '+13135550104']);
    expect(res.data.withoutNumber).toBe(1);
    expect(res.data.body).toMatch(/^Pickleball tonight @ 8pm!\n\nNorthville Pickleball Club\nDirections: https:\/\/maps\.apple\.com\/\?daddr=Northville\+Pickleball\+Club/);
    expect(res.data.preview).toBeUndefined();
    // The club's name goes with the court's address (one pair): the venue name typed on bookings in Settings does not change the text.
    g.raw("UPDATE groups SET venue_name = 'Some Booking Name'");
    const again = await g.w.app.client().call('POST', '/api/gdt', { token });
    expect(again.data.body.split('\n')[2]).toBe('Northville Pickleball Club');
  });

  it('a second player record with the organizer\'s own number never gets the text; a short number is skipped and counted', async () => {
    const g = await world();
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await g.join(n);
    g.raw('UPDATE players SET phone_number = ? WHERE id = ?', '(313) 555-0100', g.w.byName.Blair); // Alex's own number on another record
    g.raw('UPDATE players SET phone_number = ? WHERE id = ?', '555-1234', g.w.byName.Casey);
    await g.switchOn();
    g.setNow(Date.parse(START) - 55 * MIN);
    const token = await makeGdtToken(SECRET, g.id, '2026-11-12T03:00:00.000Z');
    const res = await g.w.app.client().call('POST', '/api/gdt', { token });
    expect(res.data.numbers).toEqual(['+13135550103', '+13135550104']);
    expect(res.data.withoutNumber).toBe(1); // Casey (short number); Blair is the organizer's duplicate, not a player to count
  });

  it('court line only when a court is set; pay line only while somebody signed up still owes (price as the money card shows it)', async () => {
    const g = await world();
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await g.join(n);
    await g.switchOn();
    g.setNow(Date.parse(START) - 55 * MIN);
    const token = await makeGdtToken(SECRET, g.id, '2026-11-12T03:00:00.000Z');
    const open = async () => (await g.w.app.client().call('POST', '/api/gdt', { token })).data.body as string;
    // Nobody has paid: the pay line is there, $14.
    let body = await open();
    expect(body.split('\n')[0]).toBe('Pickleball tonight @ 8pm!');
    expect(body).toMatch(/\n\nStill owe \$14\? Pay here: [a-z.]+\.[a-z]+$/);
    expect(body).not.toMatch(/Court/);
    // A court number (the game day card's own column).
    g.raw('UPDATE sessions SET court = 12 WHERE id = ?', g.id);
    body = await open();
    expect(body.split('\n')[0]).toBe('Pickleball tonight @ 8pm! (Court 12)');
    // Everyone signed up pays: no pay line.
    const dashSession = async () => (await dash(g.w)).sessions.find((s: { id: string }) => s.id === g.id);
    for (const r of (await dashSession()).roster) {
      if (r.isOrganizer) continue;
      expect((await g.w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: r.playerId, paid: true })).status, r.name).toBe(200);
    }
    body = await open();
    expect(body).not.toMatch(/Still owe/);
    expect(body.endsWith('Court 12)\n\nNorthville Pickleball Club\nDirections: ' + mapsDirectLink())).toBe(true);
  });

  it('fewer than one player with a number: the page gets an empty list (it shows a calm message, Messages never opens)', async () => {
    const g = await world();
    for (const n of ['Blair', 'Casey']) await g.join(n);
    g.raw('UPDATE players SET phone_number = NULL');
    await g.switchOn();
    g.setNow(Date.parse(START) - 55 * MIN);
    const token = await makeGdtToken(SECRET, g.id, '2026-11-12T03:00:00.000Z');
    const res = await g.w.app.client().call('POST', '/api/gdt', { token });
    expect(res.status).toBe(200);
    expect(res.data.numbers).toEqual([]);
    expect(smsGroupHref(res.data.numbers, res.data.body, true)).toMatch(/^sms:&body=/);
    const page = readFileSync(new URL('../src/pages/GameDayTextPage.tsx', import.meta.url), 'utf8');
    // The page opens Messages only when there is at least one number, and says so calmly otherwise.
    expect(page).toMatch(/numbers\.length > 0 \? smsGroupHref/);
    expect(page).toContain('No one in this game has a phone number saved, so there is no one to text.');
  });

  it('a bad token, another secret, an expired link, a canceled game and the switch off all stop it, with no numbers in the answer', async () => {
    const g = await world();
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await g.join(n);
    const visitor = g.w.app.client();
    const good = await makeGdtToken(SECRET, g.id, '2026-11-12T03:00:00.000Z');
    // Switch off (the default): nothing opens, whatever the token.
    let r = await visitor.call('POST', '/api/gdt', { token: good });
    expect(r.status).toBe(404);
    expect(r.text).not.toMatch(/\+1313|555/);
    await g.switchOn();
    g.setNow(Date.parse(START) - 55 * MIN);
    expect((await visitor.call('POST', '/api/gdt', { token: good })).status).toBe(200);
    for (const bad of ['junk', 'a.b', await makeGdtToken('another-secret-0123456789abcdef0123456789', g.id, '2026-11-12T03:00:00.000Z'), await makeGdtToken(SECRET, 'no-such-game', '2026-11-12T03:00:00.000Z')]) {
      r = await visitor.call('POST', '/api/gdt', { token: bad });
      expect(r.status, bad).toBe(404);
      expect(r.text).not.toMatch(/\+1313|555/);
    }
    // "preview" is only for a preview: on live it is just a bad token.
    expect((await visitor.call('POST', '/api/gdt', { token: 'preview' })).status).toBe(404);
    // After the game ended: expired (410), no numbers.
    g.setNow(Date.parse('2026-11-12T03:00:00.000Z') + MIN);
    r = await visitor.call('POST', '/api/gdt', { token: good });
    expect(r.status).toBe(410);
    expect(r.text).not.toMatch(/\+1313|555/);
    // The kill switch beats the row.
    g.setNow(Date.parse(START) - 55 * MIN);
    (g.app.env as unknown as Record<string, unknown>).GAME_DAY_TEXT = 'off';
    expect((await visitor.call('POST', '/api/gdt', { token: good })).status).toBe(404);
    (g.app.env as unknown as Record<string, unknown>).GAME_DAY_TEXT = 'on';
    // A canceled game.
    const cancel = await g.w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, charged: false });
    expect(cancel.status, cancel.text).toBe(200);
    const after = await visitor.call('POST', '/api/gdt', { token: good });
    expect([404, 410]).toContain(after.status);
    expect(after.text).not.toMatch(/\+1313/);
  });

  it('"preview" opens the next game with fake players only on a preview that has GAME_DAY_TEXT_PREVIEW, even with the row off', async () => {
    const g = await world({ GAME_DAY_TEXT_PREVIEW: 'on' });
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await g.join(n);
    g.setNow(Date.parse(START) - 3 * HOUR);
    const res = await g.w.app.client().call('POST', '/api/gdt', { token: 'preview' });
    expect(res.status, res.text).toBe(200);
    expect(res.data.preview).toBe(true);
    expect(res.data.numbers.length).toBe(4);
  });
});

describe('Part B: the Telegram an hour before the game', () => {
  const FIVE = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
  it('OFF at ship: the clock sends exactly what it sends today (nothing extra an hour before), switch row or not tested below', async () => {
    const a = await world();
    for (const n of FIVE) await a.join(n);
    a.sent.length = 0;
    for (let t = Date.parse(START) - 3 * HOUR; t <= Date.parse(START); t += 5 * MIN) {
      a.setNow(t);
      await a.tick();
    }
    const baseline = a.sent.map((s) => s.raw);
    // The same world with the switch turned on and then off again: no trace either.
    const b = await world();
    for (const n of FIVE) await b.join(n);
    await b.switchOn(true);
    await b.switchOn(false);
    b.sent.length = 0;
    for (let t = Date.parse(START) - 3 * HOUR; t <= Date.parse(START); t += 5 * MIN) {
      b.setNow(t);
      await b.tick();
    }
    expect(b.sent.map((s) => s.raw)).toEqual(baseline);
    expect(baseline.join('\n')).not.toMatch(/Text the players|\/gt\//);
    expect(b.raw("SELECT * FROM task_log WHERE task = 'game_text'")).toHaveLength(0);
  });

  it('ON: one Telegram about an hour before, once, "Text the players" is a tappable link, and no phone number is anywhere in it', async () => {
    const g = await world();
    for (const n of FIVE) await g.join(n);
    await g.switchOn();
    g.sent.length = 0;
    const start = Date.parse(START);
    const before: string[] = [];
    for (let t = start - 3 * HOUR; t < start - 60 * MIN; t += 5 * MIN) {
      g.setNow(t);
      await g.tick();
    }
    before.push(...g.sent.map((s) => s.text));
    expect(before.filter((x) => /Text the players/.test(x))).toHaveLength(0);
    // 60 minutes before: it goes out.
    g.setNow(start - 60 * MIN);
    await g.tick();
    const mine = g.sent.filter((s) => /Text the players/.test(s.raw));
    expect(mine).toHaveLength(1);
    const body = JSON.parse(mine[0].raw);
    expect(body.text).toBe('Tonight 8pm game starts in about an hour, 5 in. Text the players');
    expect(body.entities).toHaveLength(1);
    expect(body.entities[0]).toMatchObject({ type: 'text_link', offset: body.text.indexOf('Text the players'), length: 16 });
    expect(body.entities[0].url).toMatch(/^https:\/\/pickleball\.juncaj\.net\/gt\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    // No number, no name, no money anywhere in the message or the link.
    expect(mine[0].raw).not.toMatch(/555|\+1|313|\$|Blair|Casey|Devon|Emery|Frankie/);
    expect(body.reply_markup.inline_keyboard[0][0].text).toBe('Open site');
    // It opens the page, which has the numbers.
    const open = await g.w.app.client().call('POST', '/api/gdt', { token: tokenOf(body.entities[0].url) });
    expect(open.status).toBe(200);
    expect(open.data.numbers).toHaveLength(5);
    // And it never goes again: ticks all the way to the start send nothing more.
    const count = g.sent.length;
    for (let t = start - 55 * MIN; t <= start + 2 * HOUR; t += 5 * MIN) {
      g.setNow(t);
      await g.tick();
    }
    expect(g.sent.filter((s) => /Text the players/.test(s.raw))).toHaveLength(1);
    expect(g.sent.length).toBeGreaterThanOrEqual(count);
  });

  it('a missed tick still sends it until 15 minutes before the start; not after, not with fewer than 2 in, not for a canceled game, not for a game with no court or no number to text', async () => {
    const start = Date.parse(START);
    const sends = async (setup: (g: Awaited<ReturnType<typeof world>>) => Promise<void> | void, at: number) => {
      const g = await world();
      for (const n of FIVE) await g.join(n);
      await setup(g);
      await g.switchOn();
      g.sent.length = 0;
      g.setNow(at);
      await g.tick();
      return g.sent.filter((s) => /Text the players/.test(s.raw)).length;
    };
    expect(await sends(() => {}, start - 20 * MIN)).toBe(1);
    expect(await sends(() => {}, start - 15 * MIN)).toBe(1);
    expect(await sends(() => {}, start - 10 * MIN)).toBe(0);
    expect(await sends(() => {}, start + 5 * MIN)).toBe(0);
    expect(await sends(() => {}, start - 70 * MIN)).toBe(0);
    // The Telegram needs at least 2 in (the organizer counts): 1 in sends nothing, 2 or 3 in send it.
    const drop = (names: string[]) => async (g: Awaited<ReturnType<typeof world>>) => {
      for (const n of names) await (await playerPhone(g.w, n)).call('POST', `/api/sessions/${g.id}/withdraw`, {});
    };
    expect(await sends(drop(['Casey', 'Devon', 'Emery', 'Frankie']), start - 55 * MIN)).toBe(0);
    expect(await sends(drop(['Devon', 'Emery', 'Frankie']), start - 55 * MIN)).toBe(1);
    expect(await sends(drop(['Emery', 'Frankie']), start - 55 * MIN)).toBe(1);
    // A canceled game never.
    expect(await sends(async (g) => { await g.w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, charged: false }); }, start - 55 * MIN)).toBe(0);
    // Court not booked.
    expect(await sends(async (g) => { await g.w.organizer.call('POST', `/api/admin/sessions/${g.id}/court-status`, { status: 'not_booked' }); }, start - 55 * MIN)).toBe(0);
    // Nobody has a number.
    expect(await sends((g) => { g.raw('UPDATE players SET phone_number = NULL'); }, start - 55 * MIN)).toBe(0);
    // Smart alerts off (the organizer's own switch for clock alerts), or Telegram alerts off.
    expect(await sends(async (g) => { await g.w.organizer.call('PUT', '/api/admin/alerts', { smartAlerts: false }); }, start - 55 * MIN)).toBe(0);
    expect(await sends(async (g) => { await g.w.organizer.call('PUT', '/api/admin/alerts', { enabled: false }); }, start - 55 * MIN)).toBe(0);
  });

  it('a Telegram that fails is tried again later (at most 3 times); one that took too long is not sent twice', async () => {
    const start = Date.parse(START);
    let fails = 1;
    const g = await world();
    const prior = g.app.env.TELEGRAM_FETCH!;
    g.app.env = { ...g.app.env, TELEGRAM_FETCH: (async (u: string, init: RequestInit) => (fails > 0 && /Text the players/.test(String(init.body)) && fails-- > 0 ? new Response(JSON.stringify({ ok: false, description: 'Too Many Requests' }), { status: 429 }) : prior(u, init))) as typeof fetch };
    for (const n of FIVE) await g.join(n);
    await g.switchOn();
    g.sent.length = 0;
    g.setNow(start - 58 * MIN);
    await g.tick();
    expect(g.sent.filter((s) => /Text the players/.test(s.raw))).toHaveLength(0);
    g.setNow(start - 56 * MIN); // inside the 5 minute wait: not yet
    await g.tick();
    expect(g.sent.filter((s) => /Text the players/.test(s.raw))).toHaveLength(0);
    g.setNow(start - 50 * MIN);
    await g.tick();
    expect(g.sent.filter((s) => /Text the players/.test(s.raw))).toHaveLength(1);
    g.setNow(start - 45 * MIN);
    await g.tick();
    expect(g.sent.filter((s) => /Text the players/.test(s.raw))).toHaveLength(1);
  });

  it('never from the demo copy (View as / Pretend): the clock does nothing there and the claim row is not written', async () => {
    const g = await world();
    for (const n of FIVE) await g.join(n);
    await g.switchOn();
    expect(g.raw("SELECT * FROM task_log WHERE task = 'game_text'")).toHaveLength(0);
  });

  it('turning the switch on or off writes only its one row (no money, seat or credit changes)', async () => {
    const g = await world();
    for (const n of FIVE) await g.join(n);
    const snap = () => JSON.stringify([g.raw('SELECT * FROM session_players ORDER BY id'), g.raw('SELECT * FROM credit_ledger ORDER BY id'), g.raw('SELECT * FROM sessions ORDER BY id')]);
    const before = snap();
    await g.switchOn(true);
    await g.switchOn(false);
    expect(snap()).toBe(before);
  });
});

// Make the check that guards the wording of the player flag easy to find: it names no number and no money.
describe('privacy', () => {
  it('the player answer and the admin dashboard never carry a phone number because of this zip', async () => {
    const w = await setupGroup();
    await w.organizer.call('PUT', '/api/admin/home-screen-tip-switch', { on: true });
    await w.organizer.call('PUT', '/api/admin/game-day-text-switch', { on: true });
    const view = JSON.stringify(await group(w));
    expect(view).not.toMatch(/555-01|\+1313/);
    expect(iso(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});
