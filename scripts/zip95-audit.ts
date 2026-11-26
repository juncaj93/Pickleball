// Zip 95 (🎾95.level check): the audit before shipping. Three ended nights on the preview's fake world (local sqlite, never Cloudflare), and
// for each player: their level, the regular record the card counts, the record with the playoff and tie games too (never counted), the medal,
// and whether the Level check card lists them and why. Then the card as the dashboard sends it.
//   8 LD          the 'ended' stage: 4 teams, ended by the real End (endPlan, writeEnd)
//   10 LD         zip95_check: 5 teams, the round robin and an extra round, written row by row
//   9 Americano   zip77_revealed with Reese inactive (9 locked in), revealed by the real End
//   npx vite-node scripts/zip95-audit.ts
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { buildSmallPreview } from './preview-world-small';
import { previewPin } from './seed-preview-world';
import { levelCheckLine, MIN_GAMES, qualifies, TOP_LEVEL } from '../shared/levelCheck';
import { levelLabel } from '../shared/tournament';

const at = Date.parse(process.env.AT ?? '2026-11-18T18:30:00.000Z');
const { sql } = await buildSmallPreview(at, { calm: true, zip55: true, zip60: true });
const raw = createNodeD1(':memory:');
raw.raw.exec(sql);
const env: any = { DB: raw, PREVIEW_CALM: 'on' };
async function call(method: string, path: string, cookie = '', body?: unknown) {
  const h = new Headers({ Origin: 'https://preview.example' });
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return { res, data: JSON.parse(text) };
}
const admin = (await call('POST', '/api/admin/login', '', { pin: previewPin() })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
const db = raw.raw;
const organizer = (db.prepare("SELECT p.id FROM players p JOIN groups g ON g.id = p.group_id WHERE p.display_name = g.organizer_name OR p.id = g.organizer_player_id LIMIT 1").get() as { id: string } | undefined)?.id;

const nights = [
  { label: '8 LD (stage "ended", the real End)', stage: 'ended', before: () => undefined },
  { label: '10 LD (stage "zip95_check")', stage: 'zip95_check', before: () => undefined },
  { label: '9 Americano (stage "zip77_revealed", Reese inactive, the real End)', stage: 'zip77_revealed', before: () => db.prepare("UPDATE players SET is_active = 0 WHERE display_name = 'Reese'").run() },
];
for (const n of nights) {
  db.prepare("UPDATE players SET is_active = 1 WHERE display_name = 'Reese'").run();
  n.before();
  await call('POST', '/api/admin/tournament-test', admin, { stage: n.stage });
  const t = db.prepare("SELECT id, name, format FROM tournaments WHERE status = 'ended' ORDER BY ended_at DESC LIMIT 1").get() as { id: string; name: string; format: string };
  const games = db.prepare('SELECT stage, slot_a, slot_b, seat_a, seat_b, winner, skipped FROM tournament_games WHERE tournament_id = ?').all(t.id) as any[];
  const teams = db.prepare('SELECT seat, name, player_a, player_b FROM tournament_teams WHERE tournament_id = ?').all(t.id) as any[];
  const results = db
    .prepare('SELECT r.player_id, p.display_name AS name, COALESCE(r.approved_level, r.picked_level) AS level, r.medal FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE r.tournament_id = ? ORDER BY r.rowid')
    .all(t.id) as any[];
  const side = (g: any, s: 'a' | 'b', pid: string) => {
    const slot: string = s === 'a' ? g.slot_a : g.slot_b;
    if (slot.split('+').includes(pid)) return true;
    const seat = (s === 'a' ? g.seat_a : g.seat_b) ?? (/^T\d+$/.test(slot) ? Number(slot.slice(1)) : null);
    const team = teams.find((x) => x.seat === seat);
    return !!team && (team.player_a === pid || team.player_b === pid);
  };
  const rec = (pid: string, stages: string[]) => {
    const mine = games.filter((g) => !g.skipped && g.winner && stages.includes(g.stage) && (side(g, 'a', pid) || side(g, 'b', pid)));
    return { played: mine.length, won: mine.filter((g) => side(g, g.winner, pid)).length };
  };
  console.log(`\n== ${n.label}: ${t.name}, ${results.length} players, ${games.filter((g) => g.stage === 'pool').length} regular games, ${games.filter((g) => g.stage !== 'pool').length} playoff/tie games`);
  for (const r of results) {
    const reg = rec(r.player_id, ['pool']);
    const every = rec(r.player_id, ['pool', 'semi', 'final', 'third', 'tie']);
    const f = { ...reg, champion: r.medal === 1, level: r.level };
    const why =
      r.player_id === organizer
        ? 'no: the organizer'
        : r.level >= TOP_LEVEL
          ? 'no: already 3.6+'
          : qualifies(f)
            ? `YES: ${f.champion ? 'champion' : `${Math.round((100 * reg.won) / reg.played)}% of regular games`}`
            : reg.played < MIN_GAMES && !f.champion
              ? `no: fewer than ${MIN_GAMES} regular games`
              : `no: ${reg.played ? Math.round((100 * reg.won) / reg.played) : 0}% (under 80%), not champion`;
    console.log(
      `  ${r.name.padEnd(24)} ${levelLabel(r.level).padEnd(5)} regular ${reg.won}-${reg.played - reg.won}  with playoffs ${every.won}-${every.played - every.won}  ${r.medal ? 'gold ' : '     '} ${why}`,
    );
  }
  const card = (await call('GET', '/api/admin/dashboard', admin)).data.levelCheck;
  console.log(`  CARD: ${card ? card.rows.map((r: any) => `${r.name} "${r.line}"`).join('; ') : '(none)'}`);
  for (const r of card?.rows ?? []) {
    const f = results.find((x) => x.name === r.name);
    if (levelCheckLine({ ...rec(f.player_id, ['pool']), champion: f.medal === 1, level: f.level }) !== r.line) throw new Error(`line mismatch for ${r.name}`);
  }
}
