// The restore test's command: `npm run restore-test` (docs/RESTORE_TEST.md). Reads only; see scripts/restore-test.ts.
import { main } from './restore-test';

process.exitCode = await main(process.argv.slice(2));
