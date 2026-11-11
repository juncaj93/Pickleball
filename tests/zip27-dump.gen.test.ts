// Writes the Zip 27 world's money dump to ZIP27_DUMP_OUT (run on main and on the branch to compare). Skipped unless that is set.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { buildWorld, flipPriceRules, moneyDump } from './zip27-world';

it.skipIf(!process.env.ZIP27_DUMP_OUT)('write the zip27 money dump', async () => {
  const out: Record<string, unknown> = {};
  for (const bookingHours of [false, true]) {
    const w = await buildWorld({ bookingHours });
    const key = bookingHours ? 'booking hours on' : 'live switches';
    out[key] = await moneyDump(w);
    await flipPriceRules(w, { bookingHours });
    out[`${key}, then every price rule changed`] = await moneyDump(w);
  }
  writeFileSync(process.env.ZIP27_DUMP_OUT!, JSON.stringify(out, null, 1));
}, 240_000);
