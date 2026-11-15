// Zip 47 audit probe (security): can a name, a guest name, a cancel reason or a note typed by someone turn into a link, markup or a
// broken text message? Server answers, Telegram bodies (captured, never sent), sms: links and the calendar file. In-memory only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstSession, HOUR, playerPhone, setupGroup } from '../../harness';
import { smsHref } from '../../../shared/messages';
import { smsGroupHref, recipientNumbers } from '../../../shared/gameDayText';
import { linkText, ourAddress } from '../../../server/telegram-links';
import { cleanGuestName } from '../../../shared/guestSpot';

const SITE = 'https://pickleball.juncaj.net';
const HOSTILE = 'Pay: https://evil.example/x';
const HTML = '<img src=x onerror=alert(1)>';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('Zip 47 probe: injection', () => {
  it('no HTML sink in the page code: no dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, javascript:', () => {
    const hits: string[] = [];
    for (const f of files(join(process.cwd(), 'src')).filter((x) => /\.(tsx?|js)$/.test(x))) {
      const text = readFileSync(f, 'utf8');
      for (const re of [/dangerouslySetInnerHTML/, /\.innerHTML\s*=/, /outerHTML\s*=/, /insertAdjacentHTML/, /document\.write\(/, /\beval\(/, /new Function\(/, /['"`]javascript:/i]) {
        if (re.test(text)) hits.push(`${f.replace(process.cwd() + '/', '')}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('a guest name can only be letters (no markup, no address, no line break)', () => {
    for (const bad of [HTML, HOSTILE, 'Sam<b>', 'javascript:alert(1)', 'Sam https://x.y', '@everyone', 'Sam & Co', '']) expect(cleanGuestName(bad), bad).toBeNull();
    expect(cleanGuestName("o'neil-ann")).toBe("O'neil-ann");
    // A line break is folded into a space, never kept.
    expect(cleanGuestName('Sam\nBob')).toBe('Sam Bob');
  });

  it('a self-added name with markup or an address is stored and sent back as plain text (React draws it as text)', async () => {
    const w = await setupGroup();
    const p = w.app.client();
    p.groupKey = w.groupKey;
    const r = await p.call('POST', '/api/players/self', { name: HTML, confirmNew: true });
    expect(r.status).toBe(200);
    const g = await p.call('GET', '/api/group');
    expect(g.data.players.some((x: any) => x.name === HTML)).toBe(true);
    expect(g.headers.get('content-type')).toMatch(/application\/json/);
    expect(g.headers.get('x-content-type-options')).toBe('nosniff');
    // Control characters and direction marks are refused in names.
    for (const bad of ['A‮B', 'A\u0000B', 'A\nB', 'A B']) expect((await p.call('POST', '/api/players/self', { name: bad, confirmNew: true })).status).toBe(400);
  });

  it('Telegram: every message is plain text (no parse_mode); a name holding an address never becomes a hidden link', async () => {
    const w = await setupGroup();
    Object.assign(w.app.env, { SITE_URL: SITE, TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42', CRON_SECRET: 'probe-cron-secret-0123456789', GO_LINKS: 'on' });
    const bodies: any[] = [];
    (w.app.env as any).TELEGRAM_FETCH = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    // Every alert on, every switch on.
    await w.organizer.call('PUT', '/api/admin/alerts', { enabled: true, drop36: true, belowMin: true, refundRequests: true, smartAlerts: true });
    // A player with a hostile name.
    const evil = w.app.client();
    evil.groupKey = w.groupKey;
    expect((await evil.call('POST', '/api/players/self', { name: HOSTILE, confirmNew: true })).status).toBe(200);
    const s = await firstSession(w);
    for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await evil.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    // Late drop (a player alert), then the 5-minute clock through the game day.
    w.app.now = Date.parse(s.startsAt) - 6 * HOUR;
    await evil.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await evil.call('POST', `/api/sessions/${s.id}/join`, {});
    for (let t = Date.parse(s.startsAt) - 30 * HOUR; t < Date.parse(s.startsAt) + 6 * HOUR; t += HOUR / 2) {
      w.app.now = t;
      await w.app.client().call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': 'probe-cron-secret-0123456789' });
    }
    await w.organizer.call('POST', '/api/admin/alerts/test', {});
    await w.app.settle();
    if (process.env.PROBE_PRINT) console.log(bodies.map((b) => JSON.stringify(b)).join("\n"));
    expect(bodies.length).toBeGreaterThan(1);
    // The hostile name really reached at least one message (so the check below means something).
    expect(bodies.some((b) => String(b.text).includes('evil.example'))).toBe(true);
    for (const b of bodies) {
      expect(b.parse_mode, b.text).toBeUndefined();
      for (const e of b.entities ?? []) {
        expect(e.type).toBe('text_link');
        expect(String(e.url).startsWith(SITE + '/') || /courtreserve[.]com/.test(String(e.url)), e.url).toBe(true);
        expect(e.url).not.toMatch(/evil/);
      }
    }
  });

  it('linkText: a name "Bob: https://evil..." stays as typed; one that copies the site\'s own /go/ form only links to the site itself', () => {
    const allowed = ourAddress(SITE, []);
    expect(linkText(`Unpaid: ${HOSTILE}. Text them: ${SITE}/go/abc.def`, () => false, allowed).entities.map((e) => e.url)).toEqual([`${SITE}/go/abc.def`]);
    // A 39-character name that looks like a /go/ link is allowed by the name rules and would become tappable words, but only to this site.
    const lookalike = `X: ${SITE}/go/a.b`;
    expect(lookalike.length).toBeLessThanOrEqual(40);
    expect(linkText(`Unpaid: ${lookalike}`, () => false, allowed).entities.map((e) => e.url)).toEqual([`${SITE}/go/a.b`]);
  });

  it('sms: links: the body is fully %-encoded and a phone number can only be digits', () => {
    const body = 'Hi&body=evil&addresses=+15550000000 #x?y=z\n<b>';
    for (const ios of [true, false]) {
      const href = smsHref('(313) 555-0101', body, ios);
      expect(href).not.toMatch(/evil&|addresses=\+1555|<|>|\n| /);
      const group = smsGroupHref(recipientNumbers(['(313) 555-0101', '313-555-0102&body=x', 'javascript:alert(1)']), body, ios);
      expect(group).not.toMatch(/javascript|&body=x|<|\n| /);
    }
  });

  it('the calendar file escapes the venue words (no extra lines can be added)', async () => {
    const w = await setupGroup();
    const r = await w.organizer.call('PUT', '/api/admin/group', { venueName: 'Club; X,Y\\Z', venueAddress: '1 Main St, City' });
    expect(r.status).toBe(200);
    // Line breaks are refused before they reach the file.
    expect((await w.organizer.call('PUT', '/api/admin/group', { venueName: 'A\nBEGIN:VEVENT' })).status).toBe(400);
    const s = await firstSession(w);
    const ics = await w.app.client().call('GET', `/api/sessions/${s.id}/calendar.ics`);
    expect(ics.text).toMatch(/LOCATION:Club\\; X\\,Y\\\\Z/);
    expect(ics.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
});
