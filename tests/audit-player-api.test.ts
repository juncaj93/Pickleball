import { it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
it('explore', async () => {
  const ctx = await setupGroup();
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  for (const s of d.sessions) console.log(s.startsAt, s.endsAt, s.cancellationDeadlineAt, s.bookingStatus, s.status);
  console.log(Object.keys(d), d.group.settings);
  const p = await playerPhone(ctx, 'Blair');
  const g = (await p.call('GET', '/api/group')).data;
  console.log(JSON.stringify(g).slice(0, 1500));
  console.log(g.sessions.length);
});
