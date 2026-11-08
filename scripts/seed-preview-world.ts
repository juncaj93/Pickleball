// The fake world for the preview database: made-up players and games in every state.
// Run it with `npm run db:seed:preview` (see seed-preview.ts). This file only BUILDS the SQL.
//
//   npm run db:seed:preview              build the fake world, load it into pickleball-preview
//   npm run db:seed:preview -- --dry-run build it and run the safety checks, touch nothing remote
//   npm run db:seed:preview -- --out x.sql   also keep the SQL it would load
//
// How it works: it plays a fake group on a throwaway in-memory copy of the site (the real site code,
// a fake clock, no network), so every game and every money state comes from the site's own rules
// instead of hand-written rows. Then it loads that into the database named "pickleball-preview".
//
// Safety, in plain words:
//  - It only ever talks to the database named "pickleball-preview" with the id written below, and it
//    refuses to run if that id is the live database's id or the database holds anything that is not
//    marked as fake (the group name must say "PREVIEW, fake data").
//  - It never reads live data and never sends a text or Telegram (the in-memory site has no token).
//  - Everything it writes is fake: made-up names, 313-555-01xx phone numbers, a fake PIN.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createNodeD1 } from '../dev/nodeD1';
import { handleApi } from '../server/app';
import type { Env } from '../server/db';
import { backupToSql } from './backup-sql.mjs';
import { localParts, zonedTimeToUtc } from '../shared/time';
import { holidayFor } from '../shared/holidays';

export const FAKE_GROUP_NAME = 'Pickleball Bros (PREVIEW, fake data)';

/**
 * The fake organizer PIN lives in ONE place: docs/PREVIEW_FAKE_DB.md (the line "Organizer sign-in ... PIN `dddddd`").
 * It is not written in code, tests, chat or any other file. To change it, edit that line and re-seed.
 */
export function previewPin(): string {
  const doc = readFileSync(join(process.cwd(), 'docs/PREVIEW_FAKE_DB.md'), 'utf8');
  const m = /PIN `(\d{6})`/.exec(doc);
  if (!m) throw new Error('Could not find the preview PIN line in docs/PREVIEW_FAKE_DB.md.');
  return m[1];
}
const SETUP_TOKEN = 'preview-seed-setup-token-0123456789';
const ORIGIN = 'https://preview.example';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---- a tiny phone/browser that talks to the in-memory site -----------------------------------------------
class Phone {
  cookies = new Map<string, string>();
  groupKey: string | null = null;
  constructor(private world: World) {}

  async call(method: string, path: string, body?: unknown) {
    const h = new Headers();
    if (body !== undefined) h.set('Content-Type', 'application/json');
    if (this.groupKey) h.set('X-Group-Key', this.groupKey);
    if (this.cookies.size) h.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await handleApi(
      new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
      this.world.env,
      this.world.now,
      (work) => this.world.background.push(work),
    );
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const [name, value] = pair.split('=');
      if (attrs.some((a) => a.trim() === 'Max-Age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, text };
  }

  /** A call that must work: a failure here means the fake world would be wrong, so stop loudly. */
  async ok(method: string, path: string, body?: unknown) {
    const r = await this.call(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${r.text.slice(0, 300)}`);
    return r.data;
  }
}

class World {
  db = createNodeD1(':memory:');
  env: Env = { DB: this.db, SETUP_TOKEN };
  now = Date.now();
  background: Promise<unknown>[] = [];
  phones = new Map<string, Phone>();
  ids: Record<string, string> = {};
  org = new Phone(this);
  groupKey = '';

  async settle() {
    while (this.background.length) await Promise.allSettled(this.background.splice(0));
  }

  phone(name: string): Phone {
    let p = this.phones.get(name);
    if (!p) {
      p = new Phone(this);
      p.groupKey = this.groupKey;
      this.phones.set(name, p);
    }
    return p;
  }

  async pick(name: string) {
    const p = this.phone(name);
    if (!p.cookies.size) await p.ok('POST', '/api/me', { playerId: this.ids[name] });
    return p;
  }
}

// ---- the cast: all made up --------------------------------------------------------------------------------
const ORGANIZER = 'Organizer Orla';
/** A made-up player with no phone number saved. */
export const NO_NUMBER = 'Reese';
/** A long made-up name (it must fit on a Money row next to "Request" and "Mark paid"). */
export const LONG_NAME = 'Christopher Vanderberg';
/** Made-up players with a Venmo username saved. Everyone else (Jordan, Gray, Morgan, Reese, ...) has none. */
export const WITH_VENMO = ['Avery', 'Harper', 'Indy', 'Kai', 'Lane'];
/** Zip 16 (After-game cards): six more made-up players, only in worlds with the Zip 16 parts (the preview database). */
export const ZIP16_CAST = ['Parker', 'Quinn', 'Rowan', 'Sage', 'Tatum', 'Uma'];
const CAST = ['Avery', 'Blake', 'Casey', 'Drew', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jordan', 'Kai', 'Lane', 'Morgan'];

export interface Seed {
  sql: string;
  summary: string[];
}

/**
 * `zip13`: also the Zip 13 parts (the organizer's two games earlier this month, and the Players redo, Swap to Alex and Undo rows on). The
 * preview database always gets them (npm run db:seed:preview); the local browser tests only when they ask (e2e/zip13.cjs), so every older
 * test keeps the world it was written for, which is also what live looks like with the three switches off.
 * `zip14`: also the Zip 14 parts (two extra games tonight, one on Court 3 and one with no court yet, and the Game day card row on).
 * `zip15`: also the Zip 15 parts (Second Chance: the game day below, and the Second Chance row on).
 * `zip16`: also the Zip 16 parts (After-game cards: six more made-up players and three games finalized at the seed, and the row on).
 * `preview`: the preview database (npm run db:seed:preview): the Zip 13, 14 and 15 parts, and the switch rows exactly as live has them
 * (plus the one being built), never the rows that are off on live.
 */
export async function buildSeed(startMs = Date.now(), opts: { zip13?: boolean; zip14?: boolean; zip15?: boolean; zip16?: boolean; preview?: boolean } = {}): Promise<Seed> {
  const w = new World();
  const summary: string[] = [];
  const N = startMs; // "now" for the person tapping; everything below is placed around it

  // Setup happens about 11 months ago, so the Money page's month list has real older months to scroll through; the games of those months
  // are played below. The clock then moves up to 12 days ago, where the rest of the world starts.
  const nowDate = new Date(N);
  const monthStartMs = (back: number) => Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - back, 1, 17);
  w.now = monthStartMs(11);
  const players = [ORGANIZER, ...CAST].map((name, i) => ({ name, phone: `(313) 555-01${String(i).padStart(2, '0')}` }));
  await w.org.ok('POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: FAKE_GROUP_NAME,
    pin: previewPin(),
    venmoUrl: 'https://venmo.com/u/pickleball-preview-fake',
    players,
  });
  await w.org.ok('PUT', '/api/admin/group', { organizerName: ORGANIZER, venueName: 'Fake Courts', venueAddress: '1 Made Up Way' });
  // One made-up player with NO phone number saved, for Text all on the Money page's Remind sheet (it skips a person with no number).
  await w.org.ok('POST', '/api/admin/players', { name: NO_NUMBER });
  // Zip 6 (Venmo request, Adjust credit): a long made-up name, and Venmo usernames for some players (the rest have none saved), so the
  // preview shows both a "Venmo request" link and "no Venmo saved". All fake names.
  await w.org.ok('POST', '/api/admin/players', { name: LONG_NAME, phone: '(313) 555-0199', venmo: `@${LONG_NAME.split(' ')[0].toLowerCase()}-fake` });
  let dash = await w.org.ok('GET', '/api/admin/dashboard');
  for (const name of WITH_VENMO) {
    const p = (dash.players as any[]).find((x) => x.name === name);
    await w.org.ok('PUT', `/api/admin/players/${p.id}`, { name, phone: p.phone, isRegular: p.isRegular, isActive: p.isActive, canReceiveSubstituteInvites: p.canReceiveSubstituteInvites, usualDays: p.usualDays, venmo: `@${name.toLowerCase()}-fake` });
  }
  w.groupKey = String(dash.group.privateLink).split('/g/')[1];
  for (const p of dash.players as { id: string; name: string }[]) w.ids[p.name] = p.id;

  const games = () => (dash.sessions as any[]).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const refresh = async () => {
    dash = await w.org.ok('GET', '/api/admin/dashboard');
  };
  /** Move the fake clock forward to this moment (it never goes back). */
  const at = async (ms: number) => {
    const before = w.now;
    w.now = Math.max(w.now, ms);
    // Sign-ins last hours, not months: when the clock jumps a long way, the organizer signs in again and every phone picks its name again.
    if (w.now - before > 6 * HOUR) {
      await w.org.ok('POST', '/api/admin/login', { pin: previewPin() });
      for (const phone of w.phones.values()) phone.cookies.clear();
    }
    await refresh();
  };
  const ms = (iso: string) => Date.parse(iso);

  // 0. Older months: from 11 months back to 2 months back, 2 to 4 games a month, each with 4 players, booked, all paid $14 and finalized at
  //    the flat price (4 played = $14, so no credit moves). Real site code, a fake clock. Marked shown early so they stay listed after the
  //    first session date is set below.
  const perMonth = [2, 3, 4, 3, 2, 4, 3, 2, 3, 4];
  let oldGames = 0;
  for (let i = 0; i < perMonth.length; i++) {
    const from = monthStartMs(11 - i);
    const to = monthStartMs(10 - i);
    await at(from - 5 * DAY); // the site makes games six weeks ahead, so this month's games exist now
    const inMonth = games().filter((g) => ms(g.startsAt) >= from && ms(g.startsAt) < to);
    const step = Math.max(1, Math.floor(inMonth.length / perMonth[i]));
    const chosen = inMonth.filter((_, j) => j % step === 0).slice(0, perMonth[i]);
    for (const [k, g] of chosen.entries()) {
      const names = [0, 1, 2, 3].map((x) => CAST[(oldGames + k + x * 3) % CAST.length]);
      await at(ms(g.startsAt) - 2 * DAY);
      await w.org.ok('POST', `/api/admin/sessions/${g.id}/court-status`, { status: 'booked' });
      for (const n of names) await (await w.pick(n)).ok('POST', `/api/sessions/${g.id}/join`, {});
      for (const n of names) await w.org.ok('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids[n], paid: true });
      await at(ms(g.endsAt) + 2 * HOUR);
      await w.org.ok('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
      w.db.raw.prepare('UPDATE sessions SET shown_early = 1 WHERE id = ?').run(g.id);
      oldGames++;
    }
  }
  if (oldGames > 0) summary.push(`${oldGames} older games over 10 months (Dec to Sep): 4 players each, all paid $14, finalized, court $48 (they fill the month list on Money)`);
  await at(N - 12 * DAY);

  // Zip 16 (After-game cards), part 1 of 2: six more made-up players and three morning games in the last three days, joined and paid now
  // (the fake clock is 12 days back, so the games are still ahead). They are finalized at the very end (part 2), at the seed time, so
  // the credit is brand new and the card shows for 7 days.
  const zip16 = opts.zip16 || opts.preview;
  const z16: Record<'g1' | 'g2' | 'g3', any> = { g1: null, g2: null, g3: null };
  if (zip16) {
    for (const [i, name] of ZIP16_CAST.entries()) await w.org.ok('POST', '/api/admin/players', { name, phone: `(313) 555-01${50 + i}` });
    await refresh();
    for (const p of dash.players as { id: string; name: string }[]) w.ids[p.name] = p.id;
    const tz = 'America/Detroit';
    const morning = async (daysBack: number, h: number) => {
      const q = localParts(N - daysBack * DAY, tz);
      for (const shift of [0, 30, 60, 90, 120]) {
        const start = zonedTimeToUtc(q.year, q.month, q.day, h, 0, tz) + shift * 60_000;
        const res = await w.org.call('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note: null });
        if (res.status === 409) continue;
        if (res.status >= 300) throw new Error(`POST /api/admin/sessions -> ${res.status} ${res.text.slice(0, 300)}`);
        await refresh();
        return games().find((x) => x.id === res.data.id);
      }
      throw new Error('no free morning for a Zip 16 game');
    };
    z16.g1 = await morning(3, 10);
    z16.g2 = await morning(2, 10);
    z16.g3 = await morning(2, 13);
    const plan: [any, string[], string[]][] = [
      [z16.g1, ['Parker', 'Rowan', 'Sage', 'Tatum', 'Uma'], ['Parker', 'Rowan', 'Sage', 'Tatum', 'Uma']],
      [z16.g2, ['Rowan', 'Sage', 'Tatum', 'Uma'], ['Rowan', 'Sage', 'Tatum', 'Uma']],
      [z16.g3, ['Quinn', 'Sage', 'Tatum', 'Uma'], ['Sage', 'Tatum', 'Uma']],
    ];
    for (const [g, names, paid] of plan) {
      await w.org.ok('POST', `/api/admin/sessions/${g.id}/court-status`, { status: 'booked' });
      await w.org.ok('POST', `/api/admin/sessions/${g.id}/me`, { in: true });
      for (const n of names) await (await w.pick(n)).ok('POST', `/api/sessions/${g.id}/join`, {});
      for (const n of paid) await w.org.ok('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids[n], paid: true });
    }
  }

  // Pick the games by position around "now".
  await refresh();
  // (The Zip 16 games are not "around now" games: left out of this pick, so every older step finds the games it always did.)
  const z16ids = new Set(Object.values(z16).filter(Boolean).map((g) => g.id));
  const ended = games().filter((g) => ms(g.endsAt) <= N && !z16ids.has(g.id));
  const coming = games().filter((g) => ms(g.startsAt) > N);
  if (ended.length < 2 || coming.length < 5) throw new Error(`not enough games around now (${ended.length} past, ${coming.length} coming)`);
  const pastBooked = ended[ended.length - 2];
  const pastNeverBooked = ended[ended.length - 1];
  const [u0, u1, u2, u3, u4] = coming;
  // Like the live site's first-game date: nothing older than the first seeded game is shown (no empty games from before it).
  const firstDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' }).format(new Date(ms(pastBooked.startsAt)));
  await w.org.ok('PUT', '/api/admin/group', { firstSessionDate: firstDay });

  // Extra PAST games for the Money page rework (the preview must show a test game to hide, and previous games that are fully paid).
  // They sit after the first booked game and before the last past game, so they need about 4.5 days between those two (Thu to Tue); a
  // Tue to Thu pair has no room, and then they are simply left out. All at the flat $14 with 4 in, so no credit comes back to anyone.
  const roomForPast = ms(pastNeverBooked.startsAt) - ms(pastBooked.startsAt) >= 4.5 * DAY;
  const pastExtra = async (days: number, note: string) => {
    const start = ms(pastBooked.startsAt) + days * DAY;
    const made = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note });
    await refresh();
    return games().find((g) => g.id === made.id);
  };
  const testGame = roomForPast ? await pastExtra(1, 'Test game') : null;
  const previous1 = roomForPast ? await pastExtra(3, 'Sunday run') : null;
  const previous2 = roomForPast ? await pastExtra(4, 'Monday run') : null;

  const join = async (name: string, g: any) => (await w.pick(name)).ok('POST', `/api/sessions/${g.id}/join`, {});
  const orgPays = (name: string, g: any) => w.org.ok('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids[name], paid: true });
  const setCourt = (g: any, status: 'booked' | 'waitlist' | 'not_booked') => w.org.ok('POST', `/api/admin/sessions/${g.id}/court-status`, { status });

  // 1. A past game that WAS booked, everyone paid $14, 5 played, finalized: $11 each, $3 credit back each.
  await at(ms(pastBooked.startsAt) - 3 * DAY);
  for (const n of ['Avery', 'Blake', 'Casey', 'Drew', 'Emery']) await join(n, pastBooked);
  await setCourt(pastBooked, 'booked');
  for (const n of ['Avery', 'Blake', 'Casey', 'Drew', 'Emery']) await orgPays(n, pastBooked);
  await at(Math.min(ms(pastBooked.endsAt) + 2 * HOUR, N));
  await w.org.ok('POST', `/api/admin/sessions/${pastBooked.id}/finalize`, { everyone: true });
  summary.push('past game, booked, finalized: 5 played, $11 each, $3 credit back to Avery, Blake, Casey, Drew, Emery');

  // 1b. Past extras (only when there is room): a test game to hide (canceled, no money in it), and two fully paid previous games.
  if (testGame && previous1 && previous2) {
    // The test game: canceled early with nobody in and no charge, so no money is in it and it can be hidden.
    await w.org.ok('POST', `/api/admin/sessions/${testGame.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Test game' });
    await setCourt(previous1, 'booked');
    for (const n of ['Indy', 'Jordan', 'Morgan', 'Gray']) await join(n, previous1);
    await setCourt(previous2, 'booked');
    await w.org.ok('POST', `/api/admin/sessions/${previous2.id}/me`, { in: true });
    for (const n of ['Finley', 'Lane', 'Kai']) await join(n, previous2);
    for (const n of ['Indy', 'Jordan', 'Morgan', 'Gray']) await orgPays(n, previous1);
    for (const n of ['Finley', 'Lane', 'Kai']) await orgPays(n, previous2);
    // 1c. Zip 11: a past game that was booked and played and is NOT finalized (5 in, all paid $14): the organizer's Finalize card.
    const toFinalize = await pastExtra(2, '');
    await setCourt(toFinalize, 'booked');
    for (const n of ['Indy', 'Jordan', 'Morgan', 'Gray', 'Finley']) await join(n, toFinalize);
    for (const n of ['Indy', 'Jordan', 'Morgan', 'Gray', 'Finley']) await orgPays(n, toFinalize);
    summary.push('past game, booked, played, NOT finalized (5 in, all paid $14): the organizer sees the Finalize card');
    await at(Math.min(ms(previous1.endsAt) + 2 * HOUR, N));
    await w.org.ok('POST', `/api/admin/sessions/${previous1.id}/finalize`, { everyone: true });
    await at(Math.min(ms(previous2.endsAt) + 2 * HOUR, N));
    await w.org.ok('POST', `/api/admin/sessions/${previous2.id}/finalize`, { everyone: true });
    summary.push('old "Test game" (canceled early, nobody in, no money): the game to hide; "Sunday run" and "Monday run": played, 4 each, all paid $14 (fully paid previous games, court $48 each)');
  }

  // 2. A past game that was never booked, 4 signed up, nobody answered "Did you guys play?" yet.
  await at(ms(pastNeverBooked.startsAt) - 2 * DAY);
  for (const n of ['Gray', 'Harper', 'Kai', 'Jordan']) await join(n, pastNeverBooked);
  await at(Math.min(ms(pastNeverBooked.endsAt) + HOUR, N));
  summary.push('past game, never booked, 4 in (Gray, Harper, Kai, Jordan), not finalized: shows "Did you guys play?"');

  // 2b. Zip 13 (Players redo): the organizer played two 4-player games earlier THIS month (both booked, the 3 others paid $14, finalized at
  //     the flat price, so no credit moves), so the organizer's own "Spent" on the Players page and Money Totals "Your cost so far" have
  //     something to agree on ($30 + 2 x ($48 - 3 x $14) = $42). Only when there is room between the last past game and now, inside this
  //     month; otherwise left out (the summary says so). The players used have no credit at this point, so nobody's pot changes.
  if (opts.zip13) {
    const monthStart = (() => {
      const q = localParts(N, 'America/Detroit');
      return zonedTimeToUtc(q.year, q.month, 1, 0, 0, 'America/Detroit');
    })();
    const step = 15 * 60_000;
    let t = Math.ceil(Math.max(w.now + 2 * HOUR, monthStart + 2 * HOUR) / step) * step;
    let made = 0;
    for (const names of [['Indy', 'Jordan', 'Kai'], ['Lane', 'Morgan', 'Gray']]) {
      let g: any = null;
      while (!g && t + 2 * HOUR + 30 * 60_000 <= N - 30 * 60_000) {
        try {
          const res = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(t).toISOString(), endsAt: new Date(t + 2 * HOUR).toISOString(), note: null });
          await refresh();
          g = games().find((x) => x.id === res.id);
        } catch (err) {
          if (!/game_exists|time_taken/.test(String(err))) throw err;
          t += 30 * 60_000;
        }
      }
      if (!g) break;
      await setCourt(g, 'booked');
      await w.org.ok('POST', `/api/admin/sessions/${g.id}/me`, { in: true });
      for (const n of names) await join(n, g);
      for (const n of names) await orgPays(n, g);
      await at(ms(g.endsAt) + 15 * 60_000);
      await w.org.ok('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
      made++;
      t = Math.ceil((w.now + HOUR) / step) * step;
    }
    summary.push(
      made === 2
        ? 'organizer played 2 four-player games earlier this month (Indy, Jordan, Kai; Lane, Morgan, Gray; all paid $14, finalized): organizer Spent this month = Money "Your cost so far"'
        : `organizer this-month games: only ${made} of 2 fit before now (seeded early in the month); the organizer Spent check needs a later seed`,
    );
  }

  // Back to "now" for everything upcoming (the fake clock moves forward only).
  await at(N);

  // 3. The canceled game (with a reason). Three players paid $14 first, so it comes back to them as credit.
  await setCourt(u4, 'booked');
  for (const n of ['Finley', 'Gray', 'Harper']) {
    await join(n, u4);
    await orgPays(n, u4);
  }
  await w.org.ok('POST', `/api/admin/sessions/${u4.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Court closed' });
  summary.push('canceled game "Court closed": Finley, Gray, Harper paid $14 and got it back as credit');

  // 4. Cash-out pending: Gray asks Alex for the $14 back (before joining anything, so it stays reserved).
  await (await w.pick('Gray')).ok('POST', '/api/me/refund-request', { cents: 1400 });
  summary.push('cash-out pending: Gray asked for $14');

  // 5. u0: court Booked, 5 in, every payment state. Credit is used automatically at "I'm in".
  await setCourt(u0, 'booked');
  await w.org.ok('POST', `/api/admin/sessions/${u0.id}/me`, { in: true });
  for (const n of ['Indy', 'Jordan', 'Avery', 'Finley']) await join(n, u0);
  // Indy pays cash: taps "I paid", the organizer confirms.
  await (await w.pick('Indy')).ok('POST', `/api/sessions/${u0.id}/paid`, { paid: true, cents: 1400 });
  await w.org.ok('POST', `/api/admin/sessions/${u0.id}/claim`, { playerId: w.ids.Indy, paid: true });
  summary.push('game 1 (Booked, 5 in): Organizer in; Indy paid cash; Jordan owes $14; Avery used $3 credit and owes $11; Finley paid with credit');
  // Kai taps "I paid" and then drops out: the organizer gets a Confirm / Didn't pay card on Home.
  await join('Kai', u0);
  await (await w.pick('Kai')).ok('POST', `/api/sessions/${u0.id}/paid`, { paid: true, cents: 1400 });
  await (await w.pick('Kai')).ok('POST', `/api/sessions/${u0.id}/withdraw`, {});
  summary.push('Kai tapped "I paid" for game 1 and then dropped out: an unanswered claim waits on the organizer Home screen');

  // 6. u1: court on the venue's Waitlist (players read "Court not booked"), 3 in, each used $3 credit.
  await setCourt(u1, 'waitlist');
  for (const n of ['Blake', 'Drew', 'Emery']) await join(n, u1);
  summary.push('game 2 (court Waitlist, 3 in): Blake, Drew, Emery used $3 credit each and owe $11');

  // 7. u2: Not booked, 3 of 4 in.
  for (const n of ['Gray', 'Emery', 'Lane']) await join(n, u2);
  summary.push('game 3 (Not booked): "3 of 4 in"');

  // 8. u3: Booked and FULL (10 in) with a real standby (Gray). Mixed payments, one self-reported "I paid".
  await setCourt(u3, 'booked');
  await w.org.ok('POST', `/api/admin/sessions/${u3.id}/me`, { in: true });
  for (const n of ['Avery', 'Blake', 'Drew', 'Emery', 'Finley', 'Indy', 'Jordan', 'Lane', 'Morgan']) await join(n, u3);
  await join('Gray', u3); // the game is full, so Gray is on standby
  for (const n of ['Indy', 'Jordan', 'Finley']) await orgPays(n, u3);
  await (await w.pick('Morgan')).ok('POST', `/api/sessions/${u3.id}/paid`, { paid: true, cents: 1400 });
  summary.push('game 4 (Booked, full, 10 in): Gray is the real standby; Indy, Jordan, Finley paid; Morgan tapped "I paid" (shows as self-reported); the rest owe $14');
  summary.push('left with credit and in no game: Casey $3, Harper $14 (Kai is in no game)');

  // 9. "Late drops owe $14" (LATE_FEES): an extra game 11 hours from now, so it is already past its cancel-by (start minus
  //    12 hours) and a drop there counts as late. Booked, exactly 4 in (Jordan, Lane, Morgan, Kai), Kai paid cash. With
  //    ?latefees=on, any of them dropping leaves 3 and owes $14 unless someone takes the spot. Nothing here owes yet.
  const lateStart = Math.ceil((N + 11 * HOUR) / (15 * 60_000)) * 15 * 60_000;
  const lateGame = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(lateStart).toISOString(), endsAt: new Date(lateStart + 2 * HOUR).toISOString(), note: 'Late-fee test' });
  await refresh();
  const lg = games().find((g) => g.id === lateGame.id);
  await setCourt(lg, 'booked');
  for (const n of ['Jordan', 'Lane', 'Morgan', 'Kai']) await join(n, lg);
  await orgPays('Kai', lg);
  summary.push('extra game "Late-fee test" 11 hours from the seed (already inside its 12-hour cancel-by): 4 in (Jordan, Lane, Morgan, Kai), Kai paid cash');

  // 10. "Late-cancel fee split" (LATE_FEE_SPLIT): an extra game 10 hours from now (inside its 12-hour cancel-by), Booked, 6 in
  //     (Orla the organizer + Avery, Indy, Jordan, Lane, Morgan). Indy, Lane and Morgan paid $14 cash; Avery and Jordan owe.
  //     Cancel it and answer No to the venue question: each owes $9, the three who paid get $5 back as credit.
  const splitStart = Math.ceil((N + 10 * HOUR) / (15 * 60_000)) * 15 * 60_000;
  const splitGame = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(splitStart).toISOString(), endsAt: new Date(splitStart + 2 * HOUR).toISOString(), note: 'Fee split test' });
  await refresh();
  const sg = games().find((g) => g.id === splitGame.id);
  await setCourt(sg, 'booked');
  await w.org.ok('POST', `/api/admin/sessions/${sg.id}/me`, { in: true });
  for (const n of ['Avery', 'Indy', 'Jordan', 'Lane', 'Morgan']) await join(n, sg);
  for (const n of ['Indy', 'Lane', 'Morgan']) await orgPays(n, sg);
  summary.push('extra game "Fee split test" 10 hours from the seed (inside its 12-hour cancel-by): 6 in (Orla, Avery, Indy, Jordan, Lane, Morgan), Indy, Lane, Morgan paid cash');

  // 11. Money page rework: a game with 4 in and mixed payments ("Mixed payments": Lane and Morgan paid, Kai and Gray owe), and a game
  //     where everyone has paid ("All paid": 4 of 4; it stays in the Games list until it is finalized, then moves to Previous games). Nobody here has credit to spend,
  //     so no credit balance changes.
  const upcomingExtra = async (hoursAhead: number, note: string) => {
    const start = Math.ceil((N + hoursAhead * HOUR) / (30 * 60_000)) * 30 * 60_000;
    const made = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note });
    await refresh();
    const g = games().find((x) => x.id === made.id);
    await setCourt(g, 'booked');
    return g;
  };
  const mixed = await upcomingExtra(20, 'Mixed payments');
  for (const n of ['Lane', 'Morgan', 'Kai', 'Gray']) await join(n, mixed);
  for (const n of ['Lane', 'Morgan']) await orgPays(n, mixed);
  const allPaid = await upcomingExtra(44, 'All paid');
  for (const n of ['Indy', 'Jordan', 'Morgan', 'Lane']) await join(n, allPaid);
  for (const n of ['Indy', 'Jordan', 'Morgan', 'Lane']) await orgPays(n, allPaid);
  // 12. Text all on the Remind sheet: 5 in, Indy paid, Kai, Lane and Morgan owe $14 and have numbers, and Reese owes $14 with no number saved.
  const chase = await upcomingExtra(68, 'Owes, one no number');
  for (const n of ['Indy', 'Kai', 'Lane', 'Morgan', NO_NUMBER]) await join(n, chase);
  await orgPays('Indy', chase);
  summary.push('extra game "Owes, one no number" (Booked, 5 in): Indy paid; Kai, Lane and Morgan owe $14 with numbers; Reese owes $14 and has no number saved (Text all skips Reese)');
  summary.push('extra game "Mixed payments" (Booked, 4 in): Lane and Morgan paid cash; Kai (Venmo saved) and Gray (none) owe $14');
  summary.push('extra game "All paid" (Booked, 4 of 4 paid): stays in the Games list until finalized, then moves to Previous games');

  // 13. A late-canceled game with the fee split ($11 each): 5 in, Lane and Morgan paid $14 cash (and get $3 back as credit), Kai (Venmo saved),
  //     Jordan (no Venmo) and the long-named player owe $11, not $14. Nothing else in the world uses these three at that moment.
  await w.org.ok('PUT', '/api/admin/late-fees', { on: true });
  await w.org.ok('PUT', '/api/admin/late-fee-split', { on: true });
  // A game at this exact time may already exist (the regular Tue/Thu slot), so try a few start times inside the 12 hours until one is free.
  let split11: any = null;
  // (Late enough that it never becomes the first game on the organizer's Home: the Money page tests look at the first card.)
  for (const hoursAhead of [11.5, 10.5]) {
    try {
      split11 = await upcomingExtra(hoursAhead, 'Fee split $11');
      break;
    } catch (err) {
      if (!/game_exists/.test(String(err))) throw err;
    }
  }
  if (!split11) throw new Error('no free start time for the "Fee split $11" game');
  for (const n of ['Kai', LONG_NAME, 'Jordan', 'Lane', 'Morgan']) await join(n, split11);
  for (const n of ['Lane', 'Morgan']) await orgPays(n, split11);
  await w.org.ok('POST', `/api/admin/sessions/${split11.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
  summary.push('extra game "Fee split $11" (canceled late, fee not waived, 5 in): Kai, Christopher Vanderberg and Jordan each owe $11; Lane and Morgan paid $14 and got $3 back as credit');
  summary.push('Venmo usernames saved for Avery, Harper, Indy, Kai, Lane, Christopher Vanderberg; none for Jordan, Gray, Morgan, Reese (they show "no Venmo saved")');

  // 14. Zip 7 (Tonight glow, Simpler player cards): the preview must always have a game TONIGHT and a game TOMORROW (Eastern), whatever day it is
  //     seeded. The regular Tue/Thu games often already are one of them; an extra game is added only for the day that has no open game yet.
  //     Tonight's extra is booked with 3 in (Gray is not in it); tomorrow's is not booked with 2 in (the card shows just "2 of 4 in" and I'm in).
  const eastDate = (t: number) => {
    const q = localParts(t, 'America/Detroit');
    return `${q.year}-${q.month}-${q.day}`;
  };
  const hasOpenGameOn = (date: string) => games().some((g) => !g.state.flags.canceled && ms(g.endsAt) > N && eastDate(ms(g.startsAt)) === date);
  const pt = localParts(N, 'America/Detroit');
  // Seeded late in the evening (9 PM Eastern or later) tonight's games are over or about to start, and the next look at the preview is most
  // likely after midnight: then "tonight" means the NEXT calendar day, and "tomorrow" the day after it.
  const dayShift = pt.hour >= 21 ? 1 : 0;
  const tonightStart = zonedTimeToUtc(pt.year, pt.month, pt.day + dayShift, 20, 15, 'America/Detroit');
  const tonightDate = eastDate(tonightStart);
  if (!hasOpenGameOn(tonightDate)) {
    const start = Math.max(tonightStart, Math.ceil((N + 30 * 60_000) / 900_000) * 900_000);
    if (eastDate(start) === tonightDate) {
      const made = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note: 'Tonight test' });
      await refresh();
      const tg = games().find((g) => g.id === made.id);
      await setCourt(tg, 'booked');
      for (const n of ['Avery', 'Blake', 'Emery']) await join(n, tg);
      summary.push('extra game "Tonight test" (no regular game tonight): Booked, 3 in (Avery, Blake, Emery); Gray is not in it');
    }
  }
  const tomorrowStart = zonedTimeToUtc(pt.year, pt.month, pt.day + dayShift + 1, 18, 45, 'America/Detroit');
  if (!hasOpenGameOn(eastDate(tomorrowStart))) {
    const made = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(tomorrowStart).toISOString(), endsAt: new Date(tomorrowStart + 2 * HOUR).toISOString(), note: 'Tomorrow test' });
    await refresh();
    const tm = games().find((g) => g.id === made.id);
    for (const n of ['Casey', 'Drew']) await join(n, tm);
    summary.push('extra game "Tomorrow test" (no regular game tomorrow): not booked, 2 in (Casey, Drew); Gray is not in it');
  }

  // 15. Zip 9 "Short games": one 1.5 hour game (7:30 to 9:00 PM Eastern, about 3 days out), Booked, 4 in: Indy paid $11 cash, Jordan, Kai
  //     and Finley owe $11. Priced through the real site rules with the switch on (the preview has it on from the seed), so every amount on it
  //     is the short game's. The normal 2 hour games all around it stay at $14. No note: the site already says "1.5 hours" (player time line)
  //     and "1.5 HR" / "1.5 hr game · $11 each" (organizer), and every fact shows once (Alex, Nov 6).
  await w.org.ok('PUT', '/api/admin/short-games-switch', { on: true });
  let shortGame: any = null;
  for (const daysOut of [3, 4, 5]) {
    const q = localParts(N + daysOut * 24 * HOUR, 'America/Detroit');
    const start = zonedTimeToUtc(q.year, q.month, q.day, 19, 30, 'America/Detroit');
    try {
      const made = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 90 * 60_000).toISOString(), note: null });
      await refresh();
      shortGame = games().find((x) => x.id === made.id);
      break;
    } catch (err) {
      if (!/game_exists|time_taken/.test(String(err))) throw err;
    }
  }
  if (!shortGame) throw new Error('no free evening for the 1.5 hour game');
  await setCourt(shortGame, 'booked');
  for (const n of ['Indy', 'Jordan', 'Kai', 'Finley']) await join(n, shortGame);
  await orgPays('Indy', shortGame);
  summary.push('extra 1.5 hour game, no note (7:30 to 9:00 PM, Booked, 4 in): Indy paid $11 cash; Jordan, Kai and Finley owe $11 (Short games on)');

  // 16. Zip 10 "Card cleanup": no waitlist and no Max players cap. Switching it on for everyone ends every waitlist: Gray, the real standby
  //     on game 4 (10 in), moves in as a normal 11th player (his credit goes on like at I'm in; no "spot opened" notice). Then three extra
  //     games, no notes, so the preview has 1, 3, 4, 5, 8 and 12 players to look at: "1 in" (Booked, Kai), "8 in" (Booked, Avery to Jordan,
  //     Avery and Blake paid), and "12 in" (Booked, the organizer and 11 more; Jordan and Indy paid): one row of circles, any number.
  const cleanup = await w.org.ok('PUT', '/api/admin/card-cleanup-switch', { on: true });
  summary.push(`Card cleanup on: ${cleanup.movedIn} waitlisted player moved in (Gray, game 4 is now 11 in)`);
  const extraAt = async (hour: number, minute: number, firstDay: number) => {
    for (let daysOut = firstDay; daysOut < firstDay + 12; daysOut++) {
      const q = localParts(N + daysOut * 24 * HOUR, 'America/Detroit');
      const start = zonedTimeToUtc(q.year, q.month, q.day, hour, minute, 'America/Detroit');
      if (start <= N) continue;
      try {
        const made = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note: null });
        await refresh();
        return games().find((x) => x.id === made.id);
      } catch (err) {
        if (!/game_exists|time_taken/.test(String(err))) throw err;
      }
    }
    throw new Error('no free evening for a Card cleanup game');
  };
  const one = await extraAt(18, 0, 2);
  await setCourt(one, 'booked');
  await join('Kai', one);
  const eight = await extraAt(17, 30, 4);
  await setCourt(eight, 'booked');
  // Nobody with credit left over (Casey, Harper, Lane, Morgan keep theirs, as PREVIEW_FAKE_DB.md lists).
  for (const n of ['Avery', 'Blake', 'Drew', 'Emery', 'Finley', 'Gray', 'Indy', 'Jordan']) await join(n, eight);
  for (const n of ['Avery', 'Blake']) await orgPays(n, eight);
  const twelve = await extraAt(17, 0, 9);
  await setCourt(twelve, 'booked');
  await w.org.ok('POST', `/api/admin/sessions/${twelve.id}/me`, { in: true });
  for (const n of ['Avery', 'Blake', 'Drew', 'Emery', 'Finley', 'Gray', 'Indy', 'Jordan', 'Kai', NO_NUMBER, LONG_NAME]) await join(n, twelve);
  for (const n of ['Jordan', 'Indy']) await orgPays(n, twelve);
  summary.push(`Card cleanup games, no notes: "1 in" (Booked, Kai, 6:00 PM), "8 in" (Booked, Avery to Jordan, 5:30 PM; Avery and Blake paid), "12 in" (Booked, Orla and 11 more incl. ${NO_NUMBER} and ${LONG_NAME}, 5:00 PM; Jordan and Indy paid)`);

  // 17. Zip 11 "Alert cards": one of every alert the preview did not have yet, so each card can be seen (all fake, real site rules):
  //     a game moved after people were in (player "... moved to 7:30 PM" with Still in / Can't make it; organizer "Confirmed 0 of 3"),
  //     a hand credit adjustment with a reason (player "Credit adjusted: +$5"), and a late drop that someone took ("You no longer owe $14").
  //     The money ones only move fake money: Casey gets +$5 credit; Blake's $14 late-drop debt is cleared when Christopher Vanderberg takes the spot.
  const moved = await extraAt(19, 0, 5);
  await setCourt(moved, 'booked');
  for (const n of ['Indy', 'Jordan', 'Drew']) await join(n, moved);
  const movedTo = ms(moved.startsAt) + 30 * 60_000;
  await w.org.ok('PUT', `/api/admin/sessions/${moved.id}/time`, { startsAt: new Date(movedTo).toISOString(), endsAt: new Date(movedTo + 2 * HOUR).toISOString() });
  summary.push("moved game (Booked, 7:00 PM moved to 7:30 PM after Indy, Jordan and Drew were in): each sees Still in / Can't make it; the organizer card says Confirmed 0 of 3");
  await w.org.ok('PUT', '/api/admin/adjust-credit-switch', { on: true });
  await refresh();
  const casey = (dash.players as { id: string; name: string }[]).find((p) => p.name === 'Casey')!;
  const caseyPot = (await (await w.pick('Casey')).ok('GET', '/api/group')).credit.balanceCents as number;
  await w.org.ok('POST', `/api/admin/players/${casey.id}/credit-adjust`, { direction: 'add', cents: 500, seen: caseyPot, reason: 'Thanks for bringing balls' });
  summary.push(`credit adjusted: Casey +$5 ("Thanks for bringing balls"), credit now ${(caseyPot + 500) / 100} dollars`);
  // A regular with usual days (Tue and Thu) who has not answered the next one: Casey gets the "Want in" card ("Tuesday has 5 in",
  // I'm in, X), stacked with the Credit adjusted card above it.
  w.db.raw.prepare("UPDATE players SET usual_days = '2,4', is_regular = 1 WHERE id = ?").run(casey.id);
  summary.push('Casey is a regular for Tue and Thu and has not answered the next one: Casey sees the Want in card');
  // A Thursday-only regular (Harper): the next Thursday game, when it has fewer than 4 in, shows "Thursday needs 1 more" with the balls.
  const harper = (dash.players as { id: string; name: string }[]).find((p) => p.name === 'Harper')!;
  w.db.raw.prepare("UPDATE players SET usual_days = '4', is_regular = 1 WHERE id = ?").run(harper.id);
  summary.push('Harper is a regular for Thursday: Harper sees the Want in card for the next Thursday game');
  let takenGame: any = null;
  for (const hoursAhead of [9, 9.5, 8.5, 8]) {
    try {
      takenGame = await upcomingExtra(hoursAhead, '');
      break;
    } catch (err) {
      if (!/game_exists/.test(String(err))) throw err;
    }
  }
  if (takenGame) {
    // (Players the older browser tests do not tap on their first game: e2e/instant-taps.cjs drives Kai and Indy.)
    for (const n of ['Blake', 'Emery', 'Finley', 'Drew']) await join(n, takenGame);
    await (await w.pick('Blake')).ok('POST', `/api/sessions/${takenGame.id}/withdraw`, {});
    await join(LONG_NAME, takenGame);
    summary.push(`late drop taken: Blake dropped inside the 12 hours (owed $14), ${LONG_NAME} took the spot: Blake sees "You no longer owe $14"`);
  }

  // 16. Zip 14 (Game day card): two extra games TONIGHT (Eastern; the next day when seeded at 9 PM or later, like step 14), so the game day card
  //     shows both looks side by side: "Court 3" (4 in: Indy paid cash, Jordan, Kai, Morgan owe) and "Court TBD" (3 in: Indy, Jordan and the
  //     long name, all owe). The court is set through the real organizer path (the switch on for that one call, then back off: the seed's switch rows decide).
  //     Every other game keeps no court. The regular game on another day stays as it is ("a game on another day").
  if (opts.zip14 || opts.preview) {
    const taken = new Set(games().map((g) => ms(g.startsAt)));
    // No slot that ends after midnight (Edit game cannot save a game whose end falls on the next day; a known gap, see STAGE_NOTES Zip 14).
    const slots = [[17, 0], [21, 30], [15, 0], [12, 0], [10, 0]].map(([h, m]) => zonedTimeToUtc(pt.year, pt.month, pt.day + dayShift, h, m, 'America/Detroit'));
    // In the order above (the evening first, so both cards stay "game day" for as much of the day as possible), then by time.
    const free = slots.filter((t) => t > N + 30 * 60_000 && eastDate(t) === tonightDate && !taken.has(t)).slice(0, 2).sort((a, b) => a - b);
    if (free.length >= 2) {
      await w.org.ok('PUT', '/api/admin/game-day-card-switch', { on: true });
      const made: any[] = [];
      for (const [i, start] of free.slice(0, 2).entries()) {
        const res = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note: null, ...(i === 0 ? { court: 3 } : {}) });
        await refresh();
        const g = games().find((x) => x.id === res.id);
        await setCourt(g, 'booked');
        for (const n of i === 0 ? ['Indy', 'Jordan', 'Kai', 'Morgan'] : ['Indy', 'Jordan', LONG_NAME]) await join(n, g);
        if (i === 0) await orgPays('Indy', g);
        made.push(g);
      }
      await w.org.ok('PUT', '/api/admin/game-day-card-switch', { on: false });
      await refresh();
      summary.push(`Zip 14: two extra games tonight: ${new Date(free[0]).toISOString()} on Court 3 (Indy paid, Jordan, Kai, Morgan owe) and ${new Date(free[1]).toISOString()} with no court (Indy, Jordan, ${LONG_NAME} owe)`);
    } else summary.push('Zip 14: no room for two more games tonight (seeded too late in the day); the game day card shows on the tonight game only');
  }

  // 17. Zip 15 (Second Chance): the next Tuesday or Thursday after today (Eastern) with no other game on it (else the first free day), "game day" D. Open the preview once with
  //     /admin?noontest=on and that phone sees these cards as if it were noon on D (preview only; ?noontest=off to stop).
  //     - 7:30 PM, Not booked: Orla (the organizer), Harper (Venmo saved, paid $14 cash) and Gray (no Venmo) in, canceled the night before:
  //       the Second Chance card. The cancel turned Harper's $14 into credit, so after Reopen she can tap Use credit.
  //     - 5:15 PM, Not booked: Orla and Blake in (2), canceled the night before: NO card (exactly 3 only).
  //     - 8:15 PM, Not booked, added that day ("same-day add"): Avery paid, Kai (Venmo) and Reese (no phone, no Venmo) owe. Alex taps
  //       I'm in on it: 4 in, 2 of 4 paid -> Telegram 1 (fake, shown on Home) naming Reese; Mark paid Kai and Reese -> step 4 + Telegram 2.
  //     The cancels go through the real site (money and all); only the two "canceled at" times and the 8:30 game's "made at" are then set
  //     to the night before / that morning, the one hand edit, since the fake clock cannot run into the future.
  if (opts.zip15 || opts.preview) {
    const tz = 'America/Detroit';
    // Round 2 (Alex, Nov 8): Reopen's time list must have every half hour free (a time another game starts at is refused). So game day D
    // is the next Tuesday or Thursday whose only game is the regular one, still empty: that regular game IS the Second Chance game (as
    // in real life). Else the first day with no game at all, with an extra game at 7:30 PM.
    const onDay = (t: number) => games().filter((g) => eastDate(ms(g.startsAt)) === eastDate(t));
    let dKey: { y: number; m: number; d: number } | null = null;
    let regular: any = null;
    for (let i = 1; i <= 42 && !dKey; i++) {
      const t = N + i * DAY;
      const q = localParts(t, tz);
      const wd = new Date(Date.UTC(q.year, q.month - 1, q.day, 12)).getUTCDay();
      const day = onDay(t);
      // (Not a holiday: a holiday game brings its own notices.)
      if ((wd === 2 || wd === 4) && day.length === 1 && !holidayFor(day[0].startsAt, tz) && !day[0].extra && !day[0].state.flags.canceled && day[0].roster.length === 0) {
        dKey = { y: q.year, m: q.month, d: q.day };
        regular = day[0];
      }
    }
    for (let i = 1; i <= 21 && !dKey; i++) {
      const q = localParts(N + i * DAY, tz);
      if (onDay(N + i * DAY).length === 0) dKey = { y: q.year, m: q.month, d: q.day };
    }
    if (!dKey) throw new Error('no free day in three weeks for the Zip 15 game day');
    const D = dKey!;
    const atD = (h: number, m: number, dayOffset = 0) => zonedTimeToUtc(D.y, D.m, D.d + dayOffset, h, m, tz);
    const nightBefore = new Date(atD(21, 0, -1)).toISOString();
    // The wanted time, or the nearest free half hour (an older step may already have a game there).
    const make = async (h: number, m: number) => {
      for (const shift of [0, -30, 30, -60, 60, -90, 90]) {
        const start = atD(h, m) + shift * 60_000;
        const res = await w.org.call('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note: null });
        if (res.status === 409) continue;
        if (res.status >= 300) throw new Error(`POST /api/admin/sessions -> ${res.status} ${res.text.slice(0, 300)}`);
        await refresh();
        return games().find((x) => x.id === res.data.id);
      }
      throw new Error('no free time on game day for a Zip 15 game');
    };
    const chance = regular ?? (await make(19, 30));
    await w.org.ok('POST', `/api/admin/sessions/${chance.id}/me`, { in: true });
    for (const n of ['Harper', 'Gray']) await join(n, chance);
    await orgPays('Harper', chance);
    await w.org.ok('POST', `/api/admin/sessions/${chance.id}/decision`, { decision: 'cancel', confirm: true });
    // Off the half-hour grid, so Reopen's time list has no clash with it.
    const two = await make(17, 15);
    await w.org.ok('POST', `/api/admin/sessions/${two.id}/me`, { in: true });
    await join('Blake', two);
    await w.org.ok('POST', `/api/admin/sessions/${two.id}/decision`, { decision: 'cancel', confirm: true });
    w.db.raw.prepare('UPDATE sessions SET canceled_at = ? WHERE id IN (?, ?)').run(nightBefore, chance.id, two.id);
    const same = await make(20, 15);
    for (const n of ['Avery', 'Kai', NO_NUMBER]) await join(n, same);
    await orgPays('Avery', same);
    w.db.raw.prepare('UPDATE sessions SET created_at = ? WHERE id = ?').run(new Date(atD(10, 0)).toISOString(), same.id);
    await refresh();
    const day = `${D.y}-${String(D.m).padStart(2, '0')}-${String(D.d).padStart(2, '0')}`;
    const t = (g: any) => localParts(ms(g.startsAt), tz);
    const hm = (g: any) => `${t(g).hour % 12 || 12}:${String(t(g).minute).padStart(2, '0')} PM`;
    summary.push(`Zip 15 (game day ${day}): ${hm(chance)} canceled the night before with 3 in (Orla, Harper paid then credit, Gray): the Second Chance card; ${hm(two)} canceled with 2 in (Orla, Blake): no card; ${hm(same)} added that day, not booked: Avery paid, Kai and ${NO_NUMBER} owe`);
  }

  // Zip 16 (After-game cards), part 2 of 2: finalize the three games now (the seed time), through the real organizer taps.
  //  - Game 1 (3 days back, 6 played with Orla): $9 each, $5 back to Parker, Rowan, Sage, Tatum and Uma.
  //  - Game 2 (2 days back, 5 played): $11 each, $3 back to Rowan, Sage, Tatum and Uma. Rowan (and Sage, Tatum, Uma) see ONE card: $8, 2 games.
  //  - Game 3 (2 days back): finalized with 5 played ($11); Quinn had not paid and pays $11; then Reopen and a redo where Uma did not play:
  //    4 played, $14 each. Quinn paid $11 at the lower price, so Quinn owes $3 more ("You owe $3 more"). Sage and Tatum paid $14: nothing
  //    changes. Uma did not play: $14 back as credit (no card: not a final price change).
  if (zip16) {
    await at(N);
    await w.org.ok('POST', `/api/admin/sessions/${z16.g1.id}/finalize`, { everyone: true });
    await w.org.ok('POST', `/api/admin/sessions/${z16.g2.id}/finalize`, { everyone: true });
    await w.org.ok('POST', `/api/admin/sessions/${z16.g3.id}/finalize`, { everyone: true });
    await w.org.ok('POST', `/api/admin/sessions/${z16.g3.id}/payment`, { playerId: w.ids.Quinn, paid: true });
    await w.org.ok('POST', `/api/admin/sessions/${z16.g3.id}/reopen`, {});
    await w.org.ok('POST', `/api/admin/sessions/${z16.g3.id}/finalize`, { played: [w.ids[ORGANIZER], w.ids.Quinn, w.ids.Sage, w.ids.Tatum] });
    await refresh();
    summary.push('Zip 16: Parker has $5 back from one game (6 played, $9); Rowan, Sage, Tatum and Uma have $8 back from two games ($5 + $3); Quinn paid $11, the game was reopened and redone with 4 played ($14): Quinn owes $3 more. Open the preview with ?as=Parker (or Rowan, Quinn).');
  }

  // Hand the world to the caller as SQL.
  const backupRes = await w.org.call('GET', '/api/admin/backup');
  const backup = JSON.parse(backupRes.text);
  // Phones that picked a name in the in-memory copy mean nothing on the preview; everyone picks fresh.
  backup.tables.player_devices = [];
  await w.settle();

  const sql = wipeExtras() + (backupToSql(backup) as string) + extraRows(w) + switchRows(N, opts);
  return { sql, summary };
}

/** Rows the backup format does not carry, cleared first so a re-seed starts clean (and no PIN lockout carries over). */
function wipeExtras(): string {
  return ['organizer_alerts', 'login_attempts', 'rate_events', 'task_log', 'admin_sessions'].map((t) => `DELETE FROM ${t};`).join('\n') + '\n';
}

/**
 * PREVIEW SWITCHES RULE (Nov 4): a preview behaves like live. The Settings > Feature switches rows that are ON for everyone
 * on live are ON here from the seed (no ?something=on needed), plus the switch being built. A backup does not carry task_log,
 * so they are written here. Keep this list equal to live: it is the one place to change. ON on live (Alex, Wed Nov 4):
 * New admin layout, Admin screens round 2 and round 3, Ask for payment on every game, No Venmo? note, Moved-game notice,
 * Late drops owe $14, Player screen fixes, Pay sheet, Texts and alerts round 2, and (since Wed Nov 4, Alex) Late-cancel fee split.
 * Being built: Money page rework. MOTION and
 * MOTION_ADMIN have no Settings row: they are wrangler.toml switches, "on" in [env.preview.vars] like every kill switch.
 */
export const PREVIEW_SWITCHES_ON = [
  'admin_v2_on',
  'admin_r2_on',
  'admin_r3_on',
  'pay_always_on',
  'pay_note_on',
  'time_shift_on',
  'late_fees_on',
  'player_fix1_on',
  'pay_sheet_on',
  'texts_r2_on',
  'late_fee_split_on',
  'money_rework_on',
  'instant_taps_on',
  'adjust_credit_on',
  'venmo_request_on',
  'home_collapse_on',
  'tonight_glow_on',
  'color_cleanup_on',
  'player_cards_on',
  'last_call_texts_on',
  // Zip 9 (live, switched on by Alex Fri Nov 6): Short games and Card time and buttons.
  'short_games_on',
  'card_time_buttons_on',
  // Zip 10: Card cleanup. ON on live (the live row read with the read-only PIN after the Zip 12 deploy, Sat Nov 7, against an earlier note
  // that it was not); the fake world's 11 and 12 player games are built through it too.
  'card_cleanup_on',
  // Zip 11 (live, Settings row off): Alert cards; on here because its redo is being built.
  'alert_cards_on',
  // Zip 12 (live, Settings rows off): the three speed switches, kept on here for its own browser tests and phone tests.
  'speed_fewer_queries_on',
  'speed_direct_load_on',
  'speed_last_screen_on',
  // Being built (Zip 12 step C): Instant admin.
  'speed_last_screen_admin_on',
  // Being built: Seat dots.
  'seat_dots_on',
] as const;

/** Zip 13: Players redo, Swap to Alex, Undo on admin toasts. ON on live (read with the read-only PIN, Sun Nov 8), so ON on the preview
 *  database too; on a local world only when asked (e2e/zip13.cjs). */
export const ZIP13_SWITCHES_ON = ['players_redo_on', 'swap_button_on', 'admin_undo_on'] as const;

/** Being built (Zip 14): Game day card. On the preview database and on a local world that asks for it (e2e/zip14.cjs). */
export const ZIP14_SWITCHES_ON = ['game_day_card_on'] as const;

/** Being built (Zip 15): Second Chance. On the preview database and on a local world that asks for it (e2e/zip15.cjs). */
export const ZIP15_SWITCHES_ON = ['second_chance_on'] as const;

/** Being built (Zip 16): After-game cards. On the preview database and on a local world that asks for it (e2e/zip16.cjs). */
export const ZIP16_SWITCHES_ON = ['after_game_card_on'] as const;

/**
 * Rows that are OFF on live. Empty since the Zip 14 deploy (Sun Nov 8, 1:20 AM Eastern): the live rows read with the read-only PIN showed
 * Alert cards, Seat dots, the four speed rows and the three Zip 13 rows all ON (the repo notes had them off). Add a row here only after
 * reading it off on live; the preview database leaves these out so a preview behaves like live (PREVIEW SWITCHES RULE).
 */
export const OFF_ON_LIVE: readonly string[] = [];

/** The local world e2e/zip13.cjs was written for leaves these six rows off (unchanged since Zip 13; not about live). */
const ZIP13_LOCAL_OFF = ['alert_cards_on', 'seat_dots_on', 'speed_fewer_queries_on', 'speed_direct_load_on', 'speed_last_screen_on', 'speed_last_screen_admin_on'];

function switchRows(nowMs: number, opts: { zip13?: boolean; zip14?: boolean; zip15?: boolean; zip16?: boolean; preview?: boolean }): string {
  const at = new Date(nowMs).toISOString();
  // The preview database (and e2e/zip13.cjs): live's switch list, without the rows that are off on live. e2e/zip13.cjs adds the three
  // Zip 13 rows, and so does the preview database (they are ON on live, read Nov 8). Zip 14's row: the preview and e2e/zip14.cjs.
  const likeLive = !!opts.zip13 || !!opts.preview;
  const off: readonly string[] = opts.preview ? OFF_ON_LIVE : ZIP13_LOCAL_OFF;
  const base = likeLive ? PREVIEW_SWITCHES_ON.filter((t) => !off.includes(t)) : PREVIEW_SWITCHES_ON;
  return [...base, ...(opts.zip13 ? ZIP13_SWITCHES_ON : []), ...(opts.zip14 || opts.preview ? ZIP14_SWITCHES_ON : []), ...(opts.zip15 || opts.preview ? ZIP15_SWITCHES_ON : []), ...(opts.zip16 || opts.preview ? ZIP16_SWITCHES_ON : [])].map((task) => `INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'preview-${task}', id, NULL, '${task}', 'mark', '${at}' FROM groups;`).join('\n') + '\n';
}

/** Alert switches for the one fake group (everything on, like a fresh group). No Telegram token exists in previews, so nothing is sent. */
function extraRows(w: World): string {
  const row = w.db.raw.prepare('SELECT * FROM organizer_alerts').get() as Record<string, unknown> | undefined;
  if (!row) return '';
  const cols = Object.keys(row);
  const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return `INSERT INTO organizer_alerts (${cols.join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});\n`;
}

