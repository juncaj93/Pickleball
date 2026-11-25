import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { prizeKinds, prizeWords } from '../shared/prizeReveal';
import type { CongratsView } from '../shared/tournament';

// Zip 90 (🎾90.prize reveal), on the real server code and the preview's stages:
//   1. the congratulations view carries what the reveal needs (award, format, the tournament, the partner, the credit, the medal and whether
//      it counts by the name), from the rows End saved: no migration, nothing new stored;
//   2. who gets a card: a champion (either style), a 2nd place (either style, Locked doubles too) only with credit;
//   3. Nice (award-seen) changes no amount anywhere and no count anyone else sees; all three integrity files read 0;
//   4. the card's words and cards (pictures 1 to 6);
//   5. the look rules: the header and card colors only from the tokens, the organizer's header untouched.

const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];
const SQL = ['integrity-checks.sql', 'integrity-checks-extension.sql', 'integrity-checks-tournament.sql'].map((f) => [f, readFileSync(join(process.cwd(), 'scripts', f), 'utf8')] as const);
const css = (f: string) => readFileSync(join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

async function previewWorld() {
  const ctx = await setupGroup();
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  ctx.app.env.PREVIEW_CALM = 'on';
  const byName: Record<string, string> = {};
  for (const n of NAMES) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
  for (const p of (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[]) byName[p.name] = p.id;
  ctx.app.now = Date.parse('2026-11-13T02:00:00.000Z');
  const c = { ...ctx, byName };
  const stage = async (s: string) => {
    const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: s });
    expect(r.status, r.text).toBe(200);
    return r.data.id as string;
  };
  const phone = (name: string) => playerPhone(c, name);
  const group = async (name: string) => (await (await phone(name)).call('GET', '/api/group')).data;
  const integrity = () => {
    for (const [file, sql] of SQL) {
      const r = ctx.app.db.raw.prepare(sql.replace(/^\s*--.*$/gm, '')).get() as Record<string, number>;
      for (const [k, v] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(v), `${file}: ${k}`).toBe(0);
    }
  };
  /** Every player's balance and the medal counts, as each phone gets them. */
  const everyone = async () => {
    const out: Record<string, unknown> = {};
    for (const n of NAMES) {
      const g = await group(n);
      out[n] = { credit: g.credit?.balanceCents ?? 0, medals: g.tourAwards?.medals ?? {} };
    }
    return out;
  };
  return { ctx, stage, phone, group, integrity, everyone };
}

describe('zip 90: the prize reveal', () => {
  it('Locked doubles champions: award, partner, $14, the medal that counts by the name; the 2nd place team at $0 gets no card', async () => {
    const { stage, group, integrity } = await previewWorld();
    await stage('zip90_ld');
    const vic = (await group('Vic')).tourAwards;
    expect(vic.congrats).toMatchObject({ award: 'champion', format: 'doubles', tournament: 'The Cold Open', partner: 'Wren', creditCents: 1400, medal: true, medalCounted: true });
    // The titles of a page still open from before the deploy stay.
    expect(vic.congrats).toMatchObject({ title: 'You won The Cold Open', sub: '$14 credit toward your next game, plus a medal next to your name.' });
    expect((await group('Wren')).tourAwards.congrats).toMatchObject({ partner: 'Vic', creditCents: 1400 });
    // The server sends the real medal count and balance; holding them back is the phone's own screen only.
    expect(vic.medals.Vic).toBe(1);
    for (const n of ['Parker', 'Quinn', 'Rowan', 'Zoe']) expect((await group(n)).tourAwards?.congrats, n).toBeUndefined();
    integrity();
  });

  it('Locked doubles 2nd place with credit: Parker and Quinn get the runner-up card ($7, no medal, no partner line)', async () => {
    const { stage, group, integrity } = await previewWorld();
    await stage('zip90_second');
    for (const n of ['Parker', 'Quinn']) {
      const c = (await group(n)).tourAwards.congrats as CongratsView;
      expect(c, n).toMatchObject({ award: 'second', format: 'doubles', creditCents: 700, medal: false, medalCounted: false });
      expect(c.partner).toBeUndefined();
    }
    expect((await group('Vic')).tourAwards.congrats).toMatchObject({ award: 'champion', creditCents: 1400 });
    integrity();
  });

  it('Americano champion with no credit: the medal only; the runner-up at $0 gets no card', async () => {
    const { ctx, stage, group, integrity } = await previewWorld();
    const id = await stage('zip90_am');
    const vic = (await group('Vic')).tourAwards.congrats as CongratsView;
    expect(vic).toMatchObject({ award: 'champion', format: 'americano', creditCents: 0, medal: true, medalCounted: true });
    expect(vic.partner).toBeUndefined();
    const second = ctx.app.db.raw.prepare("SELECT p.display_name AS n FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE r.tournament_id = ? AND r.award = 'second'").get(id) as { n: string };
    expect(second?.n).toBeTruthy();
    expect((await group(second.n)).tourAwards?.congrats).toBeUndefined();
    integrity();
  });

  it('Nice changes no amount and no count for anyone; the card does not come back; a second Nice changes nothing', async () => {
    const { stage, phone, group, integrity, everyone } = await previewWorld();
    const id = await stage('zip90_ld');
    const before = await everyone();
    const vic = await phone('Vic');
    const r = await vic.call('POST', '/api/tournament/award-seen', { tournamentId: id });
    expect(r.status, r.text).toBe(200);
    expect(r.data.changed).toBe(true);
    expect((await group('Vic')).tourAwards.congrats).toBeUndefined();
    expect(await everyone()).toEqual(before);
    const again = await vic.call('POST', '/api/tournament/award-seen', { tournamentId: id });
    expect(again.data.changed).toBe(false);
    // Wren's card is her own.
    expect((await group('Wren')).tourAwards.congrats).toMatchObject({ award: 'champion' });
    integrity();
  });

  it('two unclaimed prizes: the first card carries the other one\'s credit and medal so the header holds both back', async () => {
    const { ctx, stage, group } = await previewWorld();
    const id = await stage('zip90_ld');
    const vic = ctx.app.db.raw.prepare("SELECT id, group_id FROM players WHERE display_name = 'Vic'").get() as { id: string; group_id: string };
    const now = new Date(ctx.app.now).toISOString();
    const until = new Date(ctx.app.now + 7 * 86_400_000).toISOString();
    ctx.app.db.raw
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date, status, visibility, created_at, updated_at, format, second_credit_cents, ended_at, end_key, banner_until)
         SELECT 'later-t', group_id, 'Turkey Trot', size, courts, minutes, start_minutes, ticket_cents, 700, offered_dates, final_date, 'ended', 'all', ?, ?, 'americano', 0, ?, 'later-key', ? FROM tournaments WHERE id = ?`,
      )
      .run(now, now, new Date(ctx.app.now - 86_400_000).toISOString(), until, id);
    ctx.app.db.raw
      .prepare(
        `INSERT INTO tournament_results (id, tournament_id, player_id, finish, wins, losses, points, picked_level, approved_level, medal, award, credit_cents, seen_at, created_at) VALUES ('later-r', 'later-t', ?, 1, 5, 0, 60, 300, NULL, 1, 'champion', 700, NULL, ?)`,
      )
      .run(vic.id, now);
    const c = (await group('Vic')).tourAwards.congrats as CongratsView;
    expect(c).toMatchObject({ tournament: 'The Cold Open', creditCents: 1400, laterCreditCents: 700, laterMedals: 1 });
    expect((await group('Wren')).tourAwards.congrats.laterCreditCents).toBeUndefined();
  });

  it('Replay stage: each pick turns the cards back face down (same night, same money); another stage in between builds it fresh', async () => {
    const { stage, phone, group, integrity, everyone } = await previewWorld();
    const id = await stage('zip90_replay');
    expect((await group('Vic')).tourAwards.congrats).toMatchObject({ award: 'champion', partner: 'Wren', creditCents: 1400 });
    const money = await everyone();
    for (const n of ['Vic', 'Wren']) expect((await (await phone(n)).call('POST', '/api/tournament/award-seen', { tournamentId: id })).data.changed).toBe(true);
    expect((await group('Vic')).tourAwards.congrats).toBeUndefined();
    expect(await stage('zip90_replay')).toBe(id);
    expect((await group('Vic')).tourAwards.congrats).toMatchObject({ award: 'champion', creditCents: 1400 });
    expect((await group('Wren')).tourAwards.congrats).toMatchObject({ award: 'champion' });
    expect(await everyone()).toEqual(money);
    integrity();
    await stage('zip90_header');
    const fresh = await stage('zip90_replay');
    expect(fresh).not.toBe(id);
    expect((await group('Vic')).tourAwards.congrats).toMatchObject({ award: 'champion' });
    integrity();
  });

  it('the card words and cards (pictures 1 to 6)', () => {
    const base = { key: 'k', tournamentId: 't', title: '', sub: '', tournament: 'The Cold Open', medalCounted: true };
    const ld = { ...base, award: 'champion', format: 'doubles', partner: 'Wren', creditCents: 1400, medal: true } as CongratsView;
    expect(prizeWords(ld)).toEqual({ kicker: 'The Cold Open champions', title: 'Congrats, you and Wren won!' });
    expect(prizeKinds(ld)).toEqual(['medal', 'credit']);
    const am = { ...base, award: 'champion', format: 'americano', creditCents: 0, medal: true } as CongratsView;
    expect(prizeWords(am)).toEqual({ kicker: 'The Cold Open champion', title: 'Congrats, you won!' });
    expect(prizeKinds(am)).toEqual(['medal']);
    const second = { ...base, award: 'second', format: 'doubles', creditCents: 700, medal: false, medalCounted: false } as CongratsView;
    expect(prizeWords(second)).toEqual({ kicker: 'The Cold Open runner-up', title: 'Congrats on 2nd place!' });
    expect(prizeKinds(second)).toEqual(['credit']);
  });

  it('look rules: colors only from tokens; the header rules only for the player header (.ph-head)', () => {
    const card = css('src/tour-awards.css');
    const pz = card.slice(card.indexOf('.pz {'));
    expect(pz).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(pz.replace(/rgb\(0 0 0 \/ \d+%\)/g, '')).not.toMatch(/rgba?\(/);
    const styles = css('src/styles.css');
    const head = styles.slice(styles.indexOf('.ph-head .topbar-row'), styles.indexOf('@keyframes rv-cup-glow'));
    expect(head).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const rule of head.match(/[^{}]+\{/g) ?? []) expect(rule.trim(), rule).toMatch(/^\.ph-head|^@|^\d|^from|^to/);
  });
});
