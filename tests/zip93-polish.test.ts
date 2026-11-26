import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { formatAlertWords } from '../shared/tournament';
import { monthCaps, skillsDates } from '../shared/skills';

// Zip 93 (🎾93.polish): the players' "scheduled" notice by day, the Skills dates, and the look rules the browser checks lean on
// (e2e/zip93.cjs measures the court tap areas, the banner buttons and the names in a real browser).

const DATE = '2026-11-12'; // Thu
const css = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

async function world() {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', { name: 'The Cold Open', dates: ['2026-11-10', DATE], ticketCents: 1600, creditCents: 1400, visibility: 'all', format: 'vote' });
  expect(created.status, created.text).toBe(200);
  const res = await (await playerPhone(base, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: created.data.id, level: 320, dates: [DATE], formatVote: 'locked' });
  expect(res.status, res.text).toBe(200);
  const fin = await base.organizer.call('PUT', `/api/admin/tournament/${created.data.id}/date`, { date: DATE });
  expect(fin.status, fin.text).toBe(200);
  return base;
}
const alertAt = async (ctx: Awaited<ReturnType<typeof world>>, iso: string) => {
  ctx.app.now = Date.parse(iso);
  return (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).data.tournament?.formatAlert ?? null;
};

describe('the scheduled notice by day (Eastern)', () => {
  it('the words: "is tomorrow." the day before, the same second line', () => {
    const later = formatAlertWords('The Cold Open', '2026-12-01', 'doubles', 'vote');
    const tomorrow = formatAlertWords('The Cold Open', '2026-12-01', 'doubles', 'vote', undefined, true);
    expect(later.title).toBe('The Cold Open is scheduled for Tue Dec 1.');
    expect(tomorrow).toEqual({ title: 'The Cold Open is tomorrow.', sub: later.sub });
  });
  it('two days out: scheduled; the day before (to 11:59 PM): tomorrow, same key; from midnight on the day: none', async () => {
    const ctx = await world();
    const two = await alertAt(ctx, '2026-11-10T17:00:00.000Z'); // Tue 12 PM EST
    expect(two.title).toBe('The Cold Open is scheduled for Thu Nov 12.');
    const before = await alertAt(ctx, '2026-11-11T05:01:00.000Z'); // Wed 12:01 AM
    expect(before.title).toBe('The Cold Open is tomorrow.');
    expect(before.sub).toBe(two.sub);
    expect(before.key).toBe(two.key); // closed with its X stays closed
    const late = await alertAt(ctx, '2026-11-12T04:59:00.000Z'); // Wed 11:59 PM
    expect(late.title).toBe('The Cold Open is tomorrow.');
    expect(await alertAt(ctx, '2026-11-12T05:00:30.000Z')).toBeNull(); // Thu 12:00 AM
    expect(await alertAt(ctx, '2026-11-12T23:00:00.000Z')).toBeNull(); // Thu 6 PM
  });
});

describe('Skills dates', () => {
  it('month only, in caps; the day too only for two in the same month', () => {
    expect(monthCaps('2026-08-03')).toBe('AUG');
    expect(monthCaps('2027-01-31')).toBe('JAN');
    const d = skillsDates(['2026-08-03', '2026-08-24', '2026-09-10', '2026-12-01']);
    expect(['2026-08-03', '2026-08-24', '2026-09-10', '2026-12-01'].map(d)).toEqual(['AUG 3', 'AUG 24', 'SEP', 'DEC']);
    expect(skillsDates(['2026-08-03'])('2026-08-03')).toBe('AUG');
    // The same date twice is one entry, not two.
    expect(skillsDates(['2026-08-03', '2026-08-03'])('2026-08-03')).toBe('AUG');
    // August of two different years: two months, the day stays off.
    expect(['2025-08-03', '2026-08-03'].map(skillsDates(['2025-08-03', '2026-08-03']))).toEqual(['AUG', 'AUG']);
  });
});

describe('the look rules', () => {
  it('the court picker: a tap area on every court in pick mode only (the players’ map has none)', () => {
    const s = css('src/gameday.css');
    expect(s).toMatch(/\.cm-pick button\.cm-cl::before \{\s*content: '';\s*position: absolute;/);
    expect(s).not.toMatch(/(^|\n)\.cm-cl::before/);
  });
  it('the Banner stays up buttons wrap instead of overlapping', () => {
    const s = css('src/pages/admin/tournament-end.css');
    expect(s).toMatch(/\.tm-awards-weeks \{\s*display: flex;\s*flex-wrap: wrap;/);
    expect(s).toMatch(/\.tm-awards-week \{\s*flex: 1 1 0;\s*min-width: max-content;/);
  });
  it('standings names: never overflow-wrap anywhere or break-word', () => {
    expect(css('src/pages/admin/standings-list.css')).not.toMatch(/overflow-wrap: anywhere/);
    expect(css('src/tournament/reveal.css')).toMatch(/\.tc-rv-name \{[^}]*overflow-wrap: normal;[^}]*text-overflow: ellipsis;/);
    expect(css('src/tournament/gameday-tour.css')).toMatch(/\.tc-gd-pname > b \{[^}]*overflow-wrap: normal;[^}]*text-overflow: ellipsis;/);
  });
  it('"adjusted by organizer": break-word, never anywhere', () => {
    expect(css('src/credit-player.css')).toMatch(/\.credit-adjusted,\s*\.pay-adjusted \{[^}]*overflow-wrap: break-word;/);
    expect(css('src/adjust-credit.css')).toMatch(/\.adj-entry \.adj-meta \{[^}]*overflow-wrap: break-word;/);
    for (const f of ['src/credit-admin.css', 'src/credit-history.css']) expect(css(f)).toMatch(/\.credit-history > li \{[^}]*overflow-wrap: break-word;/);
  });
  it('no court standby leftovers in the regular game screens', () => {
    for (const f of ['src/pages/PlayerHome.tsx', 'src/ui.tsx', 'src/pages/admin/CardR2.tsx', 'src/pages/admin/Sessions.tsx']) expect(css(f), f).not.toMatch(/standby|court_opened|venue-waitlist/i);
  });
});
