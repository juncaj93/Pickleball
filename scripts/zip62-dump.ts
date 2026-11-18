// Zip 62 (🎾62.speed), used by e2e/zip62-same.cjs (by hand): every screen's answer, byte for byte, from ONE saved database file (local sqlite,
// never Cloudflare), with the server code at ROOT (main's checkout or this branch): the dashboard and its check, History, Money, View as data,
// a phone with no name, and for every name its Home and check, on the organizer's own phone, View as, Pretend it's... at two moments, and the
// read-only PIN. Ids made while answering are counted, not random, so the same code on the same file gives the same text.
//   ROOT=<code folder> DB=<saved sqlite file> OUT=<json file> WORK=<scratch sqlite> [AT=<ISO time>] npx vite-node scripts/zip62-dump.ts
// Ids made while answering are counted, not random, so two runs of the same code on the same file give the same text.
import { copyFileSync, writeFileSync } from 'node:fs';

let n = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
const realFill = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
let seed = 7;
Object.defineProperty(globalThis.crypto, 'getRandomValues', {
  configurable: true,
  value: (buf: Uint8Array) => {
    if (!(buf instanceof Uint8Array)) return realFill(buf);
    for (let i = 0; i < buf.length; i++) buf[i] = (seed = (seed * 1103515245 + 12345) % 2147483648) & 255;
    return buf;
  },
});

const ROOT = process.env.ROOT!;
const AT = Date.parse(process.env.AT ?? '2026-11-18T18:30:00.000Z');
const work = process.env.WORK ?? `${process.env.DB}.work-${process.pid}.sqlite`;
copyFileSync(process.env.DB!, work);
const { handleApi } = await import(`${ROOT}/server/app.ts`);
const { createNodeD1 } = await import(`${ROOT}/dev/nodeD1.ts`);
const raw = createNodeD1(work, `${ROOT}/migrations`);
const env: any = { DB: raw, PREVIEW_CALM: 'on', ORGANIZER_READONLY_PIN: '86420975' };
const out: Record<string, string> = {};

async function call(method: string, path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  h.set('Origin', 'https://preview.example');
  const res: Response = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, AT, () => {});
  return { res, text: await res.text() };
}
const cookieOf = (r: Response) => r.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
const keep = (name: string, r: { res: Response; text: string }) => (out[name] = `${r.res.status} ${r.text}`);

const login = await call('POST', '/api/admin/login', '', { pin: '739514' });
const admin = cookieOf(login.res);
const month = new Date(AT).toISOString().slice(0, 7);
for (let round = 0; round < 2; round++) {
  // Round 0 is the first read (lazy upkeep), round 1 the steady state.
  keep(`r${round} dashboard`, await call('GET', '/api/admin/dashboard', admin));
  keep(`r${round} admin version`, await call('GET', '/api/admin/version', admin));
}
keep('activity', await call('GET', '/api/admin/activity', admin));
keep('money', await call('GET', `/api/admin/money?month=${month}`, admin));
keep('demo extras', await call('GET', '/api/admin/demo-extras', admin));
const dash = JSON.parse((await call('GET', '/api/admin/dashboard', admin)).text);
keep('nobody group', await call('GET', '/api/group'));
keep('nobody version', await call('GET', '/api/group/version'));
for (const p of dash.players as { id: string; name: string }[]) {
  const phone = cookieOf((await call('POST', '/api/me', '', { playerId: p.id })).res);
  keep(`${p.name} group`, await call('GET', '/api/group', phone));
  keep(`${p.name} version`, await call('GET', '/api/group/version', phone));
  // The organizer's own phone (signed in AND this name picked): the Only me path.
  keep(`${p.name} group on the organizer's phone`, await call('GET', '/api/group', `${admin}; ${phone}`));
  keep(`${p.name} version on the organizer's phone`, await call('GET', '/api/group/version', `${admin}; ${phone}`));
  // View as (the organizer's demo header).
  keep(`${p.name} view as`, await call('GET', '/api/group', admin, undefined, { 'X-View-As': p.id }));
  keep(`${p.name} view as version`, await call('GET', '/api/group/version', admin, undefined, { 'X-View-As': p.id }));
}
// "Pretend it's..." (the organizer's look-only preview at another moment) and the read-only PIN.
for (const when of [AT + 86_400_000, AT + 30 * 86_400_000]) {
  const h = { 'X-Pretend-Now': new Date(when).toISOString() };
  keep(`pretend ${when} dashboard`, await call('GET', '/api/admin/dashboard', admin, undefined, h));
  keep(`pretend ${when} admin version`, await call('GET', '/api/admin/version', admin, undefined, h));
  for (const p of (dash.players as { id: string; name: string }[]).slice(0, 4)) {
    keep(`pretend ${when} ${p.name} view as`, await call('GET', '/api/group', admin, undefined, { ...h, 'X-View-As': p.id }));
  }
}
const ro = cookieOf((await call('POST', '/api/admin/login', '', { pin: '86420975' })).res);
keep('readonly dashboard', await call('GET', '/api/admin/dashboard', ro));
keep('readonly admin version', await call('GET', '/api/admin/version', ro));
for (const p of dash.players as { id: string; name: string }[]) keep(`readonly ${p.name} view as`, await call('GET', '/api/group', ro, undefined, { 'X-View-As': p.id }));
writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
console.log(`dumped ${Object.keys(out).length} answers`);
