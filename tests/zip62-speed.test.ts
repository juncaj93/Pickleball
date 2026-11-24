// Zip 62 (🎾62.speed): the admin and player screens are as fast with the TOURNAMENTS switch on as with it off.
//
// On the preview's calm fake world (the 10 fixed names, "Fewer database trips" on as on live), at every Tournament test stage:
//   1. every screen (the dashboard and its 5-second check, a player's Home and its check, a phone with no name) makes exactly the database
//      trips it makes with the switch off on the same rows (before Zip 62 the switch on added 2 to 10 trips in a row to each);
//   2. the answers built from the stamp's single trip are byte for byte the answers built the old way, one read after another (the reads are
//      forced the old way by a database that refuses the combined trip);
//   3. a player who may not see the tournament (Only me) gets byte for byte the answers of a world with no tournament at all;
//   4. the Hidden check finds its one mark through an index (it read the whole task list before, on every read).
import { describe, expect, it, vi } from 'vitest';
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import type { D1Database } from '../server/db';
import { buildSmallPreview } from '../scripts/preview-world-small';
import { previewPin } from '../scripts/seed-preview-world';
import { adminTourReads, hiddenTournamentsRead, playerTourReads } from '../server/tournament';
import type { GroupRow } from '../server/repo';

vi.setConfig({ testTimeout: 180_000 });

const AT = Date.parse('2026-11-18T18:30:00.000Z'); // Wed Nov 18, 2026, 1:30 PM Eastern
const READONLY_PIN = '86420975';
let seedSql: Promise<string> | null = null;
const seed = () => (seedSql ??= buildSmallPreview(AT, { calm: true, zip55: true, zip60: true }).then((s) => s.sql));

/** The SQL of every statement the server sends in one trip, read back through bind (for the database that refuses the combined trip). */
const SQL = Symbol('sql');
type Tagged = { [SQL]?: string };
function tagging(inner: D1Database, refuse: () => boolean): D1Database {
  const wrap = (s: any, sql: string): any => {
    const out = { bind: (...v: unknown[]) => wrap(s.bind(...v), sql), first: () => s.first(), all: () => s.all(), run: () => s.run(), __inner: s, [SQL]: sql };
    return out;
  };
  return {
    prepare: (sql: string) => wrap(inner.prepare(sql), sql),
    batch: (stmts: any[]) => {
      // The stamp's combined trip carries the tournament's sign-ups through a subquery that picks the tournament: refused here.
      const combined = stmts.some((s: Tagged) => /FROM tournament_signups s JOIN players p[\s\S]*WHERE s\.tournament_id = \(SELECT/.test(s[SQL] ?? ''));
      if (combined && refuse()) return Promise.reject(new Error('refused on purpose (the old way)'));
      return inner.batch(stmts.map((s: any) => s.__inner ?? s));
    },
  } as D1Database;
}

async function world(opts: { fewer?: boolean } = {}) {
  const raw = createNodeD1(':memory:');
  raw.raw.exec(await seed());
  if (opts.fewer === false) raw.raw.exec("DELETE FROM task_log WHERE session_id IS NULL AND kind = 'mark' AND task = 'speed_fewer_queries_on'");
  const c: Counted = { trips: 0, statements: 0, sql: [] };
  let oldWay = false;
  const env: any = { DB: countingDb(tagging(raw, () => oldWay), c), PREVIEW_CALM: 'on', ORGANIZER_READONLY_PIN: READONLY_PIN };
  const call = async (method: string, path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) => {
    const h = new Headers(headers);
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    h.set('Origin', 'https://preview.example');
    c.trips = 0;
    c.seq = [];
    const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, AT, () => {});
    const text = await res.text();
    return { status: res.status, text, trips: c.trips, seq: [...(c.seq ?? [])], cookie: res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ') };
  };
  const admin = (await call('POST', '/api/admin/login', '', { pin: previewPin() })).cookie;
  const dash = JSON.parse((await call('GET', '/api/admin/dashboard', admin)).text);
  const players: { id: string; name: string }[] = dash.players;
  const phones: Record<string, string> = {};
  for (const p of players) phones[p.name] = (await call('POST', '/api/me', '', { playerId: p.id })).cookie;
  const group = raw.raw.prepare('SELECT * FROM groups LIMIT 1').get() as unknown as GroupRow;
  const setSwitch = (on: boolean) => {
    raw.raw.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = 'tournaments_on' AND kind = 'mark'").run(group.id);
    if (on) raw.raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES ('zip62-tour', ?, NULL, 'tournaments_on', 'mark', ?)").run(group.id, new Date(AT).toISOString());
  };
  const stage = async (s: string) => {
    const r = await call('POST', '/api/admin/tournament-test', admin, { stage: s });
    expect(r.status, r.text).toBe(200);
  };
  /** Every screen this zip is about, with its trips. A first pass lets any upkeep a read does happen once, as on a real phone. */
  const screens = async () => {
    const list: [string, string, string, Record<string, string>?][] = [
      ['dashboard', '/api/admin/dashboard', admin],
      ['admin check', '/api/admin/version', admin],
      ['no name Home', '/api/group', ''],
      ['no name check', '/api/group/version', ''],
      ...players.flatMap((p): [string, string, string][] => [
        [`${p.name} Home`, '/api/group', phones[p.name]],
        [`${p.name} check`, '/api/group/version', phones[p.name]],
      ]),
      // The organizer's own phone (signed in, with the organizer's name picked): the Only me path.
      ['Alex Home, organizer phone', '/api/group', `${admin}; ${phones.Alex}`],
      ['Alex check, organizer phone', '/api/group/version', `${admin}; ${phones.Alex}`],
      // View as with the real PIN (it decides Only me on its own, so it builds its card the old way, as before).
      ['Vic view as', '/api/group', admin, { 'X-View-As': players.find((p) => p.name === 'Vic')!.id }],
      ['Alex view as', '/api/group', admin, { 'X-View-As': players.find((p) => p.name === 'Alex')!.id }],
    ];
    for (const [, path, ck, h] of list) await call('GET', path, ck, undefined, h);
    const out: Record<string, { status: number; text: string; trips: number; seq: string[] }> = {};
    for (const [name, path, ck, h] of list) out[name] = await call('GET', path, ck, undefined, h);
    return out;
  };
  const oldWayToo = async <T>(f: () => Promise<T>): Promise<T> => {
    oldWay = true;
    try {
      return await f();
    } finally {
      oldWay = false;
    }
  };
  return { raw, call, admin, phones, players, group, setSwitch, stage, screens, oldWayToo };
}

type World = Awaited<ReturnType<typeof world>>;
const tripsOf = (s: Awaited<ReturnType<World['screens']>>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.trips]));

// Every Tournament test stage (after Pay by the freed-spot count and a canceled card's money ride in the same trip too).
const SAME_TRIPS = ['none', 'signup', 'speed_check', 'vote_open', 'vote_majority', 'vote_tie', 'date_picked', 'tickets_open', 'all_locked', 'rescheduled', 'canceled', 'odd', 'closed', 'hidden'];
/** Never more trips with the switch on than off on the same rows (once tickets are sold the dashboard even saves one: the tournament names
 * a ticket credit line shows now ride in the shared trip while the switch is on; switched off that read is exactly main's). `extra`: screens
 * allowed one more (named in each test). The 5-second checks are always exactly equal. */
function noMore(on: Record<string, number>, off: Record<string, number>, extra: (k: string) => boolean | number = () => false) {
  expect(Object.keys(on).sort()).toEqual(Object.keys(off).sort());
  for (const k of Object.keys(on)) {
    // View as is answered by the organizer's own in-browser copy (src/lib.ts, demo): its reads never cross the network, and it builds its
    // card the old way on purpose (it decides Only me by its own rule). Its answers are in the byte for byte comparison below.
    if (k.endsWith('view as')) continue;
    if (k.endsWith('check') || k.endsWith('check, organizer phone')) expect(on[k], k).toBe(off[k]);
    else expect(on[k], k).toBeLessThanOrEqual(off[k] + Number(extra(k)));
  }
}

describe('the switch on costs no database trip (Fewer database trips on, as live)', () => {
  for (const s of SAME_TRIPS) {
    it(`stage ${s}: no screen makes more trips than with the switch off on the same rows`, async () => {
      const w = await world();
      await w.stage(s);
      w.setSwitch(true);
      const on = tripsOf(await w.screens());
      w.setSwitch(false);
      const off = tripsOf(await w.screens());
      noMore(on, off);
      // And the numbers themselves are small: each 5-second check is one trip after the sign-in (or name) and switch reads. Zip 68: the
      // organizer's sign-in check and the switch rows share one trip, so its check is 2.
      expect(on['admin check']).toBe(2);
      expect(on['Parker check']).toBe(4);
      expect(on['Vic check']).toBe(4);
    });
  }

  for (const s of ['tickets_open', 'closed']) {
    it(`a group whose organizer is found by the name in Settings (no saved player), stage ${s}: no screen costs more either`, async () => {
      const w = await world();
      await w.stage(s);
      w.raw.raw.prepare('UPDATE groups SET organizer_player_id = NULL').run();
      w.setSwitch(true);
      const on = tripsOf(await w.screens());
      w.setSwitch(false);
      noMore(on, tripsOf(await w.screens()));
    });
  }

  for (const s of ['vote_open', 'tickets_open']) {
    it(`Only me (${s}): no screen makes more trips; only the organizer's own signed-in phone still checks its sign-in (Zip 55's rule)`, async () => {
      const w = await world();
      await w.stage(s);
      w.raw.raw.prepare("UPDATE tournaments SET visibility = 'me'").run();
      w.setSwitch(true);
      const on = tripsOf(await w.screens());
      w.setSwitch(false);
      const off = tripsOf(await w.screens());
      // The organizer's own phone: its 5-second check too (the sign-in check is the one read Only me costs that phone, since Zip 55).
      for (const k of ['Alex Home, organizer phone', 'Alex check, organizer phone']) {
        expect(on[k] - off[k], k).toBeLessThanOrEqual(1);
        delete on[k];
        delete off[k];
      }
      noMore(on, off);
    });
  }

  it('also without "Fewer database trips" (its row off, not live): the checks are equal and no screen costs more than one extra read', async () => {
    const w = await world({ fewer: false });
    await w.stage('tickets_open');
    w.setSwitch(true);
    const on = tripsOf(await w.screens());
    w.setSwitch(false);
    // Only the two small reads that exist only while the switch is on, which "Fewer database trips" sends in the shared trip: the dashboard's
    // Hidden tournaments list, and the tournament names on a ticket buyer's credit lines. Zip 83: plus, on the dashboard, the cup's one tiny
    // read (is there a champion players see?), which rides the shared trip when "Fewer database trips" is on (as on live: no trip of its own).
    noMore(on, tripsOf(await w.screens()), (k) => (k === 'dashboard' ? 2 : 1));
  });
});

describe('the answers are the answers of the old way, byte for byte', () => {
  // (The proof against main's own code, every saved stage, is the by-hand e2e/zip62-same.cjs.)
  const STAGES = [...SAME_TRIPS, 'vote_finalize'];
  for (const s of STAGES) {
    it(`stage ${s}: one trip or one read after another, every screen says exactly the same (stamps included)`, async () => {
      const w = await world();
      await w.stage(s);
      w.setSwitch(true);
      const fast = await w.screens();
      const old = await w.oldWayToo(() => w.screens());
      for (const k of Object.keys(fast)) expect(fast[k].text, k).toBe(old[k].text);
      // The two ways really differ: one read after another reads the tournament's row on its own (a first()), the single trip never does.
      const ownRead = (seq: string[]) => seq.some((x) => /^first SELECT (t\.\*, CASE WHEN t\.visibility|\*, \(status = 'canceled')/.test(x));
      const shared = Object.keys(fast).filter((k) => !k.endsWith('view as'));
      expect(shared.filter((k) => ownRead(fast[k].seq))).toEqual([]);
      expect(shared.some((k) => ownRead(old[k].seq))).toBe(true);
    });
  }

  it('Only me: the same, the organizer\'s own phone included', async () => {
    const w = await world();
    await w.stage('tickets_open');
    w.raw.raw.prepare("UPDATE tournaments SET visibility = 'me'").run();
    const fast = await w.screens();
    const old = await w.oldWayToo(() => w.screens());
    for (const k of Object.keys(fast)) expect(fast[k].text, k).toBe(old[k].text);
    expect(JSON.parse(fast['Alex Home, organizer phone'].text).tournament).toMatchObject({ onlyMe: true });
  });
});

describe('the two look-only databases keep the old way ("Pretend it\'s..." answers every batch with nothing)', () => {
  it('Pretend it\'s now, and the read-only PIN: the dashboard has the very tournament view the organizer gets', async () => {
    const w = await world();
    await w.stage('speed_check');
    const real = JSON.parse((await w.call('GET', '/api/admin/dashboard', w.admin)).text).tournament;
    expect(real).toMatchObject({ name: 'The Cold Open', visibility: 'all' });
    const pretend = JSON.parse((await w.call('GET', '/api/admin/dashboard', w.admin, undefined, { 'X-Pretend-Now': new Date(AT).toISOString() })).text);
    expect(pretend.tournament).toEqual(real);
    const ro = (await w.call('POST', '/api/admin/login', '', { pin: READONLY_PIN })).cookie;
    const view = JSON.parse((await w.call('GET', '/api/admin/dashboard', ro)).text);
    expect(view.viewOnly).toBe(true);
    expect(view.tournament).toEqual(real);
    // A player's card under Pretend (View as) and with the read-only PIN (View as): the card the player gets.
    const vic = JSON.parse((await w.call('GET', '/api/group', w.phones.Vic)).text).tournament;
    expect(vic).toMatchObject({ name: 'The Cold Open' });
    const vicId = w.players.find((p) => p.name === 'Vic')!.id;
    expect(JSON.parse((await w.call('GET', '/api/group', w.admin, undefined, { 'X-Pretend-Now': new Date(AT).toISOString(), 'X-View-As': vicId })).text).tournament).toEqual(vic);
    expect(JSON.parse((await w.call('GET', '/api/group', ro, undefined, { 'X-View-As': vicId })).text).tournament).toEqual(vic);
  });
});

describe('a player who may not see the tournament gets nothing from the server at all', () => {
  it('Only me: every other player and a phone with no name get byte for byte the answers of a world with no tournament', async () => {
    const w = await world();
    await w.stage('vote_open');
    const t = w.raw.raw.prepare('SELECT id, name FROM tournaments LIMIT 1').get() as { id: string; name: string };
    w.raw.raw.prepare("UPDATE tournaments SET visibility = 'me'").run();
    const hidden = await w.screens();
    w.raw.raw.prepare('DELETE FROM tournaments').run();
    const none = await w.screens();
    // Every player's own phone (the organizer's screens, the organizer's own phone and View as are the organizer's).
    const players = Object.keys(hidden).filter((k) => !k.startsWith('dashboard') && !k.startsWith('admin') && !k.includes('organizer phone') && !k.endsWith('view as'));
    expect(players.length).toBeGreaterThan(10);
    for (const k of players) {
      expect(hidden[k].text, k).toBe(none[k].text);
      expect(hidden[k].text, k).not.toContain(t.name);
      expect(hidden[k].text, k).not.toContain(t.id);
      expect(hidden[k].trips, k).toBe(none[k].trips);
    }
  });

  it('switched off for everyone: no tournament key, word or id in any player answer, at any stage', async () => {
    const w = await world();
    for (const s of ['vote_open', 'tickets_open', 'canceled']) {
      await w.stage(s);
      w.setSwitch(false);
      const t = w.raw.raw.prepare('SELECT id, name FROM tournaments LIMIT 1').get() as { id: string; name: string };
      const out = await w.screens();
      for (const [k, v] of Object.entries(out)) {
        if (k.startsWith('dashboard') || k.startsWith('admin')) continue;
        // (A ticket's credit line still says "a tournament" with no name, as since Zip 56: that is the reason word, not tournament data.)
        expect(JSON.parse(v.text).tournament, `${s} ${k}`).toBeUndefined();
        expect(v.text, `${s} ${k}`).not.toContain(t.name);
        expect(v.text, `${s} ${k}`).not.toContain(t.id);
      }
    }
  });
});

describe('the Hidden check finds its mark through an index', () => {
  it('the three reads that skip hidden tournaments look the mark up (SEARCH), never read the whole task list (SCAN)', async () => {
    const w = await world();
    await w.stage('canceled');
    const plan = (sql: string, values: unknown[]) =>
      (w.raw.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(values as never[])) as { detail: string }[]).map((r) => r.detail);
    const reads = [playerTourReads({ nowMs: AT, cookies: {} } as never, w.group, 'someone').reads[0], adminTourReads(w.group, AT).reads[0], hiddenTournamentsRead(w.group)];
    for (const r of reads) {
      const p = plan(r.sql, r.values);
      expect(p.some((d) => /SEARCH h USING (COVERING )?INDEX task_log_once/.test(d)), p.join(' | ')).toBe(true);
      expect(p.some((d) => /^SCAN h\b/.test(d)), p.join(' | ')).toBe(false);
    }
  });

  it('Hide and Restore still work through the new lookup (the canceled card goes and comes back)', async () => {
    const w = await world();
    await w.stage('canceled');
    const t = w.raw.raw.prepare('SELECT id FROM tournaments LIMIT 1').get() as { id: string };
    const dash = async () => JSON.parse((await w.call('GET', '/api/admin/dashboard', w.admin)).text);
    expect((await dash()).tournament).toMatchObject({ id: t.id, status: 'canceled' });
    expect((await w.call('POST', `/api/admin/tournament/${t.id}/hide`, w.admin, { hidden: true })).status).toBe(200);
    const hidden = await dash();
    expect(hidden.tournament).toBeUndefined();
    expect(hidden.hiddenTournaments.map((h: { id: string }) => h.id)).toEqual([t.id]);
    expect(JSON.parse((await w.call('GET', '/api/group', w.phones.Parker)).text).tournament).toBeUndefined();
    expect((await w.call('POST', `/api/admin/tournament/${t.id}/hide`, w.admin, { hidden: false })).status).toBe(200);
    const back = await dash();
    expect(back.tournament).toMatchObject({ id: t.id });
    expect(back.hiddenTournaments).toEqual([]);
    expect(JSON.parse((await w.call('GET', '/api/group', w.phones.Parker)).text).tournament).toMatchObject({ status: 'canceled' });
  });
});
