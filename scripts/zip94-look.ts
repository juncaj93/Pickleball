// Zip 94 (🎾94.early bird): each of this zip's stages on the preview's fake world (local sqlite, never Cloudflare): the organizer's money and
// Prizes numbers, the gear rows, and Vic's card (the price, the strike and the line).   npx vite-node scripts/zip94-look.ts
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { buildSmallPreview } from './preview-world-small';
import { earlyCardOf } from '../shared/earlyBird';
import { payByLabel } from '../shared/tournamentTickets';

const at = Date.parse(process.env.AT ?? '2026-11-26T17:00:00.000Z');
const { sql } = await buildSmallPreview(at, { calm: true, zip55: true, zip60: true });
const raw = createNodeD1(':memory:');
raw.raw.exec(sql);
const env: any = { DB: raw, PREVIEW_CALM: 'on' };
async function call(method: string, path: string, cookie = '', body?: unknown) {
  const h = new Headers({ Origin: 'https://preview.example' });
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return { res, data: JSON.parse(text) };
}
const admin = (await call('POST', '/api/admin/login', '', { pin: '739514' })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
for (const stage of ['zip94_three', 'zip94_last', 'zip94_over', 'zip94_mixed']) {
  await call('POST', '/api/admin/tournament-test', admin, { stage });
  const d = (await call('GET', '/api/admin/dashboard', admin)).data;
  const t = d.tournament;
  const vic = d.players.find((p: any) => p.name === 'Vic');
  const g = (await call('GET', `/api/admin/view-as/${vic.id}`, admin).catch(() => null))?.data;
  console.log(stage, JSON.stringify({ priceNow: t.priceNowCents ?? t.ticketCents, early: t.early, lockedIn: t.lockedIn, expected: t.expected, money: t.money && { tickets: t.money.ticketsCents, courts: t.money.courtCents, you: t.money.youCents }, cost: t.cost, tickets: t.tickets.filter((k: any) => !k.out).map((k: any) => `${k.name}:${k.priceCents}/${k.creditCents + k.paidCents}`).join(' ') }));
  if (g?.tournament?.tickets) {
    const k = g.tournament.tickets;
    console.log('  Vic', k.priceCents, JSON.stringify(earlyCardOf(k, (iso) => payByLabel(iso, 'America/Detroit', g.tournament.finalDate), at)));
  } else console.log('  (view as not available here)', Object.keys(g ?? {}).slice(0, 5));
}
