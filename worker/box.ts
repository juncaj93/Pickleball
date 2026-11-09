// Zip 21 "Error alerts": the error box. A tiny Worker (pickleball-error-box) holding ONE Durable Object, the small record the error
// alerts remember: the Settings switch's copy, the clock's last tick, when each kind was last sent, today's count and the held-back
// count (shared/errorAlerts.ts BoxState). Kept here, not in the site's database, so the alerts cost no database writes and still work
// when the database is over its free daily limit. Free plan: a SQLite-backed Durable Object, a handful of requests per tick.
//
// Only the site's Pages Functions reach it (a binding by name, wrangler.toml [[durable_objects.bindings]]): no public address, no
// route, workers_dev off. It never sends anything and holds no secret. One request does one step of the rule book (boxStep) on the
// record, and Durable Objects run one request at a time, so two errors at once can never both take the last slot.
//
// Deploy: npx wrangler deploy --config worker/box.wrangler.toml. Kill path: the site's ERROR_ALERTS = "off", or remove the site's
// ERROR_BOX binding (no error alerts at all). Deleting this Worker loses only the record (it starts fresh, switched off).

import { type BoxOp, boxStep, type BoxState, emptyBox, type ErrorKind, ERROR_KINDS } from '../shared/errorAlerts';

interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

const KEY = 'state';

/** Read the request's op strictly: anything unexpected is refused (400), never stored. */
export function parseOp(body: unknown): { op: BoxOp; nowMs: number } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const nowMs = Number(b.nowMs);
  // The time comes from the site (only it can reach the box); a missing or silly time is refused.
  if (!Number.isFinite(nowMs) || nowMs < Date.UTC(2026, 0, 1)) return null;
  if (b.op === 'sync' && typeof b.on === 'boolean') return { op: { op: 'sync', on: b.on }, nowMs };
  if (b.op === 'tick') return { op: b.seen === true ? { op: 'tick', seen: true } : { op: 'tick' }, nowMs };
  if (b.op === 'ask' && typeof b.kind === 'string' && (ERROR_KINDS as readonly string[]).includes(b.kind)) return { op: { op: 'ask', kind: b.kind as ErrorKind }, nowMs };
  return null;
}

export async function handleBox(storage: Storage, req: Request): Promise<Response> {
  if (req.method !== 'POST' || new URL(req.url).pathname !== '/step') return new Response('Not found', { status: 404 });
  const parsed = parseOp(await req.json().catch(() => null));
  if (!parsed) return Response.json({ error: 'bad step' }, { status: 400 });
  const before = (await storage.get<BoxState>(KEY)) ?? emptyBox();
  const { state, out } = boxStep(before, parsed.op, parsed.nowMs);
  await storage.put(KEY, state);
  return Response.json(out);
}

/** The Durable Object. */
export class ErrorBox {
  constructor(private state: { storage: Storage }) {}
  fetch(req: Request): Promise<Response> {
    return handleBox(this.state.storage, req);
  }
}

export default {
  // No public address (workers_dev off, no route): anything that reaches the Worker itself is "Not found".
  fetch(): Response {
    return new Response('Not found', { status: 404 });
  },
};
