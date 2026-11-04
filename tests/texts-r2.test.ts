// "Texts and Telegram alerts, round 2" (TEXTS_R2, Nov 2026). New wording for every prefilled text, new wording and timing for the
// Telegram alerts, and the cancel sheet answering No by default. Ships OFF. A fake clock throughout; Telegram is always a stand-in.
// The sample game is Tue Nov 3, 8:00 PM Eastern (EST, after the Nov 1 clock change), cancel-by 8:00 AM that day.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alertMessage, DEFAULT_ALERT_PREFS } from '../shared/alerts';
import { checkInMessage, needPlayersMessage, smsHref } from '../shared/messages';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../shared/settings';
import { dayAt, dueAlerts, mayAlertSoon, nextTasks, type TaskOptions, type TaskSession } from '../shared/tasks';
import {
  alertGame,
  canceledCreditTextR2,
  canceledFeeKeptTextR2,
  checkInTextR2,
  courtCanceledTextR2,
  courtStillBookedTextR2,
  dayLabelR2,
  dayWordR2,
  finalTextR2,
  movedTextR2,
  needPlayersTextR2,
  paymentTextR2,
  promotedTextR2,
  remindAllTextR2,
  shareTextR2,
  shortTime,
  stillInTextR2,
  TEXTS_R2_HEADER,
  textsR2Allowed,
} from '../shared/textsR2';
import { lateCancelText, reminderText, sessionTexts, unpaidPeople } from '../src/pages/admin/textMenu';
import { dashboardTasks } from '../src/pages/admin/doNow';
import { HOUR, PIN, playerPhone, sentText, setupGroup, TestApp } from './harness';
import { SCENARIO as SWEEP_SESSIONS, sweep, TZ as SWEEP_TZ } from './tick-scenarios';
import { zonedTimeToUtc } from '../shared/time';

const TZ = 'America/Detroit';
const LINK = 'pickleball.juncaj.net';
const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);
const TUE = { startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' }; // Tue Nov 3, 8:00 PM
const THU_730 = { startsAt: '2026-11-06T00:30:00.000Z', endsAt: '2026-11-06T02:30:00.000Z' }; // Thu Nov 5, 7:30 PM
const MON_7PM = at('2026-11-03T00:00:00Z'); // the night before: the game is "tomorrow"
const TUE_NOON = at('2026-11-03T17:00:00Z'); // game day, 12:00 PM: the game is "tonight"
const WED_NOON = at('2026-11-04T17:00:00Z'); // the day after: "yesterday"

describe('TEXTS_R2: day and time words', () => {
  it('tomorrow, tonight, today, yesterday, last night, and a date further away', () => {
    expect(dayWordR2(TUE.startsAt, TZ, MON_7PM)).toBe('tomorrow');
    expect(dayWordR2(TUE.startsAt, TZ, TUE_NOON)).toBe('tonight');
    expect(dayWordR2(TUE.startsAt, TZ, WED_NOON)).toBe('yesterday');
    expect(dayWordR2(TUE.startsAt, TZ, WED_NOON, { lastNight: true })).toBe('last night');
    expect(dayWordR2(TUE.startsAt, TZ, at('2026-10-27T16:00:00Z'))).toBe('Tue Nov 3');
    expect(dayWordR2(TUE.startsAt, TZ, at('2026-11-10T16:00:00Z'))).toBe('Tue Nov 3');
    // A game before 5:00 PM reads "today" on its day and plain "yesterday" even with last night asked for.
    const lunch = { startsAt: '2026-11-03T17:00:00.000Z' }; // 12:00 PM
    expect(dayWordR2(lunch.startsAt, TZ, at('2026-11-03T13:00:00Z'))).toBe('today');
    expect(dayWordR2(lunch.startsAt, TZ, WED_NOON, { lastNight: true })).toBe('yesterday');
  });
  it('counts calendar days, so midnight and the November clock change cannot shift the word', () => {
    // Sun Nov 1 is the 25-hour day: a 7:00 PM game on Mon Nov 2 is still "tomorrow" at 11:59 PM Sun and "tonight" at 12:01 AM Mon.
    const mon = '2026-11-03T00:00:00.000Z'; // Mon Nov 2, 7:00 PM EST
    expect(dayWordR2(mon, TZ, at('2026-11-02T04:59:00Z'))).toBe('tomorrow'); // Sun Nov 1, 11:59 PM EST
    expect(dayWordR2(mon, TZ, at('2026-11-02T05:01:00Z'))).toBe('tonight'); // Mon Nov 2, 12:01 AM EST
    expect(dayWordR2('2026-11-01T23:00:00.000Z', TZ, at('2026-10-31T12:00:00Z'))).toBe('tomorrow'); // Sun 6:00 PM EST game, asked Sat noon EDT
  });
  it('the Telegram day label is the same word with a capital', () => {
    expect(dayLabelR2(TUE.startsAt, TZ, MON_7PM)).toBe('Tomorrow');
    expect(dayLabelR2(TUE.startsAt, TZ, TUE_NOON)).toBe('Tonight');
    expect(dayLabelR2('2026-11-03T17:00:00.000Z', TZ, at('2026-11-03T13:00:00Z'))).toBe('Today');
    expect(dayLabelR2(TUE.startsAt, TZ, at('2026-10-27T16:00:00Z'))).toBe('Tue Nov 3');
  });
  it('times read 8pm and 7:30pm', () => {
    expect(shortTime(TUE.startsAt, TZ)).toBe('8pm');
    expect(shortTime(THU_730.startsAt, TZ)).toBe('7:30pm');
    expect(shortTime('2026-11-03T17:00:00.000Z', TZ)).toBe('12pm');
    expect(shortTime('2026-11-03T05:00:00.000Z', TZ)).toBe('12am');
    expect(shortTime('2026-11-03T12:05:00.000Z', TZ)).toBe('7:05am');
  });
});

describe('TEXTS_R2: the prefilled texts, exact words', () => {
  it('1. check-in', () => {
    expect(checkInTextR2(TUE, TZ, MON_7PM, 5, LINK)).toBe(
      ['Pickleball tomorrow @ 8pm!', '5 in so far. Want in? Join now.', 'Need to back out? Do it tonight to avoid cancel fees.', '', LINK].join('\n'),
    );
    expect(checkInTextR2(THU_730, TZ, at('2026-11-04T17:00:00Z'), 4, LINK).split('\n')[0]).toBe('Pickleball tomorrow @ 7:30pm!');
    // A game further out says "early", not "tonight".
    const far = checkInTextR2(TUE, TZ, at('2026-10-28T16:00:00Z'), 5, LINK).split('\n');
    expect(far.slice(0, 3)).toEqual(['Pickleball Tue Nov 3 @ 8pm!', '5 in so far. Want in? Join now.', 'Need to back out? Do it early to avoid cancel fees.']);
    // Two days out is "further out"; tomorrow and game day keep "tonight".
    expect(checkInTextR2(TUE, TZ, at('2026-11-01T17:00:00Z'), 5, LINK).split('\n')[2]).toBe('Need to back out? Do it early to avoid cancel fees.');
    expect(checkInTextR2(TUE, TZ, TUE_NOON, 5, LINK).split('\n')[2]).toBe('Need to back out? Do it tonight to avoid cancel fees.');
  });
  it('2. need players (also Find a sub, with tonight / today)', () => {
    expect(needPlayersTextR2(TUE, TZ, MON_7PM, 3, 1, LINK)).toBe(
      ['Pickleball tomorrow @ 8pm!', '3 in, need 1 more.', "Want in? Join tonight, otherwise we'll have to cancel.", '', LINK].join('\n'),
    );
    expect(needPlayersTextR2(TUE, TZ, at('2026-10-28T16:00:00Z'), 3, 1, LINK).split('\n').slice(0, 3)).toEqual(['Pickleball Tue Nov 3 @ 8pm!', '3 in, need 1 more.', "Want in? Join early, otherwise we'll have to cancel."]);
    expect(needPlayersTextR2(TUE, TZ, TUE_NOON, 2, 2, LINK).split('\n').slice(0, 2)).toEqual(['Pickleball tonight @ 8pm!', '2 in, need 2 more.']);
    expect(needPlayersTextR2({ startsAt: '2026-11-03T17:00:00.000Z' }, TZ, at('2026-11-03T13:00:00Z'), 0, 4, LINK).split('\n').slice(0, 2)).toEqual(['Pickleball today @ 12pm!', '0 in, need 4 more.']);
  });
  it('3. share the game', () => {
    expect(shareTextR2(TUE, TZ, MON_7PM, LINK)).toBe(['Pickleball tomorrow @ 8pm!', 'In or out here:', '', LINK].join('\n'));
  });
  it('4. final price: Thu Oct 29 style, last night / yesterday, same words', () => {
    const thu = { startsAt: '2026-10-30T00:00:00.000Z' }; // Thu Oct 29, 8:00 PM EDT
    expect(finalTextR2(thu, TZ, at('2026-11-02T16:00:00Z'), 6, 900, 1400, LINK)).toBe(
      ['Pickleball Thu Oct 29 is final: 6 played, $9 each.', 'If you paid $14, the extra $5 is now credit on your account.', '', LINK].join('\n'),
    );
    expect(finalTextR2(thu, TZ, at('2026-11-02T16:00:00Z'), 4, 1400, 1400, LINK)).toBe(['Pickleball Thu Oct 29 is final: 4 played, $14 each.', '', LINK].join('\n'));
    expect(finalTextR2(TUE, TZ, WED_NOON, 5, 1100, 1400, LINK).split('\n')[0]).toBe('Pickleball last night is final: 5 played, $11 each.');
    expect(finalTextR2({ startsAt: '2026-11-03T17:00:00.000Z' }, TZ, WED_NOON, 4, 1400, 1400, LINK).split('\n')[0]).toBe('Pickleball yesterday is final: 4 played, $14 each.');
    expect(finalTextR2(TUE, TZ, at('2026-11-04T03:30:00Z'), 5, 1100, 1400, LINK).split('\n')[0]).toBe('Pickleball tonight is final: 5 played, $11 each.');
  });
  it('5. spot opened', () => {
    expect(promotedTextR2(TUE, TZ, MON_7PM, LINK)).toBe(["A spot opened and you're in for pickleball tomorrow @ 8pm!", '', LINK].join('\n'));
  });
  it('6a. canceled, credit version: tomorrow, today, tonight, with the reason', () => {
    expect(canceledCreditTextR2(TUE, TZ, MON_7PM, LINK)).toBe(
      ['Pickleball tomorrow is canceled.', "If you paid, it's now your credit. You can request a cash out on the site.", '', LINK].join('\n'),
    );
    expect(canceledCreditTextR2(TUE, TZ, TUE_NOON, LINK, 'Rain')).toBe(
      ['Pickleball tonight is canceled. Rain.', "If you paid, it's now your credit. You can request a cash out on the site.", '', LINK].join('\n'),
    );
    expect(canceledCreditTextR2({ startsAt: '2026-11-03T17:00:00.000Z' }, TZ, at('2026-11-03T13:00:00Z'), LINK).split('\n')[0]).toBe('Pickleball today is canceled.');
  });
  it('6b. canceled, fee kept: the live words with line breaks, and the reason', () => {
    expect(canceledFeeKeptTextR2(TUE, TZ, TUE_NOON, 1400, LINK)).toBe(
      [
        "Heads up: today's game is canceled, and since it's inside 12 hours the venue is charging us for the court.",
        "If you were signed up, your $14 share still applies (if you already paid, you're all set).",
        'Sorry about that! You can pay on the site:',
        '',
        LINK,
      ].join('\n'),
    );
    expect(canceledFeeKeptTextR2(TUE, TZ, TUE_NOON, 1400, LINK, 'Thanksgiving').split('\n')[0]).toBe(
      "Heads up: today's game is canceled, and since it's inside 12 hours the venue is charging us for the court. Thanksgiving.",
    );
    expect(canceledFeeKeptTextR2(TUE, TZ, at('2026-11-03T03:00:00Z'), 1400, LINK).split('\n')[0]).toMatch(/^Heads up: tomorrow's game is canceled/);
  });
  it('7. moved: line breaks and the reason', () => {
    const was = '2026-11-04T01:00:00.000Z'; // Tue Nov 3
    expect(movedTextR2(THU_730, was, TZ, MON_7PM, LINK, 'Court swap')).toBe(['Pickleball tomorrow is moved to Thu Nov 5 @ 7:30pm. Court swap.', '', LINK].join('\n'));
    expect(movedTextR2(THU_730, was, TZ, at('2026-10-30T17:00:00Z'), LINK).split('\n')[0]).toBe('Pickleball Tue Nov 3 is moved to Thu Nov 5 @ 7:30pm.');
    // Same day, new time, asked the night before: never the weekday date for tomorrow.
    expect(movedTextR2({ startsAt: '2026-11-04T00:30:00.000Z' }, was, TZ, MON_7PM, LINK, 'Court swap').split('\n')[0]).toBe('Pickleball tomorrow is moved to 7:30pm. Court swap.');
    expect(movedTextR2({ startsAt: '2026-11-04T00:30:00.000Z' }, was, TZ, TUE_NOON, LINK).split('\n')[0]).toBe('Pickleball tonight is moved to 7:30pm.');
  });
  it('8. payment reminder, one person: yesterday or a date; several games give the total', () => {
    expect(paymentTextR2('Ryan', 1400, [TUE], TZ, WED_NOON, LINK)).toBe(['Hey Ryan, you owe $14 for pickleball yesterday.', 'Pay here:', '', LINK].join('\n'));
    expect(paymentTextR2('Ryan', 1400, [TUE], TZ, at('2026-11-09T17:00:00Z'), LINK).split('\n')[0]).toBe('Hey Ryan, you owe $14 for pickleball Tue Nov 3.');
    expect(paymentTextR2('Ryan', 2800, [TUE, THU_730], TZ, WED_NOON, LINK)).toBe(['Hey Ryan, you owe $28 for pickleball.', 'Pay here:', '', LINK].join('\n'));
  });
  it('9. remind all unpaid', () => {
    expect(remindAllTextR2(LINK)).toBe(["Hey, looks like you haven't paid for pickleball yet.", 'Pay here:', '', LINK].join('\n'));
  });
  it('10. still in? says confirmed', () => {
    expect(stillInTextR2(THU_730.startsAt, TZ, at('2026-11-04T17:00:00Z'), LINK)).toBe(
      ['Pickleball tomorrow is confirmed @ 7:30pm!', 'If you can no longer make it, let us know here:', '', LINK].join('\n'),
    );
  });
  it('11. the late-fee texts keep their live words, only line breaks added', () => {
    const a = courtCanceledTextR2();
    expect(a.split('\n')).toHaveLength(5);
    expect(a.replace(/\n/g, ' ')).toBe(
      "Hey guys, sorry, I have to back out of today's game. I canceled the court, so you can still book the same slot as non-members. It's only $2 more per person. Book online: https://app.courtreserve.com/Online/publicbookings/13765?tab=reserve&step=initial or call the courts at 810-207-5698. Sorry again, hope you can still get it in!",
    );
    const b = courtStillBookedTextR2();
    expect(b.split('\n')).toHaveLength(5);
    expect(b.replace(/\n/g, ' ')).toBe(
      "Hey guys, sorry, I have to back out of today's game. The court is still booked under my name, so you can still play. They might charge you $2 more each since the non-member rate is $16. They may be cool though and let you play under my membership pricing. Questions? Call the courts at 810-207-5698. Sorry again!",
    );
  });
  it('every text: no dashes, the address alone on its last line after a blank line, nothing says sent', () => {
    const all = [
      checkInTextR2(TUE, TZ, MON_7PM, 5, LINK),
      needPlayersTextR2(TUE, TZ, MON_7PM, 3, 1, LINK),
      shareTextR2(TUE, TZ, MON_7PM, LINK),
      finalTextR2(TUE, TZ, WED_NOON, 6, 900, 1400, LINK),
      promotedTextR2(TUE, TZ, MON_7PM, LINK),
      canceledCreditTextR2(TUE, TZ, MON_7PM, LINK, 'Rain'),
      canceledFeeKeptTextR2(TUE, TZ, TUE_NOON, 1400, LINK, 'Rain'),
      movedTextR2(THU_730, TUE.startsAt, TZ, MON_7PM, LINK, 'Court swap'),
      paymentTextR2('Ryan', 1400, [TUE], TZ, WED_NOON, LINK),
      remindAllTextR2(LINK),
      stillInTextR2(THU_730.startsAt, TZ, MON_7PM, LINK),
    ];
    for (const t of all) {
      expect(t).not.toMatch(/[–—]/);
      expect(t).not.toMatch(/\bsent\b/i);
      expect(t.endsWith(`\n\n${LINK}`)).toBe(true);
      expect(t.split(LINK).length).toBe(2);
    }
    for (const t of [courtCanceledTextR2(), courtStillBookedTextR2()]) expect(t).not.toMatch(/[–—]/);
  });
  it('line breaks survive the sms: link on iPhone and Android (a line break is %0A, never a raw newline)', () => {
    const body = checkInTextR2(TUE, TZ, MON_7PM, 5, LINK);
    for (const ios of [true, false]) {
      const href = smsHref(null, body, ios);
      expect(href).not.toMatch(/\n/);
      expect(href.split('%0A').length).toBe(body.split('\n').length);
      expect(href.includes('%0A%0A')).toBe(true); // the blank line before the address
      expect(decodeURIComponent(href.slice(href.indexOf('body=') + 5))).toBe(body);
      expect(href.startsWith(ios ? 'sms:&body=' : 'sms:?body=')).toBe(true); // no recipients
    }
    // A group of people on iPhone keeps the body intact too.
    expect(decodeURIComponent(smsHref(['3135550100', '3135550101'], body, true).split('&body=')[1])).toBe(body);
  });
  it('the text for a past game is never named "tomorrow"', () => {
    expect(paymentTextR2('Ryan', 1400, [TUE], TZ, at('2026-11-20T17:00:00Z'), LINK)).not.toMatch(/tomorrow|tonight|yesterday/);
  });
});

// ---------- The switch ----------

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  app.env.SITE_URL = 'https://pickleball.juncaj.net';
  return setupGroup(app);
}
type World = Awaited<ReturnType<typeof world>>;
const dash = async (w: World, headers: Record<string, string> = {}) => {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const sessionOn = (d: any, date: string) => d.sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
const joinAll = async (w: World, id: string, names: string[]) => {
  for (const n of names) expect((await (await playerPhone(w, n)).call('POST', `/api/sessions/${id}/join`, {})).status).toBe(200);
};

describe('TEXTS_R2: the switch', () => {
  it('N1 the var is allowed unless it says off', () => {
    expect(textsR2Allowed(undefined)).toBe(true);
    expect(textsR2Allowed('on')).toBe(true);
    expect(textsR2Allowed(' OFF ')).toBe(false);
  });
  it('N2 ships OFF: the dashboard says off for the screen and for everyone', async () => {
    const d = await dash(await world());
    expect([d.textsR2, d.textsR2ForAll]).toEqual([false, false]);
  });
  it('N3 the private header turns it on for that phone only (not for the switch row)', async () => {
    const w = await world();
    const d = await dash(w, { [TEXTS_R2_HEADER]: 'on' });
    expect([d.textsR2, d.textsR2ForAll]).toEqual([true, false]);
    expect((await dash(w, { [TEXTS_R2_HEADER]: 'yes' })).textsR2).toBe(false);
    expect((await dash(w)).textsR2).toBe(false);
  });
  it('N4 Settings switch: on for everyone with no deploy, off again, one stored row', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/texts-r2', { on: true })).data).toEqual({ ok: true, on: true });
    expect(await dash(w)).toMatchObject({ textsR2: true, textsR2ForAll: true });
    await w.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'texts_r2_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/texts-r2', { on: false })).data).toEqual({ ok: true, on: false });
    expect(await dash(w)).toMatchObject({ textsR2: false, textsR2ForAll: false });
  });
  it('N5 the kill switch beats the header and Settings', async () => {
    const w = await world({ TEXTS_R2: 'off' });
    await w.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
    expect(await dash(w, { [TEXTS_R2_HEADER]: 'on' })).toMatchObject({ textsR2: false, textsR2ForAll: true });
  });
  it('N6 the change shows in Activity, and only the organizer can flip it', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
    await w.organizer.call('PUT', '/api/admin/texts-r2', { on: false });
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries;
    expect(act.some((e: { action: string; text?: string }) => e.action === 'texts_r2_on')).toBe(true);
    expect(act.some((e: { action: string }) => e.action === 'texts_r2_off')).toBe(true);
    expect((await w.app.client().call('PUT', '/api/admin/texts-r2', { on: true })).status).toBe(401);
  });
  it('N7 wrangler.toml allows it for production and previews, and docs/FEATURE_SWITCHES.md lists it', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect((toml.match(/^TEXTS_R2 = "on"$/gm) ?? []).length).toBe(2);
    expect(readFileSync('docs/FEATURE_SWITCHES.md', 'utf8')).toMatch(/`TEXTS_R2`/);
  });
  it('N8 no database change: the newest migration is still 0016 and none mentions this switch', () => {
    const files = readdirSync('migrations').sort();
    expect(files[files.length - 1]).toBe('0016_time_confirmed.sql');
    for (const f of files) expect(readFileSync(`migrations/${f}`, 'utf8')).not.toMatch(/texts_r2/i);
  });
});

// ---------- The organizer's Text menu through the real dashboard ----------

describe('TEXTS_R2: the Text menu', () => {
  const ON = { [TEXTS_R2_HEADER]: 'on' };
  it('OFF: every text is exactly the old words', async () => {
    const w = await world();
    const d = await dash(w);
    const s = sessionOn(d, '2026-11-03');
    await joinAll(w, s.id, ['Blair', 'Casey']);
    const d2 = await dash(w);
    const items = sessionTexts(d2, sessionOn(d2, '2026-11-03'), Date.parse(d2.now));
    expect(items.map((i) => i.body)).toEqual([`Pickleball Tue Nov 3, 8:00 PM. In or out here: ${LINK}`, `Need 2 more for pickleball Tue Nov 3, 8:00 PM. In? ${LINK}`]);
    expect(items.some((i) => i.body.includes('\n'))).toBe(false);
  });
  it('ON, 2 in: share and need players, new words, both to a group chat', async () => {
    const w = await world();
    const s = sessionOn(await dash(w), '2026-11-03');
    await joinAll(w, s.id, ['Blair', 'Casey']);
    const d = await dash(w, ON);
    const items = sessionTexts(d, sessionOn(d, '2026-11-03'), Date.parse(d.now));
    expect(items.map((i) => i.id)).toEqual(['share', 'need']);
    expect(items[0].body).toBe(`Pickleball Tue Nov 3 @ 8pm!\nIn or out here:\n\n${LINK}`);
    expect(items[1].body).toBe(`Pickleball Tue Nov 3 @ 8pm!\n2 in, need 2 more.\nWant in? Join early, otherwise we'll have to cancel.\n\n${LINK}`);
    for (const i of items) expect([i.chat, i.phones]).toEqual([true, []]);
  });
  it('ON, 4 in: the check-in opens with NO recipients (OFF it goes to the numbers)', async () => {
    const w = await world();
    const s = sessionOn(await dash(w), '2026-11-03');
    await joinAll(w, s.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    const off = await dash(w);
    const itemOff = sessionTexts(off, sessionOn(off, '2026-11-03'), Date.parse(off.now)).find((i) => i.id === 'checkin')!;
    expect(itemOff.phones.length).toBe(4);
    expect(itemOff.chat).toBe(false);
    const on = await dash(w, ON);
    const item = sessionTexts(on, sessionOn(on, '2026-11-03'), Date.parse(on.now)).find((i) => i.id === 'checkin')!;
    expect([item.chat, item.phones, item.who]).toEqual([true, [], 'Group chat, you pick']);
    expect(item.body.split('\n')[1]).toBe('4 in so far. Want in? Join now.');
    expect(smsHref(item.phones.length ? item.phones : null, item.body, true).startsWith('sms:&body=')).toBe(true);
  });
  it('ON: payment reminders and remind all say the new words', async () => {
    const w = await world();
    const s = sessionOn(await dash(w), '2026-11-03');
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    await joinAll(w, s.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = at('2026-11-04T17:00:00Z'); // Wed noon, the day after
    const d = await dash(w, ON);
    expect(reminderText(d, w.byName.Blair, 'Blair')).toBe(`Hey Blair, you owe $14 for pickleball yesterday.\nPay here:\n\n${LINK}`);
    expect(unpaidPeople(d).body).toBe(`Hey, looks like you haven't paid for pickleball yet.\nPay here:\n\n${LINK}`);
    const off = await dash(w);
    expect(reminderText(off, w.byName.Blair, 'Blair')).toBe(`Hey Blair, you owe $14 for pickleball Tue Nov 3. Pay here: ${LINK}`);
  });
  it('ON: the canceled text is the credit version for any game, with the reason', async () => {
    const w = await world();
    const s = sessionOn(await dash(w), '2026-11-03');
    await joinAll(w, s.id, ['Blair', 'Casey']);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Thanksgiving' })).status).toBe(200);
    w.app.now = at('2026-11-02T20:00:00Z'); // Mon 3:00 PM: "tomorrow"
    const d = await dash(w, ON);
    const item = sessionTexts(d, sessionOn(d, '2026-11-03'), Date.parse(d.now)).find((i) => i.id === 'canceled')!;
    expect(item.body).toBe(`Pickleball tomorrow is canceled. Thanksgiving.\nIf you paid, it's now your credit. You can request a cash out on the site.\n\n${LINK}`);
    expect(item.phones.length).toBe(2);
  });
  it('ON + LATE_FEES, a late cancel: fee kept and waived both carry the reason (OFF drops it)', async () => {
    const w = await world();
    const s = sessionOn(await dash(w), '2026-11-03');
    await joinAll(w, s.id, ['Blair', 'Casey', 'Devon']);
    await w.organizer.call('PUT', '/api/admin/late-fees', { on: true });
    w.app.now = at('2026-11-03T15:00:00Z'); // Tue 10:00 AM, inside 12 hours of 8 PM
    const sid = (await dash(w)).sessions.find((x: any) => x.id === s.id);
    expect(sid).toBeTruthy();
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false, reason: 'Rain' })).status).toBe(200);
    const on = await dash(w, ON);
    const so = sessionOn(on, '2026-11-03');
    const kept = lateCancelText(on, so, '')!;
    expect(kept.feeKept).toBe(true);
    expect(kept.body).toBe(
      `Heads up: today's game is canceled, and since it's inside 12 hours the venue is charging us for the court. Rain.\nIf you were signed up, your $14 share still applies (if you already paid, you're all set).\nSorry about that! You can pay on the site:\n\n${LINK}`,
    );
    const off = await dash(w);
    expect(lateCancelText(off, sessionOn(off, '2026-11-03'), '')!.body).toBe(
      `Heads up: today's game is canceled, and since it's inside 12 hours the venue is charging us for the court. If you were signed up, your $14 share still applies (if you already paid, you're all set). You can pay on the site: ${LINK}. Sorry about that!`,
    );
    // Reopen and cancel again with Yes (waived): the credit version, "tonight", with the reason.
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'reopen' })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: true, reason: 'Rain' })).status).toBe(200);
    const on2 = await dash(w, ON);
    const waived = lateCancelText(on2, sessionOn(on2, '2026-11-03'), '')!;
    expect(waived.feeKept).toBe(false);
    expect(waived.body).toBe(`Pickleball tonight is canceled. Rain.\nIf you paid, it's now your credit. You can request a cash out on the site.\n\n${LINK}`);
  });
});

// ---------- Telegram: the tap alerts ----------

describe('TEXTS_R2: drop and "it\'s on" alerts', () => {
  const base = {
    actor: { playerId: 'r', name: 'Ryan' },
    startsAt: TUE.startsAt,
    deadlineMs: at('2026-11-03T13:00:00Z'),
    timezone: TZ,
    prefs: DEFAULT_ALERT_PREFS,
  };
  const p = (...n: string[]) => n.map((name) => ({ playerId: name.toLowerCase(), name }));
  it('OFF is the old sentence, ON names the game by its day', () => {
    const input = { ...base, before: [...p('A', 'B', 'C'), base.actor], after: p('A', 'B', 'C'), nowMs: at('2026-11-03T03:00:00Z') }; // Mon 10 PM, 22 hrs before
    expect(alertMessage(input)).toBe('Ryan dropped out of Tue Nov 3, 8:00 PM (22 hrs before). 3 in now, under 4.');
    expect(alertMessage({ ...input, textsR2: true })).toBe("Ryan dropped out of tomorrow's 8:00 PM game (22 hrs before). 3 in now, under 4.");
  });
  it('tonight: "tonight\'s game"; a late drop keeps its label; the count words stay', () => {
    const input = { ...base, before: [...p('A', 'B', 'C', 'D', 'E'), base.actor], after: p('A', 'B', 'C', 'D', 'E'), nowMs: at('2026-11-03T16:00:00Z'), textsR2: true }; // Tue 11 AM
    expect(alertMessage(input)).toBe("Late drop: Ryan dropped out of tonight's game (9 hrs before). 5 in now.");
  });
  it('the waitlist line and "owes $14" when the drop made a debt', () => {
    const input = { ...base, before: [...p('A', 'B', 'C'), base.actor], after: p('A', 'B', 'C', 'W'), nowMs: at('2026-11-03T16:00:00Z'), textsR2: true };
    expect(alertMessage({ ...input, dropperOwesCents: 1400 })).toBe("Late drop: Ryan dropped out of tonight's game (9 hrs before). W moved up from the waitlist. 4 in now. Ryan owes $14.");
    const short = { ...base, before: [...p('A', 'B', 'C'), base.actor], after: p('A', 'B', 'C'), nowMs: at('2026-11-03T16:00:00Z'), textsR2: true };
    expect(alertMessage({ ...short, dropperOwesCents: 1400 })).toBe("Late drop: Ryan dropped out of tonight's game (9 hrs before). 3 in now, under 4. Ryan owes $14.");
    // No debt, or the switch off: nothing about owing.
    expect(alertMessage({ ...short, dropperOwesCents: null })).not.toMatch(/owes/);
    expect(alertMessage({ ...short, textsR2: false, dropperOwesCents: 1400 })).not.toMatch(/owes/);
  });
  it('11. reaches 4: "Tomorrow\'s 8:00 PM game has 4 now, it\'s on."', () => {
    const input = { ...base, before: p('A', 'B', 'C'), after: [...p('A', 'B', 'C'), base.actor], nowMs: at('2026-11-02T16:00:00Z'), textsR2: true }; // Mon noon
    expect(alertMessage(input)).toBe("Tomorrow's 8:00 PM game has 4 now, it's on.");
    expect(alertMessage({ ...input, textsR2: false })).toBe('Tue Nov 3, 8:00 PM has 4 now, it\'s on.');
    // Further away than tomorrow: the date, still named as a game.
    expect(alertMessage({ ...input, nowMs: at('2026-10-30T16:00:00Z') })).toBe("The Tue Nov 3, 8:00 PM game has 4 now, it's on.");
  });
  it('alertGame: tomorrow / tonight / today / a date', () => {
    expect(alertGame(TUE.startsAt, TZ, MON_7PM, '8:00 PM')).toBe("tomorrow's 8:00 PM game");
    expect(alertGame(TUE.startsAt, TZ, TUE_NOON, '8:00 PM')).toBe("tonight's game");
    expect(alertGame('2026-11-03T17:00:00.000Z', TZ, at('2026-11-03T13:00:00Z'), '12:00 PM')).toBe("today's game");
    expect(alertGame(TUE.startsAt, TZ, at('2026-10-30T16:00:00Z'), '8:00 PM')).toBe('the Tue Nov 3, 8:00 PM game');
  });
});

// ---------- The clock: timing, with fake clocks ----------

const ADMIN = 'https://pickleball.juncaj.net/admin';
const OFF: TaskOptions = { tz: TZ, bookingLeadDays: 14, defaultDeadlineHours: 12, links: { admin: ADMIN, book: COURTRESERVE_BOOKING_URL, cancel: COURTRESERVE_CANCEL_URL } };
const R2: TaskOptions = { ...OFF, textsR2: true };

/** A two-hour game Eastern on a date, 8:00 PM unless said otherwise; cancel-by is 12 hours before. */
function game(date: string, over: Partial<TaskSession> = {}, hour = 20, minute = 0): TaskSession {
  const [y, m, d] = date.split('-').map(Number);
  const start = dayAt(new Date(Date.UTC(y, m - 1, d, 17)).toISOString(), TZ, 0, hour, minute);
  return {
    id: `s-${date}`,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * HOUR).toISOString(),
    canceled: false,
    canceledAt: null,
    confirmedCount: 3,
    booked: true,
    bookedAt: null,
    cancellationDeadlineAt: new Date(start - 12 * HOUR).toISOString(),
    finalized: false,
    holiday: null,
    ...over,
  };
}
/** Every alert that comes due on a 5-minute sweep (each sent once): [Eastern minute label, id, text]. */
function alertsOver(sessions: TaskSession[], o: TaskOptions, from: string, to: string, marks: ReadonlySet<string> = new Set()) {
  const sent = new Set<string>();
  const out: { at: number; id: string; text: string }[] = [];
  for (let now = at(from); now <= at(to); now += 5 * MIN) {
    for (const a of dueAlerts(nextTasks(now, sessions, marks, o), now, sent)) {
      sent.add(a.key);
      out.push({ at: now, id: a.id, text: a.text });
    }
  }
  return out;
}
const when = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(/^(\w{3}) /, '$1, ');

describe('TEXTS_R2: Telegram wording (clock brain)', () => {
  it('#1 night-before last call says Tomorrow, link text unchanged', () => {
    const five = game('2026-11-03', { confirmedCount: 5 });
    const three = game('2026-11-03', { confirmedCount: 3 });
    const a5 = dueAlerts(nextTasks(at('2026-11-03T00:00:00Z'), [five], new Set(), R2), at('2026-11-03T00:00:00Z'), new Set());
    expect(a5.map((a) => a.text)).toEqual([`Tomorrow: 5 players in. Text the group to confirm: ${ADMIN}`]);
    const a3 = dueAlerts(nextTasks(at('2026-11-03T00:00:00Z'), [three], new Set(), R2), at('2026-11-03T00:00:00Z'), new Set());
    expect(a3.map((a) => a.text)).toEqual([`Tomorrow: 3 players in, need a 4th. Text the group: ${ADMIN}`]);
    // Off: the weekday, as before.
    expect(dueAlerts(nextTasks(at('2026-11-03T00:00:00Z'), [five], new Set(), OFF), at('2026-11-03T00:00:00Z'), new Set()).map((a) => a.text)).toEqual([`Tuesday: 5 players in. Text the group to confirm: ${ADMIN}`]);
  });
  it('#2 and #3 cancel warning and follow-up keep their words with Tomorrow', () => {
    const list = alertsOver([game('2026-11-03')], R2, '2026-11-02T22:00:00Z', '2026-11-03T05:00:00Z');
    expect(list.filter((a) => a.id !== 'night').map((a) => [when(a.at), a.text])).toEqual([
      ['Mon, 10:00 PM', `Tomorrow: only 3 players in. Cancel court: ${COURTRESERVE_CANCEL_URL}`],
      ['Mon, 10:30 PM', `Tomorrow: court canceled? Now cancel the session and text everyone: ${ADMIN}`],
    ]);
  });
  it('#4 the game-day check is gone; it still exists with the switch off', () => {
    const day = (o: TaskOptions) => alertsOver([game('2026-11-03')], o, '2026-11-03T05:00:00Z', '2026-11-03T14:00:00Z');
    expect(day(R2).map((a) => a.id)).toEqual([]);
    expect(day(OFF).map((a) => [when(a.at), a.id])).toEqual([['Tue, 7:15 AM', 'gameday']]);
    // The Home card still reads the same on game day (it is the alert that went).
    const card = nextTasks(at('2026-11-03T12:30:00Z'), [game('2026-11-03')], new Set(), R2).find((t) => t.kind === 'cancel')!;
    expect(card.text).toBe('Tonight: only 3 players in. Cancel court before 8:00 AM.');
    expect(card.alerts.map((a) => a.id)).not.toContain('gameday');
  });
  it('#8 finalize says Tonight for an evening game and Today for a daytime game', () => {
    const eve = alertsOver([game('2026-11-03', { confirmedCount: 5 })], R2, '2026-11-04T02:00:00Z', '2026-11-04T05:00:00Z');
    expect(eve.map((a) => [when(a.at), a.text])).toEqual([['Tue, 10:05 PM', `Tonight: finalize who played: ${ADMIN}`]]);
    const day = alertsOver([game('2026-11-03', { confirmedCount: 5 }, 14, 0)], R2, '2026-11-03T17:00:00Z', '2026-11-03T22:00:00Z');
    expect(day.map((a) => [when(a.at), a.text])).toEqual([['Tue, 4:05 PM', `Today: finalize who played: ${ADMIN}`]]);
    expect(alertsOver([game('2026-11-03', { confirmedCount: 5 })], OFF, '2026-11-04T02:00:00Z', '2026-11-04T05:00:00Z')[0].text).toBe(`Tuesday: finalize who played: ${ADMIN}`);
  });
});

describe('TEXTS_R2: #5 booking heads-up at 6:55 AM, #6 reminder only while not booked', () => {
  const nov17 = (over: Partial<TaskSession> = {}) => game('2026-11-17', { booked: false, confirmedCount: 0, ...over });
  const day = (o: TaskOptions, s: TaskSession) => alertsOver([s], o, '2026-11-03T10:00:00Z', '2026-11-03T16:00:00Z');
  it('before / at / after the heads-up', () => {
    const s = nov17();
    const due = (o: TaskOptions, iso: string) => dueAlerts(nextTasks(at(iso), [s], new Set(), o), at(iso), new Set()).map((a) => a.id);
    expect(due(R2, '2026-11-03T11:50:00Z')).toEqual([]); // 6:50 AM
    expect(due(R2, '2026-11-03T11:55:00Z')).toEqual(['book']); // 6:55 AM
    expect(due(R2, '2026-11-03T12:00:00Z')).toEqual(['book']); // 7:00 AM (a missed 6:55 tick still goes out)
    // Off: 6:45 AM, as before.
    expect(due(OFF, '2026-11-03T11:40:00Z')).toEqual([]);
    expect(due(OFF, '2026-11-03T11:45:00Z')).toEqual(['book']);
  });
  it('the words are unchanged and it is sent once, at 6:55 AM on a 5-minute clock', () => {
    const list = day(R2, nov17());
    expect(list.map((a) => [when(a.at), a.id, a.text])).toEqual([
      ['Tue, 6:55 AM', 'book', `Tue Nov 17 opens at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked: ${ADMIN}`],
      ['Tue, 7:30 AM', 'book_followup', `Reminder: Tue Nov 17 opened at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked: ${ADMIN}`],
    ]);
    expect(day(OFF, nov17()).map((a) => when(a.at))).toEqual(['Tue, 6:45 AM', 'Tue, 7:30 AM']);
  });
  it('the reminder skips a game that is Booked, Waitlisted or Canceled, and fires while Not booked', () => {
    const ids = (s: TaskSession) => day(R2, s).map((a) => a.id);
    expect(ids(nov17())).toEqual(['book', 'book_followup']);
    expect(ids(nov17({ waitlisted: true }))).toEqual(['book']);
    expect(ids(nov17({ booked: true, bookedAt: '2026-11-03T12:10:00Z' }))).toEqual([]);
    expect(ids(nov17({ canceled: true, canceledAt: '2026-11-01T12:00:00Z' }))).toEqual([]);
    // The status changing between the two alerts: booked a backup (Waitlist) at 7:10 AM, before the 7:30 AM reminder.
    const sent = new Set<string>();
    const before = dueAlerts(nextTasks(at('2026-11-03T11:55:00Z'), [nov17()], new Set(), R2), at('2026-11-03T11:55:00Z'), sent);
    for (const a of before) sent.add(a.key);
    const after = dueAlerts(nextTasks(at('2026-11-03T12:30:00Z'), [nov17({ waitlisted: true })], new Set(), R2), at('2026-11-03T12:30:00Z'), sent);
    expect(before.map((a) => a.id)).toEqual(['book']);
    expect(after).toEqual([]);
    // Off: the reminder still fires for a Waitlisted game (the bug this switch fixes), so nothing else about OFF changed.
    expect(day(OFF, nov17({ waitlisted: true })).map((a) => a.id)).toEqual(['book', 'book_followup']);
  });
  it('a reminder missed by less than an hour still goes out; at an hour it is dropped', () => {
    const s = nov17();
    const due = (iso: string) => dueAlerts(nextTasks(at(iso), [s], new Set(), R2), at(iso), new Set(['s-2026-11-17:book'])).map((a) => a.id);
    expect(due('2026-11-03T13:25:00Z')).toEqual(['book_followup']); // 8:25 AM, 55 minutes late
    expect(due('2026-11-03T13:30:00Z')).toEqual([]); // 8:30 AM, exactly an hour late: gone
  });
});

describe('TEXTS_R2: #7 "no court yet" 30 minutes before cancel-by, never before 7:00 AM', () => {
  const noCourt = (s: TaskSession, o: TaskOptions = R2) => alertsOver([s], o, '2026-11-03T05:00:00Z', '2026-11-03T20:00:00Z').filter((a) => a.id === 'nocourt');
  it('8:00 PM game, cancel-by 8:00 AM: 7:30 AM, before / at / after', () => {
    const s = game('2026-11-03', { booked: false, confirmedCount: 5 });
    const due = (iso: string) => dueAlerts(nextTasks(at(iso), [s], new Set(), R2), at(iso), new Set()).map((a) => a.id);
    expect(due('2026-11-03T12:25:00Z')).toEqual([]); // 7:25 AM
    expect(due('2026-11-03T12:30:00Z')).toEqual(['nocourt']); // 7:30 AM
    expect(due('2026-11-03T12:35:00Z')).toEqual(['nocourt']); // a tick later it is still unsent
    expect(noCourt(s).map((a) => [when(a.at), a.text])).toEqual([['Tue, 7:30 AM', `Tonight: 5 in, no court yet. Check CourtReserve for an opening: ${COURTRESERVE_BOOKING_URL}`]]);
    // Off: 8:15 AM, as before.
    expect(noCourt(s, OFF).map((a) => when(a.at))).toEqual(['Tue, 8:15 AM']);
  });
  it('a 7:00 PM game (cancel-by 7:00 AM) goes at 7:00 AM, never earlier', () => {
    const s = game('2026-11-03', { booked: false, confirmedCount: 5 }, 19, 0);
    expect(noCourt(s).map((a) => when(a.at))).toEqual(['Tue, 7:00 AM']);
    const due = (iso: string) => dueAlerts(nextTasks(at(iso), [s], new Set(), R2), at(iso), new Set()).map((a) => a.id);
    expect(due('2026-11-03T11:55:00Z')).toEqual([]); // 6:55 AM, which a plain "30 minutes before" would have used
    expect(due('2026-11-03T12:00:00Z')).toEqual(['nocourt']);
  });
  it('a daytime game says Today; not with fewer than 4 in; not when booked or canceled; a Waitlisted game still gets it', () => {
    const five = game('2026-11-03', { booked: false, confirmedCount: 5 }, 17, 0);
    expect(noCourt(five).map((a) => a.text)[0]).toMatch(/^Tonight: 5 in, no court yet/);
    const noon = game('2026-11-03', { booked: false, confirmedCount: 5 }, 14, 0);
    expect(noCourt(noon).map((a) => a.text)[0]).toMatch(/^Today: 5 in, no court yet/);
    expect(noCourt(game('2026-11-03', { booked: false, confirmedCount: 3 }))).toEqual([]);
    expect(noCourt(game('2026-11-03', { booked: true, confirmedCount: 5 }))).toEqual([]);
    expect(noCourt(game('2026-11-03', { booked: false, confirmedCount: 5, canceled: true, canceledAt: '2026-11-03T05:00:00Z' }))).toEqual([]);
    expect(noCourt(game('2026-11-03', { booked: false, confirmedCount: 5, waitlisted: true })).length).toBe(1);
  });
  it('the Home "no court yet" card shows at the same time as the alert', () => {
    const s = game('2026-11-03', { booked: false, confirmedCount: 5 });
    const kinds = (iso: string) => nextTasks(at(iso), [s], new Set(), R2).map((t) => t.kind);
    expect(kinds('2026-11-03T12:25:00Z')).not.toContain('nocourt');
    expect(kinds('2026-11-03T12:30:00Z')).toContain('nocourt');
  });
  it('a custom cancel-by is followed; a 24-hour cancel-by still gets its alert, when the 24-hour window opens', () => {
    // Cancel-by 24 hours before an 8:00 PM game is Mon 8:00 PM; 30 minutes before that is outside the 24 hours, so it goes at 8:00 PM.
    const s = game('2026-11-03', { booked: false, confirmedCount: 5, cancellationDeadlineAt: '2026-11-03T01:00:00.000Z' });
    const mine = (o: TaskOptions) => alertsOver([s], o, '2026-11-02T10:00:00Z', '2026-11-03T20:00:00Z').filter((a) => a.id === 'nocourt').map((a) => when(a.at));
    expect(mine(R2)).toEqual(['Mon, 8:00 PM']);
    expect(mine(OFF)).toEqual(['Mon, 8:15 PM']); // the old time, 15 minutes after
    // A 10:00 AM cancel-by (10 hours before): 9:30 AM.
    const ten = game('2026-11-03', { booked: false, confirmedCount: 5, cancellationDeadlineAt: '2026-11-03T15:00:00.000Z' });
    expect(alertsOver([ten], R2, '2026-11-02T10:00:00Z', '2026-11-03T20:00:00Z').filter((a) => a.id === 'nocourt').map((a) => when(a.at))).toEqual(['Tue, 9:30 AM']);
  });
});

describe('TEXTS_R2: the quick check never skips a due alert', () => {
  it('every 5 minutes Oct 14 to Nov 27, games with every start time, with the switch on', { timeout: 120_000 }, () => {
    const sessions = [
      game('2026-11-01', { booked: false, confirmedCount: 5 }, 19, 0), // the clock change day
      game('2026-11-03', { booked: false, confirmedCount: 5 }),
      game('2026-11-05', { booked: false, confirmedCount: 5 }, 19, 30),
      game('2026-11-07', { booked: false, confirmedCount: 6 }, 10, 0),
      game('2026-11-10', { booked: false, confirmedCount: 4 }, 6, 30), // cancel-by 6:30 PM the day before
      game('2026-11-12', { booked: false, confirmedCount: 5, cancellationDeadlineAt: '2026-11-12T10:00:00.000Z' }),
      game('2026-11-17', { booked: false, confirmedCount: 0 }),
      game('2026-11-19', { booked: false, confirmedCount: 0, waitlisted: true }),
      game('2026-11-24', { booked: true, confirmedCount: 5 }),
      game('2026-11-13', { booked: false, confirmedCount: 5, cancellationDeadlineAt: new Date(Date.parse(game('2026-11-13').startsAt) - 24 * HOUR).toISOString() }), // a 24-hour cancel-by
    ];
    for (let now = at('2026-10-14T04:00:00Z'); now < at('2026-11-27T05:00:00Z'); now += 5 * MIN) {
      const all = dueAlerts(nextTasks(now, sessions, new Set(), R2), now, new Set());
      const kept = sessions.filter((s) => mayAlertSoon(s, s.confirmedCount, now, R2) && mayAlertSoon(s, null, now, R2));
      expect(dueAlerts(nextTasks(now, kept, new Set(), R2), now, new Set())).toEqual(all);
    }
  });
});

describe('TEXTS_R2: switched off, nothing about the clock changes', () => {
  it('every card, alert and quick check, every 5 minutes Oct 14 to Nov 27, is identical with the switch false or missing', { timeout: 120_000 }, () => {
    // tick-scenarios builds its options without the switch (the golden file test proves that is the old behavior). The same
    // options with textsR2: false (what an OFF screen or clock passes) must give the identical cards, alerts and quick check.
    expect(SWEEP_TZ).toBe(TZ);
    const plain = sweep();
    expect(plain.alerts.length).toBeGreaterThan(20);
    expect(plain.alerts.some((l) => l.includes('Tomorrow'))).toBe(false);
    expect(plain.alerts.some((l) => l.includes(':gameday'))).toBe(true);
    const base = { ...OFF, links: { ...OFF.links, go: (id: string) => `https://pickleball.juncaj.net/go/${id}` } };
    const falsy = { ...base, textsR2: false };
    for (let now = at('2026-10-14T04:00:00Z'); now < at('2026-11-27T05:00:00Z'); now += 5 * MIN) {
      const a = nextTasks(now, SWEEP_SESSIONS, new Set(), base);
      const b = nextTasks(now, SWEEP_SESSIONS, new Set(), falsy);
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`cards differ at ${new Date(now).toISOString()}`);
      for (const s of SWEEP_SESSIONS) {
        if (mayAlertSoon(s, s.confirmedCount, now, base) !== mayAlertSoon(s, s.confirmedCount, now, falsy)) throw new Error(`quick check differs at ${new Date(now).toISOString()}`);
      }
    }
  });
  it('the old wording functions still say what they said (the clock Worker sends these with the switch off)', () => {
    expect(checkInMessage(TUE, TZ, MON_7PM, LINK)).toBe(`Pickleball tomorrow, 8:00 PM. Can't make it? Update here: ${LINK}`);
    expect(needPlayersMessage(TUE, TZ, MON_7PM, 1, LINK)).toBe(`Need 1 more for pickleball tomorrow, 8:00 PM. In? ${LINK}`);
  });
  it('the Home card list is identical with the switch off or missing, and only the labels differ with it on', async () => {
    const w = await world();
    const s = sessionOn(await dash(w), '2026-11-03');
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    w.app.now = at('2026-11-03T00:30:00Z'); // Mon 7:30 PM, after the last call
    const d = await dash(w);
    const off = dashboardTasks(d, w.app.now, ADMIN);
    const on = dashboardTasks({ ...d, textsR2: true }, w.app.now, ADMIN);
    expect(off.find((t) => t.kind === 'night')?.text).toBe('Tuesday: No one in yet, need 4.');
    expect(on.find((t) => t.kind === 'night')?.text).toBe('Tomorrow: No one in yet, need 4.');
  });
});

// ---------- Through the real tick endpoint ----------

const TOKEN = '123456:FAKE-test-token-never-real';
const CHAT = '9988776655';
const SECRET = 'test-cron-secret-0123456789abcdef0123456789';
const GO = 'https://pickleball.juncaj.net/go/TOKEN';

async function smartGroup(env: Record<string, string> = {}) {
  const app = new TestApp();
  const sent: string[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: CHAT,
    CRON_SECRET: SECRET,
    GO_LINKS: 'on',
    ...env,
    TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
      sent.push(sentText(JSON.parse(String(init.body))).replace(/\/go\/[A-Za-z0-9_.-]+/, '/go/TOKEN'));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  const tick = async () => {
    const r = await ctx.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
    await app.settle();
    return r;
  };
  const dashD = async (headers: Record<string, string> = {}) => (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
  const sessionDate = async (date: string) => sessionOn(await dashD(), date);
  return { app, ctx, sent, tick, dashD, sessionDate };
}
async function fill(g: Awaited<ReturnType<typeof smartGroup>>, date: string, n: number) {
  const s = await g.sessionDate(date);
  await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
  for (const name of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'].slice(0, n)) expect((await (await playerPhone(g.ctx, name)).call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
  await g.app.settle();
  g.sent.length = 0;
  return s;
}
async function runHours(g: Awaited<ReturnType<typeof smartGroup>>, hours: number) {
  const end = g.app.now + hours * HOUR;
  while (g.app.now <= end) {
    expect((await g.tick()).status).toBe(200);
    g.app.now += 5 * MIN;
  }
}

describe('TEXTS_R2: the real tick endpoint', () => {
  const setup = async (env: Record<string, string> = {}, on = true) => {
    const g = await smartGroup(env);
    g.app.now = at('2026-11-02T17:00:00Z'); // Mon Nov 2, noon EST
    await g.dashD(); // makes the games up to six weeks out
    await fill(g, '2026-11-03', 3);
    await fill(g, '2026-11-05', 5);
    if (on) expect((await g.ctx.organizer.call('PUT', '/api/admin/texts-r2', { on: true })).status).toBe(200);
    return g;
  };
  it('ON: 48 hours of ticks send the five alerts once each with the new words, and no game-day check', async () => {
    const g = await setup();
    await runHours(g, 48);
    expect(g.sent).toEqual([
      `Tomorrow: 3 players in, need a 4th. Text the group: ${GO}`,
      `Tomorrow: only 3 players in. Cancel court: ${COURTRESERVE_CANCEL_URL}`,
      `Tomorrow: court canceled? Now cancel the session and text everyone`,
      `Tue Nov 17 opens at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`,
      `Reminder: Tue Nov 17 opened at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`,
    ]);
  });
  it('OFF (the default): the same 48 hours send the old six, word for word', async () => {
    const g = await setup({}, false);
    await runHours(g, 48);
    expect(g.sent).toEqual([
      `Tuesday: 3 players in, need a 4th. Text the group: ${GO}`,
      `Tuesday: only 3 players in. Cancel court: ${COURTRESERVE_CANCEL_URL}`,
      `Tuesday: court canceled? Now cancel the session and text everyone`,
      `Tue Nov 17 opens at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`,
      `Tonight: only 3 players in. Cancel court before 8:00 AM: ${COURTRESERVE_CANCEL_URL}`,
      `Reminder: Tue Nov 17 opened at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`,
    ]);
  });
  it('the kill switch (TEXTS_R2 = off) sends the old alerts even with Settings on', async () => {
    const g = await setup({ TEXTS_R2: 'off' });
    await runHours(g, 48);
    expect(g.sent[0]).toBe(`Tuesday: 3 players in, need a 4th. Text the group: ${GO}`);
    expect(g.sent.length).toBe(6);
  });
  it("a phone's private link never changes a Telegram alert (it is not tied to a phone)", async () => {
    const g = await setup({}, false);
    const d = await g.dashD({ [TEXTS_R2_HEADER]: 'on' });
    expect([d.textsR2, d.textsR2ForAll]).toEqual([true, false]);
    g.app.now = at('2026-11-03T00:00:00Z'); // Mon 7:00 PM: the last call
    // The tick call itself carrying the header (it never does, but if it did) still sends the old words.
    const r = await g.ctx.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET, [TEXTS_R2_HEADER]: 'on' });
    await g.app.settle();
    expect(r.status).toBe(200);
    expect(g.sent).toEqual([`Tuesday: 3 players in, need a 4th. Text the group: ${GO}`]);
  });
  it('sent once: a second tick at the same time, and the next ticks, send nothing more', async () => {
    const g = await setup();
    g.app.now = at('2026-11-03T12:00:00Z'); // 7:00 AM Tue, the court opened for Nov 17
    expect((await g.tick()).data).toMatchObject({ sent: 1 }); // the heads-up goes at once (6:55 AM tick was missed)
    expect((await g.tick()).data).toMatchObject({ sent: 0 });
    g.app.now += 5 * MIN;
    expect((await g.tick()).data).toMatchObject({ sent: 0 });
    expect(g.sent).toEqual([`Tue Nov 17 opens at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`]);
  });
  it('a tick that missed the 6:55 AM slot by less than an hour still sends the heads-up; an hour late does not', async () => {
    const g = await setup();
    g.app.now = at('2026-11-03T12:50:00Z'); // 7:50 AM: the 6:55 AM heads-up is 55 minutes late
    await g.tick();
    expect(g.sent).toEqual([
      `Tue Nov 17 opens at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`,
      `Reminder: Tue Nov 17 opened at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`,
    ]);
    const late = await setup();
    late.app.now = at('2026-11-03T13:00:00Z'); // 8:00 AM: both are an hour or more late
    await late.tick();
    expect(late.sent).toEqual([`Reminder: Tue Nov 17 opened at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`]);
  });
  it('the reminder does not go out once the game was set to Waitlist or Booked (through the real court switch)', async () => {
    const g = await setup();
    const nov17 = await g.sessionDate('2026-11-17');
    g.app.now = at('2026-11-03T11:55:00Z');
    await g.tick();
    expect(g.sent.length).toBe(1);
    expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${nov17.id}/court-status`, { status: 'waitlist' })).status).toBe(200);
    g.app.now = at('2026-11-03T12:30:00Z'); // 7:30 AM
    await g.tick();
    expect(g.sent.length).toBe(1);
  });
  it('Not booked again after a Waitlist: the reminder fires', async () => {
    const g = await setup();
    const nov17 = await g.sessionDate('2026-11-17');
    await g.ctx.organizer.call('POST', `/api/admin/sessions/${nov17.id}/court-status`, { status: 'waitlist' });
    await g.ctx.organizer.call('POST', `/api/admin/sessions/${nov17.id}/court-status`, { status: 'not_booked' });
    g.app.now = at('2026-11-03T12:30:00Z');
    await g.tick();
    expect(g.sent).toEqual([
      `Tue Nov 17 opens at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`,
      `Reminder: Tue Nov 17 opened at 7:00 AM. Book: ${COURTRESERVE_BOOKING_URL}\nThen set it to Booked`,
    ]);
  });
  it('nothing fires for a canceled game', async () => {
    const g = await setup();
    const tue = await g.sessionDate('2026-11-03');
    expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${tue.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    g.sent.length = 0;
    g.app.now = at('2026-11-02T17:00:00Z');
    await runHours(g, 36);
    expect(g.sent.some((t) => /Tomorrow|Tonight/.test(t))).toBe(false);
    expect(g.sent.every((t) => t.includes('Tue Nov 17'))).toBe(true);
  });
  it('"no court yet" through the tick: 7:30 AM with the switch on, 8:15 AM off', async () => {
    for (const [on, want] of [[true, '7:30 AM'], [false, '8:15 AM']] as const) {
      const g = await smartGroup();
      g.app.now = at('2026-11-02T17:00:00Z');
      await g.dashD();
      const s = await g.sessionDate('2026-11-03');
      await joinAll(g.ctx, s.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
      await g.app.settle();
      g.sent.length = 0;
      if (on) await g.ctx.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
      g.app.now = at('2026-11-03T11:00:00Z'); // 6:00 AM Tue
      const times: string[] = [];
      while (g.app.now < at('2026-11-03T14:00:00Z')) {
        const before = g.sent.length;
        await g.tick();
        if (g.sent.slice(before).some((t) => t.includes('no court yet'))) times.push(when(g.app.now).replace('Tue, ', ''));
        g.app.now += 5 * MIN;
      }
      expect(times).toEqual([want]);
      expect(g.sent.filter((t) => t.includes('no court yet'))).toEqual([`Tonight: 5 in, no court yet. Check CourtReserve for an opening: ${COURTRESERVE_BOOKING_URL}`]);
    }
  });
  it('the 5-per-tick cap still holds with the switch on: seven last calls due at once go out 5, then 2', async () => {
    const g = await smartGroup();
    g.app.now = at('2026-11-02T17:00:00Z'); // Mon noon
    await g.dashD();
    await g.ctx.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
    // Seven extra games on Wed Nov 4 at 8:00, 8:05 ... 8:30 PM, booked: their last calls are Tue 7:00, 7:05 ... 7:30 PM.
    for (let k = 0; k < 7; k++) {
      const start = new Date(zonedTimeToUtc(2026, 11, 4, 20, k * 5, TZ)).toISOString();
      const end = new Date(zonedTimeToUtc(2026, 11, 4, 22, k * 5, TZ)).toISOString();
      const made = await g.ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: start, endsAt: end });
      expect(made.status).toBe(200);
      expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${made.data.id}/booked`, {})).status).toBe(200);
    }
    g.sent.length = 0;
    g.app.now = at('2026-11-04T00:40:00Z'); // Tue 7:40 PM EST: all seven are due, none an hour late yet
    expect((await g.tick()).data).toMatchObject({ sent: 5, failed: 0 });
    expect(g.sent.length).toBe(5);
    expect((await g.tick()).data).toMatchObject({ sent: 2, failed: 0 });
    expect((await g.tick()).data).toMatchObject({ sent: 0, failed: 0 });
    expect(g.sent.length).toBe(7);
    for (const t of g.sent) expect(t).toMatch(/^Tomorrow: No one in yet, need 4\. Text the group: /);
  });
  it('Settings > Alerts > Test smart alert shows the new sample when it is on for everyone', async () => {
    for (const on of [false, true]) {
      const g = await smartGroup();
      if (on) await g.ctx.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
      const r = await g.ctx.organizer.call('POST', '/api/admin/alerts/smart-test', {});
      await g.app.settle();
      expect(r.status).toBe(200);
      expect(g.sent[0]).toContain(on ? 'Real ones look like: "Tomorrow: 3 players in, need a 4th. Text the group:' : 'Real ones look like: "Tuesday: 3 players in, need a 4th. Text the group:');
    }
  });
  it('the Text the group link opens the new words with the switch on (everyone or this phone), the old words off', async () => {
    const g = await setup({}, false);
    const { makeGoToken } = await import('../server/go');
    const tue = await g.sessionDate('2026-11-03');
    g.app.now = at('2026-11-03T00:00:00Z');
    const token = await makeGoToken(SECRET, tue.id, tue.startsAt, g.app.now);
    const open = (headers: Record<string, string> = {}) => g.ctx.organizer.call('POST', '/api/go', { token }, headers);
    expect((await open()).data.body).toBe(`Need 1 more for pickleball tomorrow, 8:00 PM. In? ${LINK}`);
    expect((await open({ [TEXTS_R2_HEADER]: 'on' })).data.body).toBe(`Pickleball tomorrow @ 8pm!\n3 in, need 1 more.\nWant in? Join tonight, otherwise we'll have to cancel.\n\n${LINK}`);
    await joinAll(g.ctx, tue.id, ['Emery', 'Frankie']);
    await g.ctx.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
    expect((await open()).data.body).toBe(`Pickleball tomorrow @ 8pm!\n5 in so far. Want in? Join now.\nNeed to back out? Do it tonight to avoid cancel fees.\n\n${LINK}`);
  });
});

// ---------- Through the real tap alerts ----------

describe('TEXTS_R2: a drop through the real API', () => {
  const setup = async (r2: boolean) => {
    const g = await smartGroup();
    g.app.now = at('2026-11-02T17:00:00Z');
    await g.dashD();
    if (r2) await g.ctx.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
    return g;
  };
  it('a player dropping the night before: "tomorrow\'s 8:00 PM game" (OFF names the date)', async () => {
    for (const r2 of [false, true]) {
      const g = await setup(r2);
      const s = await g.sessionDate('2026-11-03');
      await joinAll(g.ctx, s.id, ['Blair', 'Casey', 'Devon', 'Emery']);
      await g.app.settle();
      g.sent.length = 0;
      expect((await (await playerPhone(g.ctx, 'Emery')).call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
      await g.app.settle();
      expect(g.sent).toEqual([
        r2 ? "Emery dropped out of tomorrow's 8:00 PM game (32 hrs before). 3 in now, under 4." : 'Emery dropped out of Tue Nov 3, 8:00 PM (32 hrs before). 3 in now, under 4.',
      ]);
    }
  });
  it('with late fees on, a drop that makes a debt adds "owes $14"; one that does not, adds nothing', async () => {
    const g = await setup(true);
    await g.ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true });
    const s = await g.sessionDate('2026-11-03');
    await joinAll(g.ctx, s.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await g.app.settle();
    g.sent.length = 0;
    g.app.now = at('2026-11-03T16:00:00Z'); // Tue 11:00 AM: inside the 12 hours
    expect((await (await playerPhone(g.ctx, 'Emery')).call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    await g.app.settle();
    expect(g.sent).toEqual(["Late drop: Emery dropped out of tonight's game (9 hrs before). 3 in now, under 4. Emery owes $14."]);
  });
  it('a game reaching 4: "Tomorrow\'s 8:00 PM game has 4 now, it\'s on."', async () => {
    const g = await setup(true);
    const s = await g.sessionDate('2026-11-03');
    await joinAll(g.ctx, s.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await g.app.settle();
    expect(g.sent).toEqual(["Tomorrow's 8:00 PM game has 4 now, it's on."]);
  });
});

describe('TEXTS_R2: what was removed', () => {
  it('the unused wording and the duplicate Text button are gone from the code', () => {
    const messages = readFileSync('shared/messages.ts', 'utf8');
    for (const gone of ['pollMessage', 'courtWaitlistPollMessage', 'confirmationMessage', 'replacementMessage', 'bookingMessage']) expect(messages).not.toContain(gone);
    expect(() => readFileSync('src/pages/admin/Texts.tsx', 'utf8')).toThrow();
  });
  it('"Text this alert to yourself" is hidden with the switch on (checked in the browser test), its wording stays while the switch can be off', () => {
    expect(readFileSync('shared/messages.ts', 'utf8')).toContain('deadlineAlertMessage');
    expect(readFileSync('src/pages/admin/Sessions.tsx', 'utf8')).toContain("ctx.d.textsR2 !== true");
  });
});
