import { describe, expect, it } from 'vitest';
import { keyboardHeight } from '../src/keyboard';

describe('keyboardHeight: how much of the bottom of the page an on-screen keyboard covers', () => {
  it('no keyboard: the visible area is the whole page', () => {
    expect(keyboardHeight(700, 700, 0, 1)).toBe(0);
  });
  it('an iPhone keyboard shrinks the visible area, not the page', () => {
    expect(keyboardHeight(700, 400, 0, 1)).toBe(300);
  });
  it('the page scrolled up inside the visible area: the keyboard is what is left at the bottom', () => {
    expect(keyboardHeight(700, 380, 20, 1)).toBe(300);
  });
  it('a few pixels of difference (the browser bars) is not a keyboard', () => {
    expect(keyboardHeight(700, 660, 0, 1)).toBe(0);
    expect(keyboardHeight(700, 601, 0, 1)).toBe(0);
  });
  it('pinched in (zoomed) is not a keyboard', () => {
    expect(keyboardHeight(700, 300, 0, 2)).toBe(0);
  });
  it('never negative', () => {
    expect(keyboardHeight(700, 800, 0, 1)).toBe(0);
  });
});
