import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL, SITE_NAME } from '../shared/settings';
import { firstSession, playerPhone, setupGroup } from './harness';

const ROOT = join(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', '.git', '.wrangler', 'screenshots', 'polish.test.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|cjs|js|html|css|json|webmanifest|md|sql|toml)$/.test(name) ? [p] : [];
  });
}

describe('the name is Pickleball Bros', () => {
  const all = files(ROOT).map((p) => ({ p, text: readFileSync(p, 'utf8') }));

  it('the old names appear nowhere in the code, pages or texts', () => {
    for (const { p, text } of all) {
      expect(text.includes('Detroit Pickle Alliance'), p).toBe(false);
      // "Northville Pickleball Club" is the venue and stays.
      expect(/(?<!Northville )Pickleball Club/.test(text), p).toBe(false);
    }
  });

  it('the browser tab, Home Screen icon, web app and share previews use it', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
    expect(SITE_NAME).toBe('Pickleball Bros');
    expect(html).toContain('<title>Pickleball Bros</title>');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Pickle Bros" />');
    expect(html).toContain('<meta property="og:title" content="Pickleball Bros" />');
    expect(manifest).toMatchObject({ name: 'Pickleball Bros', short_name: 'Pickle Bros' });
  });

  it('the calendar event is still called Pickleball', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const ics = (await ctx.app.client().call('GET', `/api/sessions/${s.id}/calendar.ics`)).text;
    expect(ics).toContain('SUMMARY:Pickleball\r\n');
  });

  it('the group name stays editable in Settings', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Pickleball Bros' });
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.group.name).toBe('Pickleball Bros');
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Pickle Bros' });
    expect((await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data.group.name).toBe('Pickle Bros');
  });
});

describe('CourtReserve', () => {
  it('every link goes to the booking page or the modify/cancel page', () => {
    expect(COURTRESERVE_BOOKING_URL).toBe('https://mobileapp.courtreserve.com/Online/Reservations/Bookings/13765?sId=19442');
    expect(COURTRESERVE_CANCEL_URL).toBe('https://mobileapp.courtreserve.com/Online/Bookings/List/13765?type=1');
    for (const p of files(ROOT)) {
      const text = readFileSync(p, 'utf8');
      const links = text.match(/https?:\/\/[a-z.]*courtreserve\.com[^\s'"`)<]*/g) ?? [];
      for (const l of links) expect([COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL], p).toContain(l);
    }
  });
});

describe('signing up never depends on the court', () => {
  it('players can join a session whose court is not booked yet', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const before = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id === s.id);
    expect(before.bookingStatus).toBe('needs_booking');
    const alex = await playerPhone(ctx, 'Alex');
    const view = (await alex.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(view).toMatchObject({ bookingStatus: 'needs_booking', joinAs: 'in' });
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'confirmed' });
  });
});
