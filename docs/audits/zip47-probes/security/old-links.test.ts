// Zip 47 audit probe (security): the removed personal-link routes (Zip 44), the old calendar feed, and the two signed-token pages
// (/go/ and /gt/) answer nothing useful to someone without a real token. In-memory only.
import { describe, expect, it } from 'vitest';
import { routeList } from '../../../server/app';
import { firstSession, setupGroup } from '../../harness';
import { makeGoToken } from '../../../server/go';
import { makeGdtToken } from '../../../server/gameDayText';

describe('Zip 47 probe: old and token addresses', () => {
  it('the removed /api/link routes and the organizer "links" route are gone for everyone, organizer included', async () => {
    const w = await setupGroup();
    const s = await firstSession(w);
    expect(routeList().some((r) => /\/api\/link|\/links$|\/api\/t\//.test(r.path))).toBe(false);
    for (const who of [w.app.client(), w.organizer]) {
      for (const [m, p] of [
        ['POST', '/api/link'],
        ['POST', '/api/link/act'],
        ['GET', '/api/link'],
        ['POST', `/api/admin/sessions/${s.id}/links`],
        ['GET', '/api/t/abc'],
        ['POST', '/api/t/abc'],
      ] as const) {
        const r = await who.call(m, p, m === 'POST' ? { token: 'abc', action: 'join' } : undefined);
        expect(r.status, `${m} ${p}`).toBe(404);
      }
    }
    // Nothing ever writes the old token table again.
    const n = w.app.db.raw.prepare('SELECT COUNT(*) AS n FROM session_action_tokens').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('the old calendar feed answers a plain Not found', async () => {
    const w = await setupGroup();
    const r = await w.app.client().call('GET', '/api/cal/anything');
    expect(r.status).toBe(404);
    expect(r.text).toBe('Not found');
  });

  it('/api/go and /api/gdt: no secret, a forged token, a token for the other page, or "preview" on live all say the link does not work', async () => {
    const w = await setupGroup();
    const s = await firstSession(w);
    await w.organizer.call('PUT', '/api/admin/game-day-text-switch', { on: true });
    const anon = w.app.client();
    // No CRON_SECRET: nothing works.
    expect((await anon.call('POST', '/api/go', { token: 'a.b' })).status).toBe(404);
    expect((await anon.call('POST', '/api/gdt', { token: 'a.b' })).status).toBe(404);
    w.app.env.CRON_SECRET = 'probe-cron-secret-0123456789';
    w.app.env.GO_LINKS = 'on';
    // A token signed with another secret.
    const forged = await makeGdtToken('some-other-secret-0123456789', s.id, s.endsAt);
    expect((await anon.call('POST', '/api/gdt', { token: forged })).status).toBe(404);
    // A real /go/ token is refused by /gt/ (its own purpose word), and the other way round.
    const go = await makeGoToken(w.app.env.CRON_SECRET, s.id, s.startsAt, w.app.now);
    const gdt = await makeGdtToken(w.app.env.CRON_SECRET, s.id, s.endsAt);
    expect((await anon.call('POST', '/api/gdt', { token: go })).status).toBe(404);
    expect((await anon.call('POST', '/api/go', { token: gdt })).status).toBe(404);
    // "preview" only works where the preview-only variable is set.
    expect((await anon.call('POST', '/api/gdt', { token: 'preview' })).status).toBe(404);
    // The real /gt/ token does give the phone numbers (by design: it only goes to the organizer's Telegram, and ends with the game).
    const real = await anon.call('POST', '/api/gdt', { token: gdt });
    expect(real.status).toBe(200);
    // The real /go/ token gives only the words of the group text, no phone number.
    const goRes = await anon.call('POST', '/api/go', { token: go });
    expect(goRes.status).toBe(200);
    expect(goRes.text).not.toMatch(/555/);
    // After the game ends, the /gt/ token is dead.
    w.app.now = Date.parse(s.endsAt) + 1000;
    expect((await anon.call('POST', '/api/gdt', { token: gdt })).status).toBe(410);
  });
});
