import { it } from 'vitest';
import { coldOpen, dash } from './coldOpen';
import { playerPhone } from '../harness';
it('odd switch words', async () => {
  const { ctx } = await coldOpen({ n: 9, style: 'vote', courts: 2, log: [] });
  const g = (await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group')).data;
  const t = g.tournament;
  console.log('PCARD', JSON.stringify({ format: t.format, formatAlert: t.formatAlert, styleBanner: t.styleBanner, banner: t.banner, styleLine: t.styleLine, alerts: g.alerts?.filter?.((a: any) => /Americano|style|switch/i.test(JSON.stringify(a))) }).slice(0, 900));
  const words = JSON.stringify(t).match(/[^"]*(Americano|odd)[^"]*/g);
  console.log('PWORDS', JSON.stringify([...new Set(words)]).slice(0, 900));
  const d = await dash(ctx);
  const aw = JSON.stringify(d.tournament).match(/[^"]*(Americano|odd number)[^"]*/g);
  console.log('AWORDS', JSON.stringify([...new Set(aw)]).slice(0, 600));
  const act = (await ctx.organizer.call('GET', '/api/admin/activity')).data;
  console.log('ACT', JSON.stringify(act).match(/[^"]*(Americano|odd)[^"]*/g)?.slice(0, 5));
  const tg = ctx.app.db.raw.prepare("SELECT task, kind, detail FROM task_log WHERE detail LIKE '%Americano%' OR task LIKE '%odd%' LIMIT 5").all();
  console.log('TASK', JSON.stringify(tg).slice(0, 400));
});
