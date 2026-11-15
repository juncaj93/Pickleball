// The SMALL preview world (the 10 fixed names, docs/PREVIEW_FAKE_DB.md) as if "now" were the given moment, loaded into a LOCAL sqlite
// file (never Cloudflare). Used by e2e/zip18.cjs; the bigger world (scripts/load-seed-local.ts) stays for the older browser tests.
//   npx vite-node scripts/load-small-local.ts -- <file.sqlite> [ISO time, default now] [--calm] [--zip49]   (--calm = the calm profile; with --zip49
//   it is the default preview profile of Zip 49: e2e/zip49.cjs)
import { rmSync } from 'node:fs';
import { createNodeD1 } from '../dev/nodeD1';
import { buildSmallPreview } from './preview-world-small';

const calm = process.argv.includes('--calm');
const zip49 = process.argv.includes('--zip49');
const [out, at] = process.argv.slice(2).filter((a) => a !== '--' && a !== '--calm' && a !== '--zip49');
if (!out) throw new Error('Usage: vite-node scripts/load-small-local.ts -- <file.sqlite> [ISO time]');
const startMs = at ? Date.parse(at) : Date.now();
if (Number.isNaN(startMs)) throw new Error(`Not a time: ${at}`);
const { sql, summary } = await buildSmallPreview(startMs, { calm, zip49 });
rmSync(out, { force: true });
const db = createNodeD1(out);
db.raw.exec(sql);
console.log(`Loaded the small fake world for ${new Date(startMs).toISOString()} into ${out}\n${summary.join('\n')}`);
