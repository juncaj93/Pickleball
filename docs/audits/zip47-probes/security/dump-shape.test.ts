// Zip 47 audit probe: prints the shape of a player's /api/group answer (keys only, plus one roster entry), to read what other players are shown.
import { it } from 'vitest';
import { firstSession, playerPhone, setupGroup } from '../../harness';

function keysOf(o: unknown, depth = 0, path = ''): string[] {
  if (!o || typeof o !== 'object' || depth > 4) return [];
  if (Array.isArray(o)) return o.length ? keysOf(o[0], depth + 1, path + '[]') : [];
  return Object.entries(o).flatMap(([k, v]) => [path + '.' + k, ...keysOf(v, depth + 1, path + '.' + k)]);
}

it('prints the player answer shape', async () => {
  const ctx = await setupGroup();
  const s = await firstSession(ctx);
  for (const n of ['Blair', 'Casey']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
  await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Casey, paid: true });
  const blair = await playerPhone(ctx, 'Blair');
  const r = await blair.call('GET', '/api/group');
  if (process.env.PROBE_PRINT) {
    console.log([...new Set(keysOf(r.data))].join('\n'));
    const sess = r.data.sessions?.find((x: any) => x.id === s.id);
    console.log(JSON.stringify(sess, null, 1).slice(0, 4000));
  }
});
