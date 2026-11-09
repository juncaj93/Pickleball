// Loaded only when the organizer starts a demo, so players never download
// the in-browser database.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createSandbox, type Sandbox } from './sandbox';
import type { DemoExtras } from '../../server/zip18';

const migrationFiles = import.meta.glob('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** A fresh demo copy of the live data, switches included (read with the organizer's sign-in; nothing is written). */
export async function loadSandbox(): Promise<Sandbox> {
  const [SQL, res, more] = await Promise.all([
    initSqlJs({ locateFile: () => wasmUrl }),
    fetch('/api/admin/backup', { credentials: 'same-origin' }),
    // Zip 18 (server/zip18.ts): the switch rows and the on/off settings the backup leaves out, so the copy shows what players see.
    fetch('/api/admin/demo-extras', { credentials: 'same-origin' }),
  ]);
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in again to use the demo.' : "Couldn't start the demo.");
  // A server from before Zip 18 (a rollback) has no such address: the copy starts as it always did, without them.
  if (!more.ok && more.status !== 404) throw new Error(more.status === 401 ? 'Sign in again to use the demo.' : "Couldn't start the demo.");
  const extras = more.ok ? ((await more.json()) as DemoExtras) : null;
  const migrations = Object.keys(migrationFiles)
    .sort()
    .map((k) => migrationFiles[k]);
  return createSandbox(SQL, await res.json(), migrations, window.location.origin, extras);
}
