// Independent review: with MONEY_REWORK off, nothing may read differently from main 4014f51.
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import type { ActivityEntry } from '../shared/api';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const entry = (action: string, details: Record<string, unknown> = {}): ActivityEntry =>
  ({ id: 'e1', actorLabel: 'organizer', action, details, sessionStartsAt: '2026-11-03T23:00:00.000Z', createdAt: '2026-11-03T12:00:00.000Z' }) as ActivityEntry;

describe('review: switch off reads exactly as main', () => {
  // Main had no case for these two actions, so the Activity page printed the generic "who: action name for day" line. The new
  // cases are not behind the switch (activityText gets no flag when the rework is off), so the old screen now words them differently.
  for (const action of ['payment_claim_confirmed', 'payment_claim_cleared']) {
    it(`OFF1 ${action} reads as it did on main when the rework is off`, () => {
      const e = entry(action, { player: 'Blair', playerId: 'p1', amountCents: 1400, reason: 'paid' });
      const generic = activityText(entry('zzz_qqq'), 'America/New_York', 'Alex').replace('zzz qqq', action.replace(/_/g, ' '));
      expect(activityText(e, 'America/New_York', 'Alex')).toBe(generic);
    });
  }
  it('OFF2 late_drop_done keeps writing the same log details as main ({}), switch off', async () => {
    const w = await setupGroup(new TestApp());
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    const s0 = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/booked`, {});
    await (await playerPhone(w, 'Blair')).call('POST', `/api/sessions/${s0.id}/join`, {});
    w.app.now = Date.parse(s0.startsAt) - 6 * HOUR;
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    await (await playerPhone(w, 'Blair')).call('POST', `/api/sessions/${s0.id}/withdraw`, {});
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/late-drop-done`, { playerId: w.byName.Blair });
    expect(r.status, r.text).toBe(200);
    const row = w.app.db.raw.prepare("SELECT details_json FROM admin_audit_log WHERE action = 'late_drop_done'").get() as { details_json: string };
    expect(JSON.parse(row.details_json)).toEqual({});
  });
  it('OFF3 off: the Activity text for late_drop_done is still the old sentence even though the log now has a name', () => {
    const e = entry('late_drop_done', { player: 'Blair', playerId: 'p1' });
    expect(activityText(e, 'America/New_York', 'Alex')).toBe('Alex handled a late drop for Tue, Nov 3');
  });
});
