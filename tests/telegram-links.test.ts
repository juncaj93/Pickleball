import { describe, expect, it } from 'vitest';
import { isAdminPage, linkText } from '../server/telegram-links';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../shared/settings';
import { dueAlerts, nextTasks } from '../shared/tasks';
import { sentText, setupGroup, TestApp } from './harness';
import { OPTS, SCENARIO, ticks } from './tick-scenarios';

// Telegram alerts show short tappable words instead of raw addresses. A
// phrase links only where a tap does the job: the direct text (/go/) or
// CourtReserve. Words that pointed at the organizer's /admin page stay as
// plain words (the Open site button goes there). The alert words, their
// send times and the Home card are unchanged.

const ADMIN = 'https://pickleball.juncaj.net/admin';
const GO = 'https://pickleball.juncaj.net/go/';

/** What Telegram shows, with each link as [words](address), using the sender's rule. */
function shown(text: string) {
  const { text: visible, entities } = linkText(text, isAdminPage);
  let out = visible;
  for (const e of [...entities].reverse()) out = `${out.slice(0, e.offset)}[${out.slice(e.offset, e.offset + e.length)}](${e.url})${out.slice(e.offset + e.length)}`;
  return out;
}

describe('tappable words in Telegram alerts', () => {
  it('each kind of alert: the direct text and CourtReserve are links; the /admin words are plain', () => {
    const go = `${GO}eyJzIjoiYWJjIn0.c2ln`;
    expect(shown(`Tuesday: 3 players in, need a 4th. Text the group: ${go}`)).toBe(`Tuesday: 3 players in, need a 4th. [Text the group](${go})`);
    expect(shown(`Tuesday: 5 players in. Text the group to confirm: ${go}`)).toBe(`Tuesday: 5 players in. [Text the group to confirm](${go})`);
    // Direct link switched off (GO_LINKS off): the words stay, with no link.
    expect(shown(`Tuesday: 5 players in. Text the group to confirm: ${ADMIN}`)).toBe('Tuesday: 5 players in. Text the group to confirm');
    expect(shown(`Tuesday: only 3 players in. Cancel court: ${COURTRESERVE_CANCEL_URL}`)).toBe(`Tuesday: only 3 players in. [Cancel court](${COURTRESERVE_CANCEL_URL})`);
    expect(shown(`Tuesday: court canceled? Now cancel the session and text everyone: ${ADMIN}`)).toBe('Tuesday: court canceled? Now cancel the session and text everyone');
    expect(shown(`Tonight: only 3 players in. Cancel court before 7:00 AM: ${COURTRESERVE_CANCEL_URL}`)).toBe(`Tonight: only 3 players in. [Cancel court before 7:00 AM](${COURTRESERVE_CANCEL_URL})`);
    expect(shown(`Thu Nov 26 opens at 7:00 AM (Thanksgiving). Book: ${COURTRESERVE_BOOKING_URL}\nThen tap I booked it: ${ADMIN}`)).toBe(
      `Thu Nov 26 opens at 7:00 AM (Thanksgiving). [Book](${COURTRESERVE_BOOKING_URL})\nThen tap I booked it`,
    );
    expect(shown(`Tonight: 5 in, no court yet. Check CourtReserve for an opening: ${COURTRESERVE_BOOKING_URL}`)).toBe(`Tonight: 5 in, no court yet. [Check CourtReserve for an opening](${COURTRESERVE_BOOKING_URL})`);
    expect(shown(`Thursday: finalize who played: ${ADMIN}`)).toBe('Thursday: finalize who played');
    expect(isAdminPage(`${ADMIN}/`)).toBe(true);
    expect(isAdminPage(`${GO}abc`)).toBe(false);
    expect(isAdminPage('not a url')).toBe(false);
  });

  it('every alert in six weeks of ticks: no raw address, no /admin link, and the words are the old words', { timeout: 120_000 }, () => {
    const seen = new Set<string>();
    for (const now of ticks()) for (const a of dueAlerts(nextTasks(now, SCENARIO, new Set(), OPTS), now, new Set())) seen.add(a.text);
    expect(seen.size).toBeGreaterThanOrEqual(30);
    for (const text of seen) {
      const linked = linkText(text, isAdminPage);
      expect(linked.text).not.toMatch(/https?:/);
      for (const e of linked.entities) expect(isAdminPage(e.url)).toBe(false);
      // Reading it back gives the old text, minus only the ": <admin address>" parts.
      expect(sentText(linked)).toBe(text.replace(/: https:\/\/pickleball\.juncaj\.net\/admin/g, ''));
    }
  });

  it('a message with no address is sent exactly as before, with no links', () => {
    expect(linkText('Blair dropped out of Tuesday. 3 in.')).toEqual({ text: 'Blair dropped out of Tuesday. 3 in.', entities: [] });
    // Emoji and accents before a link: offsets count the way Telegram does.
    const t = linkText(`Zoë 🎾 is in. Text the group: ${ADMIN}`);
    expect(t.text.slice(t.entities[0].offset, t.entities[0].offset + t.entities[0].length)).toBe('Text the group');
  });

  it('the TEST smart alert as Telegram gets it: one line, "Text the group" opens the direct /go/ link, and the Open site button', async () => {
    const app = new TestApp();
    const bodies: any[] = [];
    app.env = {
      ...app.env,
      SITE_URL: 'https://pickleball.juncaj.net',
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_CHAT_ID: '42',
      CRON_SECRET: 's'.repeat(64),
      GO_LINKS: 'on',
      TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
    };
    const ctx = await setupGroup(app);
    await ctx.organizer.call('GET', '/api/admin/dashboard');
    expect((await ctx.organizer.call('POST', '/api/admin/alerts/smart-test', {})).status).toBe(200);
    const b = bodies.at(-1);
    expect(b.text).toBe('TEST smart alert from Pickleball Bros. Nothing to do. Real ones look like: "Tuesday: 3 players in, need a 4th. Text the group"');
    expect(b.entities).toHaveLength(1);
    expect(b.text.slice(b.entities[0].offset, b.entities[0].offset + b.entities[0].length)).toBe('Text the group');
    expect(b.entities[0].url).toMatch(/^https:\/\/pickleball\.juncaj\.net\/go\/[A-Za-z0-9_.-]+$/);
    expect(b.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Open site', url: ADMIN }]] });
    expect(b.parse_mode).toBeUndefined();
  });
});
