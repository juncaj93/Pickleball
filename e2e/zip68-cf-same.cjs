/* Zip 68, by hand: the organizer's dashboard and check from two PREVIEW addresses (main's code and this branch's) on the same fake database,
 * at each Tournament test stage, must be byte for byte the same once each address's own host name is blanked (the player links carry it)
 * and the moment each answer was made ("now").
 *   A=https://<main preview> B=https://<branch preview> PIN=<preview pin> STAGES=a,b node e2e/zip68-cf-same.cjs
 */
const { A, B, PIN } = process.env;
for (const x of [A, B]) if (!x || /pickleball\.juncaj\.net|^https:\/\/pickleball-club-9h0\.pages\.dev/.test(x)) throw new Error('A and B must be preview addresses');
const login = async (base) => {
  const r = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ pin: PIN }) });
  return r.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
};
(async () => {
  const ca = await login(A);
  const cb = await login(B);
  let bad = 0;
  for (const stage of (process.env.STAGES ?? 'tickets_open,all_locked,day_ready,mid').split(',')) {
    const s = await fetch(A + '/api/admin/tournament-test', { method: 'POST', headers: { Cookie: ca, Origin: A, 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
    if (!s.ok) throw new Error(stage + ' ' + s.status);
    for (const path of ['/api/admin/dashboard', '/api/admin/version']) {
      const ta = (await (await fetch(A + path, { headers: { Cookie: ca, Origin: A } })).text()).split(new URL(A).host).join('HOST');
      const tb = (await (await fetch(B + path, { headers: { Cookie: cb, Origin: B } })).text()).split(new URL(B).host).join('HOST');
      // The moment each answer was made (two requests are never the same millisecond).
      const blank = (t) => t.replace(/"now":"[^"]*"/g, '"now":"T"');
      const same = blank(ta) === blank(tb);
      if (!same) bad++;
      console.log(`${same ? '✓' : '✗'} ${stage} ${path}: ${ta.length} bytes${same ? ' the same' : ' DIFFERENT'}`);
    }
  }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
