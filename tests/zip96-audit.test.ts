// 🎾96 audit (read-only): 🎾92's dry run grid on today's main, plus who the 🎾95 Level check card lists after each night and that it never shows
// before End. Runs only with ZIP96_AUDIT=1. One JSON line per night to ZIP96_OUT (default .data/zip96-audit.jsonl).
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { clock, coldOpen, dash, END_MS, fmtLeft, playNight, span, START_MS, type PaceName } from './zip92-world';

const CASES: { n: number; style: 'vote' | 'americano'; courts: 1 | 2; tag: string }[] = [
  { n: 7, style: 'vote', courts: 1, tag: '7 AM 1c' },
  { n: 7, style: 'vote', courts: 2, tag: '7 AM 2c' },
  { n: 6, style: 'vote', courts: 1, tag: '6 AM 1c' },
  { n: 6, style: 'vote', courts: 2, tag: '6 vote' },
  { n: 8, style: 'vote', courts: 2, tag: '8 LD' },
  { n: 9, style: 'vote', courts: 2, tag: '9 AM' },
  { n: 10, style: 'vote', courts: 2, tag: '10 LD' },
  { n: 11, style: 'vote', courts: 2, tag: '11 AM' },
  { n: 12, style: 'vote', courts: 2, tag: '12 vote' },
  { n: 8, style: 'americano', courts: 2, tag: '8 AM' },
  { n: 10, style: 'americano', courts: 2, tag: '10 AM' },
  { n: 12, style: 'americano', courts: 2, tag: '12 AM' },
];
const PACES: PaceName[] = (process.env.ZIP96_PACES ?? 'fast,normal,slow,mixed').split(',') as PaceName[];
const only = process.env.ZIP96_ONLY;
const out = process.env.ZIP96_OUT ?? '.data/zip96-audit.jsonl';
const rows: string[] = [];

describe.skipIf(!process.env.ZIP96_AUDIT)('🎾96 audit grid', () => {
  for (const c of CASES.filter((x) => !only || only.split(',').includes(x.tag)))
    it(c.tag, async () => {
      for (const pace of PACES)
        for (const accept of [true, false]) {
          const seed = c.n * 100 + PACES.indexOf(pace) * 10 + (accept ? 1 : 0);
          const { ctx, before } = await coldOpen({ n: c.n, style: c.style, courts: c.courts, log: [] });
          const lcBefore = (await dash(ctx)).levelCheck ?? null;
          const run = await playNight(ctx, pace, seed, accept);
          const d = await dash(ctx);
          const lc = d.levelCheck ?? null;
          const perRound = new Map<number, number>();
          for (const x of run.timeChecks) if (x.round !== null) perRound.set(x.round, (perRound.get(x.round) ?? 0) + 1);
          const row = {
            tag: c.tag,
            pace,
            accept,
            style: before.plan.style,
            plan: before.plan,
            roundsPlayed: run.roundsPlayed,
            games: span(run.games),
            sits: span(run.sits),
            offers: run.offers.map((o) => `${o.kind}@R${o.afterRound} ${clock(o.at)}${o.accepted ? ' ACC' : ' dec'}`),
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
            levelCheckBeforeEnd: lcBefore ? 'SHOWN' : 'none',
            levelCheck: lc ? lc.rows.map((r: { name: string; line: string }) => `${r.name} (${r.line})`) : [],
          };
          rows.push(JSON.stringify(row));
          console.log(
            `[audit] ${c.tag.padEnd(8)} ${pace.padEnd(6)} ${accept ? 'ACC' : 'DEC'} ${row.style} rounds ${before.plan.rounds}/${run.roundsPlayed} offers [${row.offers.join('; ')}] tc ${run.timeChecks.length} (max ${row.tcPerRoundMax}/round) plan ${row.plannedFinish} end ${row.finish} left ${row.left}${row.past10 ? ' PAST10' : ''}${row.idle ? ` IDLE ${row.idle}` : ''}${row.overlap ? ' OVERLAP' : ''}${run.stuck ? ` STUCK ${run.stuck}` : ''} End ${row.end} money ${run.money} LC-before ${row.levelCheckBeforeEnd} LC [${row.levelCheck.join('; ')}]${run.shortenedOnCourt.length ? ` SHORTENED-ON-COURT ${run.shortenedOnCourt.join(',')}` : ''}`,
          );
        }
    }, 3_600_000);
  it('writes', () => {
    mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(out, rows.join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });
});
