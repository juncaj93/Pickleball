import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { clock, coldOpen, END_MS, fmtLeft, playNight, span, START_MS, type PaceName } from './coldOpen';

// 🎾91.dry run: every headcount x pace, accept all offers / decline all. Writes one row per night to DRYRUN_OUT (JSON lines) and the console.
const CASES: { n: number; style: 'vote' | 'americano'; courts: 1 | 2; tag: string }[] = [
  { n: 7, style: 'vote', courts: 1, tag: '7 AM 1c' },
  { n: 8, style: 'vote', courts: 2, tag: '8 LD' },
  { n: 9, style: 'vote', courts: 2, tag: '9 AM' },
  { n: 10, style: 'vote', courts: 2, tag: '10 LD' },
  { n: 11, style: 'vote', courts: 2, tag: '11 AM' },
  { n: 12, style: 'vote', courts: 2, tag: '12 LD' },
  { n: 8, style: 'americano', courts: 2, tag: '8 AM' },
  { n: 10, style: 'americano', courts: 2, tag: '10 AM' },
  { n: 12, style: 'americano', courts: 2, tag: '12 AM' },
];
const PACES: PaceName[] = (process.env.DRYRUN_PACES ?? 'fast,normal,slow,mixed').split(',') as PaceName[];
const only = process.env.DRYRUN_ONLY;
const out = process.env.DRYRUN_OUT ?? '/tmp/dryrun91.jsonl';
const rows: string[] = [];

describe('🎾91 dry run grid', () => {
  for (const c of CASES.filter((x) => !only || only.split(',').includes(x.tag)))
    it(c.tag, async () => {
      for (const pace of PACES)
        for (const accept of [true, false]) {
          const seed = c.n * 100 + PACES.indexOf(pace) * 10 + (accept ? 1 : 0);
          const { ctx, before } = await coldOpen({ n: c.n, style: c.style, courts: c.courts, log: [] });
          const run = await playNight(ctx, pace, seed, accept);
          const plannedFinish = START_MS + before.plan.minutesUsed * 60_000;
          const row = {
            tag: c.tag,
            pace,
            accept,
            style: before.plan.style,
            formatAtClose: before.formatAtClose,
            courts: before.courts,
            courtCents: before.courtCents,
            ticketsCents: before.ticketsCents,
            suggested: before.suggested,
            plan: before.plan,
            serverPlan: before.serverPlan,
            roundsPlayed: run.roundsPlayed,
            games: span(run.games),
            sits: span(run.sits),
            sitStreak: run.sitStreak,
            offers: run.offers.map((o) => `${o.kind}@R${o.afterRound} ${clock(o.at)} left${o.plannedLeft}${o.accepted ? ' ACC' : ' dec'}`),
            breaks: run.breaks.map((b) => `${clock(b.at)} ${b.mins}m`),
            timeChecks: run.timeChecks.map((x) => `${clock(x.at)} R${x.fromRound}->to${x.to}`),
            plannedFinish: clock(plannedFinish),
            finish: clock(run.finish),
            left: fmtLeft(run.finish),
            past10: run.finish > END_MS,
            idle: run.idle,
            idleCourtMin: Math.round(run.idleCourtMin),
            overlap: run.overlap,
            overtime: run.overtime,
            byAlex: run.byAlex,
            byPhone: run.byPhone,
            stuck: run.stuck ?? null,
            end: run.end,
            claim: run.claim,
            money: run.money,
            playerSees: before.playerSees,
            alexSees: before.alexSees,
          };
          rows.push(JSON.stringify(row));
          console.log(`[dry] ${c.tag.padEnd(8)} ${pace.padEnd(6)} ${accept ? 'ACC' : 'DEC'} rounds ${before.plan.rounds}/${run.roundsPlayed} games ${row.games} sits ${row.sits} offers [${row.offers.join('; ')}] breaks ${run.breaks.length} tc [${row.timeChecks.join('; ')}] plan ${row.plannedFinish} end ${row.finish} left ${row.left}${row.idle.length ? ` IDLE ${row.idle.length}` : ''} idleCourt ${row.idleCourtMin}m${row.overlap.length ? ' OVERLAP' : ''}${run.stuck ? ` STUCK ${run.stuck}` : ''} end ${run.end?.status} money ${run.money} claim ${run.claim}${run.overtime ? ` OT ${run.overtime}` : ''}`);
        }
    }, 900_000);
  // Start now (Alex taps it at 7:20 PM, everyone there): one night each style, normal pace, offers accepted.
  for (const c of CASES.filter((x) => ['10 LD', '9 AM', '7 AM 1c'].includes(x.tag) && !only))
    it(`Start now ${c.tag}`, async () => {
      const { ctx, before } = await coldOpen({ n: c.n, style: c.style, courts: c.courts, log: [] });
      const run = await playNight(ctx, 'normal', 999, true, START_MS - 10 * 60_000);
      console.log(`[startnow] ${c.tag} rounds ${before.plan.rounds}/${run.roundsPlayed} offers [${run.offers.map((o) => `${o.kind}@R${o.afterRound} ${clock(o.at)}`).join('; ')}] tc ${run.timeChecks.length} end ${clock(run.finish)} left ${fmtLeft(run.finish)} end ${run.end?.status} money ${run.money}`);
      expect(run.finish).toBeLessThanOrEqual(END_MS);
    }, 120_000);
  it('writes', () => {
    mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(out, rows.join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });
});
