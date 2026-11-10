// Zip 27 deploy step: a READ-ONLY snapshot of every money number the organizer sees, to prove the deploy and the one-time price lock
// (scripts/lock-finalized.ts) change nothing. Signs in with the read-only PIN (reads only: the server refuses every write and its reads
// write nothing), so it is safe at any hour.
//
//   READONLY_PIN=... npx vite-node scripts/money-check.ts -- --base https://pickleball.juncaj.net --out <scratch>/before.json
//   npx vite-node scripts/money-check.ts -- --compare <scratch>/before.json <scratch>/after.json
//
// What it reads: Money > Totals for every month from October 2026 to this month (GET /api/admin/money), every game row on the
// dashboard (court cost, final price, each seat's share, owes and credit), the Players list's Spent, and each player's sheet (month and
// All time Spent). The file has names and money: keep it in the session's scratch folder, never in git. The PIN is never written down.

import { readFileSync, writeFileSync } from 'node:fs';

type Json = Record<string, unknown>;

async function snapshot(base: string, pin: string): Promise<Json> {
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ pin }) });
  if (!login.ok) throw new Error(`sign-in failed: ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const get = async (path: string) => {
    const r = await fetch(base + path, { headers: { Cookie: cookie } });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return (await r.json()) as Json;
  };
  const out: Json = {};
  const d = (await get('/api/admin/dashboard')) as { players: Json[]; sessions: Json[] };
  const now = new Date();
  const ny = Number(now.toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }).slice(0, 4));
  const nm = Number(now.toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }).slice(5, 7));
  for (let y = 2026, m = 10; y < ny || (y === ny && m <= nm); m === 12 ? ((m = 1), y++) : m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out[`money ${key}`] = await get(`/api/admin/money?month=${key}`);
  }
  for (const s of [...d.sessions].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))) {
    const roster = (s.roster as Json[]).map((r) => [r.name, r.status, r.paymentStatus, r.paymentAmountCents, r.shareCents, r.owesCents, r.creditCents, r.paidEarlierCents]);
    out[`game ${s.startsAt}`] = { finalized: s.finalized ?? null, court: s.court ?? null, shortGame: s.shortGame ?? null, roster };
  }
  out.players = d.players.map((p) => [p.name, p.spentCents ?? null, p.played]);
  for (const p of d.players) {
    const r = await fetch(`${base}/api/admin/players/${p.id}/summary`, { headers: { Cookie: cookie } });
    out[`summary ${p.name}`] = r.ok ? await r.json() : r.status;
  }
  return out;
}

function compare(a: unknown, b: unknown, path: string, diffs: string[]) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a as Json), ...Object.keys(b as Json)])) compare((a as Json)[k], (b as Json)[k], `${path}/${k}`, diffs);
    return;
  }
  diffs.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--compare')) {
    const [x, y] = args.slice(args.indexOf('--compare') + 1).map((f) => JSON.parse(readFileSync(f, 'utf8')));
    const diffs: string[] = [];
    compare(x, y, '', diffs);
    console.log(diffs.length === 0 ? 'IDENTICAL: every month, game row and Spent number is the same.' : `${diffs.length} DIFFERENCES:\n${diffs.join('\n')}`);
    process.exit(diffs.length === 0 ? 0 : 1);
  }
  const base = args[args.indexOf('--base') + 1];
  const outFile = args[args.indexOf('--out') + 1];
  const pin = process.env.READONLY_PIN;
  if (!base || !outFile || !pin) throw new Error('Needs --base, --out and READONLY_PIN.');
  const snap = await snapshot(base.replace(/\/$/, ''), pin);
  writeFileSync(outFile, JSON.stringify(snap, null, 1));
  console.log(`Saved ${Object.keys(snap).length} sections to ${outFile}.`);
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
