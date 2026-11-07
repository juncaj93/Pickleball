// Zip 11, "Alert cards" (ALERT_CARDS): the switch (ships off, the private header, the Settings row, the kill switch, the change stamp,
// the Activity line, the same data either way), every rule in src/alert-cards.css under <html data-alert-cards>, the color tokens at
// 4.5:1, the dead code that is gone (the /t/ link page, the "I booked it" button, the game-day check, the player standby words), and the
// preview seed. The look itself is checked in the browser (e2e/zip11.cjs) and OFF = main by e2e/zip11-off.cjs.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { nextTasks, taskTimes } from '../shared/tasks';
import { ALERT_CARDS_HEADER, splitFirst, zip11Allowed } from '../shared/zip11';
import { PREVIEW_SWITCHES_ON } from '../scripts/seed-preview-world';
import { PIN, playerPhone, setupGroup, TestApp } from './harness';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W, headers: Record<string, string> = {}) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  return r.data;
}
const group = async (w: W, headers: Record<string, string> = {}) => (await (await playerPhone(w, 'Blair')).call('GET', '/api/group', undefined, headers)).data;
const PATH = '/api/admin/alert-cards-switch';

describe('the switch', () => {
  it('the kill switch var is allowed unless it says off', () => {
    expect(zip11Allowed(undefined)).toBe(true);
    expect(zip11Allowed('on')).toBe(true);
    expect(zip11Allowed(' OFF ')).toBe(false);
    expect(ALERT_CARDS_HEADER).toBe('X-Alert-Cards');
  });

  it('ships off: no flag on the player view or the dashboard, only the Settings row value', async () => {
    const w = await world();
    expect('alertCards' in (await group(w))).toBe(false);
    const d = await dash(w);
    expect('alertCards' in d).toBe(false);
    expect(d.alertCardsForAll).toBe(false);
  });

  it('the private header turns it on for that phone only (player and organizer screens)', async () => {
    const w = await world();
    expect((await group(w, { [ALERT_CARDS_HEADER]: 'on' })).alertCards).toBe(true);
    expect('alertCards' in (await group(w))).toBe(false);
    expect((await dash(w, { [ALERT_CARDS_HEADER]: 'on' })).alertCards).toBe(true);
    expect('alertCards' in (await group(w, { [ALERT_CARDS_HEADER]: 'yes' }))).toBe(false);
  });

  it('the Settings switch turns it on for everyone and off again; one row, logged, organizer only; players notice on their next check', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    const v0 = (await blair.call('GET', '/api/group/version')).data.v;
    expect((await w.organizer.call('PUT', PATH, { on: true })).status).toBe(200);
    await w.organizer.call('PUT', PATH, { on: true });
    expect((await w.app.db.prepare('SELECT COUNT(*) AS n FROM task_log WHERE task = ?').bind('alert_cards_on').first<{ n: number }>())?.n).toBe(1);
    expect((await group(w)).alertCards).toBe(true);
    expect((await dash(w)).alertCardsForAll).toBe(true);
    expect((await blair.call('GET', '/api/group/version')).data.v).not.toBe(v0);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: { action: string }) => e.action === 'alert_cards_on');
    expect(activityText({ ...act }, 'America/Detroit', 'Alex')).toBe('Alex switched "Alert cards" on');
    expect((await w.app.client().call('PUT', PATH, { on: true })).status).toBe(401);
    expect((await blair.call('PUT', PATH, { on: false })).status).toBe(401);
    await w.organizer.call('PUT', PATH, { on: false });
    expect('alertCards' in (await group(w))).toBe(false);
    // Off again: the change stamp is exactly what it was before (no leftover piece).
    expect((await blair.call('GET', '/api/group/version')).data.v).toBe(v0);
    const off = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: { action: string }) => e.action === 'alert_cards_off');
    expect(activityText({ ...off }, 'America/Detroit', 'Alex')).toBe('Alex switched "Alert cards" off');
  });

  it('the kill switch beats both the header and Settings', async () => {
    const w = await world({ ALERT_CARDS: 'off' });
    await w.organizer.call('PUT', PATH, { on: true });
    expect('alertCards' in (await group(w, { [ALERT_CARDS_HEADER]: 'on' }))).toBe(false);
    expect('alertCards' in (await dash(w, { [ALERT_CARDS_HEADER]: 'on' }))).toBe(false);
  });

  it('look only: the server sends the same games, money and alerts either way; the flag is the only difference', async () => {
    const w = await world();
    const strip = (x: Record<string, unknown>) => {
      const { alertCards: _a, version: _v, now: _n, ...rest } = x;
      return rest;
    };
    const off = strip(await group(w));
    const on = strip(await group(w, { [ALERT_CARDS_HEADER]: 'on' }));
    expect(on).toEqual(off);
    const doff = strip(await dash(w));
    const don = strip(await dash(w, { [ALERT_CARDS_HEADER]: 'on' }));
    expect(don).toEqual(doff);
  });
});

describe('the look (src/alert-cards.css)', () => {
  const css = readFileSync(new URL('../src/alert-cards.css', import.meta.url), 'utf8');

  it('every rule is under <html data-alert-cards> (dormant with the switch off)', () => {
    const rules = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((r) => r.split('{')[0].trim())
      .filter((sel) => sel && !sel.startsWith('@'));
    expect(rules.length).toBeGreaterThan(40);
    for (const sel of rules) for (const part of sel.split(',')) expect(part.trim(), part).toMatch(/^html\[data-alert-cards\]/);
  });

  /** WCAG contrast of two hex colors. */
  const contrast = (a: string, b: string) => {
    const lum = (h: string) => {
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** The tokens of one block (light, the phone's dark, the site's dark). */
  const blocks = () => {
    const out: Record<string, string>[] = [];
    for (const m of css.matchAll(/html\[data-alert-cards\](?::not\(\[data-theme='light'\]\)|\[data-theme='dark'\])? \{([^}]*)\}/g)) {
      const t: Record<string, string> = {};
      for (const d of m[1].matchAll(/--(ac-[a-z-]+):\s*(#[0-9a-f]{6})/g)) t[d[1]] = d[2];
      if (Object.keys(t).length > 20) out.push(t);
    }
    return out;
  };

  it('light, dark and dark again: every tone has its tokens, the two dark blocks are the same', () => {
    const [light, dark1, dark2] = blocks();
    expect(light && dark1 && dark2).toBeTruthy();
    expect(dark2).toEqual(dark1);
    for (const tone of ['green', 'amber', 'blue', 'purple', 'gray', 'red']) for (const k of ['tint', 'fill', 'fill-ink', 'ink']) expect(light[`ac-${tone}-${k}`], `${tone}-${k}`).toMatch(/^#/);
    // The card is the game card's own surface (src/player-cards.css --pc-card, --pc-line, --pc-ink, --pc-muted, --pc-ring), light and dark.
    expect([light['ac-card'], light['ac-line'], light['ac-title'], light['ac-sub'], light['ac-ring']]).toEqual(['#ffffff', '#dad9cf', '#18241d', '#4a4f46', '#18241d']);
    expect([dark1['ac-card'], dark1['ac-line'], dark1['ac-title'], dark1['ac-sub'], dark1['ac-ring']]).toEqual(['#18221c', '#2b3a31', '#f1f3ec', '#b8bfb2', '#d5dacf']);
    const pc = readFileSync(new URL('../src/player-cards.css', import.meta.url), 'utf8');
    for (const v of ['#ffffff', '#dad9cf', '#18221c', '#2b3a31', '#d5dacf']) expect(pc).toContain(v);
  });

  it('every text and button pair is 4.5:1 or better, light and dark (title, sub line, filled button, outline button, link); badge icons 3:1', () => {
    for (const t of blocks()) {
      for (const tone of ['green', 'amber', 'blue', 'purple', 'gray', 'red']) {
        const bg = t['ac-card'];
        expect(contrast(t[`ac-${tone}-ink`], t[`ac-${tone}-tint`]), `${tone} badge icon`).toBeGreaterThanOrEqual(3);
        expect(contrast(t['ac-title'], bg), `${tone} title`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['ac-sub'], bg), `${tone} sub`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t[`ac-${tone}-fill-ink`], t[`ac-${tone}-fill`]), `${tone} filled button`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t[`ac-${tone}-ink`], bg), `${tone} outline and link`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t['ac-red-ink'], t['ac-card']), 'red sub line').toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the stylesheets are loaded last (after zip10.css); the alert balls are the game card\'s own SpotDots, no ball of its own', () => {
    const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
    expect(main.indexOf("import './alert-cards.css'")).toBeGreaterThan(main.indexOf("import './zip10.css'"));
    const piece = readFileSync(new URL('../src/AlertCard.tsx', import.meta.url), 'utf8');
    // Two svgs: the badge and the X. No ball or circle drawing of its own: the balls come from SpotDots (the game card's).
    expect(piece.match(/<svg/g)).toHaveLength(2);
    expect(piece).toContain('<SpotDots');
    expect(piece).not.toMatch(/ball-skin|className="ball/);
    expect(main.indexOf("import './seat-dots.css'")).toBeGreaterThan(main.indexOf("import './alert-cards.css'"));
  });

  it('organizer card words are their own words split at the first sentence', () => {
    expect(splitFirst('Tomorrow: only 3 players in. Cancel court before 7:00 AM.')).toEqual({ title: 'Tomorrow: only 3 players in', rest: 'Cancel court before 7:00 AM' });
    expect(splitFirst('Tonight: 5 in, no court yet. Check CourtReserve for an opening.')).toEqual({ title: 'Tonight: 5 in, no court yet', rest: 'Check CourtReserve for an opening' });
    expect(splitFirst('Tonight: finalize who played.')).toEqual({ title: 'Tonight: finalize who played', rest: '' });
    expect(splitFirst('Kai tapped I paid ($14), not confirmed. Dropped out of Tue, Nov 10.')).toEqual({ title: 'Kai tapped I paid ($14), not confirmed', rest: 'Dropped out of Tue, Nov 10' });
  });
});

describe('dead code that is gone (Zip 11)', () => {
  it('the /t/ link page is deleted and an old /t/ link opens the home page', () => {
    expect(existsSync(new URL('../src/pages/LinkPage.tsx', import.meta.url))).toBe(false);
    const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
    expect(main).not.toContain('LinkPage');
    expect(main).toMatch(/\\\/t\(\\\/\|\$\)/);
    expect(main).toContain("window.history.replaceState(null, '', '/')");
  });

  const game = (confirmedCount: number, booked = true) => ({
    id: 'g',
    startsAt: '2026-11-04T01:00:00.000Z', // Tue Nov 3, 8:00 PM Eastern
    endsAt: '2026-11-04T03:00:00.000Z',
    canceled: false,
    canceledAt: null,
    confirmedCount,
    booked,
    bookedAt: null,
    cancellationDeadlineAt: null,
    finalized: false,
    holiday: null,
  });
  const opts = (textsR2: boolean) => ({ tz: 'America/Detroit', bookingLeadDays: 14, defaultDeadlineHours: 12, links: { admin: 'A', book: 'B', cancel: 'C' }, ...(textsR2 ? { textsR2: true } : {}) });

  it('no task has an "I booked it" button any more (nothing drew it); the court switch sets Booked', () => {
    for (const textsR2 of [false, true]) {
      for (let ms = Date.parse('2026-10-20T10:00:00Z'); ms < Date.parse('2026-11-04T01:00:00Z'); ms += 15 * 60_000) {
        for (const t of nextTasks(ms, [game(5, false), game(0, false)].map((g, i) => ({ ...g, id: `g${i}` })), new Set(), opts(textsR2))) {
          expect(t.buttons.map((b) => b.label)).not.toContain('I booked it');
          expect(t.buttons.map((b) => b.action.type as string)).not.toContain('booked');
        }
      }
    }
  });

  it('the game-day check (6:15 / 7:15 AM) is gone with Texts round 2 on or off; the night-before warning and its follow-up stay', () => {
    for (const textsR2 of [false, true]) {
      const ids = new Set<string>();
      for (let ms = Date.parse('2026-11-02T12:00:00Z'); ms < Date.parse('2026-11-04T01:00:00Z'); ms += 5 * 60_000) {
        for (const t of nextTasks(ms, [game(3)], new Set(), opts(textsR2))) for (const a of t.alerts) ids.add(a.id);
      }
      expect([...ids]).not.toContain('gameday');
      expect([...ids]).toContain('cancel');
      expect([...ids]).toContain('cancel_followup');
    }
    expect('gamedayCheck' in taskTimes(game(3), opts(false))).toBe(false);
  });

  it('the standby words are KEPT: a game that already started on a court still on Waitlist reaches the card (fresh review, Zip 11)', () => {
    const src = readFileSync(new URL('../src/pages/PlayerHome.tsx', import.meta.url), 'utf8');
    for (const w of ['Join standby', 'Leave standby', 'on standby']) expect(src, w).toContain(w);
  });
});

describe('the preview', () => {
  it('the preview has every switch that is on live, plus Alert cards', () => {
    expect(PREVIEW_SWITCHES_ON).toContain('alert_cards_on');
    expect(PREVIEW_SWITCHES_ON).toContain('card_cleanup_on');
  });
  it('the kill switch is allowed on live and on the preview (wrangler.toml)', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml.match(/^ALERT_CARDS = "on"$/gm)).toHaveLength(2);
  });
});

describe('Seat dots (SEAT_DOTS)', () => {
  const SD = { header: 'X-Seat-Dots', path: '/api/admin/seat-dots-switch' };
  it('ships off; the private header turns it on for one phone; the Settings row for everyone, logged; the kill switch beats both', async () => {
    const w = await world();
    expect('seatDots' in (await group(w))).toBe(false);
    expect((await dash(w)).seatDotsForAll).toBe(false);
    expect((await group(w, { [SD.header]: 'on' })).seatDots).toBe(true);
    expect((await dash(w, { [SD.header]: 'on' })).seatDots).toBe(true);
    const blair = await playerPhone(w, 'Blair');
    const v0 = (await blair.call('GET', '/api/group/version')).data.v;
    expect((await w.organizer.call('PUT', SD.path, { on: true })).status).toBe(200);
    expect((await group(w)).seatDots).toBe(true);
    expect((await blair.call('GET', '/api/group/version')).data.v).not.toBe(v0);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: { action: string }) => e.action === 'seat_dots_on');
    expect(activityText({ ...act }, 'America/Detroit', 'Alex')).toBe('Alex switched "Seat dots" on');
    expect((await blair.call('PUT', SD.path, { on: false })).status).toBe(401);
    await w.organizer.call('PUT', SD.path, { on: false });
    expect('seatDots' in (await group(w))).toBe(false);
    expect((await blair.call('GET', '/api/group/version')).data.v).toBe(v0);
    const k = await world({ SEAT_DOTS: 'off' });
    await k.organizer.call('PUT', SD.path, { on: true });
    expect('seatDots' in (await group(k, { [SD.header]: 'on' }))).toBe(false);
  });
  it('every rule in src/seat-dots.css is under <html data-seat-dots>, and it only touches the empty seat (never a ball)', () => {
    const css = readFileSync(new URL('../src/seat-dots.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = css.split('}').map((r) => r.split('{')[0].trim()).filter((sel) => sel && !sel.startsWith('@'));
    for (const sel of rules) for (const part of sel.split(',')) expect(part.trim(), part).toMatch(/^html\[data-seat-dots\]/);
    expect(css).not.toMatch(/\.ball/);
    const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8');
    // One empty-seat component, used by SpotDots.
    expect(ui.match(/className="dot"/g)).toHaveLength(1);
    expect(ui).toContain('<EmptySeat key={i} />');
  });
  it('the kill switch is allowed on live and on the preview (wrangler.toml), and the preview has it on', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml.match(/^SEAT_DOTS = "on"$/gm)).toHaveLength(2);
    expect(PREVIEW_SWITCHES_ON).toContain('seat_dots_on');
  });
});
