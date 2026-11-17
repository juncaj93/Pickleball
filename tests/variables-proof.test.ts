/// <reference types="vite/client" />
// Zip 45: proof that removing Cloudflare variables changed no switch.
//
// Cloudflare's free plan allows 64 variables per site. Most of ours were "on" lines for "allowed unless off" kill switches, where a missing
// variable reads exactly like "on". Zip 45 removed those lines. This file keeps the proof for good:
//
//   BEFORE = tests/fixtures/cloudflare-vars-before-zip45.json (every variable Cloudflare had, production and preview, read from its API before
//            the change; secret NAMES only, never a value).
//   AFTER  = wrangler.toml as it is now ([vars] for production, [env.preview.vars] for previews).
//
// Part 1 finds every place the site's code reads one of these variables (server/, shared/, functions/, src/), works out the rule that reads it
// (the site's own allowed-function, the "=== 'on'" checks, SITE_URL's fallback) and runs that rule on BEFORE and on AFTER: every switch must give
// the same on/off answer, for production and for preview, and for the View as copy too. A read the test does not recognize fails the test.
// Part 2 runs the whole site in this process on the fake preview world, once with BEFORE and once with AFTER, as the organizer, a player and the
// 5-minute clock, with every private test header on: every answer must be byte for byte the same. With every removed variable set to "off"
// the answers must change, which shows part 2 really sees the switches.
//
// If this fails after a wrangler.toml edit: you changed what a switch does. If that was the point (for example a kill switch set to "off"), write
// the new intended value into the fixture's "plain" list too, so the before and after agree again.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { handleApi } from '../server/app';
import { switchEnvOf } from '../server/zip18';
import { ZIP13 } from '../shared/zip13';
import { buildSeed, previewPin } from '../scripts/seed-preview-world';
import { tomlSection } from './tomlVars';

type Vars = Record<string, string>;
type EnvName = 'production' | 'preview';
const ENVS: EnvName[] = ['production', 'preview'];

const ROOT = process.cwd();
const BEFORE = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/cloudflare-vars-before-zip45.json'), 'utf8')) as Record<EnvName, { plain: Vars; secretNames: string[] }>;
const TOML = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');

const AFTER: Record<EnvName, Vars> = { production: tomlSection('[vars]', TOML), preview: tomlSection('[env.preview.vars]', TOML) };
const removed = (env: EnvName) => Object.keys(BEFORE[env].plain).filter((k) => !(k in AFTER[env]));

/** Never removed, whatever their value (START_HERE, Zip 45): GO_LINKS, the two motion switches and the preview-only switches. */
const PROTECTED: Record<EnvName, string[]> = {
  production: ['SITE_URL', 'GO_LINKS', 'MOTION', 'MOTION_ADMIN'],
  preview: [
    'GO_LINKS',
    'MOTION',
    'MOTION_ADMIN',
    'GAME_DAY_TEST',
    'SECOND_CHANCE_TEST',
    'PREVIEW_CALM',
    'ACTING_FOR_OTHERS_PREVIEW',
    'EXTENDED_TIME_PREVIEW',
    'HOME_SCREEN_TIP_PREVIEW',
    'CHRISTMAS_SKIN_PREVIEW',
    'GAME_DAY_TEXT_PREVIEW',
  ],
};

// ---------- Part 1: every read of a variable, and the rule that reads it ----------

const shared = import.meta.glob('../shared/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
/** An exported one-argument rule from shared/ (xxxAllowed, timeShiftOn, motionOnForAll ...), by name. */
function sharedRule(name: string): ((v: string | undefined) => unknown) | null {
  for (const mod of Object.values(shared)) if (typeof mod[name] === 'function') return mod[name] as (v: string | undefined) => unknown;
  return null;
}

type Rule = { kind: string; run: (v: string | undefined) => unknown };
interface Read {
  file: string;
  line: number;
  name: string;
  rule: Rule | null;
  text: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

/** The gate an `on(ctx, groupId, flag, ...)` / `onFor(...)` helper checks first, read from the helper's own body in that file. */
function helperGate(source: string, helper: string): Rule | null {
  const m = source.match(new RegExp(`function ${helper}\\(ctx: Ctx, groupId: string, flag: string \\| undefined[^)]*\\)[^{]*\\{\\s*if \\(!(\\w+)\\(flag\\)\\) return false;`));
  const fn = m && sharedRule(m[1]);
  return fn ? { kind: `${m![1]} (through ${helper})`, run: fn } : null;
}

function ruleFor(source: string, pre: string, post: string): Rule | null {
  // xxxAllowed(ctx.env.NAME) and friends.
  const call = pre.match(/(\w+)\(\s*(?:ctx\.)?$/);
  if (call && /^\s*\)/.test(post)) {
    const fn = sharedRule(call[1]);
    if (fn) return { kind: call[1], run: fn };
  }
  // on(ctx, groupId, ctx.env.NAME, ...) in server/zip7.ts, server/zip9.ts; onFor(...) in server/speed.ts.
  const helper = pre.match(/\b(on|onFor)\(ctx, groupId, (?:ctx\.)?$/);
  if (helper) return helperGate(source, helper[1]);
  // (ctx.env.NAME ?? '').trim().toLowerCase() === 'on': the preview-only switches.
  if (/\((?:ctx\.)?$/.test(pre) && /^ \?\? ''\)\.trim\(\)\.toLowerCase\(\) (===|!==) 'on'/.test(post)) {
    return { kind: "(v ?? '').trim().toLowerCase() === 'on'", run: (v) => (v ?? '').trim().toLowerCase() === 'on' };
  }
  // ctx.env.GO_LINKS === 'on' (exact, case-sensitive).
  if (/^\s*(===|!==)\s*'on'/.test(post)) return { kind: "v === 'on'", run: (v) => v === 'on' };
  // (ctx.env.SITE_URL || ctx.url.origin): the value itself, or the fallback when missing or empty.
  if (/^\s*\|\|/.test(post)) return { kind: 'v || fallback', run: (v) => v || '<fallback>' };
  return null;
}

function findReads(): Read[] {
  const reads: Read[] = [];
  for (const file of ['server', 'shared', 'functions', 'src'].flatMap(sourceFiles)) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    source.split('\n').forEach((text, i) => {
      const t = text.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const m of text.matchAll(/\benv\??\.([A-Z][A-Z0-9_]*)\b/g)) {
        const pre = text.slice(0, m.index);
        const post = text.slice(m.index! + m[0].length);
        reads.push({ file, line: i + 1, name: m[1], rule: ruleFor(source, pre, post), text: t });
      }
      // Zip 45 review: a read the scan above cannot see. Destructuring (`const { X } = ctx.env`, `({ X }: Env)`) is refused outright; an
      // alias (`const env = ctx.env`) is fine only when it is named env, so its reads are still `env.X` and seen above.
      if (/\}\s*(?::\s*Env\b|=\s*(?:ctx\.)?env\b)/.test(text)) reads.push({ file, line: i + 1, name: '<destructured>', rule: null, text: t });
      const alias = /\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:ctx\.)?env\s*;/.exec(text);
      if (alias && alias[1] !== 'env') reads.push({ file, line: i + 1, name: '<alias>', rule: null, text: t });
      // The one read by a computed name: server/zip13.ts, zip13Allowed(ctx.env[z.env]) for PLAYERS_REDO, SWAP_BUTTON and ADMIN_UNDO.
      if (/\benv\[/.test(text)) {
        const known = file === 'server/zip13.ts' && text.includes('zip13Allowed(ctx.env[z.env])');
        const fn = sharedRule('zip13Allowed');
        if (known && fn) for (const z of Object.values(ZIP13)) reads.push({ file, line: i + 1, name: z.env, rule: { kind: 'zip13Allowed', run: fn }, text: t });
        else reads.push({ file, line: i + 1, name: '<computed>', rule: null, text: t });
      }
    });
  }
  return reads;
}

const READS = findReads();
const PLAIN_NAMES = new Set(ENVS.flatMap((e) => [...Object.keys(BEFORE[e].plain), ...Object.keys(AFTER[e])]));
const SECRET_NAMES = new Set(ENVS.flatMap((e) => BEFORE[e].secretNames));

describe('Zip 45: Cloudflare variables (the reduced set)', () => {
  it('fits the free plan with room to spare: production 25 or fewer, preview 30 or fewer (secrets included)', () => {
    const count = (e: EnvName) => Object.keys(AFTER[e]).length + BEFORE[e].secretNames.length;
    expect({ production: Object.keys(BEFORE.production.plain).length + BEFORE.production.secretNames.length, preview: Object.keys(BEFORE.preview.plain).length + BEFORE.preview.secretNames.length }).toEqual({ production: 58, preview: 60 });
    expect(count('production')).toBeLessThanOrEqual(25);
    expect(count('preview')).toBeLessThanOrEqual(30);
  });

  it('adds no variable and changes no value: every line left in wrangler.toml was there before with the same value', () => {
    for (const e of ENVS) for (const [k, v] of Object.entries(AFTER[e])) expect([e, k, BEFORE[e].plain[k]]).toEqual([e, k, v]);
  });

  it('keeps every protected variable, every variable set to "off" and every secret name out of wrangler.toml', () => {
    for (const e of ENVS) {
      for (const k of PROTECTED[e]) if (k in BEFORE[e].plain) expect([e, k, AFTER[e][k]]).toEqual([e, k, BEFORE[e].plain[k]]);
      for (const [k, v] of Object.entries(BEFORE[e].plain)) if (v.trim().toLowerCase() !== 'on') expect([e, k, AFTER[e][k]]).toEqual([e, k, v]);
      for (const k of BEFORE[e].secretNames) expect([e, k, k in AFTER[e]]).toEqual([e, k, false]);
    }
  });

  it('refuses a wrangler.toml line it cannot read (a single-quoted or indented "off" would otherwise read as allowed)', () => {
    const toml = (line: string) => `x\n[vars]\nGO_LINKS = "on"\n${line}\n\n[env.preview]\n`;
    expect(tomlSection('[vars]', toml('PAY_SHEET = "off" # pulled'))).toEqual({ GO_LINKS: 'on', PAY_SHEET: 'off' });
    expect(() => tomlSection('[vars]', toml("PAY_SHEET = 'off'"))).toThrow(/cannot read/);
    expect(() => tomlSection('[vars]', toml('  PAY_SHEET = "off"'))).toThrow(/cannot read/);
    expect(() => tomlSection('[vars]', toml('PAY_SHEET="off"'))).toThrow(/cannot read/);
  });

  // Zip 50 (Audit C F-14): a variable the code reads that is in neither saved list used to pass unseen. Now every name the code reads
  // must be in the Zip 45 lists, or below: the switches added since Zip 45 (each checked: missing = its default, "off" kills it) and
  // the bindings that are not on/off settings. A new switch fails here until it is added (and documented in docs/FEATURE_SWITCHES.md).
  const NEWER_SWITCHES: Record<string, { missing: unknown; off: unknown }> = {
    GUEST_SPOT: { missing: true, off: false }, // Zip 42, allowed unless "off"
    VENUE_ALERT: { missing: true, off: false }, // Zip 43, allowed unless "off"
    GUEST_SPOT_PREVIEW: { missing: false, off: false }, // Zip 42, preview only: on only when it says "on"
    TOURNAMENTS: { missing: true, off: false }, // Zip 55, allowed unless "off"
  };
  const NOT_SETTINGS = ['DB', 'ERROR_BOX', 'SANDBOX', 'TELEGRAM_FETCH']; // the database, the error box binding, View as, a test hook
  it('every variable the code reads is known: in the Zip 45 lists, a newer switch (checked), or a binding (F-14)', () => {
    const unknown = [...new Set(READS.map((r) => r.name))].filter((n) => !PLAIN_NAMES.has(n) && !SECRET_NAMES.has(n) && !(n in NEWER_SWITCHES) && !NOT_SETTINGS.includes(n)).sort();
    expect(unknown).toEqual([]);
    const docs = readFileSync(join(ROOT, 'docs/FEATURE_SWITCHES.md'), 'utf8');
    for (const [name, want] of Object.entries(NEWER_SWITCHES)) {
      const reads = READS.filter((r) => r.name === name);
      expect(reads.length, name).toBeGreaterThan(0);
      for (const r of reads) {
        expect(r.rule, `${r.file}:${r.line} ${name}`).not.toBeNull();
        expect([name, Boolean(r.rule!.run(undefined))]).toEqual([name, want.missing]);
        expect([name, Boolean(r.rule!.run('off'))]).toEqual([name, want.off]);
      }
      expect(docs, name).toContain(`\`${name}\``);
      // None is in wrangler.toml (no new Cloudflare variable).
      for (const e of ENVS) expect([e, name, name in AFTER[e]]).toEqual([e, name, false]);
    }
  });

  it('recognizes every place the code reads one of these variables (an unknown way of reading one fails here)', () => {
    const unknown = READS.filter((r) => !r.rule && (PLAIN_NAMES.has(r.name) || r.name.startsWith('<'))).map((r) => `${r.file}:${r.line} ${r.name}: ${r.text}`);
    expect(unknown).toEqual([]);
    // Every variable we hold is read somewhere, so every one of them is checked below.
    const read = new Set(READS.map((r) => r.name));
    expect([...PLAIN_NAMES].filter((n) => !read.has(n))).toEqual([]);
    // Sanity: the scan sees the reads it must (the kill switches, the strict GO_LINKS check, the preview-only switches, SITE_URL).
    expect(READS.length).toBeGreaterThan(80);
    expect(READS.some((r) => r.name === 'GO_LINKS' && r.rule?.kind === "v === 'on'")).toBe(true);
    expect(READS.some((r) => r.name === 'PREVIEW_CALM' && r.rule?.kind.startsWith('(v'))).toBe(true);
    expect(READS.some((r) => r.name === 'SITE_URL' && r.rule?.kind === 'v || fallback')).toBe(true);
    expect(READS.filter((r) => r.rule?.kind.includes('through')).map((r) => r.name).sort()).toEqual(
      ['CARD_TIME_BUTTONS', 'COLOR_CLEANUP', 'PLAYER_CARDS_SIMPLE', 'SHORT_GAMES', 'SPEED_DIRECT_LOAD', 'SPEED_LAST_SCREEN', 'SPEED_LAST_SCREEN_ADMIN', 'TONIGHT_GLOW'].sort(),
    );
  });

  it('every switch gives the same answer before and after, for production and preview, on the site and in the View as copy', () => {
    const answers: string[] = [];
    const differences: string[] = [];
    for (const e of ENVS) {
      const viewAsBefore = switchEnvOf(BEFORE[e].plain);
      const viewAsAfter = switchEnvOf(AFTER[e]);
      for (const r of READS) {
        if (!r.rule || SECRET_NAMES.has(r.name) || !PLAIN_NAMES.has(r.name)) continue;
        const b = r.rule.run(BEFORE[e].plain[r.name]);
        const a = r.rule.run(AFTER[e][r.name]);
        const vb = r.rule.run(viewAsBefore[r.name]);
        const va = r.rule.run(viewAsAfter[r.name]);
        answers.push(`${e} ${r.name} ${r.file}:${r.line} ${String(b)}`);
        if (a !== b || va !== vb) differences.push(`${e} ${r.name} at ${r.file}:${r.line} (${r.rule.kind}): before ${String(b)}, after ${String(a)}; View as ${String(vb)} -> ${String(va)}`);
      }
    }
    expect(differences).toEqual([]);
    // 2 places x every read: a few hundred answers, all the same.
    expect(answers.length).toBeGreaterThan(160);
  });

  it('every removed variable is an "allowed unless off" switch: missing reads as on, and "off" still works as its kill switch', () => {
    for (const e of ENVS) {
      for (const name of removed(e)) {
        expect([e, name, BEFORE[e].plain[name]]).toEqual([e, name, 'on']);
        const rules = READS.filter((r) => r.name === name && r.rule);
        expect([e, name, rules.length > 0]).toEqual([e, name, true]);
        for (const r of rules) {
          expect([name, r.file, r.line, r.rule!.run(undefined), r.rule!.run('off')]).toEqual([name, r.file, r.line, true, false]);
        }
      }
    }
  });

  it('every variable still in wrangler.toml is needed: without it some answer would change (or it is protected)', () => {
    for (const e of ENVS) {
      for (const [name, value] of Object.entries(AFTER[e])) {
        const differs = READS.some((r) => r.name === name && r.rule && r.rule.run(undefined) !== r.rule.run(value));
        expect([e, name, differs || PROTECTED[e].includes(name)]).toEqual([e, name, true]);
      }
    }
  });
});

// ---------- Part 2: the whole site, in this process, before and after ----------

// Sat Nov 14, 2026, 3:00 PM Eastern: a Saturday in the quiet window, with games coming up Tuesday and Thursday.
const NOW = Date.parse('2026-11-14T20:00:00.000Z');
const ORIGIN = 'https://proof.example';
const CRON = 'proof-cron-value-not-a-real-secret';

/** Every private test header of a switch (shared/ and server/), sent as "on", so every kill switch decides something. */
const SWITCH_HEADERS: string[] = (() => {
  const skip = new Set(['X-Christmas-Date', 'X-Christmas-Mode', 'X-Content-Type-Options', 'X-Cron-Secret', 'X-Group-Key', 'X-Phone-Tag', 'X-Pretend-Now', 'X-Robots-Tag', 'X-Venue-Alert-Since', 'X-View-As']);
  const found = new Set<string>();
  for (const file of ['server', 'shared'].flatMap(sourceFiles)) for (const m of readFileSync(join(ROOT, file), 'utf8').matchAll(/'(X-[A-Za-z0-9-]+)'/g)) found.add(m[1]);
  return [...found].filter((h) => !skip.has(h)).sort();
})();

/** Every "on for everyone" Settings row name (task_log, kind 'mark'), so the 5-minute clock (which sends no headers) sees every switch on. */
const SWITCH_ROWS: string[] = (() => {
  const found = new Set<string>();
  for (const file of ['server', 'shared'].flatMap(sourceFiles)) for (const m of readFileSync(join(ROOT, file), 'utf8').matchAll(/'([a-z0-9]+(?:_[a-z0-9]+)*_on)'/g)) found.add(m[1]);
  return [...found].sort();
})();

const blankIds = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');

let seedSql: Promise<string> | undefined;
const seed = () => (seedSql ??= buildSeed(NOW, { preview: true, zip16: true, zip17: true }).then((s) => s.sql));

/** One run of the site with one set of variables: a fixed list of reads and taps, every answer written down. */
async function transcript(vars: Vars, rowsOn: boolean): Promise<string[]> {
  const db = createNodeD1(':memory:');
  db.raw.exec(await seed());
  if (rowsOn) {
    const group = db.raw.prepare('SELECT id FROM groups LIMIT 1').get() as { id: string };
    for (const [i, task] of SWITCH_ROWS.entries()) {
      db.raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT ?, ?, NULL, ?, 'mark', ? WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark')").run(
        `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        group.id,
        task,
        new Date(NOW - 86_400_000).toISOString(),
        group.id,
        task,
      );
    }
  }
  const env: any = { DB: db, CRON_SECRET: CRON, ...vars };
  const out: string[] = [];
  const cookies = { org: '', player: '' };
  const call = async (who: 'org' | 'player' | 'clock', method: string, path: string, body?: unknown, headersOn = true) => {
    const h = new Headers();
    if (headersOn) for (const name of SWITCH_HEADERS) h.set(name, 'on');
    if (body !== undefined) h.set('Content-Type', 'application/json');
    if (who === 'clock') h.set('X-Cron-Secret', CRON);
    if (who !== 'clock' && cookies[who]) h.set('Cookie', cookies[who]);
    if (who === 'player' && groupKey) h.set('X-Group-Key', groupKey);
    h.set('Origin', ORIGIN);
    const res = await handleApi(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, NOW, () => {});
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    if (who !== 'clock' && set.length) cookies[who] = [...cookies[who].split('; ').filter(Boolean), ...set].join('; ');
    const text = await res.text();
    out.push(`${who} ${method} ${path} ${headersOn ? '(headers on)' : '(plain)'} -> ${res.status} ${blankIds(text)}`);
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return data;
  };
  let groupKey = '';
  await call('org', 'POST', '/api/admin/login', { pin: previewPin() });
  const dash = await call('org', 'GET', '/api/admin/dashboard');
  groupKey = String(dash.group.privateLink).split('/g/')[1];
  for (const headersOn of [false, true]) {
    await call('org', 'GET', '/api/admin/dashboard', undefined, headersOn);
    await call('org', 'GET', '/api/admin/activity', undefined, headersOn);
    await call('org', 'GET', '/api/admin/version', undefined, headersOn);
    await call('org', 'GET', '/api/admin/money?month=2026-11', undefined, headersOn);
    await call('org', 'GET', '/api/admin/money?month=2026-10', undefined, headersOn);
    await call('org', 'GET', '/api/status', undefined, headersOn);
  }
  // The View as copy's extras: the switch rows must match; its on/off list is checked in part 1 (it lists the removed names only before).
  const extras = await call('org', 'GET', '/api/admin/demo-extras');
  out.push(`demo-extras taskLog ${blankIds(JSON.stringify(extras?.taskLog ?? null))}`);
  out.splice(out.findIndex((l) => l.startsWith('org GET /api/admin/demo-extras')), 1);

  // A player phone (one with unpaid games, so the nudge, owe card and pay sheet have something to say).
  const players: { id: string; name: string }[] = dash.players;
  const vic = players.find((p) => p.name === 'Vic') ?? players[1];
  await call('player', 'POST', '/api/me', { playerId: vic.id });
  for (const headersOn of [false, true]) {
    await call('player', 'GET', '/api/status', undefined, headersOn);
    await call('player', 'GET', '/api/group', undefined, headersOn);
    await call('player', 'GET', '/api/group/version', undefined, headersOn);
  }
  // Taps that go through the money rules: I'm in on the next open game, then drop out; the organizer's view after.
  const view = await call('player', 'GET', '/api/group');
  const next = (view?.sessions ?? []).find((s: any) => s.status !== 'canceled' && Date.parse(s.startsAt) > NOW && !s.me?.in);
  if (next) {
    await call('player', 'POST', `/api/sessions/${next.id}/join`, {});
    await call('player', 'GET', '/api/group');
    await call('player', 'POST', `/api/sessions/${next.id}/withdraw`, {});
    await call('player', 'GET', '/api/group');
  }
  await call('org', 'GET', '/api/admin/dashboard');
  // The 5-minute clock: it reads only the Settings rows and the variables (no phone, no headers).
  await call('clock', 'POST', '/api/cron/tick', {}, false);
  await call('org', 'GET', '/api/admin/dashboard', undefined, false);
  return out;
}

describe('Zip 45: the whole site answers the same with the reduced variables', () => {
  for (const e of ENVS) {
    for (const rowsOn of [false, true]) {
      it(`${e}${rowsOn ? ', every Settings row on' : ', Settings rows as the preview seed has them'}: every answer is the same before and after`, async () => {
        const before = await transcript(BEFORE[e].plain, rowsOn);
        const after = await transcript(AFTER[e], rowsOn);
        expect(before.length).toBeGreaterThan(25);
        for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
        expect(after.length).toBe(before.length);
      }, 120_000);
    }
  }

  it('the comparison really sees the switches: with every removed variable set to "off" the answers change', async () => {
    for (const e of ENVS) {
      const killed: Vars = { ...AFTER[e], ...Object.fromEntries(removed(e).map((k) => [k, 'off'])) };
      const after = await transcript(AFTER[e], true);
      const off = await transcript(killed, true);
      const changed = after.filter((line, i) => off[i] !== line).length;
      expect([e, changed > 5]).toEqual([e, true]);
    }
  }, 120_000);
});
