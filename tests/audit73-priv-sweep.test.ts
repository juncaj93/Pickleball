// Audit 73 (privacy, proof only): every Tournament test stage (both styles), every player phone on the preview's small fake world, through the
// real server code. Dumps GET /api/group and /api/group/version for each phone (and a phone with no name picked) and checks:
//   - no level anywhere but the player's own pick (me.level, lockedLevel), and never the organizer's rating (approved_level, made distinctive);
//   - no other player's phone or Venmo handle; tournament money keys only for the player's own ticket;
//   - a phone with no name: no Venmo link, no Zelle number, no tournament data;
//   - Only me: another player (also one who picked the organizer's name, with no organizer cookie) gets no card, no name, no fingerprint change.
import { describe, expect, it, vi } from 'vitest';
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { buildSmallPreview } from '../scripts/preview-world-small';
import { previewPin } from '../scripts/seed-preview-world';
import { TEST_STAGES } from '../server/tournamentTest';
import { withoutIds } from './harness';

vi.setConfig({ testTimeout: 900_000 });

const AT = Date.parse('2026-11-18T18:30:00.000Z');
const LEVEL_KEY = /level|approved|rating|skill|strength|^total$|projected/i;
const NOT_LEVEL = new Set(['tournament.day.progress.total']); // games played of games in the night (a count, not a level)
const ALLOWED_LEVEL_PATHS = new Set(['tournament.me.level', 'tournament.lockedLevel']);

function walk(x: unknown, path: string, out: { path: string; key: string; value: unknown }[]) {
  if (!x || typeof x !== 'object') return;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const p = Array.isArray(x) ? `${path}[]` : path ? `${path}.${k}` : k;
    out.push({ path: p, key: k, value: v });
    walk(v, p, out);
  }
}

describe('audit 73 privacy sweep (every tournament test stage, every phone)', () => {
  it('no level, no other player money/phone/venmo, no payment details or tournament for a nameless phone, Only me stays private', async () => {
    const { sql } = await buildSmallPreview(AT, { calm: true, zip55: true, zip60: true });
    const raw = createNodeD1(':memory:');
    raw.raw.exec(sql);
    const env: any = { DB: raw, PREVIEW_CALM: 'on' };
    const call = async (method: string, path: string, cookie = '', body?: unknown) => {
      const h = new Headers({ Origin: 'https://preview.example' });
      if (cookie) h.set('Cookie', cookie);
      if (body !== undefined) h.set('Content-Type', 'application/json');
      const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, AT, () => {});
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* not json */
      }
      return { status: res.status, text, data, cookie: res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ') };
    };
    const admin = (await call('POST', '/api/admin/login', '', { pin: previewPin() })).cookie;
    const violations: string[] = [];
    const moneyPaths = new Set<string>();
    const levelPathsSeen = new Set<string>();
    let checkedPhones = 0;
    let checkedStages = 0;
    let onlyMeChecks = 0;
    for (const format of ['doubles', 'americano'] as const) {
      for (const stage of TEST_STAGES) {
        const r = await call('POST', '/api/admin/tournament-test', admin, { stage, format });
        if (r.status !== 200) {
          if (format === 'doubles') violations.push(`stage ${stage} did not build: ${r.status} ${r.text.slice(0, 120)}`);
          continue;
        }
        checkedStages++;
        // The organizer's rating made distinctive (never a real level value), so any leak of it is findable as text too.
        raw.raw.exec('UPDATE tournament_signups SET approved_level = 701 + (rowid % 14) * 7');
        const players = raw.raw.prepare('SELECT id, display_name, phone_number, venmo_handle, is_active FROM players').all() as any[];
        const approved = raw.raw.prepare('SELECT player_id, approved_level, picked_level FROM tournament_signups').all() as any[];
        const tours = raw.raw.prepare('SELECT id, name, visibility FROM tournaments').all() as any[];
        const tourNames = tours.map((t) => t.name);
        const org = raw.raw.prepare('SELECT organizer_player_id FROM groups').get() as any;
        const orgId = org?.organizer_player_id ?? players.find((p) => p.display_name === 'Alex')?.id;
        const phoneOf = (cookie: string) => ({ cookie });
        const tag = `${format}/${stage}`;
        const check = (who: string, meId: string | null, g: any, text: string) => {
          const body = withoutIds(text);
          const keys: { path: string; key: string; value: unknown }[] = [];
          walk(g, '', keys);
          for (const k of keys) {
            if (LEVEL_KEY.test(k.key)) {
              levelPathsSeen.add(k.path);
              if (!ALLOWED_LEVEL_PATHS.has(k.path) && !NOT_LEVEL.has(k.path)) violations.push(`${tag} ${who}: level-like key ${k.path}=${JSON.stringify(k.value)?.slice(0, 60)}`);
            }
            if (k.path.startsWith('tournament') && /cents|credit|paid|owed|claim/i.test(k.key)) moneyPaths.add(k.path);
            if (/phone/i.test(k.key)) violations.push(`${tag} ${who}: phone key ${k.path}`);
          }
          for (const a of approved) {
            if (a.approved_level === null) continue;
            if (new RegExp(`(^|[^0-9.])${a.approved_level}([^0-9]|$)`).test(body)) violations.push(`${tag} ${who}: approved level marker ${a.approved_level} in text`);
          }
          if (g?.tournament?.me && meId) {
            const mine = approved.find((a) => a.player_id === meId);
            if (mine && g.tournament.me.level !== mine.picked_level) violations.push(`${tag} ${who}: me.level ${g.tournament.me.level} is not their pick ${mine.picked_level}`);
          }
          for (const p of players) {
            if (p.id === meId) continue;
            // The organizer's own number is the group's Zelle number on the Pay sheet (by design, only to a phone with a name).
            if (p.id === orgId && meId) continue;
            if (p.phone_number) {
              const digits = String(p.phone_number).replace(/\D/g, '').slice(-10);
              const m = digits.length >= 7 ? new RegExp(digits.split('').join('\\D{0,2}')).exec(body) : null;
              if (m) violations.push(`${tag} ${who}: phone of ${p.display_name} near ${JSON.stringify(body.slice(Math.max(0, m.index - 40), m.index + 30))}`);
            }
            if (p.venmo_handle && String(p.venmo_handle).length >= 3 && text.includes(String(p.venmo_handle))) violations.push(`${tag} ${who}: venmo handle of ${p.display_name}`);
          }
        };
        // Every phone with a name picked (no organizer cookie).
        for (const p of players.filter((x) => x.is_active === 1)) {
          const pick = await call('POST', '/api/me', '', { playerId: p.id });
          if (pick.status !== 200) {
            violations.push(`${tag}: pick ${p.display_name} ${pick.status}`);
            continue;
          }
          const g = await call('GET', '/api/group', pick.cookie);
          const ver = await call('GET', '/api/group/version', pick.cookie);
          if (g.status !== 200) violations.push(`${tag} ${p.display_name}: group ${g.status}`);
          check(p.display_name, p.id, g.data, g.text);
          if (!/^\{"v":"[A-Za-z0-9_-]{16}"\}$/.test(ver.text)) violations.push(`${tag} ${p.display_name}: version answer is not a bare hash: ${ver.text.slice(0, 80)}`);
          checkedPhones++;
          void phoneOf;
        }
        // A phone with no name picked: no payment details, no tournament.
        const none = await call('GET', '/api/group', '');
        if (none.status === 200) {
          if (none.data.group?.venmoUrl) violations.push(`${tag} no-name: venmoUrl sent`);
          if ('zelleNumber' in (none.data.group ?? {})) violations.push(`${tag} no-name: zelleNumber sent`);
          if (none.data.tournament || none.data.tourAwards) violations.push(`${tag} no-name: tournament data sent`);
          for (const n of tourNames) if (none.text.includes(n)) violations.push(`${tag} no-name: tournament name "${n}" in answer`);
          check('no-name', null, none.data, none.text);
        } else violations.push(`${tag} no-name: group ${none.status}`);
        // Only me: the same rows, visibility Only me.
        if (tours.length) {
          raw.raw.exec("UPDATE tournaments SET visibility = 'me'");
          const others = players.filter((x) => x.is_active === 1 && x.id !== orgId);
          const orgPlayer = players.find((x) => x.id === orgId);
          const phones: { name: string; cookie: string }[] = [];
          for (const p of [...others, ...(orgPlayer ? [orgPlayer] : [])]) phones.push({ name: p.display_name, cookie: (await call('POST', '/api/me', '', { playerId: p.id })).cookie });
          const before = new Map<string, string>();
          for (const ph of phones) {
            const g = await call('GET', '/api/group', ph.cookie);
            if (g.data?.tournament) violations.push(`${tag} only-me: ${ph.name} gets the tournament card`);
            if (g.data?.tourAwards?.ticker || g.data?.tourAwards?.congrats) violations.push(`${tag} only-me: ${ph.name} gets tourAwards ${JSON.stringify(g.data.tourAwards).slice(0, 80)}`);
            for (const n of tourNames) if (g.text.includes(n)) violations.push(`${tag} only-me: ${ph.name} sees the name "${n}"`);
            before.set(ph.name, (await call('GET', '/api/group/version', ph.cookie)).text);
            onlyMeChecks++;
          }
          // A change only the Only me tournament shows: the fingerprint of every other phone stays the same.
          raw.raw.exec("UPDATE tournaments SET name = name || ' 2', updated_at = '2026-11-18T18:29:00.000Z', start_minutes = COALESCE(start_minutes, 0) + 5");
          raw.raw.exec("UPDATE tournament_games SET winner = CASE WHEN winner IS NULL THEN 'a' ELSE NULL END WHERE num = 1");
          for (const ph of phones) {
            const after = (await call('GET', '/api/group/version', ph.cookie)).text;
            if (after !== before.get(ph.name)) violations.push(`${tag} only-me: ${ph.name}'s fingerprint moved with an Only me change`);
          }
          // Sanity: the organizer's own player on the organizer's signed-in phone does see it.
          if (orgPlayer) {
            const both = `${admin}; ${phones.find((x) => x.name === orgPlayer.display_name)!.cookie}`;
            const g = await call('GET', '/api/group', both);
            const vis = tours.some((t) => t.visibility === 'all' || t.visibility === 'me');
            if (vis && stage === 'tickets_open' && !g.data?.tournament) violations.push(`${tag} only-me sanity: the organizer's own phone does not see it`);
          }
        }
      }
    }
    console.log(`stages built: ${checkedStages}; phones checked: ${checkedPhones}; only-me phone checks: ${onlyMeChecks}`);
    console.log('level-like key paths seen:', [...levelPathsSeen].sort().join(', '));
    console.log('tournament money key paths seen:', [...moneyPaths].sort().join(', '));
    console.log(`violations (${violations.length}):\n` + [...new Set(violations)].slice(0, 200).join('\n'));
    expect([...new Set(violations)]).toEqual([]);
  });
});
