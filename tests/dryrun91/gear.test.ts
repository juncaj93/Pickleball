import { it } from 'vitest';
import { adminTour, coldOpen, moneyCheck, potOf, PAY_BY_MS } from './coldOpen';
// Gear sheet saves AFTER people paid: ticket price, style, Pay by, courts, expected; money to the cent after each.
it('gear after paid', async () => {
  const { ctx } = await coldOpen({ n: 10, style: 'vote', courts: 2, log: [], stopAfterPay: true });
  const pots = () => ctx.names.map((n) => potOf(ctx, n)).join(',');
  const t = await adminTour(ctx);
  const base = { name: t.name, dates: t.offeredDates, ticketCents: t.ticketCents, creditCents: t.championCreditCents, visibility: t.visibility };
  const log = (what: string, r: any) => console.log(`[gear] ${what}: ${r.status} ${String(r.data?.message ?? r.data?.error ?? (r.data?.ok ? 'ok' : '')).slice(0, 120)} | money ${moneyCheck(ctx)}`);
  const p0 = pots();
  log('price 18 -> 20', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...base, ticketCents: 2000 }));
  log('price 18 -> 15', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...base, ticketCents: 1500 }));
  log('style -> americano', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...base, format: 'americano' }));
  const t2 = await adminTour(ctx);
  console.log('[gear] now format', t2.format, 'ticket', t2.ticketCents, 'pots same', pots() === p0);
  log('style -> doubles', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...base, format: 'doubles' }));
  log('pay by -> Mon 9 PM', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: '2026-12-01T02:00:00.000Z' }));
  log('pay by -> Sun 7 PM', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: '2026-11-30T00:00:00.000Z' }));
  log('plan expect 12 courts 2', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 12, courts: 2 }));
  log('time 7:00-9:30', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 19 * 60, minutes: 150 }));
  log('time back 7:30-10', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 19 * 60 + 30, minutes: 150 }));
  log('visibility me', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...base, visibility: 'me' }));
  log('name', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...base, name: 'The Cold Open 2' }));
  const t3 = await adminTour(ctx);
  console.log('[gear] end: format', t3.format, 'ticket', t3.ticketCents, 'payBy', t3.payBy, 'pots same', pots() === p0, 'money', JSON.stringify(t3.money));
  ctx.app.now = PAY_BY_MS + 3 * 3600_000;
  log('price after Pay by', await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...base, name: 'The Cold Open 2', ticketCents: 2000 }));
});
