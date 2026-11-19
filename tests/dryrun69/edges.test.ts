import { describe, expect, it } from 'vitest';
import { adminTour, books, card, confirmPaid, DATE, dump, finalize, games, giveCredit, group, liveLike, lockIn, MIN, NAMES, PAY_BY_MS, phone, play, potOf, START_MS, signUp, teams, tickets, tourLedger , snap } from './world69';
import { withoutIds } from '../harness';

const EIGHT = NAMES.slice(0, 8);
const pots = (w: any, names: string[]) => Object.fromEntries(names.map((n) => [n, potOf(w, n)]));

describe('Edge cases', () => {
  it('missed the date: I\'m in and Can\'t make it', async () => {
    const w = await liveLike();
    await signUp(w, EIGHT, { missDate: ['Reese', 'Quinn'] });
    await finalize(w);
    const r = await card(w, 'Reese');
    dump('D-missed-card', r);
    snap(w, 'D1-missed-date');
    // I'm in: the picked date goes on, then Lock.
    const put = await (await phone(w, 'Reese')).call('PUT', '/api/tournament/signup', { tournamentId: w.tid, dates: [DATE] });
    dump('D-missed-put', { status: put.status, data: put.data });
    expect(put.status, put.text).toBe(200);
    const lk = await lockIn(w, 'Reese');
    dump('D-missed-lock', lk);
    dump('D-missed-card-after', await card(w, 'Reese'));
    // Can't make it: back out.
    const bo = await (await phone(w, 'Quinn')).call('POST', '/api/tournament/back-out', { tournamentId: w.tid });
    dump('D-cant-make-it', { status: bo.status, data: bo.data });
    expect(bo.status).toBe(200);
    books(w);
  });

  it('late joiner after Pay by; drop out before and after Pay by; I paid waiting then drop', async () => {
    const w = await liveLike();
    await signUp(w, EIGHT);
    await finalize(w);
    for (const [n, c] of Object.entries({ Vic: 1800, Parker: 1000, Rowan: 2000 })) await giveCredit(w, n, c);
    for (const n of EIGHT) await lockIn(w, n);
    for (const n of ['Parker', 'Zoe', 'Wren', 'Quinn']) await confirmPaid(w, n); // Reese's I paid still waits.
    const p0 = pots(w, EIGHT);
    // Drop out before Pay by: Vic (all credit), Parker (part credit, part cash), Reese (I paid waiting).
    const out: Record<string, unknown> = {};
    for (const n of ['Vic', 'Parker', 'Reese']) out[n] = (await (await phone(w, n)).call('POST', '/api/tournament/back-out', { tournamentId: w.tid })).data;
    dump('D-drop-before', { out, before: p0, after: pots(w, EIGHT), tickets: tickets(w) });
    dump('D-admin-after-drops', (({ tickets, cost, lockedIn }) => ({ tickets, cost, lockedIn }))(await adminTour(w)));
    // The organizer answers Reese's I paid after she left: it comes back as credit.
    const rc = await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/ticket`, { playerId: w.byName['Reese'], action: 'confirm' });
    dump('D-confirm-after-drop', { status: rc.status, data: rc.data, reese: potOf(w, 'Reese') });
    books(w, 'after drops');
    // Late joiner after Pay by: a brand-new sign up (Sage), and Christopher signed up earlier but never paid.
    w.app.now = PAY_BY_MS + 30 * MIN;
    const s = await (await phone(w, 'Sage')).call('POST', '/api/tournament/signup', { tournamentId: w.tid, level: 300, dates: [DATE], formatVote: 'either' });
    dump('D-late-signup', { status: s.status, data: s.data });
    if (s.status === 200) dump('D-late-lock', await lockIn(w, 'Sage'));
    dump('D-sage-card', await card(w, 'Sage'));
    // Drop out after Pay by: Wren (cash) gets credit back.
    const pw = potOf(w, 'Wren');
    const bw = await (await phone(w, 'Wren')).call('POST', '/api/tournament/back-out', { tournamentId: w.tid });
    dump('D-drop-after', { status: bw.status, data: bw.data, before: pw, after: potOf(w, 'Wren') });
    // 3 hours before the start: tickets closed, no drop.
    w.app.now = START_MS - 3 * 60 * MIN + MIN;
    const late = await (await phone(w, 'Zoe')).call('POST', '/api/tournament/back-out', { tournamentId: w.tid });
    const lateLock = await (await phone(w, 'Christopher Vanderberg')).call('POST', '/api/tournament/lock', { tournamentId: w.tid, intent: 'lock', priceCents: 1800 });
    dump('D-last-3-hours', { drop: [late.status, late.data], lock: [lateLock.status, lateLock.data] });
    dump('D-admin-final', (({ tickets, cost, lockedIn, format, oddSwitch }) => ({ tickets, cost, lockedIn, format, oddSwitch }))(await adminTour(w)));
    dump('D-ledger', tourLedger(w));
    books(w, 'end');
  });

  it('reschedule, then cancel: everything back as credit', async () => {
    const w = await liveLike();
    await signUp(w, EIGHT);
    await finalize(w);
    for (const [n, c] of Object.entries({ Vic: 1800, Parker: 1000 })) await giveCredit(w, n, c);
    for (const n of EIGHT) await lockIn(w, n);
    for (const n of ['Parker', 'Rowan', 'Zoe']) await confirmPaid(w, n); // Wren, Quinn, Reese: I paid waiting
    const p0 = pots(w, EIGHT);
    const rs = await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/reschedule`, {});
    dump('D-reschedule', { status: rs.status, data: rs.data, tickets: tickets(w) });
    dump('D-vic-rescheduled', await card(w, 'Vic'));
    dump('D-admin-rescheduled', (({ status, tickets, signups }) => ({ status, tickets, signups: signups?.map((s: any) => [s.name, s.dates]) }))(await adminTour(w)));
    const cx = await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/cancel`, {});
    dump('D-cancel', { status: cx.status, data: cx.data, before: p0, after: pots(w, EIGHT), tickets: tickets(w) });
    // The I paids still waiting after the cancel: Alex answers them.
    for (const n of ['Wren', 'Quinn']) dump(`D-cancel-confirm-${n}`, (await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/ticket`, { playerId: w.byName[n], action: 'confirm' })).data);
    dump('D-cancel-reject-Reese', (await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/ticket`, { playerId: w.byName['Reese'], action: 'reject' })).data);
    dump('D-after-cancel', { pots: pots(w, EIGHT), tickets: tickets(w), vic: await card(w, 'Vic') });
    books(w, 'after cancel');
  });

  it('Only me and a phone with no name get nothing', async () => {
    const w = await liveLike();
    await signUp(w, EIGHT);
    await finalize(w);
    for (const n of EIGHT) await lockIn(w, n);
    const vis = await w.organizer.call('PUT', `/api/admin/tournament/${w.tid}/visibility`, { visibility: 'me' });
    dump('D-only-me', { status: vis.status, data: vis.data });
    const g = await group(w, 'Vic');
    const txt = withoutIds(JSON.stringify(g));
    dump('D-only-me-vic-keys', { keys: Object.keys(g), hasTour: /Cold Open|tournament/i.test(txt) });
    const lk = await (await phone(w, 'Vic')).call('POST', '/api/tournament/lock', { tournamentId: w.tid, intent: 'lock', priceCents: 1800 });
    dump('D-only-me-lock', { status: lk.status, data: lk.data });
    // Back to everyone; now a phone with no name.
    await w.organizer.call('PUT', `/api/admin/tournament/${w.tid}/visibility`, { visibility: 'all' });
    const anon = w.app.client();
    anon.groupKey = w.groupKey;
    const a = await anon.call('GET', '/api/group');
    const atxt = withoutIds(a.text);
    dump('D-anon', { status: a.status, keys: Object.keys(a.data), group: a.data.group, hasTour: /Cold Open|"tournament"/i.test(atxt), hasZelle: /zelle/i.test(atxt), hasVenmo: /venmo/i.test(atxt) });
    const al = await anon.call('POST', '/api/tournament/lock', { tournamentId: w.tid, intent: 'lock', priceCents: 1800 });
    dump('D-anon-lock', { status: al.status, data: al.data });
  });

  it('refresh mid action and two phones on one result', async () => {
    const w = await liveLike();
    await signUp(w, EIGHT);
    await finalize(w);
    await giveCredit(w, 'Vic', 1000);
    // Two phones (or a refresh) tap Lock at once: credit used once.
    const v1 = await phone(w, 'Vic');
    const v2 = w.app.client();
    v2.groupKey = w.groupKey;
    await v2.call('POST', '/api/me', { playerId: w.byName['Vic'] });
    const [l1, l2] = await Promise.all([
      v1.call('POST', '/api/tournament/lock', { tournamentId: w.tid, intent: 'lock', priceCents: 1800 }),
      v2.call('POST', '/api/tournament/lock', { tournamentId: w.tid, intent: 'lock', priceCents: 1800 }),
    ]);
    const [p1, p2] = await Promise.all([v1.call('POST', '/api/tournament/paid', { tournamentId: w.tid, cents: 800 }), v2.call('POST', '/api/tournament/paid', { tournamentId: w.tid, cents: 800 })]);
    dump('D-double-lock', { l1: [l1.status, l1.data], l2: [l2.status, l2.data], p1: [p1.status, p1.data], p2: [p2.status, p2.data], pot: potOf(w, 'Vic'), tickets: tickets(w).filter((k) => k.name === 'Vic') });
    // Alex confirms twice at once.
    const [c1, c2] = await Promise.all([
      w.organizer.call('POST', `/api/admin/tournament/${w.tid}/ticket`, { playerId: w.byName['Vic'], action: 'confirm' }),
      w.organizer.call('POST', `/api/admin/tournament/${w.tid}/ticket`, { playerId: w.byName['Vic'], action: 'confirm' }),
    ]);
    dump('D-double-confirm', { c1: [c1.status, c1.data], c2: [c2.status, c2.data], tickets: tickets(w).filter((k) => k.name === 'Vic') });
    for (const n of EIGHT.filter((n) => n !== 'Vic')) {
      await lockIn(w, n);
      if (n !== 'Alex') await confirmPaid(w, n);
    }
    books(w);
    w.app.now = PAY_BY_MS + MIN;
    await teams(w, { action: 'draft' });
    await teams(w, { action: 'publish' });
    w.app.now = START_MS + 2 * MIN;
    const d = (await adminTour(w)).day;
    const g = d.games[0];
    const pa = d.teams.find((t: any) => t.seat === g.a.seat).players.map((p: any) => p.name);
    const pb = d.teams.find((t: any) => t.seat === g.b.seat).players.map((p: any) => p.name);
    // Both teams tap We won at the same moment.
    const [x, y] = await Promise.all([play(w, pa[0], g.num, 'won'), play(w, pb[0], g.num, 'won')]);
    const after = (await adminTour(w)).day.games.find((q: any) => q.num === g.num);
    dump('D-both-won', { x: [x.status, x.data], y: [y.status, y.data], game: after });
    // Partners on two phones: one taps We won, the other the loss.
    const g2 = d.games[1];
    const qa = d.teams.find((t: any) => t.seat === g2.a.seat).players.map((p: any) => p.name);
    const [m, n] = await Promise.all([play(w, qa[0], g2.num, 'won'), play(w, qa[1], g2.num, 'lost')]);
    dump('D-partners-disagree', { m: [m.status, m.data], n: [n.status, n.data], game: (await adminTour(w)).day.games.find((q: any) => q.num === g2.num) });
    // Organizer Fix at the same time as a player's confirm.
    const [f, c] = await Promise.all([games(w, { action: 'result', num: g.num, winner: 'b', seen: { claim: after.claim ?? null, winner: after.winner ?? null } }), play(w, pa[1], g.num, 'confirm')]);
    dump('D-fix-vs-confirm', { f: [f.status, f.data], c: [c.status, c.data], game: (await adminTour(w)).day.games.find((q: any) => q.num === g.num) });
  });
});
