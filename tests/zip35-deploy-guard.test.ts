// Zip 35 Part C (audit A-06 leftover): `npm run deploy` refuses unless it is main = GitHub's main, live is part of main, and it is not loud hours.
// Tooling only. Every check below runs on fake clocks and fake git facts: nothing is built, sent or read from the network.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decide, liveShaFromList, loudHours, main, nextQuiet } from '../scripts/deploy.mjs';

const at = (iso: string) => Date.parse(iso);
const HEAD = '60b446d220356631a455c187f65426e04eb8be32';
const OLD = '0eaa6d5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const QUIET = at('2026-11-11T17:00:00Z'); // Wed Nov 11, 12:00 PM EST
const good = { head: HEAD, remoteMain: HEAD, live: { relation: 'same' as const, sha: HEAD } };

describe('loud hours (Eastern): Mon and Wed from 6:00 PM through Tue and Thu 11:00 PM', () => {
  const loud = (iso: string) => loudHours(at(iso)).loud;
  it('Monday: quiet until 5:59 PM, loud from 6:00 PM (EST, week of Nov 9)', () => {
    expect(loud('2026-11-09T22:59:00Z')).toBe(false); // 5:59 PM
    expect(loud('2026-11-09T23:00:00Z')).toBe(true); // 6:00 PM
    expect(loud('2026-11-09T14:00:00Z')).toBe(false); // Monday 9:00 AM
  });
  it('Tuesday: loud all day, until 10:59 PM; 11:00 PM is quiet again', () => {
    expect(loud('2026-11-10T05:00:00Z')).toBe(true); // 12:00 AM Tue
    expect(loud('2026-11-10T13:00:00Z')).toBe(true); // 8:00 AM
    expect(loud('2026-11-11T03:59:00Z')).toBe(true); // 10:59 PM
    expect(loud('2026-11-11T04:00:00Z')).toBe(false); // 11:00 PM
  });
  it('Wednesday: quiet 11:00 PM Tuesday through 5:59 PM, loud from 6:00 PM', () => {
    expect(loud('2026-11-11T11:00:00Z')).toBe(false); // 6:00 AM
    expect(loud('2026-11-11T22:59:00Z')).toBe(false); // 5:59 PM
    expect(loud('2026-11-11T23:00:00Z')).toBe(true); // 6:00 PM
  });
  it('Thursday: loud all day, quiet from 11:00 PM; Friday to Sunday quiet', () => {
    expect(loud('2026-11-12T15:00:00Z')).toBe(true);
    expect(loud('2026-11-13T03:59:00Z')).toBe(true);
    expect(loud('2026-11-13T04:00:00Z')).toBe(false);
    for (const iso of ['2026-11-13T15:00:00Z', '2026-11-14T15:00:00Z', '2026-11-15T23:30:00Z']) expect(loud(iso)).toBe(false);
  });
  it('follows daylight saving: the week of Oct 26 is EDT (6:00 PM is 22:00 UTC)', () => {
    expect(loud('2026-10-26T21:59:00Z')).toBe(false);
    expect(loud('2026-10-26T22:00:00Z')).toBe(true);
  });
  it('the words and the next quiet time are Eastern with AM/PM', () => {
    expect(loudHours(at('2026-11-10T23:12:00Z')).label).toBe('Tuesday 6:12 PM Eastern');
    expect(nextQuiet(at('2026-11-10T23:12:00Z'))).toBe('Tuesday 11:00 PM Eastern');
    expect(nextQuiet(at('2026-11-11T23:30:00Z'))).toBe('Thursday 11:00 PM Eastern');
  });
});

describe('decide(): production rules, in order', () => {
  const git = { branch: 'main', dirty: false };
  it('all good: quiet hour, main = GitHub main = live', () => {
    expect(decide('production', git, { nowMs: QUIET, ...good })).toEqual({ ok: true, branch: 'main', notes: [`Live already equals main (60b446d). This deploy ships the same code again.`] });
  });
  it('not main / detached / unsaved changes: stopped by the old rules (branch, dirty), with or without checks', () => {
    expect(decide('production', { branch: 'x', dirty: false }, { nowMs: QUIET, ...good })).toMatchObject({ ok: false, rule: 'branch' });
    expect(decide('production', { branch: null, dirty: false }, { nowMs: QUIET, ...good })).toMatchObject({ ok: false, rule: 'branch' });
    expect(decide('production', { branch: 'main', dirty: true }, { nowMs: QUIET, ...good })).toMatchObject({ ok: false, rule: 'dirty' });
  });
  it('loud hours: refused, names the rule, the time, when it ends, and the override flag', () => {
    const r = decide('production', git, { nowMs: at('2026-11-10T23:12:00Z'), ...good });
    expect(r).toMatchObject({ ok: false, rule: 'loud' });
    expect(r.message).toMatch(/Tuesday 6:12 PM Eastern/);
    expect(r.message).toMatch(/Tuesday 11:00 PM Eastern/);
    expect(r.message).toMatch(/--override-loud-hours/);
    expect(r.message).toMatch(/texts the group/);
  });
  it('loud hours with the override flag: allowed, with a warning, and no other rule is skipped', () => {
    const r = decide('production', git, { nowMs: at('2026-11-10T23:12:00Z'), overrideLoud: true, ...good });
    expect(r.ok).toBe(true);
    expect(r.notes?.[0]).toMatch(/WARNING: loud hours/);
    expect(decide('production', git, { nowMs: at('2026-11-10T23:12:00Z'), overrideLoud: true, ...good, remoteMain: OLD })).toMatchObject({ ok: false, rule: 'github' });
    expect(decide('production', { branch: 'x', dirty: false }, { nowMs: at('2026-11-10T23:12:00Z'), overrideLoud: true, ...good })).toMatchObject({ ok: false, rule: 'branch' });
  });
  it("GitHub's main: different hash refused (both short hashes shown), unreadable refused", () => {
    const r = decide('production', git, { nowMs: QUIET, ...good, remoteMain: OLD });
    expect(r).toMatchObject({ ok: false, rule: 'github' });
    expect(r.message).toMatch(/60b446d/);
    expect(r.message).toMatch(/0eaa6d5/);
    expect(decide('production', git, { nowMs: QUIET, ...good, remoteMain: null })).toMatchObject({ ok: false, rule: 'github' });
  });
  it('live: behind main is allowed and lists exactly what the deploy ships; diverged and unknown are refused', () => {
    const behind = decide('production', git, { nowMs: QUIET, head: HEAD, remoteMain: HEAD, live: { relation: 'behind', sha: OLD, behind: 2, ships: ['60b446d Merge #128', '9b10cbf Merge main'] } });
    expect(behind.ok).toBe(true);
    expect(behind.notes?.[0]).toBe('Live (0eaa6d5) is 2 commits behind main. This deploy ships: 60b446d Merge #128; 9b10cbf Merge main.');
    const diverged = decide('production', git, { nowMs: QUIET, head: HEAD, remoteMain: HEAD, live: { relation: 'diverged', sha: OLD } });
    expect(diverged).toMatchObject({ ok: false, rule: 'live' });
    expect(diverged.message).toMatch(/NOT part of main/);
    const unknown = decide('production', git, { nowMs: QUIET, head: HEAD, remoteMain: HEAD, live: { relation: 'unknown' } });
    expect(unknown).toMatchObject({ ok: false, rule: 'live' });
    expect(unknown.message).toMatch(/could not tell what is live/);
    expect(decide('production', git, { nowMs: QUIET, head: HEAD, remoteMain: HEAD, live: { relation: 'unknown', sha: 'abcdef1' } }).message).toMatch(/git fetch origin/);
  });
  it('a preview is never touched by the new rules, loud hours or not', () => {
    expect(decide('preview', { branch: 'zip-35', dirty: false })).toEqual({ ok: true, branch: 'zip-35', warn: undefined });
    expect(decide('preview', { branch: 'zip-35', dirty: false }, { nowMs: at('2026-11-10T23:12:00Z') } as never).ok).toBe(true);
  });
});

describe('main(): the command, with fake git, fake clock, nothing built', () => {
  const run = (argv: string[], over: Parameters<typeof main>[1] = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const ran: string[] = [];
    const status = main(argv, {
      git: () => ({ branch: 'main', dirty: false }),
      network: () => good,
      now: () => QUIET,
      run: (cmd, a) => (ran.push(`${cmd} ${a.join(' ')}`), 0),
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      ...over,
    });
    return { status, out: out.join('\n'), err: err.join('\n'), ran };
  };
  it('quiet hour, everything matches: builds, then deploys with --branch main', () => {
    const r = run(['production']);
    expect(r.status).toBe(0);
    expect(r.ran).toEqual(['npm run build', 'npx wrangler pages deploy dist --project-name pickleball-club --branch main']);
  });
  it('--dry-run: same decision, nothing built', () => {
    const r = run(['production', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.ran).toEqual([]);
    expect(r.out).toContain('--branch main');
  });
  it('loud hours: exit 1, prints the rule, builds nothing, and never even reads the network', () => {
    let read = false;
    const r = run(['production'], { now: () => at('2026-11-12T15:00:00Z'), network: () => ((read = true), good) });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/Stopped by the "loud" rule/);
    expect(r.ran).toEqual([]);
    expect(read).toBe(false);
  });
  it('loud hours with --override-loud-hours: goes ahead and says so', () => {
    const r = run(['production', '--override-loud-hours'], { now: () => at('2026-11-12T15:00:00Z') });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/WARNING: loud hours/);
    expect(r.ran).toHaveLength(2);
  });
  it("main differs from GitHub's: exit 1, rule github, nothing built", () => {
    const r = run(['production'], { network: () => ({ ...good, remoteMain: OLD }) });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/Stopped by the "github" rule/);
    expect(r.ran).toEqual([]);
  });
  it('live on something main does not contain: exit 1, rule live', () => {
    const r = run(['production'], { network: () => ({ ...good, live: { relation: 'diverged', sha: OLD } }) });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/Stopped by the "live" rule/);
  });
  it('live behind main: prints what it ships, then deploys', () => {
    const r = run(['production'], { network: () => ({ ...good, live: { relation: 'behind', sha: OLD, behind: 1, ships: ['60b446d Merge #128'] } }) });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/1 commit behind main. This deploy ships: 60b446d Merge #128/);
  });
  it('a preview in the middle of loud hours is fine and reads no network', () => {
    let read = false;
    const r = run(['preview'], { git: () => ({ branch: 'claude/zip-35', dirty: true }), now: () => at('2026-11-12T15:00:00Z'), network: () => ((read = true), good) });
    expect(r.status).toBe(0);
    expect(read).toBe(false);
    expect(r.ran.at(-1)).toContain('--branch claude/zip-35 --commit-dirty=true');
  });
  it('a failed build stops before anything is sent', () => {
    const r = run(['production'], { run: (cmd) => (cmd === 'npm' ? 2 : 0) });
    expect(r.status).toBe(2);
  });
});

describe('reading what is live from `wrangler pages deployment list --json`', () => {
  const sample = `▲ [WARNING] Proxy environment variables detected. We'll use your proxy for fetch requests.\n\n\n[\n  { "Id": "a0f2", "Environment": "Production", "Branch": "main", "Source": "60b446d", "Status": "13 minutes ago" },\n  { "Id": "18582", "Environment": "Production", "Branch": "main", "Source": "0eaa6d5", "Status": "33 minutes ago" }\n]\n`;
  it('takes the newest Production deployment (the first one), skipping the warning lines', () => {
    expect(liveShaFromList(sample)).toBe('60b446d');
  });
  it('a preview-only list, junk, or nothing: null (then the guard says it cannot tell)', () => {
    expect(liveShaFromList('[{"Environment":"Preview","Source":"abc1234"}]')).toBeNull();
    expect(liveShaFromList('not json')).toBeNull();
    expect(liveShaFromList('')).toBeNull();
    expect(liveShaFromList('[{"Environment":"Production","Source":"nothex!"}]')).toBeNull();
  });
});

describe('wiring', () => {
  it('package.json still sends `npm run deploy` through the guard, and the docs say so', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')).scripts as Record<string, string>;
    expect(pkg.deploy).toBe('node scripts/deploy.mjs production');
    const doc = readFileSync(resolve(__dirname, '../docs/DEPLOY.md'), 'utf8');
    for (const word of ['loud hours', '--override-loud-hours', 'GitHub', 'Stopped by the', 'live']) expect(doc).toContain(word);
  });
});
