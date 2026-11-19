// Zip 68 (🎾68.speed), used by e2e/zip68-same.cjs (by hand): saves fake worlds (local sqlite, never Cloudflare) as sqlite files (VACUUM INTO),
// so main's code and this branch's code each answer from the very same rows. The calm preview world at EVERY Tournament test stage; the
// full world (months of finalized games, money, a cash out pending) at the stages Alex named (tickets open, all locked in, game day, game
// night, the Final, ended); and the rare paths of the one shared trip: "Fewer database trips" off, extra switches on (Venue charge alert,
// Acting for others, Second Chance, Players redo, Spent matches Totals) with hidden games (one with money), the weekly upkeep adding a game
// on the first read (a write in the middle of the dashboard), and the organizer found by the name in Settings.
//   npx vite-node scripts/zip68-states.ts -- <out dir> [calm|full|all]
import { mkdirSync, rmSync } from 'node:fs';
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { TEST_STAGES } from '../server/tournamentTest';
import { buildSmallPreview } from './preview-world-small';

const [dir, which = 'all'] = process.argv.slice(2).filter((a) => a !== '--');
mkdirSync(dir, { recursive: true });
const at = Date.parse('2026-11-18T18:30:00.000Z');

async function world(calm: boolean) {
  const { sql } = await buildSmallPreview(at, { calm, zip55: true, zip60: true });
  const raw = createNodeD1(':memory:');
  raw.raw.exec(sql);
  const env: any = { DB: raw, PREVIEW_CALM: 'on' };
  const call = async (method: string, path: string, cookie = '', body?: unknown) => {
    const h = new Headers({ Origin: 'https://preview.example' });
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
    return { res, text: await res.text() };
  };
  const admin = (await call('POST', '/api/admin/login', '', { pin: '739514' })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  const groupId = (raw.raw.prepare('SELECT id FROM groups LIMIT 1').get() as any).id as string;
  const stage = async (s: string) => {
    if (s === 'none') return;
    const r = await call('POST', '/api/admin/tournament-test', admin, { stage: s });
    if (r.res.status !== 200) throw new Error(`${s}: ${r.text}`);
  };
  const save = (name: string) => {
    const file = `${dir}/${name}.sqlite`;
    rmSync(file, { force: true });
    raw.raw.exec(`VACUUM INTO '${file}'`);
    console.log('saved', name);
  };
  const mark = (task: string, sessionId: string | null = null) =>
    raw.raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, ?, ?, 'mark', ?)").run(`z68-${task}-${sessionId ?? 'all'}`, groupId, sessionId, task, new Date(at - 3_600_000).toISOString());
  const unmark = (task: string) => raw.raw.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").run(groupId, task);
  return { raw, stage, save, mark, unmark, groupId };
}

if (which === 'calm' || which === 'all') {
  const w = await world(true);
  for (const s of TEST_STAGES) {
    await w.stage(s);
    w.save(`calm_${s}`);
  }
  for (const s of ['tickets_open', 'mid']) {
    await w.stage(s);
    w.unmark('speed_fewer_queries_on');
    w.save(`calm_off_${s}`);
    w.mark('speed_fewer_queries_on');
  }
}
if (which === 'full' || which === 'all') {
  const w = await world(false);
  for (const s of ['none', 'tickets_open', 'all_locked', 'day_ready', 'mid', 'final_done', 'ended']) {
    await w.stage(s);
    w.save(`full_${s}`);
  }
  await w.stage('tickets_open');
  w.unmark('speed_fewer_queries_on');
  w.save('full_off_tickets_open');
  w.mark('speed_fewer_queries_on');
  // Extra switches on, and three games hidden from the organizer's lists: two empty future games and one game with money (stays listed).
  for (const t of ['venue_alert_on', 'acting_others_on', 'second_chance_on', 'players_redo_on', 'spent_totals_on', 'extended_time_on']) {
    w.unmark(t);
    w.mark(t);
  }
  const empty = w.raw.raw.prepare("SELECT s.id FROM sessions s WHERE s.starts_at > ? AND NOT EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = s.id) ORDER BY s.starts_at LIMIT 2").all(new Date(at).toISOString()) as { id: string }[];
  const paid = w.raw.raw.prepare("SELECT session_id AS id FROM session_players WHERE payment_status = 'paid' LIMIT 1").get() as { id: string };
  for (const g of [...empty, paid]) w.mark('admin_hidden_game', g.id);
  w.save('full_extras_tickets_open');
  await w.stage('mid');
  w.save('full_extras_mid');
  w.unmark('speed_fewer_queries_on');
  w.save('full_extras_off_mid');
  w.mark('speed_fewer_queries_on');
  // The weekly upkeep adds a game on the first read: the last regular game ahead is taken out (it has nobody in it).
  const last = w.raw.raw.prepare("SELECT s.id FROM sessions s WHERE s.planned_starts_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = s.id) ORDER BY s.starts_at DESC LIMIT 1").get() as { id: string };
  w.raw.raw.prepare('DELETE FROM task_log WHERE session_id = ?').run(last.id);
  w.raw.raw.prepare('DELETE FROM sessions WHERE id = ?').run(last.id);
  w.save('full_upkeep_mid');
  // The organizer found by the name in Settings (no saved player).
  w.raw.raw.prepare('UPDATE groups SET organizer_player_id = NULL').run();
  w.save('full_byname_mid');
}
