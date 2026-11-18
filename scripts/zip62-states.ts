// Zip 62 (🎾62.speed), used by e2e/zip62-same.cjs (by hand): builds the preview's calm fake world (local sqlite, never Cloudflare), puts the
// tournament in each Tournament test stage (the preview's own test route) plus the rare states (Only me, switched off, a piece 1 date pick,
// the night over with a hold in line), and saves each state as its own sqlite file (VACUUM INTO), so main's code and this branch's code can
// each answer from the very same rows.
//   npx vite-node scripts/zip62-states.ts -- <out dir>
import { mkdirSync, rmSync } from 'node:fs';
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { buildSmallPreview } from './preview-world-small';

const dir = process.argv.slice(2).filter((a) => a !== '--')[0];
mkdirSync(dir, { recursive: true });
const at = Date.parse('2026-11-18T18:30:00.000Z');
const { sql } = await buildSmallPreview(at, { calm: true, zip55: true, zip60: true });
const raw = createNodeD1(':memory:');
raw.raw.exec(sql);
const env: any = { DB: raw, PREVIEW_CALM: 'on' };
async function call(method: string, path: string, cookie = '', body?: unknown) {
  const h = new Headers();
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  h.set('Origin', 'https://preview.example');
  const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
  return { res, text: await res.text() };
}
const admin = (await call('POST', '/api/admin/login', '', { pin: '739514' })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
const groupId = (raw.raw.prepare('SELECT id FROM groups LIMIT 1').get() as any).id as string;
const setSwitch = (on: boolean) => {
  raw.raw.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = 'tournaments_on' AND kind = 'mark'").run(groupId);
  if (on) raw.raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES ('m-tour', ?, NULL, 'tournaments_on', 'mark', ?)").run(groupId, new Date(at).toISOString());
};
const save = (name: string) => {
  const file = `${dir}/${name}.sqlite`;
  rmSync(file, { force: true });
  raw.raw.exec(`VACUUM INTO '${file}'`);
  console.log('saved', name);
};
const stage = async (s: string, format?: string) => {
  const r = await call('POST', '/api/admin/tournament-test', admin, { stage: s, ...(format ? { format } : {}) });
  if (r.res.status !== 200) throw new Error(`${s}: ${r.text}`);
  // The test route turns the switch row on; a state that wants it off turns it off after.
};
const STAGES = ['none', 'signup', 'date_picked', 'tickets_open', 'all_locked', 'odd', 'canceled', 'rescheduled', 'closed', 'hidden', 'vote_open', 'vote_majority', 'vote_tie', 'vote_finalize'];
for (const s of STAGES) {
  await stage(s);
  save(`on_${s}`);
}
await stage('tickets_open', 'americano');
save('on_tickets_open_americano');
for (const s of ['vote_open', 'tickets_open', 'canceled']) {
  await stage(s);
  setSwitch(false);
  save(`off_${s}`);
}
// Only me (players may not see it), at two stages.
for (const s of ['vote_open', 'tickets_open']) {
  await stage(s);
  raw.raw.prepare("UPDATE tournaments SET visibility = 'me'").run();
  save(`onlyme_${s}`);
}
// A piece 1 date pick (before Zip 56: the date picked, tickets never opened): the first screen that reads it opens tickets (a write).
await stage('tickets_open');
raw.raw.exec("DELETE FROM tournament_tickets; UPDATE tournaments SET status = 'date_picked', pay_by = NULL; DELETE FROM credit_ledger WHERE reason LIKE 'tour:%' OR reason = 'adjusted:Ticket stage credit';");
save('piece1_date_picked');
// The night is over with a paid hold still in line: the first screen that reads it gives the hold back (a write). Read at 11:00 PM that night.
await stage('tickets_open');
const t = raw.raw.prepare('SELECT final_date FROM tournaments LIMIT 1').get() as any;
raw.raw.exec("UPDATE tournament_tickets SET place = 'line' WHERE id = (SELECT id FROM tournament_tickets WHERE place = 'spot' AND paid_cents > 0 ORDER BY rowid DESC LIMIT 1)");
save(`after_night__${t.final_date}`);
// Last (they change the group): the organizer found by the name in Settings (no saved player), and a saved organizer player that is gone.
await stage('vote_open');
raw.raw.prepare("UPDATE tournaments SET visibility = 'me'").run();
raw.raw.prepare('UPDATE groups SET organizer_player_id = NULL').run();
save('byname_onlyme_vote_open');
for (const s of ['tickets_open', 'closed', 'canceled']) {
  await stage(s);
  save(`byname_${s}`);
}
await stage('tickets_open');
raw.raw.prepare("UPDATE groups SET organizer_player_id = 'gone-player'").run();
save('gone_saved_tickets_open');
