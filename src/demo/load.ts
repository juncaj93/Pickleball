// Loaded only when the organizer starts a demo, so players never download
// the in-browser database.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createSandbox, type Sandbox } from './sandbox';

const migrationFiles = import.meta.glob('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** A fresh demo copy of the live data (read with the organizer's sign-in; nothing is written). */
export async function loadSandbox(): Promise<Sandbox> {
  const [SQL, res] = await Promise.all([
    initSqlJs({ locateFile: () => wasmUrl }),
    fetch('/api/admin/backup', { credentials: 'same-origin' }),
  ]);
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in again to use the demo.' : "Couldn't start the demo.");
  const migrations = Object.keys(migrationFiles)
    .sort()
    .map((k) => migrationFiles[k]);
  return createSandbox(SQL, await res.json(), migrations, window.location.origin);
}
