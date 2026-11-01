// FIXED Nov 1 in the page (src/pages/PlayerHome.tsx): View as never writes, reads, sends or clears the phone's real
// drop note (sendDropsBeforeJoin and look() return in a demo; dropOut writes no note in a demo). These tests show why:
// the pure decisions alone would send or forget. The browser check is in e2e/audit-player-flows.cjs.
// Fresh auditor D (Nov 1, 2026): code-reading pass on today's player-side changes. Scratch proofs only.
// The drop note (localStorage 'pb_pending_drop') is one key shared by the organizer's View as (demo copy) and the
// live player page on the same browser. The demo copy is a full copy of the live rows (same ids, same sign-up times),
// so a note written in View as cannot be told apart from a live one, and the reverse.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { createSandbox, type Sandbox } from '../src/demo/sandbox';
import { noteStillApplies, pendingDropAction } from '../src/hold';
import { ORIGIN, firstSession, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const migrations = () => readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join('migrations', f), 'utf8'));
async function demo(ctx: Ctx): Promise<Sandbox> {
  const backup = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
  return createSandbox(await initSqlJs(), backup, migrations(), ORIGIN);
}
async function demoGroup(sb: Sandbox, ctx: Ctx, viewAs: string) {
  const res = await sb.request('GET', '/api/group', undefined, { 'X-View-As': ctx.byName[viewAs] }, ctx.app.now);
  return res.json() as Promise<any>;
}

describe('fresh D: a View as drop note is finished on the LIVE site', () => {
  it('Alex (organizer and player) views as Alex, taps Drop out, closes the tab within 5 s; his live page then drops him for real', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    // View as Alex: the screen (demo copy) is what dropOut reads for the note.
    const sb = await demo(ctx);
    const shown = await demoGroup(sb, ctx, 'Alex');
    const mine = shown.sessions.find((x: any) => x.id === s.id).mine;
    // Exactly what ScheduleRow.dropOut writes (PlayerHome.tsx ~1344), with no demo marker.
    const note = { sessionId: s.id, at: Date.now() - 20_000, playerId: shown.me.id, signupAt: mine.signupAt };
    // The demo send never finished (pagehide; the copy answers after crypto.subtle), so the note stays.
    // Within 2 minutes Alex opens his real player link on the same browser: look() checks it against LIVE data.
    const live = (await alex.call('GET', '/api/group')).data;
    expect(noteStillApplies(note, live)).toBe(true);
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, live), () => false)).toEqual({ do: 'send', sessionId: s.id });
    // ...which is a real withdraw on the live site.
    expect((await alex.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    const after = (await alex.call('GET', '/api/group')).data;
    expect(after.sessions.find((x: any) => x.id === s.id).mine.status).toBe('withdrawn');
  });
});

describe('fresh D: a LIVE drop note is thrown away by I\'m in inside View as', () => {
  it('Alex drops on his live page with no signal (note kept), then in View as Blair taps I\'m in: the note is forgotten, the drop never happens', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    const g = (await alex.call('GET', '/api/group')).data;
    const note = { sessionId: s.id, at: Date.now() - 20_000, playerId: g.me.id, signupAt: g.sessions.find((x: any) => x.id === s.id).mine.signupAt };
    // sendDropsBeforeJoin in View as: GET /api/group goes to the demo copy as Blair.
    const sb = await demo(ctx);
    const fresh = await demoGroup(sb, ctx, 'Blair');
    expect(pendingDropAction(note, Date.now(), () => true, () => false)).toEqual({ do: 'send', sessionId: s.id });
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, fresh), () => false)).toEqual({ do: 'forget' });
    // storageRemove(PENDING_DROP_KEY) follows; Alex is still IN on the live site and owes for a game he dropped.
    const live = (await alex.call('GET', '/api/group')).data;
    expect(live.sessions.find((x: any) => x.id === s.id).mine.status).toBe('confirmed');
  });
});
