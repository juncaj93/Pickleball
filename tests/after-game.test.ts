// Zip 16: After-game cards (AFTER_GAME_CARD, ships OFF) and the dark-mode in-between look of the player alert cards (rides on Alert cards).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { AFTER_GAME_CARD, AFTER_GAME_DAYS, afterGameCard, joinDays, oweMoreText } from '../shared/afterGame';
import { formatPrice } from '../shared/money';
import { formatShortDate } from '../shared/time';
import { createNodeD1 } from '../dev/nodeD1';
import { handleApi } from '../server/app';
import { DAY, HOUR, playerPhone, setupGroup, TestApp } from './harness';
import { buildSeed, PREVIEW_SWITCHES_ON, ZIP16_CAST, ZIP16_SWITCHES_ON } from '../scripts/seed-preview-world';

const TZ = 'America/Detroit';
const day = (iso: string) => formatShortDate(iso, TZ);
const ON = { [AFTER_GAME_CARD.header]: 'on' };

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const group = async (w: W, name: string, headers: Record<string, string> = {}) => (await (await playerPhone(w, name)).call('GET', '/api/group', undefined, headers)).data;

/** The upcoming games, oldest first. */
async function upcoming(w: W) {
  const d = await dash(w);
  return (d.sessions as any[]).filter((s) => Date.parse(s.startsAt) > w.app.now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Book a game, sign these players in, and mark the `paid` ones paid ($14 cash). */
async function fill(w: W, s: any, names: string[], paid: string[] = names) {
  expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' })).status).toBe(200);
  for (const n of names) expect((await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
  for (const n of paid) expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName[n], paid: true })).status).toBe(200);
}

const finalize = async (w: W, s: any, body: Record<string, unknown> = { everyone: true }) => {
  w.app.now = Math.max(w.app.now, Date.parse(s.endsAt) + HOUR);
  const r = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, body);
  expect(r.status).toBe(200);
  return r.data;
};

/** The ledger rows Finalize wrote for one player (the real credit records). */
const finalizedRows = (w: W, name: string) =>
  w.app.db.raw
    .prepare("SELECT id, amount_cents AS cents, session_id AS sessionId FROM credit_ledger WHERE player_id = ? AND kind = 'kept' AND reason = 'finalized' AND ended_at IS NULL ORDER BY created_at")
    .all(w.byName[name]) as { id: string; cents: number; sessionId: string }[];

const SIX = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];

describe('AFTER_GAME_CARD ships off: every answer exactly as before', () => {
  it('off: no flag, no list, no "more" on an owed game, no Settings row flag, even right after a finalize with credit back', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, SIX);
    await finalize(w, s);
    const g = await group(w, 'Blair');
    expect(g.afterGameCard).toBeUndefined();
    expect(g.afterGame).toBeUndefined();
    expect(g.preview).toBeUndefined();
    expect(g.owed.every((o: any) => !('more' in o))).toBe(true);
    expect((await dash(w)).afterGameCardForAll).toBeUndefined();
    // The credit itself is there as always.
    expect(g.credit.balanceCents).toBe(500);
  });

  it('the Settings row turns it on for everyone (Activity line, the player stamp changes); the private link for one phone; the kill switch beats both', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    const v0 = (await blair.call('GET', '/api/group/version')).data.v;
    expect((await group(w, 'Blair', ON)).afterGameCard).toBe(true);
    expect((await w.organizer.call('PUT', '/api/admin/after-game-card-switch', { on: true })).status).toBe(200);
    expect((await dash(w)).afterGameCardForAll).toBe(true);
    expect((await group(w, 'Blair')).afterGameCard).toBe(true);
    expect((await blair.call('GET', '/api/group/version')).data.v).not.toBe(v0);
    const acts = (await w.organizer.call('GET', '/api/admin/activity')).data.entries as any[];
    const act = acts.find((a) => a.action === 'after_game_card_on');
    expect(activityText(act, 'America/Detroit', 'Alex')).toBe('Alex switched "After-game cards" on');
    w.app.env.AFTER_GAME_CARD = 'off';
    expect((await group(w, 'Blair')).afterGameCard).toBeUndefined();
    expect((await group(w, 'Blair', ON)).afterGameCard).toBeUndefined();
    w.app.env.AFTER_GAME_CARD = 'on';
    expect((await w.organizer.call('PUT', '/api/admin/after-game-card-switch', { on: false })).status).toBe(200);
    expect((await group(w, 'Blair')).afterGameCard).toBeUndefined();
    // A player cannot flip it.
    expect((await blair.call('PUT', '/api/admin/after-game-card-switch', { on: true })).status).toBe(401);
  });
});

describe('the credit-back card reads the real credit record, to the cent', () => {
  it('6 played, everyone paid $14: each player gets ONE item, equal to the ledger row and to the credit chip change', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, SIX);
    const before = (await group(w, 'Blair', ON)).credit.balanceCents;
    await finalize(w, s);
    const g = await group(w, 'Blair', ON);
    const rows = finalizedRows(w, 'Blair');
    expect(rows).toHaveLength(1);
    expect(g.afterGame).toEqual([{ id: rows[0].id, sessionId: s.id, startsAt: s.startsAt, cents: rows[0].cents, finalPriceCents: 900, playedCount: 6, at: expect.any(String) }]);
    const card = afterGameCard(g.afterGame, [], Date.parse(g.now), day, formatPrice)!;
    expect(card.cents).toBe(g.credit.balanceCents - before);
    expect(card.cents).toBe(500);
    expect(card.title).toBe('$5 back to your credit');
    expect(card.sub).toBe(`${day(s.startsAt)}: final price $9 (6 played)`);
  });

  it('no card when the final price equals what they paid (4 played at $14), and none for a player who did not pay', async () => {
    const w = await world();
    const [s, s2] = await upcoming(w);
    await fill(w, s, ['Blair', 'Casey', 'Devon', 'Emery']);
    await finalize(w, s);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) expect((await group(w, n, ON)).afterGame).toEqual([]);
    // Unpaid at 6 played: owes $9, no credit, no card.
    await fill(w, s2, SIX, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    await finalize(w, s2);
    const f = await group(w, 'Frankie', ON);
    expect(f.afterGame).toEqual([]);
    expect(f.owed).toEqual([expect.objectContaining({ amountCents: 900, finalized: true })]);
    expect(f.owed[0].more).toBeUndefined();
  });

  it('two games at once: ONE card, the sum of both records ($5 + $3 = $8), "2 games: Tue ... and Thu ..."', async () => {
    const w = await world();
    const [s1, s2] = await upcoming(w);
    await fill(w, s1, SIX);
    await fill(w, s2, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    const before = (await group(w, 'Blair', ON)).credit.balanceCents;
    await finalize(w, s1);
    await finalize(w, s2);
    const g = await group(w, 'Blair', ON);
    expect(g.afterGame.map((c: any) => c.cents).sort()).toEqual([300, 500]);
    const card = afterGameCard(g.afterGame, [], Date.parse(g.now), day, formatPrice)!;
    expect(card.cents).toBe(800);
    expect(card.cents).toBe(g.credit.balanceCents - before);
    expect(card.title).toBe('$8 back to your credit');
    expect(card.sub).toBe(`2 games: ${day(s1.startsAt)} and ${day(s2.startsAt)}`);
    expect(card.ids.sort()).toEqual(finalizedRows(w, 'Blair').map((r) => r.id).sort());
  });

  it('closing it hides exactly those records on that phone (a newer one shows again); it never calls the server', async () => {
    const w = await world();
    const [s1, s2] = await upcoming(w);
    await fill(w, s1, SIX);
    await finalize(w, s1);
    const g = await group(w, 'Blair', ON);
    const first = afterGameCard(g.afterGame, [], Date.parse(g.now), day, formatPrice)!;
    expect(afterGameCard(g.afterGame, first.ids, Date.parse(g.now), day, formatPrice)).toBeNull();
    await fill(w, s2, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await finalize(w, s2);
    const g2 = await group(w, 'Blair', ON);
    const next = afterGameCard(g2.afterGame, first.ids, Date.parse(g2.now), day, formatPrice)!;
    expect(next.cents).toBe(300);
    expect(next.sub).toBe(`${day(s2.startsAt)}: final price $11 (5 played)`);
    // The X lives on the phone only: the card's code has no request in it.
    const src = readFileSync('src/pages/PlayerHome.tsx', 'utf8');
    const body = src.slice(src.indexOf('function AfterGameCard('), src.indexOf('/** The ids of cleared-debt notices'));
    expect(body).toContain('storageSet(AFTER_GAME_SEEN_KEY');
    expect(body).not.toMatch(/\bapi\(|fetch\(/);
  });

  it('goes by itself 7 days after the credit was given (server and card agree)', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, SIX);
    await finalize(w, s);
    const g = await group(w, 'Blair', ON);
    const at = Date.parse(g.afterGame[0].at);
    expect(afterGameCard(g.afterGame, [], at + AFTER_GAME_DAYS * DAY - 60_000, day, formatPrice)).not.toBeNull();
    expect(afterGameCard(g.afterGame, [], at + AFTER_GAME_DAYS * DAY, day, formatPrice)).toBeNull();
    w.app.now = at + AFTER_GAME_DAYS * DAY - 60_000;
    expect((await group(w, 'Blair', ON)).afterGame).toHaveLength(1);
    w.app.now = at + AFTER_GAME_DAYS * DAY + 60_000;
    expect((await group(w, 'Blair', ON)).afterGame).toEqual([]);
    // The money stays: only the card went.
    expect((await group(w, 'Blair', ON)).credit.balanceCents).toBe(500);
  });

  it('a Reopen takes the card away with the credit; the redo shows the new amount', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, SIX);
    await finalize(w, s);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {})).status).toBe(200);
    expect((await group(w, 'Blair', ON)).afterGame).toEqual([]);
    await finalize(w, s, { played: ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'].map((n) => w.byName[n]) });
    const g = await group(w, 'Blair', ON);
    expect(g.afterGame).toEqual([expect.objectContaining({ cents: 300, finalPriceCents: 1100, playedCount: 5 })]);
    // Frankie did not play: $14 back, but that is not a final price change, so no card.
    expect((await group(w, 'Frankie', ON)).afterGame).toEqual([]);
  });

  it('privacy: each player sees only their own records; a phone with no name picked sees none; ids of other players never appear', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, SIX);
    await finalize(w, s);
    const blair = await group(w, 'Blair', ON);
    const casey = await group(w, 'Casey', ON);
    expect(blair.afterGame.map((c: any) => c.id)).toEqual(finalizedRows(w, 'Blair').map((r) => r.id));
    expect(casey.afterGame.map((c: any) => c.id)).toEqual(finalizedRows(w, 'Casey').map((r) => r.id));
    expect(JSON.stringify(blair)).not.toContain(finalizedRows(w, 'Casey')[0].id);
    const anon = w.app.client();
    anon.groupKey = w.groupKey;
    const a = (await anon.call('GET', '/api/group', undefined, ON)).data;
    expect(a.me).toBeNull();
    expect(a.afterGame).toEqual([]);
    for (const n of SIX.slice(1)) expect(JSON.stringify(a)).not.toContain(finalizedRows(w, n)[0].id);
  });
});

describe('owes more after Finalize (the owe card that is already there, reworded)', () => {
  it('paid $11 at 5 played, reopened and redone with 4 played ($14): "You owe $3 more", the same Pay; off: as before', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], ['Blair', 'Casey', 'Devon', 'Emery']);
    await finalize(w, s);
    // Frankie pays the final price ($11) after Finalize.
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName.Frankie, paid: true })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {})).status).toBe(200);
    await finalize(w, s, { played: ['Blair', 'Casey', 'Devon', 'Frankie'].map((n) => w.byName[n]) });
    const on = await group(w, 'Frankie', ON);
    expect(on.owed).toEqual([expect.objectContaining({ sessionId: s.id, amountCents: 300, finalized: true, more: { finalPriceCents: 1400, playedCount: 4 } })]);
    expect(on.payDue).toEqual(on.owed);
    expect(oweMoreText(on.owed[0], day, formatPrice)).toEqual({ title: 'You owe $3 more', sub: `${day(s.startsAt)}: final price $14 (4 played)` });
    const off = await group(w, 'Frankie');
    expect(off.owed).toEqual([expect.objectContaining({ amountCents: 300, finalized: true })]);
    expect(off.owed[0].more).toBeUndefined();
    // Nobody else owes more.
    for (const n of ['Blair', 'Casey', 'Devon']) expect((await group(w, n, ON)).owed).toEqual([]);
  });

  it('a seat that never paid owes the final price: the old words, no "more"', async () => {
    const w = await world();
    const [s] = await upcoming(w);
    await fill(w, s, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon']);
    await finalize(w, s);
    const g = await group(w, 'Emery', ON);
    expect(g.owed).toEqual([expect.objectContaining({ amountCents: 1400 })]);
    expect(g.owed[0].more).toBeUndefined();
    expect(oweMoreText(g.owed[0], day, formatPrice)).toBeNull();
  });
});

describe('the card words', () => {
  it('joins dates the plain way', () => {
    expect(joinDays(['Tue, Nov 3'])).toBe('Tue, Nov 3');
    expect(joinDays(['Tue, Nov 3', 'Thu, Nov 5'])).toBe('Tue, Nov 3 and Thu, Nov 5');
    expect(joinDays(['Tue, Nov 3', 'Thu, Nov 5', 'Tue, Nov 10'])).toBe('Tue, Nov 3, Thu, Nov 5 and Tue, Nov 10');
  });
  it('matches the mock exactly', () => {
    const now = Date.parse('2026-11-06T15:00:00Z');
    const one = [{ id: 'a', sessionId: 's1', startsAt: '2026-11-04T01:00:00Z', cents: 500, finalPriceCents: 900, playedCount: 6, at: '2026-11-05T12:00:00Z' }];
    expect(afterGameCard(one, [], now, day, formatPrice)).toMatchObject({ title: '$5 back to your credit', sub: 'Tue, Nov 3: final price $9 (6 played)' });
    const two = [...one, { id: 'b', sessionId: 's2', startsAt: '2026-11-06T01:00:00Z', cents: 300, finalPriceCents: 1100, playedCount: 5, at: '2026-11-06T12:00:00Z' }];
    expect(afterGameCard(two, [], now, day, formatPrice)).toMatchObject({ title: '$8 back to your credit', sub: '2 games: Tue, Nov 3 and Thu, Nov 5' });
  });
});

describe('dark-mode in-between look (rides on Alert cards, player and organizer, light untouched)', () => {
  const css = readFileSync('src/alert-cards.css', 'utf8');
  const part = css.slice(css.indexOf('/* ---------- Zip 16'));
  it('every new look rule is dark-only; the mock numbers are used', () => {
    // Outside the two dark blocks only the --t-line names (no colors at all) are set.
    const light = part.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/, '').replace(/html\[data-alert-cards\]\[data-theme='dark'\][^{]*\{[^}]*\}/g, '');
    expect(light).not.toMatch(/background|border|#[0-9a-f]{6}/i);
    expect(part).toContain('color-mix(in srgb, var(--ac-card) 62%, var(--t-tint))');
    expect(part).toContain('color-mix(in srgb, var(--ac-line) 45%, var(--t-line))');
    expect(part).toContain('border-width: 1.5px');
    for (const c of ['#2b5a40', '#5a4720', '#363f78', '#3a403b']) expect(part).toContain(c);
  });
  it('applies to every alert card (player and organizer) under the Alert cards attribute, dark only', () => {
    expect(part).not.toContain('data-ac-player');
    expect(readFileSync('src/pages/PlayerHome.tsx', 'utf8')).not.toContain('usePlayerAlertLook');
    for (const sel of part.match(/^html\[[^{]*\{/gm) ?? []) expect(sel).toMatch(/^html\[data-alert-cards\]/);
  });
});

describe('preview', () => {
  it('the seed: the row is on only for the preview (and the local world that asks); Parker, Rowan and Quinn have their states', async () => {
    expect(ZIP16_SWITCHES_ON).toContain(AFTER_GAME_CARD.task);
    expect(PREVIEW_SWITCHES_ON as readonly string[]).not.toContain(AFTER_GAME_CARD.task);
    const NOW = Date.parse('2026-11-08T20:00:00.000Z');
    const { sql } = await buildSeed(NOW, { zip16: true });
    expect(sql).toContain(`'preview-${AFTER_GAME_CARD.task}'`);
    const db = createNodeD1(':memory:');
    db.raw.exec(sql);
    const env: any = { DB: db, PREVIEW_CALM: 'on' };
    const key = (db.raw.prepare('SELECT group_key FROM groups').get() as { group_key: string }).group_key;
    const ids = Object.fromEntries((db.raw.prepare('SELECT id, display_name FROM players').all() as { id: string; display_name: string }[]).map((p) => [p.display_name, p.id]));
    for (const n of ZIP16_CAST) expect(ids[n]).toBeTruthy();
    const as = async (name: string) => {
      const pick = await handleApi(new Request('https://preview.example/api/me', { method: 'POST', headers: { 'X-Group-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: ids[name] }) }), env, NOW, () => {});
      const cookie = pick.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      const res = await handleApi(new Request('https://preview.example/api/group', { headers: { 'X-Group-Key': key, Cookie: cookie } }), env, NOW, () => {});
      return (await res.json()) as any;
    };
    const parker = await as('Parker');
    expect(parker.preview).toBe(true);
    expect(parker.previewCalm).toBe(true);
    expect(afterGameCard(parker.afterGame, [], NOW, day, formatPrice)).toMatchObject({ title: '$5 back to your credit', cents: 500 });
    expect(parker.credit.balanceCents).toBe(500);
    const rowan = await as('Rowan');
    expect(afterGameCard(rowan.afterGame, [], NOW, day, formatPrice)).toMatchObject({ title: '$8 back to your credit', cents: 800 });
    expect(rowan.credit.balanceCents).toBe(800);
    const quinn = await as('Quinn');
    expect(quinn.afterGame).toEqual([]);
    expect(quinn.payDue).toEqual([expect.objectContaining({ amountCents: 300, more: { finalPriceCents: 1400, playedCount: 4 } })]);
    // Uma did not play the redo: $14 back as credit, still only the two final price records on her card ($8).
    const uma = await as('Uma');
    expect(afterGameCard(uma.afterGame, [], NOW, day, formatPrice)).toMatchObject({ cents: 800 });
    // Live never says preview.
    const live = await handleApi(new Request('https://preview.example/api/group', { headers: { 'X-Group-Key': key } }), { DB: db } as any, NOW, () => {});
    expect(((await live.json()) as any).preview).toBeUndefined();
  }, 60_000);
});
