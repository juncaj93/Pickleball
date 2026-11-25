// Zip 92: 🎾91's dry run grid, rebuilt clean (no test switches). Every headcount x pace, offers accepted or declined. Long (about 10 to 20
// minutes): runs only with ZIP92_DRYRUN=1 (the always-on checks are in tests/zip92-fixes.test.ts). Writes one JSON line per night to
// ZIP92_OUT (default .data/zip92-dryrun.jsonl). ZIP92_ONLY="8 LD,10 LD" and ZIP92_PACES="fast,slow" narrow it.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { clock, coldOpen, END_MS, fmtLeft, playNight, span, START_MS, type PaceName } from './zip92-world';

const CASES: { n: number; style: 'vote' | 'americano'; courts: 1 | 2; tag: string }[] = [
  { n: 7, style: 'vote', courts: 1, tag: '7 AM 1c' },
  { n: 8, style: 'vote', courts: 2, tag: '8 LD' },
  { n: 9, style: 'vote', courts: 2, tag: '9 AM' },
  { n: 10, style: 'vote', courts: 2, tag: '10 LD' },
  { n: 11, style: 'vote', courts: 2, tag: '11 AM' },
  { n: 12, style: 'vote', courts: 2, tag: '12 vote' },
  { n: 8, style: 'americano', courts: 2, tag: '8 AM' },
  { n: 10, style: 'americano', courts: 2, tag: '10 AM' },
  { n: 12, style: 'americano', courts: 2, tag: '12 AM' },
];
const PACES: PaceName[] = (process.env.ZIP92_PACES ?? 'fast,normal,slow,mixed').split(',') as PaceName[];
const only = process.env.ZIP92_ONLY;
const out = process.env.ZIP92_OUT ?? '.data/zip92-dryrun.jsonl';
const rows: string[] = [];

describe.skipIf(!process.env.ZIP92_DRYRUN)('🎾92 dry run grid', () => {
  for (const c of CASES.filter((x) => !only || only.split(',').includes(x.tag)))
    it(c.tag, async () => {
      for (const pace of PACES)
        for (const accept of [true, false]) {
          const seed = c.n * 100 + PACES.indexOf(pace) * 10 + (accept ? 1 : 0);
          const { ctx, before } = await coldOpen({ n: c.n, style: c.style, courts: c.courts, log: [] });
          const run = await playNight(ctx, pace, seed, accept);
          const perRound = new Map<number, number>();
          for (const x of run.timeChecks) if (x.round !== null) perRound.set(x.round, (perRound.get(x.round) ?? 0) + 1);
          const row = {
            tag: c.tag,
            pace,
            accept,
            style: before.plan.style,
            formatAtClose: before.formatAtClose,
            plan: before.plan,
            roundsPlayed: run.roundsPlayed,
            games: span(run.games),
            sits: span(run.sits),
            sitStreak: run.sitStreak,
            offers: run.offers.map((o) => `${o.kind}@R${o.afterRound} ${clock(o.at)} left${o.plannedLeft}${o.accepted ? ' ACC' : ' dec'}`),
            breaks: run.breaks.length,
            timeChecks: run.timeChecks.map((x) => `${clock(x.at)} R${x.round}: ${x.text}`),
            tcPerRoundMax: Math.max(0, ...perRound.values()),
            shortenedOnCourt: run.shortenedOnCourt,
            plannedFinish: clock(START_MS + before.plan.minutesUsed * 60_000),
            finish: clock(run.finish),
            left: fmtLeft(run.finish),
            past10: run.finish > END_MS,
            idle: run.idle.length,
            overlap: run.overlap.length,
            stuck: run.stuck ?? null,
            end: run.end?.status ?? null,
            claim: run.claim,
            money: run.money,
          };
          rows.push(JSON.stringify(row));
          console.log(
            `[dry] ${c.tag.padEnd(8)} ${pace.padEnd(6)} ${accept ? 'ACC' : 'DEC'} ${row.style} rounds ${before.plan.rounds}/${run.roundsPlayed} sits ${row.sits} offers [${row.offers.join('; ')}] tc ${run.timeChecks.length} (max ${row.tcPerRoundMax}/round) plan ${row.plannedFinish} end ${row.finish} left ${row.left}${row.idle ? ` IDLE ${row.idle}` : ''}${row.overlap ? ' OVERLAP' : ''}${run.stuck ? ` STUCK ${run.stuck}` : ''} end ${row.end} money ${run.money}${run.shortenedOnCourt.length ? ` SHORTENED-ON-COURT ${run.shortenedOnCourt.join(",")}` : ""}`,
          );
          for (const x of row.timeChecks) console.log(`        tc ${x}`);
        }
    }, 2_400_000);
  it('writes', () => {
    mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(out, rows.join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });
});
