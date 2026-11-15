// Zip 47 audit probes (read-only audit): the Christmas skin (shared/christmasSkin.ts, server/christmasSkin.ts, src/skin/*).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inChristmasWindow, thanksgivingDay, windowStartDay } from '../../../shared/christmasSkin';
import { zonedTimeToUtc } from '../../../shared/time';
import { PIN, playerPhone, setupGroup } from '../../harness';

const TZ = 'America/Detroit';
const et = (y: number, m: number, d: number, h = 0, min = 0) => zonedTimeToUtc(y, m, d, h, min, TZ);

describe('P-X01 the window, 2026 to 2030: Friday after Thanksgiving 12:00 AM Eastern through Dec 31 11:59 PM Eastern', () => {
  const starts: [number, number][] = [
    [2026, 27],
    [2027, 26],
    [2028, 24],
    [2029, 23],
    [2030, 29],
  ];
  it.each(starts)('%i: opens Fri Nov %i', (y, d) => {
    expect(windowStartDay(y)).toBe(d);
    expect(thanksgivingDay(y)).toBe(d - 1);
    expect(new Date(Date.UTC(y, 10, d)).getUTCDay()).toBe(5); // a Friday
    expect(inChristmasWindow(et(y, 11, d - 1, 23, 59))).toBe(false); // Thanksgiving 11:59 PM
    expect(inChristmasWindow(et(y, 11, d - 1, 23, 59) + 59_999)).toBe(false); // 11:59:59.999 PM
    expect(inChristmasWindow(et(y, 11, d, 0, 0))).toBe(true); // Friday 12:00 AM
    expect(inChristmasWindow(et(y, 12, 31, 23, 59) + 59_999)).toBe(true); // Dec 31 11:59:59.999 PM
    expect(inChristmasWindow(et(y + 1, 1, 1, 0, 0))).toBe(false); // Jan 1 12:00 AM
    // UTC traps: Dec 31 7 PM Eastern is Jan 1 UTC (still in); Friday 12:00 AM Eastern is 5 AM UTC (UTC midnight is still Thursday evening).
    expect(inChristmasWindow(et(y, 12, 31, 19, 30))).toBe(true);
    expect(inChristmasWindow(Date.UTC(y, 10, d, 0, 0))).toBe(false);
  });
  it('the brief\'s "Nov 27" is only right in 2026: Nov 27 2027 is a day late (the window already opened Fri Nov 26), and in 2028/2029 Nov 27 is days late; 2030 opens Nov 29, AFTER Nov 27', () => {
    expect(inChristmasWindow(et(2027, 11, 26, 12))).toBe(true);
    expect(inChristmasWindow(et(2030, 11, 27, 12))).toBe(false);
    expect(inChristmasWindow(et(2030, 11, 28, 12))).toBe(false); // Thanksgiving 2030
  });
});

type W = Awaited<ReturnType<typeof setupGroup>>;
const raw = (w: W) => w.app.db.raw;
const setMode = async (w: W, mode: 'off' | 'me' | 'all') => {
  expect((await w.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
  expect((await w.organizer.call('PUT', '/api/admin/christmas-skin-switch', { mode })).status).toBe(200);
};
/** Every table except task_log and the History (audit) table. */
function snapshot(w: W): string {
  const tables = (raw(w).prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name).filter((t) => t !== 'task_log' && !/audit|activity/.test(t));
  return tables.map((t) => `${t}:${JSON.stringify(raw(w).prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())}`).join('\n');
}
const strip = (o: any) => {
  const { christmasSkin, christmasSkinMe, version, ...rest } = o;
  void christmasSkin;
  void christmasSkinMe;
  void version;
  return JSON.stringify(rest);
};

describe('P-X02 look only: with a guest in a game, the player answer is identical with the skin on and off (except the one flag)', () => {
  it('Everyone, inside the window, guest spot on, "Blair + Sam (guest)": answers equal; admin dashboard never carries a player skin flag', async () => {
    const w = await setupGroup();
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    w.app.now = et(2026, 12, 5, 12);
    expect((await w.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    expect((await w.organizer.call('PUT', '/api/admin/guest-spot-switch', { on: true })).status).toBe(200);
    const d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = d.sessions.find((x: any) => Date.parse(x.startsAt) > w.app.now && x.status !== 'canceled');
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    const g = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/guest`, { playerId: w.byName.Blair, name: 'Sam' });
    expect(g.status, g.text).toBe(200);
    const off = (await blair.call('GET', '/api/group')).data;
    const dOff = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    const dbOff = snapshot(w);
    await setMode(w, 'all');
    const on = (await blair.call('GET', '/api/group')).data;
    expect(on.christmasSkin).toBe(true);
    expect(strip(on)).toBe(strip(off));
    expect(JSON.stringify(on)).toContain('Sam');
    const dOn = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(dOn.christmasSkin).toBeUndefined();
    expect(dOn.christmasSkinMe).toBeUndefined();
    const { christmasSkinMode, version: v1, ...dOnRest } = dOn;
    const { version: v2, ...dOffRest } = dOff;
    void v1;
    void v2;
    expect(christmasSkinMode).toBe('all');
    const differ = Object.keys({ ...dOnRest, ...dOffRest }).filter((k) => JSON.stringify((dOnRest as any)[k]) !== JSON.stringify((dOffRest as any)[k]));
    // Only the History feed differs (the switch's own "Christmas skin everyone" line), nothing about games, seats or money.
    expect(differ.filter((k) => !/^audit$|activity|recent|history|feed/i.test(k)), JSON.stringify(differ)).toEqual([]);
    // Just me, Alex's own player: still the same seats, money and names.
    await setMode(w, 'me');
    const alex = await playerPhone(w, 'Alex');
    const me = (await alex.call('GET', '/api/group')).data;
    expect(me.christmasSkinMe).toEqual({ on: false });
    expect((await alex.call('POST', '/api/christmas-skin-me', { on: true })).data).toMatchObject({ applied: true });
    // The skin's writes never touched any table but task_log (and History).
    // Sign-ins (setMode signs in again, Alex's phone picks his name) add session rows; every other table must be untouched.
    const changed = snapshot(w).split('\n').filter((l) => !dbOff.split('\n').includes(l)).map((l) => l.split(':')[0]);
    expect(changed.filter((t) => !/^(admin_sessions|player_devices|login_attempts)$/.test(t)), JSON.stringify(changed)).toEqual([]);
    const rows = (raw(w).prepare("SELECT task FROM task_log WHERE task LIKE 'christmas%' ORDER BY task").all() as { task: string }[]).map((r) => r.task);
    expect(rows).toEqual(['christmas_skin_me', 'christmas_skin_me_on']);
  });
  it('christmas-skin-me: another player and a read-only organizer phone write nothing', async () => {
    const w = await setupGroup();
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    w.app.env.ORGANIZER_READONLY_PIN = '58302917';
    await setMode(w, 'me');
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', '/api/christmas-skin-me', { on: true })).data).toMatchObject({ applied: false });
    const ro = w.app.client();
    expect((await ro.call('POST', '/api/admin/login', { pin: '58302917' })).status).toBe(200);
    expect((await ro.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' })).status).toBe(403);
    expect(raw(w).prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'christmas_skin_me_on'").get()).toEqual({ n: 0 });
    expect(raw(w).prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'christmas_skin_on'").get()).toEqual({ n: 0 });
  });
});

describe('P-X03 code trace: the CSS cannot reach guest rows, names, the Players sheet, dialogs, or the admin venue card', () => {
  const css = readFileSync(new URL('../../../src/skin/christmas.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css
    .split('}')
    .map((b) => b.split('{')[0].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|[\d.]+%)$/.test(s))
    .flatMap((s) => s.split(',').map((p) => p.trim()));
  it('no selector names a guest, a names line, a roster, a sheet, a dialog, a venue card, an alert-card title or button', () => {
    const bad = selectors.filter((s) => /guest|names-line|waitlist-line|roster|sheet|dialog|venue|ac-title|ac-sub|ac-btn|confirm|players|money|price|owe/i.test(s));
    expect(bad).toEqual([]);
  });
  it('no rule sets display:none, visibility, content text (except an empty pseudo-element), or pointer-events on anything but decoration', () => {
    const rules = css.split('}').map((b) => b.split('{')).filter((x) => x.length === 2);
    const hide = rules.filter(([, body]) => /display:\s*none|visibility:\s*hidden|content:\s*'[^']/.test(body));
    expect(hide).toEqual([]);
    const pe = rules.filter(([, body]) => /pointer-events/.test(body)).map(([sel]) => sel.trim());
    expect(pe.every((s) => /::before|skin-bubble/.test(s))).toBe(true);
  });
  it('Admin screens import nothing from src/skin and the venue card has no skin hook', () => {
    expect(readFileSync(new URL('../../../src/pages/Admin.tsx', import.meta.url), 'utf8')).not.toMatch(/skin\//);
    expect(readFileSync(new URL('../../../src/pages/admin/VenueAlert.tsx', import.meta.url), 'utf8')).not.toMatch(/skin|xorn|christmas/i);
  });
});
