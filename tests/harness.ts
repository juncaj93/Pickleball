import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import type { Env } from '../server/db';

export const SETUP_TOKEN = 'test-setup-token-0123456789';
export const PIN = '246810';
export const ORIGIN = 'https://club.example';

// Monday, Oct 26 2026, 12:00 PM Eastern (EDT). DST ends Sunday Nov 1.
export const MONDAY_NOON = Date.parse('2026-10-26T16:00:00.000Z');

/** Text with every random id (UUID) blanked out: an id can hold "4800" or "555" by chance, so privacy checks look only at real text. */
export const withoutIds = (text: string) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');

export const PLAYER_NAMES = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];

/** One phone or browser: keeps its own cookies. */
export class Client {
  cookies = new Map<string, string>();
  groupKey: string | null = null;

  constructor(private app: TestApp) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h = new Headers(headers);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    if (this.groupKey) h.set('X-Group-Key', this.groupKey);
    if (this.cookies.size) h.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await handleApi(
      new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
      this.app.env,
      this.app.now,
      (work) => this.app.background.push(work),
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
    return { status: res.status, data, headers: res.headers, text };
  }
}

export class TestApp {
  db = createNodeD1(':memory:');
  env: Env = { DB: this.db, SETUP_TOKEN };
  now = MONDAY_NOON;
  /** Work a response left running (Telegram alerts). */
  background: Promise<unknown>[] = [];

  /** Wait for everything left running in the background. */
  async settle() {
    while (this.background.length) await Promise.allSettled(this.background.splice(0));
  }

  client() {
    return new Client(this);
  }

  advance(ms: number) {
    this.now += ms;
  }
}

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

/** A set-up group with six players, an organizer client, and a player-link key. */
export async function setupGroup(app = new TestApp()) {
  const organizer = app.client();
  const res = await organizer.call('POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Tuesday Thursday Dinks',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: PLAYER_NAMES.map((name, i) => ({ name, phone: `(313) 555-01${String(i).padStart(2, '0')}` })),
  });
  if (res.status !== 200) throw new Error(`setup failed: ${res.text}`);
  const dash = await organizer.call('GET', '/api/admin/dashboard');
  // The plain address is the player link now; tests use the private link's key.
  const groupKey = String(dash.data.group.privateLink).split('/g/')[1];
  const players: { id: string; name: string }[] = dash.data.players;
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  return { app, organizer, groupKey, players, byName, dashboard: dash.data };
}

/** A player's phone, already on the group link with their name picked. */
export async function playerPhone(ctx: Awaited<ReturnType<typeof setupGroup>>, name: string) {
  const c = ctx.app.client();
  c.groupKey = ctx.groupKey;
  const res = await c.call('POST', '/api/me', { playerId: ctx.byName[name] });
  if (res.status !== 200) throw new Error(`pick name failed: ${res.text}`);
  return c;
}

export async function firstSession(ctx: Awaited<ReturnType<typeof setupGroup>>) {
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  return dash.data.sessions.find((s: any) => Date.parse(s.startsAt) > ctx.app.now);
}
