// "Good news, a spot opened up, so you're in." shows only the first time (src/goodNews.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { _newVisitForTests, goodNewsKey, seeGoodNews } from '../src/goodNews';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    _m: m,
  };
}

const A = goodNewsKey('ryan', 'tue-nov-3', '2026-11-02T15:00:00.000Z');

describe('Good news note: first time only', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = fakeStorage();
    _newVisitForTests();
  });

  it('shows the first time, and keeps showing for the rest of that visit (5-second refresh, redraws)', () => {
    expect(seeGoodNews(A)).toBe(true);
    for (let i = 0; i < 20; i++) expect(seeGoodNews(A)).toBe(true);
  });

  it('never shows again after a reload or a later visit', () => {
    expect(seeGoodNews(A)).toBe(true);
    _newVisitForTests();
    expect(seeGoodNews(A)).toBe(false);
    _newVisitForTests();
    expect(seeGoodNews(A)).toBe(false);
  });

  it('a brand new promotion on a different game still shows once', () => {
    expect(seeGoodNews(A)).toBe(true);
    _newVisitForTests();
    const B = goodNewsKey('ryan', 'thu-nov-5', '2026-11-04T15:00:00.000Z');
    expect(seeGoodNews(A)).toBe(false);
    expect(seeGoodNews(B)).toBe(true);
    _newVisitForTests();
    expect(seeGoodNews(B)).toBe(false);
  });

  it('a new promotion on the same game later (dropped, waitlisted, moved in again) shows once more', () => {
    expect(seeGoodNews(A)).toBe(true);
    _newVisitForTests();
    expect(seeGoodNews(goodNewsKey('ryan', 'tue-nov-3', '2026-11-03T12:00:00.000Z'))).toBe(true);
  });

  it('another player on the same phone (not you?) sees their own promotion', () => {
    expect(seeGoodNews(A)).toBe(true);
    _newVisitForTests();
    expect(seeGoodNews(goodNewsKey('casey', 'tue-nov-3', '2026-11-02T15:00:00.000Z'))).toBe(true);
  });

  it('storage blocked (private mode): still shows once, no repeat while the page is open, never throws', () => {
    (globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(seeGoodNews(A)).toBe(true);
    expect(seeGoodNews(A)).toBe(true);
    const B = goodNewsKey('ryan', 'thu', 'x');
    expect(seeGoodNews(B)).toBe(true);
  });

  it('broken stored value is ignored, not a crash', () => {
    (globalThis as any).localStorage.setItem('pb_good_news_seen', '{not json');
    expect(seeGoodNews(A)).toBe(true);
    _newVisitForTests();
    expect(seeGoodNews(A)).toBe(false);
  });

  it('keeps the memory small (the oldest are forgotten first)', () => {
    for (let i = 0; i < 100; i++) seeGoodNews(goodNewsKey('p', `s${i}`, 't'));
    const saved = JSON.parse((globalThis as any).localStorage.getItem('pb_good_news_seen'));
    expect(saved.length).toBeLessThanOrEqual(60);
    expect(saved).toContain(goodNewsKey('p', 's99', 't'));
  });

  it('View as (demo): once per demo session, never saved to the phone, and a new demo session shows it again', () => {
    expect(seeGoodNews(A, 3)).toBe(true);
    expect(seeGoodNews(A, 3)).toBe(true); // same visit: stays
    expect((globalThis as any).localStorage.getItem('pb_good_news_seen')).toBeNull();
    // Same demo session, card drawn again after leaving and coming back to it in the page: the visit memory keeps it.
    // A new demo session (Exit, View as again): shows once more.
    expect(seeGoodNews(A, 4)).toBe(true);
    // Demo never uses up the real phone's memory.
    expect(seeGoodNews(A)).toBe(true);
  });
});
