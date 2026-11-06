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
const CAST = ['Avery', 'Blake', 'Casey', 'Drew', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jordan', 'Kai', 'Lane', 'Morgan'];

export interface Seed {
  sql: string;
  summary: string[];
}

export async function buildSeed(startMs = Date.now()): Promise<Seed> {
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

  // Pick the games by position around "now".
  await refresh();
  const ended = games().filter((g) => ms(g.endsAt) <= N);
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
  //     is the short game's. The normal 2 hour games all around it stay at $14.
  await w.org.ok('PUT', '/api/admin/short-games-switch', { on: true });
  let shortGame: any = null;
  for (const daysOut of [3, 4, 5]) {
    const q = localParts(N + daysOut * 24 * HOUR, 'America/Detroit');
    const start = zonedTimeToUtc(q.year, q.month, q.day, 19, 30, 'America/Detroit');
    try {
      const made = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 90 * 60_000).toISOString(), note: '1.5 hour game' });
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
  summary.push('extra game "1.5 hour game" (7:30 to 9:00 PM, Booked, 4 in): Indy paid $11 cash; Jordan, Kai and Finley owe $11 (Short games on)');

  // Hand the world to the caller as SQL.
  const backupRes = await w.org.call('GET', '/api/admin/backup');
  const backup = JSON.parse(backupRes.text);
  // Phones that picked a name in the in-memory copy mean nothing on the preview; everyone picks fresh.
  backup.tables.player_devices = [];
  await w.settle();

  const sql = wipeExtras() + (backupToSql(backup) as string) + extraRows(w) + switchRows(N);
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
  // Being built (Zip 9): Short games and Card time and buttons.
  'short_games_on',
  'card_time_buttons_on',
] as const;

function switchRows(nowMs: number): string {
  const at = new Date(nowMs).toISOString();
  return PREVIEW_SWITCHES_ON.map((task) => `INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'preview-${task}', id, NULL, '${task}', 'mark', '${at}' FROM groups;`).join('\n') + '\n';
}

/** Alert switches for the one fake group (everything on, like a fresh group). No Telegram token exists in previews, so nothing is sent. */
function extraRows(w: World): string {
  const row = w.db.raw.prepare('SELECT * FROM organizer_alerts').get() as Record<string, unknown> | undefined;
  if (!row) return '';
  const cols = Object.keys(row);
  const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return `INSERT INTO organizer_alerts (${cols.join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});\n`;
}

