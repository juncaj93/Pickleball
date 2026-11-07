// Builds the fake preview world as if "now" were the given moment, and loads it into a LOCAL sqlite file (never Cloudflare).
// Used by the browser tests and for a local look at the preview data:
//   npx vite-node scripts/load-seed-local.ts -- <file.sqlite> [ISO time, default now]
// Then:  DEV_DB=<file.sqlite> npx vite     (and, for a fixed day, POST the same moment to /__dev/clock with DEV_CLOCK=1)
import { rmSync } from 'node:fs';
import { createNodeD1 } from '../dev/nodeD1';
import { buildSeed } from './seed-preview-world';

const [out, at] = process.argv.slice(2).filter((a) => a !== '--');
if (!out) throw new Error('Usage: vite-node scripts/load-seed-local.ts -- <file.sqlite> [ISO time]');
const startMs = at ? Date.parse(at) : Date.now();
if (Number.isNaN(startMs)) throw new Error(`Not a time: ${at}`);
// SEED_ZIP13=1: also the Zip 13 parts (e2e/zip13.cjs); left out, the world every older test was written for.
const { sql } = await buildSeed(startMs, { zip13: process.env.SEED_ZIP13 === '1' });
rmSync(out, { force: true });
const db = createNodeD1(out);
db.raw.exec(sql);
console.log(`Loaded the fake world for ${new Date(startMs).toISOString()} into ${out}`);
