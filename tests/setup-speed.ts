// Zip 12: `PB_SPEED_FORCE=1 npx vitest run` runs EVERY test with SPEED_FEWER_QUERIES on for every request (server/speed.ts
// reads this flag; it never exists on Cloudflare). Same tests, same expected answers: the proof that the switch changes no answer.
if (process.env.PB_SPEED_FORCE === '1') (globalThis as { __PB_SPEED_FORCE?: boolean }).__PB_SPEED_FORCE = true;
