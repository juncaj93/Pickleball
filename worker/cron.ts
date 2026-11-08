// The smart-alert clock: a tiny Cloudflare Worker with one cron trigger
// (every 5 minutes). It only knocks on the site's /api/cron/tick with a
// shared secret; the site works out what is due and sends it with its own
// Telegram secrets (server/tasks.ts). It has no public address, sends no
// messages and holds no Telegram token. If a knock fails, the next one, 5
// minutes later, catches up (alerts are sent up to an hour late, never twice).
// Once an hour it also looks whether the weekly backup copy is due (worker/backup.ts, Zip 8). Since Zip 19 that look, and each step of
// a copy, is its own run of this Worker (called through its private SELF binding), so the knock's run stays small and no run's CPU
// grows with the data. The Worker still has no public address: only it can call itself, and every such call carries CRON_SECRET.

import type { D1Database } from '../server/db';
import { checkThisTick, finishCopy, type Finish, maybeWeeklyBackup, planCopy, type PlanResult, type Runners, runStep, type BackupResult, type StepBody, type StepRunner } from './backup';
import { viewOnlyDb } from '../server/viewOnly';

/** The Worker's binding to itself (worker/wrangler.toml [[services]] SELF). */
interface SelfBinding {
  fetch(req: Request): Promise<Response>;
}

interface Env {
  /** Where the site lives, e.g. https://pickleball-club-9h0.pages.dev */
  SITE_URL: string;
  /** The same value as the site's CRON_SECRET. */
  CRON_SECRET: string;
  /** The live database, only READ, for the weekly backup copy (worker/backup.ts). Missing: no copies, the knock goes on as before. */
  DB?: D1Database;
  /** The private backup database `pickleball-backups` the weekly copy is saved in. */
  BACKUP?: D1Database;
  /** This Worker itself (Zip 19): each backup run and step gets its own run and CPU allowance. Missing: done in the knock's run, as before. */
  SELF?: SelfBinding;
}

const SECRET_HEADER = 'X-Backup-Secret';

/** Ask this Worker (through SELF) to do `path` as its own run. */
async function callSelf<T>(env: Env, path: string, body: unknown): Promise<T> {
  const res = await env.SELF!.fetch(
    new Request(`https://pickleball-alerts-clock${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', [SECRET_HEADER]: env.CRON_SECRET ?? '' }, body: JSON.stringify(body) }),
  );
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${path} answered ${res.status}`);
  return data;
}

/** Each step of a copy as its own run (SELF), or in this run when there is no SELF binding. */
function stepRunner(env: Env, live: D1Database, store: D1Database): StepRunner {
  const self: StepRunner = (body: StepBody) => callSelf<{ chars: number }>(env, '/backup/step', body);
  const inline: StepRunner = (body: StepBody) => runStep(live, store, body, inline);
  return env.SELF ? self : inline;
}

/** The plan, every step and the finish each as its own run (SELF); without SELF, all in this run. */
function runners(env: Env, live: D1Database, store: D1Database): Runners {
  if (!env.SELF) return {};
  return {
    plan: (nowMs, force) => callSelf<PlanResult>(env, '/backup/plan', { nowMs, force }),
    step: stepRunner(env, live, store),
    finish: (f) => callSelf<BackupResult>(env, '/backup/finish', f),
  };
}

interface ScheduledCtx {
  waitUntil(work: Promise<unknown>): void;
}

export async function knock(env: Env, doFetch: typeof fetch = fetch): Promise<number> {
  try {
    const res = await doFetch(`${env.SITE_URL.replace(/\/$/, '')}/api/cron/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': env.CRON_SECRET ?? '' },
      body: '{}',
      signal: AbortSignal.timeout(25_000),
    });
    // Shows in the Worker's logs on Cloudflare (a wrong secret reads 404).
    if (!res.ok) console.log(`tick answered ${res.status}`);
    return res.status;
  } catch (err) {
    console.log(`tick failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return 0;
  }
}

/** The hourly look and, when due, the whole copy (its steps each in their own run). The live database is only ever read. */
async function backupRun(env: Env, nowMs: number): Promise<BackupResult> {
  // The live database is handed over wrapped so it can only be read: any write would quietly do nothing.
  const live = env.DB ? viewOnlyDb(env.DB) : undefined;
  return maybeWeeklyBackup(live, env.BACKUP, nowMs, live && env.BACKUP ? runners(env, live, env.BACKUP) : {});
}

/** The weekly copy, on its own: it never delays or stops the knock, and a failure is only a log line (retried within the hour). */
export async function backupTick(env: Env, nowMs = Date.now()): Promise<void> {
  let r: BackupResult;
  try {
    // Only the ticks at minute 0 to 4 look at all (checked again inside), so the other 11 ticks an hour make no extra run.
    if (env.SELF && env.DB && env.BACKUP && checkThisTick(nowMs)) {
      r = await callSelf<BackupResult>(env, '/backup/run', { nowMs });
    } else r = await backupRun(env, nowMs);
  } catch (err) {
    r = { made: false, reason: `failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
  if (r.made) console.log(`weekly backup ${r.week}: ${r.bytes} bytes in ${r.parts} parts, ${r.kept} kept`);
  else if (r.reason.startsWith('failed')) console.log(`weekly backup ${r.reason}`);
}

/**
 * Calls this Worker makes to itself (SELF): `/backup/run` (the hourly look and the copy, which calls the rest), `/backup/plan`,
 * `/backup/step` (one step and the rest of its chain) and `/backup/finish`. Anything else,
 * or a call without the shared secret, is "Not found". (No route or workers.dev address points here, so only SELF can reach it.)
 */
export async function selfCall(req: Request, env: Env): Promise<Response> {
  const secret = env.CRON_SECRET ?? '';
  if (req.method !== 'POST' || !secret || req.headers.get(SECRET_HEADER) !== secret || !env.DB || !env.BACKUP) return new Response('Not found', { status: 404 });
  const path = new URL(req.url).pathname;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    // The clock time a run is for must be the real time (within 10 minutes): a far-off time could make copies that push real ones out.
    const nowMs = Number(body.nowMs);
    if ((path === '/backup/run' || path === '/backup/plan') && !(Math.abs(nowMs - Date.now()) <= 10 * 60_000)) return Response.json({ error: 'not the current time' }, { status: 400 });
    if (path === '/backup/run') return Response.json(await backupRun(env, nowMs));
    if (path === '/backup/plan') return Response.json(await planCopy(viewOnlyDb(env.DB), env.BACKUP, nowMs, body.force === true));
    if (path === '/backup/finish') return Response.json(await finishCopy(viewOnlyDb(env.DB), env.BACKUP, body as unknown as Finish));
    if (path === '/backup/step') {
      const live = viewOnlyDb(env.DB);
      // This step, then the next one of its chain as its own run.
      return Response.json(await runStep(live, env.BACKUP, body as unknown as StepBody, stepRunner(env, live, env.BACKUP)));
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
  return new Response('Not found', { status: 404 });
}

export default {
  fetch: selfCall,
  scheduled(_event: unknown, env: Env, ctx: ScheduledCtx) {
    // The knock first and on its own; the weekly copy only starts once the knock has its answer, so it can never cut the knock short.
    ctx.waitUntil(
      knock(env)
        .catch(() => 0)
        .then(() => backupTick(env))
        .catch(() => {}),
    );
  },
};
