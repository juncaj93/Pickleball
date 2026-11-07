// Zip 12: the saved copy's privacy and throw-away rules (src/lastScreen.ts), the two flags on the player's answer (server/speed.ts),
// the year-long cache rule for built files (public/_headers) and the smaller logo.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Each test builds the fake world (a few seconds on a busy machine).
vi.setConfig({ testTimeout: 60_000 });
import { createNodeD1 } from '../dev/nodeD1';
import { handleApi } from '../server/app';
import { buildSeed, previewPin, WITH_VENMO } from '../scripts/seed-preview-world';
import { asOfText, LAST_SCREEN_KEY, readLastScreen, sanitize, saveLastScreen } from '../src/lastScreen';
import type { GroupView } from '../shared/api';
import { LAST_SCREEN_MAX_AGE_MS } from '../shared/speed';

const AT = Date.parse('2026-11-07T17:00:00.000Z'); // Sat Nov 7, 12:00 PM Eastern

async function world(env: Record<string, string> = {}, keepSpeedRows = false) {
  const { sql } = await buildSeed(AT);
  const raw = createNodeD1(':memory:');
  raw.raw.exec(sql);
  if (!keepSpeedRows) raw.raw.exec("DELETE FROM task_log WHERE session_id IS NULL AND kind = 'mark' AND task LIKE 'speed_%'");
  const e: any = { DB: raw, ...env };
  const call = async (method: string, path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) => {
    const h = new Headers(headers);
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e, AT, () => {});
    const text = await res.text();
    return { status: res.status, text, data: (() => { try { return JSON.parse(text); } catch { return null; } })(), cookie: res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ') };
  };
  const admin = (await call('POST', '/api/admin/login', '', { pin: previewPin() })).cookie;
  const dash = (await call('GET', '/api/admin/dashboard', admin)).data;
  const phone = async (name: string) => (await call('POST', '/api/me', '', { playerId: dash.players.find((p: any) => p.name.startsWith(name)).id })).cookie;
  return { raw, call, admin, dash, phone, env: e };
}

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('saved copy: what is kept (never money, phones, Venmo, organizer-only)', () => {
  it('a player who owes, paid, has credit: the kept copy holds no money and no private field at all', async () => {
    const w = await world();
    for (const name of ['Avery', 'Indy', 'Gray', 'Harper', 'Lane', 'Kai', 'Jordan']) {
      const ck = await w.phone(name);
      const v = (await w.call('GET', '/api/group', ck, undefined, { 'X-Last-Screen': 'on' })).data as GroupView;
      expect(v.lastScreen).toBe(true);
      const store = new MemStore();
      saveLastScreen('plain', v, AT, store);
      const text = store.getItem(LAST_SCREEN_KEY)!;
      expect(text, name).toBeTruthy();
      // Every amount of money in the copy is zero (price, owed, credit, shares, drop money, fees).
      for (const m of text.matchAll(/"(\w*[Cc]ents)":(-?\d+|null)/g)) expect([m[1], m[2]], name).toEqual([m[1], m[2] === 'null' ? 'null' : '0']);
      expect(text).not.toMatch(/555-01|\(313\)/); // phone numbers
      for (const handle of WITH_VENMO) expect(text.toLowerCase()).not.toContain(`venmo.com/u/${handle.toLowerCase()}`);
      expect(text).not.toMatch(/venmo\.com|zelle|"paid"|"unpaid"|lateFee":\{|history":\[\{/i);
      const kept = JSON.parse(text).view as GroupView;
      expect(kept.group.organizerName).toBeNull();
      expect(kept.group.venmoUrl).toBeNull();
      expect(kept.group.priceCents).toBe(0);
      expect(kept.players).toEqual([]); // the names list ("Who are you?") is not kept
      expect(kept.owed).toEqual([]);
      expect(kept.payDue).toEqual([]);
      expect(kept.credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
      expect(kept.suggestion).toBeNull();
      expect(kept.feeNotices).toBeUndefined();
      expect(kept.payAlways).toBeUndefined();
      expect(kept.paySheet).toBeUndefined();
      expect(kept.instantTaps).toBeUndefined();
      for (const s of kept.sessions) {
        expect(s.canceled).toBe(false);
        expect(s.past).toBe(false);
        expect(s.finalized).toBeNull();
        expect(s.timeAsk).toBeNull();
        expect(s.shortGame).toBeUndefined();
        if (s.mine) expect(s.mine.paymentStatus).toBe('not_applicable');
      }
      // What it does keep: the games still to come, their names and balls, and your own in / out.
      const live = v.sessions.filter((s) => !s.canceled && !s.past && Date.parse(s.endsAt) > AT);
      expect(kept.sessions.map((s) => s.id)).toEqual(live.map((s) => s.id));
      expect(kept.sessions.map((s) => s.confirmed.map((p) => p.name))).toEqual(live.map((s) => s.confirmed.map((p) => p.name)));
      expect(kept.sessions.map((s) => s.mine?.status ?? null)).toEqual(live.map((s) => s.mine?.status ?? null));
      expect(kept.me).toEqual(v.me);
    }
  });

  it('nothing is kept for the organizer\'s View as, a phone with no name, or with the switch off (and an old copy is dropped)', async () => {
    const w = await world();
    const store = new MemStore();
    const avery = w.dash.players.find((p: any) => p.name.startsWith('Avery'));
    const viewAs = (await w.call('GET', '/api/group', w.admin, undefined, { 'X-View-As': avery.id, 'X-Last-Screen': 'on' })).data as GroupView;
    store.setItem(LAST_SCREEN_KEY, 'old');
    saveLastScreen('plain', viewAs, AT, store);
    expect(store.getItem(LAST_SCREEN_KEY)).toBeNull();
    const nobody = (await w.call('GET', '/api/group', '', undefined, { 'X-Last-Screen': 'on' })).data as GroupView;
    store.setItem(LAST_SCREEN_KEY, 'old');
    saveLastScreen('plain', nobody, AT, store);
    expect(store.getItem(LAST_SCREEN_KEY)).toBeNull();
    const off = (await w.call('GET', '/api/group', await w.phone('Avery'))).data as GroupView;
    expect(off.lastScreen).toBeUndefined();
    store.setItem(LAST_SCREEN_KEY, 'old');
    saveLastScreen('plain', off, AT, store);
    expect(store.getItem(LAST_SCREEN_KEY)).toBeNull();
  });
});

describe('saved copy: when it is thrown away', () => {
  async function kept() {
    const w = await world();
    const v = (await w.call('GET', '/api/group', await w.phone('Avery'), undefined, { 'X-Last-Screen': 'on' })).data as GroupView;
    const store = new MemStore();
    saveLastScreen('plain', v, AT, store);
    return { v, store };
  }
  it('shown within 24 hours on the same address; never after 24 hours (and dropped)', async () => {
    const { store } = await kept();
    expect(readLastScreen('plain', AT + 60_000, store)).not.toBeNull();
    expect(readLastScreen('g-other', AT + 60_000, store)).toBeNull(); // another address: not shown (kept for its own)
    expect(readLastScreen('plain', AT + LAST_SCREEN_MAX_AGE_MS - 1, store)).not.toBeNull();
    expect(readLastScreen('plain', AT + LAST_SCREEN_MAX_AGE_MS, store)).toBeNull();
    expect(store.getItem(LAST_SCREEN_KEY)).toBeNull();
  });
  it('another app version: dropped', async () => {
    const { store } = await kept();
    const saved = JSON.parse(store.getItem(LAST_SCREEN_KEY)!);
    store.setItem(LAST_SCREEN_KEY, JSON.stringify({ ...saved, build: 'an-older-build' }));
    expect(readLastScreen('plain', AT + 1000, store)).toBeNull();
    expect(store.getItem(LAST_SCREEN_KEY)).toBeNull();
  });
  it('a game that ends after it was saved is left out; ended or canceled games were never saved', async () => {
    const { v, store } = await kept();
    const first = [...v.sessions].filter((s) => !s.canceled && !s.past).sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0];
    const after = Date.parse(first.endsAt) + 1000;
    const read = readLastScreen('plain', after, store)!;
    expect(read.view.sessions.some((s) => s.id === first.id)).toBe(false);
    expect(read.view.sessions.every((s) => Date.parse(s.endsAt) > after && !s.canceled)).toBe(true);
    expect(v.sessions.some((s) => s.canceled)).toBe(true); // the seed has a canceled game, and it is not in the copy
  });
  it('unreadable or a broken store: nothing shown, nothing thrown', () => {
    const store = new MemStore();
    store.setItem(LAST_SCREEN_KEY, '{not json');
    expect(readLastScreen('plain', AT, store)).toBeNull();
    expect(store.getItem(LAST_SCREEN_KEY)).toBeNull();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(readLastScreen('plain', AT, broken)).toBeNull();
    expect(() => saveLastScreen('plain', { lastScreen: true, me: { id: 'x', name: 'X' } } as GroupView, AT, broken)).not.toThrow();
  });
  it('the as-of tag: Eastern, 12-hour; the day too when it was saved on an earlier day', () => {
    const tz = 'America/Detroit';
    expect(asOfText(Date.parse('2026-11-07T19:14:00.000Z'), tz, Date.parse('2026-11-07T21:00:00.000Z'))).toBe('as of 2:14 PM');
    expect(asOfText(Date.parse('2026-11-06T19:14:00.000Z'), tz, Date.parse('2026-11-07T13:00:00.000Z'))).toBe('as of Fri 2:14 PM');
  });
  it('sanitize never carries the switches that change money or taps', () => {
    const v = { group: { name: 'G', timezone: 'America/Detroit', venmoUrl: 'https://venmo.com/u/x', organizerName: 'Alex', zelleNumber: '555', priceCents: 1400, maxPlayers: 10, usualMinutes: 120 }, players: [{ id: '1', name: 'A' }], me: { id: '1', name: 'A' }, viewingAs: false, payAlways: true, payNote: true, paySheet: true, instantTaps: true, lateFees: true, shortGames: true, cardCleanup: true, now: new Date(AT).toISOString(), sessions: [], owed: [], payDue: [], credit: { balanceCents: 500, usableCents: 500, pending: null, history: [] }, suggestion: null, version: 'v' } as unknown as GroupView;
    const s = sanitize(v, AT);
    expect(JSON.stringify(s)).not.toMatch(/payAlways|payNote|paySheet|instantTaps|lateFees|shortGames|zelle|venmo\.com|Alex|1400|500/);
    expect(s.cardCleanup).toBe(true);
  });
});

describe('the two flags on the player answer (only while on)', () => {
  it('off: missing, so the answer is exactly as before; the private link or the Settings row turns each on; the kill switch wins', async () => {
    const w = await world();
    const ck = await w.phone('Casey');
    const off = (await w.call('GET', '/api/group', ck)).data;
    expect('directLoad' in off).toBe(false);
    expect('lastScreen' in off).toBe(false);
    expect((await w.call('GET', '/api/group', ck, undefined, { 'X-Direct-Load': 'on' })).data.directLoad).toBe(true);
    expect((await w.call('GET', '/api/group', ck, undefined, { 'X-Last-Screen': 'on' })).data.lastScreen).toBe(true);
    const origin = { Origin: 'https://preview.example' };
    expect((await w.call('PUT', '/api/admin/speed-direct-load-switch', w.admin, { on: true }, origin)).status).toBe(200);
    expect((await w.call('PUT', '/api/admin/speed-last-screen-switch', w.admin, { on: true }, origin)).status).toBe(200);
    const on = (await w.call('GET', '/api/group', ck)).data;
    expect(on.directLoad).toBe(true);
    expect(on.lastScreen).toBe(true);
    const dash = (await w.call('GET', '/api/admin/dashboard', w.admin)).data;
    expect([dash.speedDirectLoadForAll, dash.speedLastScreenForAll, 'speedFewerQueriesForAll' in dash]).toEqual([true, true, false]);
    w.env.SPEED_DIRECT_LOAD = 'off';
    w.env.SPEED_LAST_SCREEN = 'off';
    const killed = (await w.call('GET', '/api/group', ck, undefined, { 'X-Direct-Load': 'on', 'X-Last-Screen': 'on' })).data;
    expect(killed.directLoad).toBeUndefined();
    expect(killed.lastScreen).toBeUndefined();
    // History lines say who switched what.
    const acts = (await w.call('GET', '/api/admin/dashboard', w.admin)).data.audit.map((a: any) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['speed_direct_load_on', 'speed_last_screen_on']));
  });
  it('the preview seed has all three speed rows on (the preview rule)', async () => {
    const w = await world({}, true);
    const dash = (await w.call('GET', '/api/admin/dashboard', w.admin)).data;
    expect([dash.speedFewerQueriesForAll, dash.speedDirectLoadForAll, dash.speedLastScreenForAll]).toEqual([true, true, true]);
  });
});

describe('built files keep a year; nothing else changes', () => {
  const headers = readFileSync(join(process.cwd(), 'public/_headers'), 'utf8');
  it('/assets/* is public, a year, immutable; the page and every other path keep today\'s rules', () => {
    const blocks = headers.split(/\n(?=\S)/).map((b) => b.trim());
    const assets = blocks.find((b) => b.startsWith('/assets/*'));
    expect(assets).toContain('Cache-Control: public, max-age=31536000, immutable');
    // Only one Cache-Control rule in the file, and it is the /assets/* one (the page, icons, theme.js and /api are untouched).
    expect(headers.match(/Cache-Control/g)).toHaveLength(1);
    expect(blocks.filter((b) => /^\/(\*|api|index|theme|logo)/.test(b)).every((b) => !/Cache-Control/.test(b))).toBe(true);
  });
  it('a missing built file is a real 404 page (public/assets/404.html), never the home page kept for a year', () => {
    const page = readFileSync(join(process.cwd(), 'public/assets/404.html'), 'utf8');
    expect(page).toMatch(/Not found/);
    expect(page).not.toMatch(/<script/);
  });
  it('every API answer still says no-store', async () => {
    const w = await world();
    const res = await handleApi(new Request('https://preview.example/api/status'), w.env, AT, () => {});
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('the smaller logo', () => {
  it('logo.png is 72 x 72 (3x its 24 px) and under 4 KB', () => {
    const file = join(process.cwd(), 'public/logo.png');
    const buf = readFileSync(file);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([72, 72]);
    expect(statSync(file).size).toBeLessThan(4096);
  });
});
