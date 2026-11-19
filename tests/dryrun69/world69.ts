// Zip 69 dry run (🎾69.dryrun): The Cold Open as it is on live, played out on the real server code (the test harness: its own in-memory
// database, a fake clock). Live settings: Tue Dec 1, 2026, 7:30 to 10:00 PM, 2 courts, $18 tickets, credits $0, Pay by Mon Nov 30 7:00 PM,
// style Auto (players vote). Names: the preview's fixed names. Alex is the organizer and plays (a $0 seat), as on live.
import { existsSync, mkdirSync, readFileSync, readFileSync as readF, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { TestApp, playerPhone, setupGroup, type Client } from '../harness';

export const DATE = '2026-12-01';
export const OTHER_DATES = ['2026-12-03', '2026-12-08'];
export const NAMES = ['Alex', 'Vic', 'Parker', 'Rowan', 'Zoe', 'Wren', 'Quinn', 'Reese', 'Sage', 'Christopher Vanderberg'];
/** Thu Nov 19, 2026, 6:00 PM Eastern: today. */
export const TODAY_MS = Date.parse('2026-11-19T23:00:00.000Z');
/** Tue Nov 24, 8:00 PM: Alex finalizes. */
export const FINALIZE_MS = Date.parse('2026-11-25T01:00:00.000Z');
/** Mon Nov 30, 7:00 PM Eastern. */
export const PAY_BY_MS = Date.parse('2026-12-01T00:00:00.000Z');
/** Tue Dec 1, 7:30 PM Eastern. */
export const START_MS = Date.parse('2026-12-02T00:30:00.000Z');
export const END_MS = Date.parse('2026-12-02T03:00:00.000Z');
export const MIN = 60_000;
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const EXT_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-extension.sql'), 'utf8');
const LEVELS = [350, 360, 340, 320, 300, 300, 275, 250, 320, 340, 360, 250];
export const OUT = join(process.cwd(), '.data', 'dryrun69');
mkdirSync(OUT, { recursive: true });

export type W = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string>; phones: Record<string, Client>; notes: string[] };

export function note(w: W, s: string) {
  w.notes.push(s);
}
export function dump(name: string, data: unknown) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
}

/** The group as on live: Alex organizes and is a player; the other nine fixed names. Tournaments and Adjust credit on. */
export async function liveLike(): Promise<W> {
  const app = new TestApp();
  app.now = TODAY_MS;
  const base = await setupGroup(app);
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  // setupGroup made Alex..Frankie; rename them to the fixed names, then add the rest.
  const extra = NAMES.filter((n) => !base.players.some((p: any) => p.name === n));
  for (const [i, name] of extra.entries()) {
    const r = await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-04${String(i).padStart(2, '0')}` });
    expect(r.status, r.text).toBe(200);
  }
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  // Live's switches (read from live's task_log, SELECT only, Thu Nov 19): every one that is on for everyone on live is on here.
  if (process.env.DRYRUN_SWITCHES !== 'off') {
    const gid = (app.db.raw.prepare('SELECT id FROM groups LIMIT 1').get() as { id: string }).id;
    const ins = app.db.raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) SELECT ?, ?, NULL, ?, 'mark', NULL, ? WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark')");
    for (const [i, task] of 'acting_others_on adjust_credit_on admin_r2_on admin_r3_on admin_undo_on admin_v2_on after_game_card_on alert_cards_on booking_hours_on card_cleanup_on card_time_buttons_on cheaper_fix_on checkin_pay_line_on color_cleanup_on error_alerts_on extended_time_on game_day_card_on game_day_text_on guest_spot_on home_collapse_on home_screen_tip_on instant_taps_on last_call_texts_on late_fee_split_on late_fees_on money_note_on money_rework_on pay_always_on pay_note_on pay_sheet_on player_cards_on player_fix1_on players_redo_on players_sheet_redo_on seat_dots_on second_chance_on short_games_on speed_direct_load_on speed_fewer_queries_on speed_last_screen_admin_on speed_last_screen_on spent_totals_on swap_button_on tap_guard_fix_on texts_r2_on time_shift_on tonight_glow_on totals_refresh_on tournaments_on unpaid_nudge_on venmo_request_on venue_alert_on'.split(' ').entries()) ins.run(`live-switch-${i}`, gid, task, '2026-11-02T00:00:00.000Z', gid, task);
  }
  const created = await base.organizer.call('POST', '/api/admin/tournament', {
    name: 'The Cold Open',
    dates: [DATE, ...OTHER_DATES],
    ticketCents: 1800,
    creditCents: 0,
    secondCreditCents: 0,
    visibility: 'all',
    format: 'vote',
  });
  expect(created.status, created.text).toBe(200);
  return { ...base, byName, tid: created.data.id, phones: {}, notes: [] };
}

export async function phone(w: W, name: string) {
  if (!w.byName[name]) throw new Error(`no player ${name}`);
  w.phones[name] ??= await playerPhone(w as any, name);
  return w.phones[name];
}

/** Every name in `names` signs up (all can make Dec 1 unless listed in `missDate`), with a format vote. */
export async function signUp(w: W, names: string[], opts: { missDate?: string[]; votes?: Record<string, string> } = {}) {
  for (const [i, name] of names.entries()) {
    const dates = opts.missDate?.includes(name) ? OTHER_DATES : [DATE, ...OTHER_DATES.slice(0, i % 2)];
    const r = await (await phone(w, name)).call('POST', '/api/tournament/signup', {
      tournamentId: w.tid,
      level: LEVELS[i % LEVELS.length],
      dates,
      formatVote: opts.votes?.[name] ?? (i % 3 === 0 ? 'americano' : i % 3 === 1 ? 'locked' : 'either'),
    });
    expect(r.status, `${name} sign up: ${r.text}`).toBe(200);
  }
}

/** Alex finalizes Dec 1, 7:30 to 10:00 PM, 2 courts, Pay by Mon 7 PM (the default), style Auto. */
export async function finalize(w: W, extra: Record<string, unknown> = {}) {
  w.app.now = FINALIZE_MS;
  const view = await w.organizer.call('GET', `/api/admin/tournament/${w.tid}/finalize?date=${DATE}`);
  dump('finalize-view', view.data);
  const fin = await w.organizer.call('PUT', `/api/admin/tournament/${w.tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: 150, courts: 2, ...extra });
  expect(fin.status, fin.text).toBe(200);
  return fin.data;
}

export async function giveCredit(w: W, name: string, cents: number) {
  const r = await w.organizer.call('POST', `/api/admin/players/${w.byName[name]}/credit-adjust`, { direction: 'add', cents, reason: 'Dry run credit', seen: potOf(w, name) });
  expect(r.status, r.text).toBe(200);
}

/** Lock my spot (credit first), then I paid for whatever is left (unless `pay` is false). Returns the lock answer. */
export async function lockIn(w: W, name: string, pay = true) {
  const p = await phone(w, name);
  const price = name === 'Alex' ? 0 : 1800;
  const r = await p.call('POST', '/api/tournament/lock', { tournamentId: w.tid, intent: 'lock', priceCents: price });
  expect(r.status, `${name} lock: ${r.text}`).toBe(200);
  if (pay && r.data.dueCents > 0) {
    const paid = await p.call('POST', '/api/tournament/paid', { tournamentId: w.tid, cents: r.data.dueCents });
    expect(paid.status, `${name} I paid: ${paid.text}`).toBe(200);
  }
  return r.data;
}

export async function confirmPaid(w: W, name: string) {
  const r = await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/ticket`, { playerId: w.byName[name], action: 'confirm' });
  expect(r.status, `confirm ${name}: ${r.text}`).toBe(200);
  return r.data;
}

/** A player's credit pot, to the cent, from the ledger (live rows only). */
export function potOf(w: W, name: string): number {
  return Number(
    (
      w.app.db.raw
        .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`)
        .get(w.byName[name]) as { c: number }
    ).c,
  );
}

export function tickets(w: W) {
  return w.app.db.raw
    .prepare(
      `SELECT p.display_name AS name, k.place, k.price_cents AS price, k.credit_cents AS credit, k.paid_cents AS paid, k.claim_cents AS claim, s.status AS signup
       FROM tournament_tickets k JOIN players p ON p.id = k.player_id LEFT JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id
       WHERE k.tournament_id = ? ORDER BY p.display_name`,
    )
    .all(w.tid) as { name: string; place: string; price: number; credit: number; paid: number; claim: number; signup: string }[];
}

export function tourLedger(w: W) {
  return w.app.db.raw
    .prepare(`SELECT p.display_name AS name, l.kind, l.amount_cents AS cents, l.reason, l.ended_at FROM credit_ledger l JOIN players p ON p.id = l.player_id WHERE l.reason LIKE ? OR l.reason LIKE 'Dry run%' OR l.reason LIKE 'adjust%' ORDER BY l.rowid`)
    .all(`tour:${w.tid}%`) as { name: string; kind: string; cents: number; reason: string; ended_at: string | null }[];
}

/** Every money check of the site, extension and tournaments reads zero (the info_ columns are only counts). */
export function books(w: W, label = '') {
  const bad: string[] = [];
  for (const sql of [OLD_SQL, EXT_SQL, TOUR_SQL]) {
    const r = w.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, val] of Object.entries(r)) if (!k.startsWith('info_') && Number(val) !== 0) bad.push(`${k}=${val}`);
  }
  expect(bad, `money checks ${label}`).toEqual([]);
}

export const dash = async (w: W) => (await w.organizer.call('GET', '/api/admin/dashboard')).data;
export const adminTour = async (w: W) => (await dash(w)).tournament;
export const group = async (w: W, name: string) => (await (await phone(w, name)).call('GET', '/api/group')).data;
export const card = async (w: W, name: string) => (await group(w, name)).tournament;
export const teams = (w: W, body: Record<string, unknown>) => w.organizer.call('POST', `/api/admin/tournament/${w.tid}/teams`, body);
export const games = (w: W, body: Record<string, unknown>) => w.organizer.call('POST', `/api/admin/tournament/${w.tid}/games`, body);
export const awards = (w: W, body: Record<string, unknown>) => w.organizer.call('POST', `/api/admin/tournament/${w.tid}/awards`, body);
export const play = async (w: W, name: string, num: number, action: string) => (await phone(w, name)).call('POST', '/api/tournament/game', { tournamentId: w.tid, num, action });

/** A copy of the database right now, for the browser pass (.data/dryrun69/snaps/<name>.sqlite), with the clock moment saved beside it. */
export function snap(w: W, name: string, extra: Record<string, unknown> = {}) {
  const dir = join(OUT, 'snaps');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.sqlite`);
  if (existsSync(file)) rmSync(file);
  w.app.db.raw.exec(`VACUUM INTO '${file}'`);
  const man = join(dir, 'manifest.json');
  const m = existsSync(man) ? JSON.parse(readF(man, 'utf8')) : {};
  m[name] = { nowMs: w.app.now, iso: new Date(w.app.now).toISOString(), ...extra };
  writeFileSync(man, JSON.stringify(m, null, 2));
}
