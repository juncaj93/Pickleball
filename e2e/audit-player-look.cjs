/* Player screens: how they LOOK and how accessible they are (audit, Nov 1, 2026).
 * Real browser, fake group, fake clock. Nothing is changed in the product; this only looks.
 *
 *   node e2e/audit-player-look.cjs
 *
 * At 320 px and 390 px, light and dark, for ten fake players who between them have every card state:
 *   - tiers THIS WEEK / NEXT WEEK / LATER with 0, 1, 2 and many games; All games / My games; More sessions;
 *     a game tonight (TONIGHT strip), one that started 5 minutes ago, one that finished (and was finalized),
 *     canceled with a reason ("Canceled - Thanksgiving"), with a 40-character reason and with none; extra games
 *     with a note; court booked, not booked and on the venue's Waitlist (players must read "Court not booked")
 *   - every payment state: $14 due + Pay (+ I paid after Pay was tapped, or with no Venmo), Paid $14 + Didn't pay?,
 *     Paid with credit + Undo, part credit, "$14 due · $9 credit" + Use credit, Use $9 credit on a no-court game,
 *     waitlist 2nd in line, canceled, finalized (final price), the game-day Pay card, the CREDIT chip and its
 *     sheet, the CASH OUT chip
 *   - every card offers a way forward
 *   - no sideways scroll, nothing overlapping or cut off, 44 x 44 px real tap areas (measured with
 *     elementFromPoint, so ::before-extended links count), contrast 4.5:1 (3:1 for large text), big text,
 *     even spacing between cards
 *   - accessible names, keyboard Tab order and visible focus, dialogs (Drop out, credit sheet) keep focus,
 *     close with Escape and give focus back, reduce motion
 * Checks named "BUG: ..." are real defects found by this audit and are left failing on purpose (Nov 1, 2026):
 *   - calendar icon tap area 38 x 44 px (player-cards.css .schedule .sched-status .cal-icon-link, 24 px wide + 7 px ::before)
 *   - the bottom 1.5 px of Pay / Use credit / I paid belongs to the Drop out link under it (its 44 px ::before)
 *   - canceled cards at opacity 0.7: "Canceled - Thanksgiving" 3.59:1 in light, "THU" 3.11:1 / 3.84:1
 *   - dark mode CREDIT word on the header chip 3.1:1 (--primary #237a52 on #18221c)
 *   - the player's own name in the header breaks mid-word ("Bartholo / mew...") with the CREDIT chip
 *   - big text: the "$14 due · $9 credit" chip and "Court not booked" + calendar run past the card, LATER rows squeeze
 *     names to one letter per line, header name / chip / date square text spills
 * The group name over the player's name ending in "..." on a tight header is deliberate (CSS ellipsis) and allowed.
 * Screenshots go to LOOK_SHOTS (default: this session's scratch folder), never into the repo.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5302;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'audit-look-setup-token-0123456789';
const PIN = '482913';
const SHOTS = process.env.LOOK_SHOTS || '/tmp/claude-0/-home-user-Pickleball/e0c6a0ef-bae9-52e2-8eac-04a320380c11/scratchpad/look';
const BMS = 'Bartholomew Montgomery-Smythe';
const ZOE = 'Zoë 🏓';
const FILL = ['Fa', 'Fb', 'Fc', 'Fd', 'Fe', 'Ff', 'Fg', 'Fh'];
const NAMES = ['Alex', 'Ryan', 'Wren', 'Zed', 'Pia', 'Dana', 'Sam', 'Nathan', 'Mitchel', 'Brandon', 'Julian', 'Quinn', ZOE, "D'Angelo", BMS, 'Bartholomew Montgomery', ...FILL];
const VIEWERS = ['Ryan', 'Wren', 'Zed', 'Sam', 'Pia', 'Dana', BMS, ZOE, 'Nathan', 'Quinn'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const REASON_40 = 'Venue closed: regional tournament finals';
const NOTE = 'New spot: east courts 5 and 6. Park by the tennis bubble, walk in the side door';
const at = (s) => Date.parse(s);

let passed = 0;
let failed = 0;
let openCount = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    // "OPEN: ..." are known defects left for later (docs/AUDIT_SCENARIOS_player.md says why): reported, not failing the run.
    if (name.startsWith('OPEN: ')) {
      openCount++;
      console.log(`  ○ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 300)}`);
      return;
    }
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 900)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ in-page measuring ------------------------------------------------------------------ */

/** Layout facts of the whole player screen: cards, header, pay card, tiers, gaps, things past the screen edge or clipped. */
function collectFacts() {
  const vis = (el) => el && el.checkVisibility({ opacityProperty: false, visibilityProperty: true }) && el.getBoundingClientRect().width > 0 && !el.closest('.sr-only, dialog');
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top + scrollY, b: r.bottom + scrollY, w: r.width, h: r.height };
  };
  const label = (el) => squash(el.getAttribute('aria-label') || el.textContent).slice(0, 40);
  function squash(t) {
    return String(t || '').replace(/\s+/g, ' ').trim();
  }
  const vw = innerWidth;
  const offScreen = [...document.querySelectorAll('header *, main *')]
    .filter((e) => vis(e) && !e.closest('.chip-credit') && e.tagName !== 'path')
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.right > vw + 0.5 || r.left < -0.5;
    })
    .map((e) => `${e.tagName.toLowerCase()}.${String(e.className.baseVal ?? e.className).split(' ')[0]} "${label(e)}" ${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)}`);
  // Text that is clipped: an element that hides overflow (or ellipsis / line clamp) and has more inside than it shows.
  const clipped = (root) =>
    [...root.querySelectorAll('*')]
      .filter((e) => vis(e) && !e.closest('.cc-ghost') && !e.matches('.chip-credit, svg, svg *'))
      .filter((e) => {
        const cs = getComputedStyle(e);
        const hides = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
        if (!hides) return false;
        if (!e.textContent.trim()) return false;
        return e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1;
      })
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${label(e)}" (${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight})`);

  // A line break inside a word ("Wre / n"): the characters' own boxes jump to a new line with no space, hyphen or comma between.
  const midWord = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      // One text node at a time: a break between two elements (name, then ", ") is a normal wrap.
      let prev = null;
      if (n.parentElement.closest('.sr-only')) continue;
      const text = n.textContent;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (/\s/.test(ch)) {
          prev = null;
          continue;
        }
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const rects = r.getClientRects();
        if (!rects.length) continue;
        const top = rects[0].top;
        if (prev && top > prev.top + 2 && !/[-,·/]/.test(prev.ch) && !/[\ud800-\udfff]/.test(ch)) out.push(`${prev.ch}|${ch}`);
        prev = { ch, top };
      }
    }
    return out;
  };
  const brokenWords = (root, sel) =>
    [...root.querySelectorAll(sel)].filter(vis).flatMap((e) => {
      const m = midWord(e);
      return m.length ? [`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${label(e)}" broken mid-word at ${m.join(', ')}`] : [];
    });
  const cards = [...document.querySelectorAll('.schedule > article.sched')].filter((a) => !a.classList.contains('leaving')).map((a) => {
    const box = rect(a);
    const sel = '.tile-wrap, .sched-time, .sched-status, .in-line, .names-line, .waitlist-line, .pchip, .btn, .quiet-link, .credit-note, .sched-sub, .game-note, .notice, .cal-icon-link';
    const parts = [...a.querySelectorAll(sel)].filter(vis).map((e) => ({ n: `${String(e.className).split(' ').slice(0, 2).join('.')} "${label(e).slice(0, 24)}"`, el: e, ...rect(e) }));
    const overlaps = [];
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const p = parts[i];
        const q = parts[j];
        if (p.el.contains(q.el) || q.el.contains(p.el)) continue;
        const x = Math.min(p.r, q.r) - Math.max(p.l, q.l);
        const y = Math.min(p.b, q.b) - Math.max(p.t, q.t);
        if (x > 1 && y > 1) overlaps.push(`${p.n} overlaps ${q.n} (${x.toFixed(0)}x${y.toFixed(0)})`);
      }
    // The check badge pokes out of the tile on purpose; everything else stays inside the card.
    const leaks = parts.filter((p) => p.r > box.r + 1 || p.l < box.l - 1 || p.b > box.b + 1 || p.t < box.t - 1).map((p) => `${p.n} ${p.l.toFixed(0)}..${p.r.toFixed(0)} / ${p.t.toFixed(0)}..${p.b.toFixed(0)} outside card ${box.l.toFixed(0)}..${box.r.toFixed(0)} / ${box.t.toFixed(0)}..${box.b.toFixed(0)}`);
    const badge = a.querySelector('.tile-check');
    let badgeCovered = null;
    if (badge && vis(badge)) {
      const r = badge.getBoundingClientRect();
      const inView = r.top >= 0 && r.bottom <= innerHeight;
      if (inView) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        badgeCovered = hit && !badge.contains(hit) && hit !== badge ? squash(hit.className) : null;
      }
    }
    const col = a.querySelector('.sched-tilecol');
    const time = [...a.querySelectorAll('.sched-time span')].map((s) => ({ t: s.textContent, w: s.getBoundingClientRect().width, sw: s.scrollWidth }));
    const controls = [...a.querySelectorAll('button, a[href]')].filter(vis).map((b) => ({ text: squash(b.textContent), name: b.getAttribute('aria-label') || '', cls: String(b.className), disabled: b.disabled === true }));
    return {
      id: a.id.replace(/^row-/, ''),
      tier: a.dataset.tier,
      mine: a.dataset.mine === 'in',
      off: a.classList.contains('off'),
      extra: a.dataset.extra === 'yes',
      text: squash(a.innerText),
      allText: squash(a.textContent),
      status: squash((a.querySelector('.sched-status') || {}).textContent),
      count: squash((a.querySelector('.in-count') || {}).textContent),
      tonight: !!a.querySelector('.tonight-tag'),
      tonightIn: (() => {
        const t = a.querySelector('.tonight-tag');
        const tile = a.querySelector('.ptile');
        if (!t || !tile) return null;
        const x = t.getBoundingClientRect();
        const y = tile.getBoundingClientRect();
        return x.left >= y.left - 0.5 && x.right <= y.right + 0.5 && t.scrollWidth <= t.clientWidth + 1;
      })(),
      tileExtra: !!a.querySelector('.ptile.extra'),
      box,
      overlaps,
      leaks,
      badgeCovered,
      colW: col ? col.getBoundingClientRect().width : 0,
      time,
      controls,
      clipped: [...clipped(a), ...brokenWords(a, '.names-line, .waitlist-line, .sched-status, .game-note, .sched-sub, .credit-note, .pchip, .in-count, .btn, .quiet-link')],
      calR: (() => {
        const c = a.querySelector('.cal-icon-link');
        const s = a.querySelector('.st-tail .court-status');
        return c && s ? { cal: rect(c), status: rect(s) } : null;
      })(),
      // The LATER chip's "· $9 credit" is read out but not drawn (clipped to 1px).
      chipCreditDrawn: (() => {
        const e = a.querySelector('.chip-credit');
        return e ? e.getBoundingClientRect().width > 2 : null;
      })(),
    };
  });
  // Even spacing: the gap between two cards in a row (no header between), and from a header to its first card.
  const kids = [...document.querySelectorAll('.schedule > *')].filter((e) => vis(e) && !e.classList.contains('leaving'));
  const gaps = [];
  for (let i = 1; i < kids.length; i++) {
    const a = kids[i - 1];
    const b = kids[i];
    const kind = a.matches('article') && b.matches('article') ? `card-card ${a.dataset.tier}` : a.matches('.week-break') && b.matches('article') ? 'header-card' : b.matches('.week-break') && a.matches('article') ? 'card-header' : 'other';
    gaps.push({ kind, gap: Math.round((b.getBoundingClientRect().top - a.getBoundingClientRect().bottom) * 10) / 10 });
  }
  const tiers = [...document.querySelectorAll('.schedule > .week-break')].map((w) => ({ label: squash((w.querySelector('h3') || {}).textContent), toggle: !!w.querySelector('.filter-toggle'), filterOnly: w.classList.contains('filter-only') }));
  const header = document.querySelector('header.topbar');
  const hparts = header
    ? [...header.querySelectorAll('.brand-logo, h1, .not-you, .mode-btn, .credit-chip, .today, .eyebrow')].filter(vis).map((e) => ({ n: String(e.className).split(' ')[0] || e.tagName, el: e, ...rect(e) }))
    : [];
  const hover = [];
  for (let i = 0; i < hparts.length; i++)
    for (let j = i + 1; j < hparts.length; j++) {
      const p = hparts[i];
      const q = hparts[j];
      if (p.el.contains(q.el) || q.el.contains(p.el)) continue;
      // h1's box can be wider than its text (flex): measure the text itself.
      const box = (x) => {
        if (x.el.tagName !== 'H1') return x;
        // ...but only what is drawn: a clamped h1 hides the lines past its box.
        const range = document.createRange();
        range.selectNodeContents(x.el);
        const rr = range.getBoundingClientRect();
        return { l: Math.max(rr.left, x.l), r: Math.min(rr.right, x.r), t: Math.max(rr.top + scrollY, x.t), b: Math.min(rr.bottom + scrollY, x.b) };
      };
      const a = box(p);
      const b = box(q);
      const x = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (x > 1 && y > 1) hover.push(`${p.n} overlaps ${q.n}`);
    }
  const spill = [...document.querySelectorAll('header .credit-chip, header .today')].flatMap((box) => {
    const b = box.getBoundingClientRect();
    return [...box.querySelectorAll('span')]
      .filter((e) => vis(e) && !e.classList.contains('cc-ghost') && !e.classList.contains('cc-amount'))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5;
      })
      .map((e) => `"${e.textContent.trim()}" spills out of the ${String(box.className).split(' ')[0]} box`);
  });
  const pay = document.querySelector('main .pay-card');
  const chip = document.querySelector('header [data-credit-chip]');
  return {
    vw,
    sw: document.documentElement.scrollWidth,
    bodySW: document.body.scrollWidth,
    offScreen,
    cards,
    gaps,
    tiers,
    header: { overlaps: hover, clipped: header ? [...clipped(header), ...brokenWords(header, 'h1, .not-you, .eyebrow')] : [], spill, title: squash((header?.querySelector('h1') || {}).textContent) },
    pay: pay ? { text: squash(pay.innerText), clipped: [...clipped(pay), ...brokenWords(pay, 'h2, li, p, .btn')], controls: [...pay.querySelectorAll('button, a[href]')].filter(vis).map((b) => ({ text: squash(b.textContent), cls: String(b.className) })) } : null,
    chip: chip ? { text: squash(chip.innerText), name: chip.getAttribute('aria-label') } : null,
    more: squash((document.querySelector('main > .btn.ghost.block') || {}).textContent),
    empty: squash((document.querySelector('.empty-mine') || {}).innerText),
  };
}

/** The real tap area of every control: scrolled into view, then measured with elementFromPoint through its middle. */
function measureTaps(rootSel) {
  const out = [];
  const roots = [...document.querySelectorAll(rootSel)];
  const els = roots.flatMap((r) => [...r.querySelectorAll('button, a[href], [role="button"], input, select')]);
  for (const el of els) {
    if (!el.checkVisibility({ visibilityProperty: true }) || el.getBoundingClientRect().width === 0 || el.closest('.sr-only') || el.closest('.leaving')) continue;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = (x, y) => {
      const h = document.elementFromPoint(x, y);
      return !!h && (h === el || el.contains(h));
    };
    const name = String(el.getAttribute('aria-label') || el.textContent).replace(/\s+/g, ' ').trim().slice(0, 30);
    const card = el.closest('article');
    const where = card ? card.id.replace(/^row-/, '') : el.closest('header') ? 'header' : el.closest('dialog') ? 'dialog' : el.closest('.pay-card') ? 'pay-card' : 'page';
    if (!hits(cx, cy)) {
      const h = document.elementFromPoint(cx, cy);
      out.push({ name, where, cls: String(el.className), w: 0, h: 0, covered: h ? `${h.tagName}.${String(h.className)}` : 'nothing' });
      continue;
    }
    let l = 0;
    let rr = 0;
    let t = 0;
    let b = 0;
    while (l < 60 && hits(cx - l - 0.5, cy)) l += 0.5;
    while (rr < 60 && hits(cx + rr + 0.5, cy)) rr += 0.5;
    while (t < 60 && hits(cx, cy - t - 0.5)) t += 0.5;
    while (b < 60 && hits(cx, cy + b + 0.5)) b += 0.5;
    // Smaller than drawn: say which other control takes the edge.
    const thief = (x, y) => {
      const h = document.elementFromPoint(x, y);
      const c = h && h.closest('button, a[href]');
      return c && c !== el ? `${String(c.className)} "${String(c.getAttribute('aria-label') || c.textContent).trim().slice(0, 20)}"` : null;
    };
    const stolen = (t + b < r.height - 0.5 ? thief(cx, cy + b + 1) || thief(cx, cy - t - 1) : null) || (l + rr < r.width - 0.5 ? thief(cx + rr + 1, cy) || thief(cx - l - 1, cy) : null);
    out.push({ name, where, cls: String(el.className), w: l + rr, h: t + b, box: [Math.round(r.width), Math.round(r.height)], stolen });
  }
  scrollTo(0, 0);
  return out;
}

/** WCAG contrast of every visible piece of text against what is really behind it (opacity included). */
function measureContrast(rootSel) {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const mix = (top, a, under) => top.slice(0, 3).map((v, i) => v * a + under[i] * (1 - a));
  // The background really behind an element: every layer from the page up, blended.
  const bgOf = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(e);
    let bg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (!bg || bg[3] === 0) bg = parse(getComputedStyle(document.body).backgroundColor);
    if (!bg || bg[3] === 0) bg = [255, 255, 255, 1];
    let base = bg.slice(0, 3);
    for (const e of chain.reverse()) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) base = mix(c, c[3], base);
    }
    return base;
  };
  const out = [];
  const seen = new Set();
  for (const root of document.querySelectorAll(rootSel)) {
    for (const el of root.querySelectorAll('*')) {
      if (!el.checkVisibility({ visibilityProperty: true }) || el.closest('.sr-only, .chip-credit.sr-only, .cc-ghost, [aria-hidden="true"].sr-only') || el.getBoundingClientRect().width === 0) continue;
      if (rootSel.indexOf('dialog') < 0 && el.closest('dialog')) continue;
      if (el.closest('button:disabled')) continue;
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (!txt) continue;
      // Hidden by a clip (the LATER chip's credit words are read out, not drawn).
      const cs0 = getComputedStyle(el);
      if (cs0.clip && cs0.clip !== 'auto' && cs0.position === 'absolute') continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      let op = 1;
      for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const bg = bgOf(el);
      const shown = mix(fg, fg[3] * op, bg);
      const c = ratio(shown, bg);
      const px = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = px >= 24 || (bold && px >= 18.66);
      const need = large ? 3 : 4.5;
      const key = `${txt}|${c.toFixed(2)}`;
      if (c < need && !seen.has(key)) {
        seen.add(key);
        const card = el.closest('article');
        out.push({ text: txt.slice(0, 30), cls: String(el.className).split(' ')[0], ratio: Math.round(c * 100) / 100, need, px: Math.round(px * 10) / 10, op: Math.round(op * 100) / 100, color: cs.color, bg: `rgb(${bg.map(Math.round).join(', ')})`, where: card ? card.id.replace(/^row-/, '') : el.closest('header') ? 'header' : 'page' });
      }
    }
  }
  return out;
}

/** Every control and icon has a name; a visible label is part of that name. */
function measureNames(rootSel) {
  const nameOf = (el) => {
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    const walk = (n) => {
      if (n.nodeType === 3) return n.textContent;
      if (n.nodeType !== 1) return '';
      if (n.getAttribute('aria-hidden') === 'true') return '';
      if (getComputedStyle(n).display === 'none') return '';
      if (n.tagName === 'IMG') return n.getAttribute('alt') || '';
      return [...n.childNodes].map(walk).join('');
    };
    let t = walk(el).replace(/\s+/g, ' ').trim();
    if (!t && el.labels && el.labels.length) t = el.labels[0].textContent.trim();
    return t || el.getAttribute('title') || '';
  };
  const visText = (el) =>
    [...el.querySelectorAll('*'), el]
      .filter((n) => n.childNodes && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
      .filter((n) => n.checkVisibility() && !n.closest('.sr-only') && !n.closest('.cc-ghost'))
      .map((n) => [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  const out = [];
  const list = [];
  for (const root of document.querySelectorAll(rootSel)) {
    for (const el of root.querySelectorAll('button, a[href], [role="img"], [role="button"], input, select, svg:not([aria-hidden="true"]), img')) {
      if (!el.checkVisibility() && !el.matches('[role="img"]')) continue;
      if (el.closest('[aria-hidden="true"]') && !el.matches('button, a[href]')) continue;
      if (el.tagName === 'IMG' && el.getAttribute('alt') === '') continue;
      const name = nameOf(el);
      const where = el.closest('article') ? el.closest('article').id.replace(/^row-/, '') : el.closest('header') ? 'header' : el.closest('dialog') ? 'dialog' : 'page';
      list.push({ name, where, tag: el.tagName.toLowerCase() });
      if (!name) {
        out.push(`${where}: ${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(' ')[0]} has no name`);
        continue;
      }
      // Label in name: every word you can see on the control is in its name (voice control says what it sees).
      if (el.matches('button, a[href]') && el.getAttribute('aria-label')) {
        const seen = visText(el).toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/).filter(Boolean);
        const n = name.toLowerCase();
        const missing = seen.filter((w) => !n.includes(w));
        if (missing.length) out.push(`${where}: "${visText(el)}" is named "${name}" (missing ${missing.join(', ')})`);
      }
    }
  }
  return { problems: out, list };
}

/* ------------------------------------------------------------------ the run ------------------------------------------------------------------ */

async function main() {
  const dbFile = path.join(ROOT, '.data', 'audit-look.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  let shots = true;
  try {
    mkdirSync(SHOTS, { recursive: true });
  } catch {
    shots = false;
  }
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const clock = (iso) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: at(iso) }) });
  // Set-up time: Mon Nov 2, 6:00 AM Eastern (the clocks went back on Sun Nov 1).
  await clock('2026-11-02T06:00:00-05:00');

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const ok = async (resp, what) => {
    if (!resp.ok()) throw new Error(`${what}: ${resp.status()} ${await resp.text()}`);
    return resp.json().catch(() => ({}));
  };
  const setup = (await browser.newContext()).request;
  await ok(
    await post(setup, '/api/setup', {
      setupToken: SETUP_TOKEN,
      groupName: 'Pickleball Bros',
      pin: PIN,
      venmoUrl: 'https://venmo.com/u/organizer',
      players: NAMES.slice(0, 16).map((name, i) => ({ name, phone: `2485553${String(i).padStart(3, '0')}` })),
    }),
    'setup',
  );
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  await ok(await areq.put(BASE + '/api/admin/group', { data: { organizerName: 'Alex', settings: { maxPlayers: 10 } }, headers: { Origin: BASE } }), 'group');
  // Setup takes 20 names at most; the fillers are added like the organizer would.
  for (const [i, name] of NAMES.slice(16).entries()) await ok(await post(areq, '/api/admin/players', { name, phone: `2485554${String(i).padStart(3, '0')}`, isRegular: true, isActive: true }), `add ${name}`);
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  // Extra games: one that finishes before the main look (finalized), one that starts 5 minutes before it, one with a note, a Saturday morning one.
  const addGame = async (startsAt, endsAt, note) => (await ok(await post(areq, '/api/admin/sessions', { startsAt: new Date(at(startsAt)).toISOString(), endsAt: new Date(at(endsAt)).toISOString(), note }), 'add game')).id;
  const E = {
    fin: await addGame('2026-11-02T07:00:00-05:00', '2026-11-02T08:00:00-05:00'),
    started: await addGame('2026-11-03T09:30:00-05:00', '2026-11-03T11:00:00-05:00'),
    note: await addGame('2026-11-04T18:30:00-05:00', '2026-11-04T20:30:00-05:00', NOTE),
    sat: await addGame('2026-11-07T10:30:00-05:00', '2026-11-07T12:30:00-05:00'),
  };
  d = await dash();
  const regular = d.sessions.filter((s) => !s.extra && !s.isExtra && !Object.values(E).includes(s.id)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const S = {};
  regular.forEach((s, i) => (S[i + 1] = s.id));
  const LABEL = { [E.fin]: 'Mon Nov 2 7 AM (finished)', [E.started]: 'Tue Nov 3 9:30 AM (started)', [E.note]: 'Wed Nov 4 extra with note', [E.sat]: 'Sat Nov 7 10:30 AM extra' };
  regular.forEach((s, i) => (LABEL[s.id] = `${new Date(s.startsAt).toLocaleDateString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric' })} (S${i + 1})`));
  const lab = (id) => LABEL[id] || id.slice(0, 8);
  const idOf = (n) => d.players.find((p) => p.name === n).id;

  // Courts: booked, not booked (S4, S11) and the venue's Waitlist (S5, S12).
  for (const id of [S[1], S[2], S[3], S[6], S[7], S[8], S[9], S[10], E.fin, E.started, E.note, E.sat]) await ok(await post(areq, `/api/admin/sessions/${id}/booked`, {}), `book ${lab(id)}`);
  for (const id of [S[5], S[12]]) await ok(await post(areq, `/api/admin/sessions/${id}/court-status`, { status: 'waitlist' }), `waitlist ${lab(id)}`);

  const who = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    who[n] = c.request;
  }
  const join = async (n, id, want) => {
    const r = await post(who[n], `/api/sessions/${id}/join`, {});
    const body = await r.json().catch(() => ({}));
    if (!r.ok() || (want && body.result !== want)) throw new Error(`${n} joining ${lab(id)}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  const adminPaid = async (n, id) => ok(await post(areq, `/api/admin/sessions/${id}/payment`, { playerId: idOf(n), paid: true }), `mark ${n} paid`);

  // Finished game: 10 in, 9 paid by the organizer, Ryan unpaid. Finalized at 10 played: $5 each, $9 back as credit.
  for (const n of ['Wren', 'Zed', 'Pia', 'Dana', BMS, 'Fa', 'Fb', 'Brandon', 'Mitchel', 'Ryan']) await join(n, E.fin, 'confirmed');
  for (const n of ['Wren', 'Zed', 'Pia', 'Dana', BMS, 'Fa', 'Fb', 'Brandon', 'Mitchel']) await adminPaid(n, E.fin);
  // Tonight (S1, Tue Nov 3): 4 in.
  for (const n of ['Ryan', 'Nathan', 'Wren', 'Mitchel']) await join(n, S[1], 'confirmed');
  for (const n of ['Ryan', 'Mitchel', 'Brandon']) await join(n, E.started, 'confirmed');
  for (const n of ['Julian', 'Nathan', 'Mitchel', 'Brandon']) await join(n, E.note, 'confirmed');
  // Thu Nov 5 (S2): 10 in, long names and emoji; Brandon waits.
  for (const n of ['Ryan', 'Wren', BMS, 'Bartholomew Montgomery', ZOE, "D'Angelo", 'Fe', 'Ff', 'Fg', 'Fh']) await join(n, S[2], 'confirmed');
  await join('Brandon', S[2], 'waitlisted');
  await join('Ryan', E.sat, 'confirmed');
  await adminPaid('Ryan', E.sat);
  await join('Ryan', S[3], 'confirmed');
  await ok(await post(who.Ryan, `/api/sessions/${S[3]}/paid`, { paid: true, cents: 1400 }), 'Ryan I paid');
  for (const n of ['Ryan', 'Wren']) await join(n, S[4], 'confirmed');
  for (const n of ['Ryan', 'Nathan']) await join(n, S[5], 'confirmed');
  await join('Ryan', S[6], 'confirmed');
  for (const n of ['Ryan', 'Wren']) await join(n, S[7], 'confirmed');
  for (const n of ['Ryan', 'Sam']) await join(n, S[8], 'confirmed');
  await adminPaid('Sam', S[8]);
  for (const n of [...FILL, 'Nathan', 'Mitchel']) await join(n, S[9], 'confirmed');
  await join('Brandon', S[9], 'waitlisted');
  await join('Ryan', S[9], 'waitlisted');
  await join('Ryan', S[10], 'confirmed');
  await join('Julian', S[12], 'confirmed');
  // Canceled: Thanksgiving (Sam paid: $14 credit), a 40-character reason, and no reason.
  const cancel = async (id, reason) => ok(await post(areq, `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true, ...(reason ? { reason } : {}) }), `cancel ${lab(id)}`);
  await cancel(S[8], 'Thanksgiving');
  await cancel(S[6], REASON_40);
  await cancel(S[10]);

  // The finished game ends; it is finalized.
  await clock('2026-11-02T08:05:00-05:00');
  await ok(await post(areq, `/api/admin/sessions/${E.fin}/finalize`, { everyone: true }), 'finalize');
  // With credit now: Zed part credit on S3, Dana credit used on a no-court game, Sam paid with credit, Pia cash out pending.
  await join('Zed', S[3], 'confirmed');
  await join('Dana', S[4], 'confirmed');
  await join('Sam', S[3], 'confirmed');
  await ok(await post(who.Pia, '/api/me/refund-request', { cents: 900 }), 'Pia cash out');
  await join('Pia', S[7], 'confirmed');
  await join(ZOE, S[11], 'confirmed').catch(() => {});

  // The main look: Tue Nov 3, 9:35 AM Eastern. Game day (Pay card from 8 AM), a game started 5 minutes ago.
  await clock('2026-11-03T09:35:00-05:00');
  const groupOf = async (n) => (await who[n].get(`${BASE}/api/group`)).json();
  const allIds = [...regular.map((s) => s.id), ...Object.values(E)];

  // Sanity of the fake data before any look.
  {
    const r = await groupOf('Ryan');
    const by = Object.fromEntries(r.sessions.map((s) => [s.id, s]));
    const w = await groupOf('Wren');
    const z = await groupOf('Zed');
    const sam = await groupOf('Sam');
    const problems = [];
    if (by[E.fin]) problems.push('finished game still listed');
    if (!by[E.started]?.started) problems.push('started game not started');
    if (by[S[9]]?.mine?.waitlistPosition !== 2) problems.push(`Ryan S9 position ${by[S[9]]?.mine?.waitlistPosition}`);
    if (w.credit.usableCents !== 900) problems.push(`Wren credit ${w.credit.usableCents}`);
    if (z.sessions.find((s) => s.id === S[3])?.mine?.creditCents !== 900) problems.push('Zed part credit');
    if (!sam.sessions.find((s) => s.id === S[3])?.mine?.paidWithCredit) problems.push('Sam paid with credit');
    if (!r.payDue.some((o) => o.sessionId === E.fin && o.finalized && o.amountCents === 500)) problems.push(`Ryan final price ${JSON.stringify(r.payDue)}`);
    if (problems.length) throw new Error(`fake data is not as planned: ${problems.join('; ')}`);
  }

  const phone = (w, scheme, extra = {}) => ({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, colorScheme: scheme, ...extra });
  /** One player's phone, the schedule fully open ("More sessions"), no one-time banners in the way. */
  async function open(name, w, scheme, extra = {}, { more = true, filter = 'all' } = {}) {
    const ctx = await browser.newContext(phone(w, scheme, extra));
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    await ctx.addInitScript(
      ({ ids, filter }) => {
        try {
          localStorage.setItem('pb_celebrated', JSON.stringify(ids));
          localStorage.setItem('pb_games_filter', filter);
        } catch {}
      },
      { ids: allIds, filter },
    );
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.schedule article, .empty-mine, .schedule .filter-toggle').first().waitFor();
    const m = page.getByRole('button', { name: /^More sessions/ });
    if (more && (await m.count())) {
      await m.click();
      await page.waitForTimeout(300);
    }
    await page.locator('.pop').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
    return { ctx, page };
  }
  const shot = async (page, file, full = true) => {
    if (shots) await page.screenshot({ path: path.join(SHOTS, file), fullPage: full }).catch(() => {});
  };
  const cardOf = (facts, id) => facts.cards.find((c) => c.id === id);
  const btns = (c) => c.controls.filter((x) => !/cal-icon-link/.test(x.cls));
  const hasBtn = (c, re) => c.controls.some((x) => re.test(x.text) && !x.disabled);

  /* ---------------- the four looks: 320 / 390, light / dark ---------------- */
  const COMBOS = [
    [320, 'light'],
    [320, 'dark'],
    [390, 'light'],
    [390, 'dark'],
  ];
  const known = {
    // Real defects, each with its own BUG check (and left out of the general checks so those still guard the rest).
    calTap: (t) => /cal-icon-link/.test(t.cls),
    edgeSteal: (t) => !!t.stolen && /quiet-link/.test(t.stolen),
    headerName: (x) => /^h1\./.test(x) || /H1 overlaps|overlaps H1/.test(x),
    // Deliberate: the group name over the player's name ends in "..." when the row is tight (CSS text-overflow: ellipsis).
    eyebrow: (x) => /div\.eyebrow/.test(x),
    chipLabelDark: (p) => p.where === 'header' && p.cls === 'cc-label',
    canceledFaded: (p, f) => (f.cards.find((c) => c.id === p.where) || {}).off,
  };
  const all = {};
  for (const [w, scheme] of COMBOS) {
    const tag = `${w}px ${scheme}`;
    const per = {};
    for (const name of VIEWERS) {
      const { ctx, page } = await open(name, w, scheme);
      const facts = await page.evaluate(collectFacts);
      const taps = await page.evaluate(measureTaps, 'header, main');
      const contrast = await page.evaluate(measureContrast, 'header, main');
      const names = await page.evaluate(measureNames, 'header, main');
      per[name] = { facts, taps, contrast, names, g: await groupOf(name) };
      if (['Ryan', 'Wren', BMS].includes(name)) await shot(page, `${w}-${scheme}-${name.split(' ')[0]}.png`);
      await ctx.close();
    }
    all[tag] = per;
    const each = (fn) => {
      const bad = [];
      for (const name of VIEWERS) bad.push(...(fn(per[name], name) || []).map((x) => `${name}: ${x}`));
      return bad;
    };

    await check(`${tag}: no sideways scroll and nothing past the screen edge (10 players, every card state)`, async () => {
      const bad = each(({ facts }) => [...(facts.sw > facts.vw ? [`page is ${facts.sw}px wide in ${facts.vw}`] : []), ...facts.offScreen]);
      assert(bad.length === 0, bad.slice(0, 8).join(' | '));
    });
    await check(`${tag}: nothing overlaps inside a card (status, count, names, chips, buttons, links, notes)`, async () => {
      const bad = each(({ facts }) => facts.cards.flatMap((c) => c.overlaps.map((o) => `${lab(c.id)}: ${o}`)));
      assert(bad.length === 0, bad.slice(0, 8).join(' | '));
    });
    await check(`${tag}: nothing sticks out of its card; the check badge is not covered`, async () => {
      const bad = each(({ facts }) => facts.cards.flatMap((c) => [...c.leaks.map((o) => `${lab(c.id)}: ${o}`), ...(c.badgeCovered ? [`${lab(c.id)}: badge covered by ${c.badgeCovered}`] : [])]));
      assert(bad.length === 0, bad.slice(0, 8).join(' | '));
    });
    await check(`${tag}: no text cut off in cards, the header or the Pay card (long names, emoji, 40-char reason, long note)`, async () => {
      const bad = each(({ facts }) => [...facts.cards.flatMap((c) => c.clipped.map((x) => `${lab(c.id)}: ${x}`)), ...facts.header.clipped.filter((x) => !known.eyebrow(x) && !known.headerName(x)).map((x) => `header: ${x}`), ...(facts.pay ? facts.pay.clipped.map((x) => `pay card: ${x}`) : [])]);
      assert(bad.length === 0, bad.slice(0, 8).join(' | '));
    });
    // Nov 2026 (layout polish): a long name ends in "..." on one line (CSS ellipsis) and gives way before the sun button, the
    // CREDIT chip or the date square; it is never broken in the middle of a word and never sits on another part.
    await check(`${tag}: the player's own name in the header ends in "..." on one line, never broken mid-word or over another part ("${BMS}" with the CREDIT chip)`, async () => {
      const bad = each(({ facts }) => [...facts.header.clipped, ...facts.header.overlaps].filter((x) => known.headerName(x) && (/broken mid-word/.test(x) || /overlaps/.test(x))));
      assert(bad.length === 0, bad.join(' | '));
    });
    await check(`${tag}: header parts (logo, name, not you?, light/dark, CREDIT chip, today) never overlap`, async () => {
      const bad = each(({ facts }) => [...facts.header.overlaps.filter((x) => !known.headerName(x)), ...facts.header.spill]);
      assert(bad.length === 0, bad.slice(0, 8).join(' | '));
    });
    await check(`${tag}: start time under the tile fits its column (10:30 AM, 9:30 AM to 11 AM, 6:30 PM)`, async () => {
      const bad = each(({ facts }) => facts.cards.flatMap((c) => c.time.filter((t) => t.w > c.colW + 0.5 || t.sw > Math.ceil(t.w) + 1).map((t) => `${lab(c.id)}: "${t.t}" ${t.w.toFixed(1)}px in a ${c.colW}px column`)));
      assert(bad.length === 0, bad.slice(0, 8).join(' | '));
    });
    await check(`${tag}: calendar icon sits right after "Court booked" / "Court not booked" on the same line, inside the card`, async () => {
      const bad = each(({ facts }) =>
        facts.cards
          .filter((c) => c.calR)
          .filter((c) => c.calR.cal.l < c.calR.status.r - 1 || Math.abs((c.calR.cal.t + c.calR.cal.b) / 2 - (c.calR.status.t + c.calR.status.b) / 2) > 6 || c.calR.cal.r > c.box.r + 1)
          .map((c) => `${lab(c.id)}: icon ${JSON.stringify(c.calR.cal)} status ${JSON.stringify(c.calR.status)}`),
      );
      assert(bad.length === 0, bad.slice(0, 6).join(' | '));
    });
    await check(`${tag}: real tap areas at least 44 x 44 px (elementFromPoint; quiet links, filter, not you?, chip, buttons)`, async () => {
      const bad = each(({ taps }) => taps.filter((t) => !known.calTap(t) && !known.edgeSteal(t) && (t.w < 43.5 || t.h < 43.5)).map((t) => `${t.where === 'header' || t.where === 'page' || t.where === 'pay-card' ? t.where : lab(t.where)} "${t.name}" ${t.w}x${t.h}${t.covered ? ` covered by ${t.covered}` : ''}`));
      assert(bad.length === 0, [...new Set(bad)].slice(0, 10).join(' | '));
    });
    await check(`FIXED (Nov 1): ${tag}: the bottom edge of Pay / Use credit / I paid is not taken by the "I paid" / "Drop out" link under it`, async () => {
      const bad = each(({ taps }) => taps.filter((t) => known.edgeSteal(t) && (t.w < 43.5 || t.h < 43.5)).map((t) => `${lab(t.where)} "${t.name}" hit area ${t.w}x${t.h} (drawn ${t.box}), edge goes to ${t.stolen}`));
      assert(bad.length === 0, `${bad.length} buttons: ${[...new Set(bad.map((b) => b.replace(/^[^:]+: /, '')))].slice(0, 4).join(' | ')}`);
    });
    await check(`FIXED (Nov 1): ${tag}: the calendar icon on joined cards has a 44 x 44 px tap area`, async () => {
      const bad = each(({ taps }) => taps.filter((t) => known.calTap(t) && (t.w < 43.5 || t.h < 43.5)).map((t) => `"${t.name}" ${t.w}x${t.h} (drawn ${t.box})`));
      assert(bad.length === 0, [...new Set(bad.map((b) => b.replace(/^[^:]+: /, '')))].slice(0, 3).join(' | ') + ` (${bad.length} icons)`);
    });
    await check(`${tag}: text contrast at least 4.5:1 (3:1 large) on cards, header, Pay card`, async () => {
      const bad = each(({ contrast, facts }) => contrast.filter((p) => !known.chipLabelDark(p) && !known.canceledFaded(p, facts)).map((p) => `"${p.text}" ${p.ratio}:1 (${p.color} on ${p.bg}, ${p.px}px, opacity ${p.op}) in ${p.where === 'header' || p.where === 'page' ? p.where : lab(p.where)}`));
      assert(bad.length === 0, [...new Set(bad)].slice(0, 10).join(' | '));
    });
    await check(`FIXED (Nov 1): ${tag}: canceled cards ("Canceled - Thanksgiving", names, "If you paid...") are readable, 4.5:1`, async () => {
      const bad = each(({ contrast, facts }) => contrast.filter((p) => known.canceledFaded(p, facts)).map((p) => `"${p.text}" ${p.ratio}:1 (opacity ${p.op})`));
      const uniq = [...new Set(bad.map((b) => b.replace(/^[^:]+: /, '')))];
      assert(uniq.length === 0, uniq.slice(0, 6).join(' | '));
    });
    await check(`${scheme === 'dark' ? 'FIXED (Nov 1): ' : ''}${tag}: the CREDIT / CASH OUT word on the header chip is readable, 4.5:1`, async () => {
      const bad = each(({ contrast }) => contrast.filter((p) => known.chipLabelDark(p)).map((p) => `"${p.text}" ${p.ratio}:1 (${p.color} on ${p.bg}, ${p.px}px)`));
      const uniq = [...new Set(bad.map((b) => b.replace(/^[^:]+: /, '')))];
      assert(uniq.length === 0, uniq.join(' | '));
    });
    await check(`${tag}: every button, link and icon has a name; visible words are in the name`, async () => {
      const bad = each(({ names }) => names.problems);
      assert(bad.length === 0, [...new Set(bad)].slice(0, 8).join(' | '));
    });
    await check(`${tag}: spacing between cards is the same everywhere (card to card, header to card)`, async () => {
      const bad = [];
      for (const name of VIEWERS) {
        const by = {};
        for (const gp of per[name].facts.gaps) (by[gp.kind] ??= new Set()).add(gp.gap);
        for (const [kind, set] of Object.entries(by)) {
          const v = [...set];
          if (kind !== 'other' && Math.max(...v) - Math.min(...v) > 1) bad.push(`${name}: ${kind} gaps ${v.join(', ')}`);
        }
        const cc = [...(by['card-card this'] || []), ...(by['card-card next'] || [])];
        const lat = [...(by['card-card later'] || [])];
        if (cc.length && lat.length && Math.abs(Math.max(...cc) - Math.max(...lat)) > 1) bad.push(`${name}: card gaps ${cc} vs LATER ${lat}`);
      }
      assert(bad.length === 0, bad.slice(0, 6).join(' | '));
    });
    await check(`${tag}: every card offers a way forward (no joined, unpaid card on a booked court without Pay / Use credit / I paid; no open card without a control)`, async () => {
      const bad = [];
      for (const name of VIEWERS) {
        const { facts, g } = per[name];
        const payCtl = facts.pay ? facts.pay.controls.some((x) => /Pay|I paid|Use credit/.test(x.text)) : false;
        for (const c of facts.cards) {
          const s = g.sessions.find((x) => x.id === c.id);
          const where = `${name} ${lab(c.id)}`;
          if (c.off) {
            if (btns(c).length) bad.push(`${where}: canceled card has controls ${btns(c).map((x) => x.text)}`);
            continue;
          }
          if (s.started) continue;
          if (!btns(c).some((x) => !x.disabled)) bad.push(`${where}: no control at all ("${c.text.slice(0, 60)}")`);
          const owes = / \$\d+ due|^\$\d+ due|\$\d+ due/.test(c.text);
          const onTop = g.payDue.some((o) => o.sessionId === c.id);
          if (owes && s.bookingStatus === 'booked') {
            if (onTop) {
              if (!payCtl) bad.push(`${where}: owing, game-day Pay card has no Pay / I paid / Use credit`);
            } else if (!hasBtn(c, /^(Pay|Pay \$\d+|I paid|Use credit)$/)) bad.push(`${where}: owing on a booked court with no Pay / Use credit ("${c.text.slice(0, 80)}")`);
          }
          if (s.mine?.status === 'confirmed' && !hasBtn(c, /^Drop out$/)) bad.push(`${where}: in, but no Drop out`);
          if (s.mine?.status === 'waitlisted' && !hasBtn(c, /^Leave waitlist$/)) bad.push(`${where}: waiting, no Leave waitlist`);
          if (!s.mine || !['confirmed', 'waitlisted'].includes(s.mine.status)) if (!hasBtn(c, /^(I'm in|Join waitlist)$/)) bad.push(`${where}: not in, no I'm in`);
          if (s.mine?.status === 'confirmed' && s.mine.paymentStatus !== 'paid' && s.mine.useCreditCents > 0 && !hasBtn(c, /Use .*credit/) && !onTop) bad.push(`${where}: has credit to use but no Use credit`);
        }
      }
      assert(bad.length === 0, bad.slice(0, 8).join(' | '));
    });
    await check(`${tag}: games with no court read "Court not booked", "N of 4 in", never waitlist / waiting / standby, no Pay`, async () => {
      const bad = [];
      for (const name of VIEWERS) {
        for (const id of [S[4], S[5], S[11], S[12]]) {
          const c = cardOf(per[name].facts, id);
          if (!c) {
            bad.push(`${name}: ${lab(id)} missing`);
            continue;
          }
          if (/waitlist|waiting|standby/i.test(c.allText)) bad.push(`${name} ${lab(id)}: "${c.allText.slice(0, 90)}"`);
          if (!/Court not booked/.test(c.status)) bad.push(`${name} ${lab(id)}: status "${c.status}"`);
          if (!/^\d+ of 4 in$/.test(c.count)) bad.push(`${name} ${lab(id)}: count "${c.count}"`);
          if (hasBtn(c, /^(Pay|Pay \$\d+|I paid)$/) || /\$\d+ due/.test(c.text)) bad.push(`${name} ${lab(id)}: pay prompt before the court is booked`);
        }
      }
      assert(bad.length === 0, bad.slice(0, 8).join(' | '));
    });
    await check(`${tag}: tiers THIS WEEK, NEXT WEEK, LATER in order, one header each, the filter switch on the first line`, async () => {
      const bad = each(({ facts }) => {
        const l = facts.tiers.map((t) => t.label);
        const out = [];
        if (l.join('|') !== 'This week|Next week|Later') out.push(`tiers ${l.join(', ')}`);
        if (!facts.tiers[0]?.toggle || facts.tiers.filter((t) => t.toggle).length !== 1) out.push('filter switch not on the first line only');
        const order = facts.cards.map((c) => ({ this: 0, next: 1, later: 2 })[c.tier]);
        if (order.some((v, i) => i && v < order[i - 1])) out.push('cards out of tier order');
        return out;
      });
      assert(bad.length === 0, bad.slice(0, 6).join(' | '));
    });
  }

  /* ---------------- states, at 390 light unless said ---------------- */
  const L = all['390px light'];
  const fact = (name, id, tag = '390px light') => cardOf(all[tag][name].facts, id);
  await check('THIS WEEK has many games (tonight, started, extra with note, Thu, Saturday), NEXT WEEK 2, LATER many (All games)', async () => {
    const c = L.Ryan.facts.cards;
    const n = (t) => c.filter((x) => x.tier === t).length;
    assert(n('this') === 5 && n('next') === 2 && n('later') >= 7, `this ${n('this')}, next ${n('next')}, later ${n('later')}`);
  });
  await check('"More sessions (N)" button: right count, 44 px, opens the rest, then reads "Show fewer"', async () => {
    const { ctx, page } = await open('Ryan', 320, 'light', {}, { more: false });
    const m = page.getByRole('button', { name: /^More sessions \(\d+\)$/ });
    assert((await m.count()) === 1, 'no More sessions button');
    const total = (await groupOf('Ryan')).sessions.length;
    const label = await m.innerText();
    assert(label === `More sessions (${total - 6})`, `${label} with ${total} games`);
    const box = await m.boundingBox();
    assert(box.height >= 44 && box.width <= 320 - 28 + 1, `button ${JSON.stringify(box)}`);
    assert((await page.locator('.schedule article').count()) === 6, 'first look shows 6');
    await m.click();
    await page.getByRole('button', { name: 'Show fewer' }).waitFor();
    assert((await page.locator('.schedule article').count()) === total, 'all games after More sessions');
    await ctx.close();
  });
  await check('My games, one game in one tier: Dana sees only NEXT WEEK (1 game), the switch on that line', async () => {
    const { ctx, page } = await open('Dana', 390, 'light', {}, { filter: 'mine' });
    const f = await page.evaluate(collectFacts);
    assert(f.tiers.map((t) => t.label).join('|') === 'Next week' && f.tiers[0].toggle, JSON.stringify(f.tiers));
    assert(f.cards.length === 1 && f.cards[0].id === S[4], f.cards.map((c) => lab(c.id)).join(', '));
    assert(/My games/.test(await page.locator('.filter-toggle').innerText()), 'switch says My games');
    await shot(page, 'mine-dana-390-light.png');
    await ctx.close();
  });
  await check('My games, two tiers with 2 each, none next week: Nathan (tonight + Wed; Nov 17 + Dec 1)', async () => {
    const { ctx, page } = await open('Nathan', 390, 'dark', {}, { filter: 'mine' });
    const f = await page.evaluate(collectFacts);
    const n = (t) => f.cards.filter((x) => x.tier === t).length;
    assert(f.tiers.map((t) => t.label).join('|') === 'This week|Later' && n('this') === 2 && n('later') === 2, `${JSON.stringify(f.tiers)} this ${n('this')} later ${n('later')}`);
    await ctx.close();
  });
  await check('My games with no games: "You\'re not in any games yet", See all games (44 px), the switch keeps its own line', async () => {
    const { ctx, page } = await open('Quinn', 320, 'light', {}, { filter: 'mine' });
    const f = await page.evaluate(collectFacts);
    assert(/You're not in any games yet/.test(f.empty) && /See all games/.test(f.empty), f.empty);
    assert(f.tiers.length === 1 && f.tiers[0].filterOnly && f.tiers[0].toggle, JSON.stringify(f.tiers));
    const taps = await page.evaluate(measureTaps, 'main');
    const see = taps.find((t) => t.name === 'See all games');
    assert(see && see.w >= 44 && see.h >= 44, JSON.stringify(see));
    await page.getByRole('button', { name: 'See all games' }).click();
    await page.locator('.schedule article').first().waitFor();
    await ctx.close();
  });
  await check('switch toggles All games / My games and its name says what it shows', async () => {
    const { ctx, page } = await open('Ryan', 390, 'light', {}, { more: false });
    const t = page.locator('.filter-toggle');
    assert((await t.getAttribute('aria-label')) === 'Showing all games. Switch to my games', await t.getAttribute('aria-label'));
    const before = await page.locator('.schedule article').count();
    await t.click();
    await page.waitForTimeout(400);
    assert((await t.getAttribute('aria-label')) === 'Showing my games. Switch to all games', 'name after switch');
    const after = await page.locator('.schedule article:not(.leaving)').count();
    assert(after <= before, `${before} -> ${after}`);
    await ctx.close();
  });
  await check('tonight (Tue Nov 3): blue TONIGHT strip inside the tile; not on the game that already started', async () => {
    for (const tag of ['320px light', '320px dark', '390px light', '390px dark']) {
      const c = fact('Ryan', S[1], tag);
      assert(c.tonight && c.tonightIn, `${tag}: strip ${c.tonight} inside ${c.tonightIn}`);
      assert(!fact('Ryan', E.started, tag).tonight, `${tag}: started game has the strip`);
      assert(all[tag].Ryan.facts.cards.filter((x) => x.tonight).length === 1, `${tag}: more than one TONIGHT`);
    }
  });
  await check('started 5 minutes ago: card stays, "You\'re in · Court booked", no Drop out, no I\'m in for others, time 9:30 AM to 11 AM', async () => {
    const c = fact('Ryan', E.started);
    assert(/You're in/.test(c.status) && !hasBtn(c, /Drop out/), c.text);
    const o = fact('Wren', E.started);
    assert(!hasBtn(o, /I'm in|Join/), `others can still join: ${o.text}`);
    assert(c.time.map((t) => t.t).join('') === '9:30 AM–11 AM', JSON.stringify(c.time));
  });
  await check('finished and finalized: no card; the top Pay card lists it at the final price ($5, "final price")', async () => {
    assert(!fact('Ryan', E.fin), 'finished game still shows a card');
    const p = L.Ryan.facts.pay;
    assert(p && /You owe \$33 total/.test(p.text) && /\$5 \(final price\)/.test(p.text), p && p.text);
  });
  await check('canceled with a reason: "Canceled - Thanksgiving", "If you paid, it\'s now your credit.", no controls', async () => {
    const c = fact('Ryan', S[8]);
    assert(c.off && c.status === 'Canceled - Thanksgiving' && /If you paid, it's now your credit\./.test(c.text) && btns(c).length === 0, c.text);
  });
  await check('canceled with a 40-character reason: whole reason shows, inside the card, at 320 px light and dark', async () => {
    for (const tag of ['320px light', '320px dark']) {
      const c = fact('Ryan', S[6], tag);
      assert(c.status === `Canceled - ${REASON_40}` && c.clipped.length === 0 && c.leaks.length === 0, `${tag}: ${c.status} ${c.clipped} ${c.leaks}`);
    }
  });
  await check('canceled without a reason: just "Canceled"', async () => {
    assert(fact('Ryan', S[10]).status === 'Canceled', fact('Ryan', S[10]).status);
  });
  await check('extra game with a note: ink tile, "Extra game" for screen readers, the whole note shows', async () => {
    const c = fact('Ryan', E.note);
    assert(c.tileExtra && /Extra game/.test(c.allText) && c.text.includes(NOTE), c.text);
  });
  await check('not in, 4 already in, room left: I\'m in + "If 5 play, you get $3 back as credit."', async () => {
    const c = fact('Ryan', E.note);
    assert(hasBtn(c, /^I'm in$/) && /If 5 play, you get \$3 back as credit\./.test(c.text), c.text);
  });
  await check('booked court reads "Court booked"; joined: "You\'re in · Court booked" with the check badge', async () => {
    const c = fact('Ryan', S[2]);
    assert(/^You're in\s*·\s*Court booked$/.test(c.status) && c.mine && !c.badgeCovered, c.status);
  });
  await check('10 players in: "10 in, full", ten balls, every long name and emoji on the names line', async () => {
    const { ctx, page } = await open(ZOE, 320, 'light');
    const card = page.locator(`#row-${S[2]}`);
    const count = await card.locator('.in-count').innerText();
    assert(/^10 in/.test(count), count);
    assert((await card.locator('.ball').count()) === 10, 'ten balls');
    const names = await card.locator('.names-line').innerText();
    // Names show as first names unless two share one ("Zoë 🏓" reads "Zoë"; the two Bartholomews in full).
    for (const n of ['Bartholomew Montgomery-Smythe', 'Bartholomew Montgomery', 'Zoë', "D'Angelo"]) assert(names.includes(n), `${n} missing from "${names}"`);
    const r = await card.evaluate((a) => {
      const box = a.getBoundingClientRect();
      const dots = a.querySelector('.dots').getBoundingClientRect();
      return { in: dots.right <= box.right + 0.5 };
    });
    assert(r.in, 'balls run out of the card');
    await shot(page, '320-light-ten-in-long-names.png');
    await ctx.close();
  });

  // Payment states
  await check('$14 due + Pay (filled) + I paid + Drop out (Thu, Ryan)', async () => {
    const c = fact('Ryan', S[2]);
    assert(/\$14 due/.test(c.text) && hasBtn(c, /^Pay$/) && hasBtn(c, /^I paid$/) && hasBtn(c, /^Drop out$/), c.text);
    assert(c.controls.find((x) => x.text === 'Pay').name === 'Pay $14 with Venmo', 'Pay name');
  });
  await check('"$14 due · $9 credit" + Use credit (filled) + Pay (outline), no I paid before Pay is tapped (Wren, Thu)', async () => {
    const c = fact('Wren', S[2]);
    assert(/\$14 due · \$9 credit/.test(c.text) && hasBtn(c, /^Use credit$/) && !hasBtn(c, /^I paid$/), c.text);
    const pay = c.controls.find((x) => x.text === 'Pay');
    const use = c.controls.find((x) => x.text === 'Use credit');
    assert(/outline/.test(pay.cls) && !/outline/.test(use.cls), `${pay.cls} / ${use.cls}`);
  });
  await check('LATER owing with credit: chip, Use credit and Pay stacked on the right; credit words read out, not drawn (Wren, Nov 24)', async () => {
    const c = fact('Wren', S[7]);
    assert(c.tier === 'later' && /\$14 due/.test(c.text) && c.chipCreditDrawn === false && /\$9 credit/.test(c.allText) && hasBtn(c, /^Use credit$/) && hasBtn(c, /^Pay$/), `${c.text} | drawn ${c.chipCreditDrawn}`);
  });
  await check('Pay tapped: "I paid" shows next to Pay (credit player, remembered on this phone)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'light' });
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    await ctx.addInitScript((ids) => localStorage.setItem('pb_celebrated', JSON.stringify(ids)), allIds);
    await post(ctx.request, '/api/me', { playerId: idOf('Wren') });
    const page = await ctx.newPage();
    await page.goto(BASE);
    const card = page.locator(`#row-${S[2]}`);
    await card.waitFor();
    assert((await card.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid before Pay');
    const popup = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await card.getByRole('link', { name: 'Pay $14 with Venmo' }).click();
    const p2 = await popup;
    if (p2) await p2.close();
    await card.getByRole('button', { name: 'I paid' }).waitFor({ timeout: 4000 });
    const f = await page.evaluate(collectFacts);
    const c = cardOf(f, S[2]);
    assert(c.overlaps.length === 0 && c.leaks.length === 0, `${c.overlaps} ${c.leaks}`);
    await ctx.close();
  });
  await check('Paid $14 + "Didn\'t pay?" after my own I paid (Ryan, Nov 10)', async () => {
    const c = fact('Ryan', S[3]);
    assert(/Paid \$14/.test(c.text) && hasBtn(c, /^Didn't pay\?$/) && hasBtn(c, /^Drop out$/), c.text);
  });
  await check('Paid $14 marked by the organizer: no "Didn\'t pay?" (Ryan, Sat 10:30 AM)', async () => {
    const c = fact('Ryan', E.sat);
    assert(/Paid \$14/.test(c.text) && !hasBtn(c, /Didn't pay/), c.text);
    assert(c.time.map((t) => t.t).join('') === '10:30 AM', JSON.stringify(c.time));
  });
  await check('Paid with credit + Undo (Sam, Nov 10)', async () => {
    const c = fact('Sam', S[3]);
    assert(/Paid with credit/.test(c.text) && hasBtn(c, /^Undo$/), c.text);
  });
  await check('part credit: "Credit $9 used" + "$5 due" + "Pay $5" (Zed, Nov 10)', async () => {
    const c = fact('Zed', S[3]);
    assert(/Credit \$9 used/.test(c.text) && /\$5 due/.test(c.text) && hasBtn(c, /^Pay \$5$/), c.text);
  });
  await check('no court yet, credit already on the seat: "Credit $9 used", no Pay (Dana, Nov 12)', async () => {
    const c = fact('Dana', S[4]);
    assert(/Credit \$9 used/.test(c.text) && !hasBtn(c, /Pay|I paid/), c.text);
  });
  await check('no court yet, joined before credit came: "Use $9 credit" (Wren, Nov 12)', async () => {
    const c = fact('Wren', S[4]);
    assert(hasBtn(c, /^Use \$9 credit$/) && !/due/.test(c.text), c.text);
  });
  await check('waitlist: "Waitlist, 2nd in line", "You\'re in if someone drops.", Leave waitlist (Ryan, Dec 1)', async () => {
    const c = fact('Ryan', S[9]);
    assert(c.status === 'Waitlist, 2nd in line' && /You're in if someone drops\./.test(c.text) && hasBtn(c, /^Leave waitlist$/), c.text);
  });
  await check('full booked game, not in: Join waitlist (Wren, Dec 1)', async () => {
    assert(hasBtn(fact('Wren', S[9]), /^Join waitlist$/), fact('Wren', S[9]).text);
  });
  await check('game-day Pay card, several games: "You owe $33 total", list, Pay with Venmo + I paid; tonight\'s row shows the chip only', async () => {
    const p = L.Ryan.facts.pay;
    assert(p.controls.some((x) => x.text === 'Pay with Venmo') && p.controls.some((x) => x.text === 'I paid'), p.text);
    const c = fact('Ryan', S[1]);
    assert(/\$14 due/.test(c.text) && !hasBtn(c, /^(Pay|I paid)$/) && hasBtn(c, /^Drop out$/), c.text);
  });
  await check('game-day Pay card, one game: "Tonight: you owe $14" (Nathan)', async () => {
    assert(/^Tonight: you owe \$14/.test(L.Nathan.facts.pay.text), L.Nathan.facts.pay.text);
  });
  await check('game-day Pay card with credit: Use credit (filled) then Pay with Venmo (outline), I paid waits for Pay (Wren)', async () => {
    const p = L.Wren.facts.pay;
    const use = p.controls.find((x) => x.text === 'Use credit');
    const pay = p.controls.find((x) => x.text === 'Pay with Venmo');
    assert(use && pay && /big/.test(use.cls) && /secondary/.test(pay.cls) && !p.controls.some((x) => x.text === 'I paid'), JSON.stringify(p.controls));
  });
  await check('no Pay card before 8:00 AM on game day... and none for a player who owes nothing today (Zed)', async () => {
    assert(!L.Zed.facts.pay, L.Zed.facts.pay && L.Zed.facts.pay.text);
  });
  await check('CREDIT chip only above $0: Wren $9, Zed none ($0 left), Sam none, Ryan none; name says the amount', async () => {
    assert(L.Wren.facts.chip && L.Wren.facts.chip.text === 'CREDIT $9' && L.Wren.facts.chip.name === '$9 credit. Open your credit', JSON.stringify(L.Wren.facts.chip));
    for (const n of ['Zed', 'Sam', 'Ryan']) assert(!L[n].facts.chip, `${n} has a chip: ${JSON.stringify(L[n].facts.chip)}`);
  });
  await check('cash out pending: chip reads "CASH OUT $9" and its name says so (Pia)', async () => {
    assert(L.Pia.facts.chip && L.Pia.facts.chip.text === 'CASH OUT $9' && /cash out requested/.test(L.Pia.facts.chip.name), JSON.stringify(L.Pia.facts.chip));
  });
  await check('real names with the CREDIT chip at 320 px (Brandon, Mitchel): name whole on one line, not you?, chip and date clear of it', async () => {
    for (const scheme of ['light', 'dark']) {
      for (const n of ['Brandon', 'Mitchel']) {
        const { ctx, page } = await open(n, 320, scheme, {}, { more: false });
        const f = await page.evaluate(collectFacts);
        const lines = await page.locator('header h1').evaluate((h) => Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)));
        assert(f.chip && f.header.title === n && lines === 1 && f.header.clipped.filter((x) => !known.eyebrow(x)).length === 0 && f.header.overlaps.length === 0, `${scheme} ${n}: chip ${!!f.chip}, ${lines} lines, ${f.header.clipped} ${f.header.overlaps}`);
        if (n === 'Brandon' && scheme === 'light') await shot(page, '320-light-Brandon-header.png', false);
        await ctx.close();
      }
    }
  });

  /* ---------------- dialogs: Drop out confirm and the credit sheet ---------------- */
  for (const [w, scheme] of COMBOS) {
    const tag = `${w}px ${scheme}`;
    await check(`${tag}: Drop out and credit sheet dialogs: nothing cut off, 44 px taps, contrast, names`, async () => {
      const bad = [];
      for (const [name, opener, sel] of [
        ['Ryan', async (p) => p.locator(`#row-${S[2]}`).getByRole('button', { name: 'Drop out' }).click(), 'dialog[open]'],
        ['Wren', async (p) => p.locator('header [data-credit-chip]').click(), 'dialog[open]'],
        ['Pia', async (p) => p.locator('header [data-credit-chip]').click(), 'dialog[open]'],
      ]) {
        const { ctx, page } = await open(name, w, scheme, {}, { more: false });
        await opener(page);
        await page.locator('dialog[open] .sheet-body').waitFor();
        await page.waitForTimeout(350);
        const r = await page.evaluate(() => {
          const dlg = document.querySelector('dialog[open]');
          const b = dlg.getBoundingClientRect();
          const out = [...dlg.querySelectorAll('*')].filter((e) => e.checkVisibility() && e.getBoundingClientRect().width > 0 && !e.closest('.sr-only')).filter((e) => {
            const r = e.getBoundingClientRect();
            return r.right > Math.min(b.right, innerWidth) + 0.5 || r.left < Math.max(b.left, 0) - 0.5;
          });
          return { out: out.map((e) => e.textContent.trim().slice(0, 30)), sw: document.documentElement.scrollWidth, vw: innerWidth };
        });
        if (r.out.length || r.sw > r.vw) bad.push(`${name}: out of the sheet ${r.out}`);
        const taps = await page.evaluate(measureTaps, 'dialog[open]');
        bad.push(...taps.filter((t) => t.w < 43.5 || t.h < 43.5).map((t) => `${name}: "${t.name}" ${t.w}x${t.h}`));
        const c = await page.evaluate(measureContrast, 'dialog[open]');
        bad.push(...c.map((p) => `${name}: "${p.text}" ${p.ratio}:1`));
        const n = await page.evaluate(measureNames, 'dialog[open]');
        bad.push(...n.problems.map((p) => `${name}: ${p}`));
        if (name === 'Wren' && w === 390 && scheme === 'dark') await shot(page, '390-dark-credit-sheet.png', false);
        if (name === 'Ryan' && w === 320) await shot(page, `320-${scheme}-drop-dialog.png`, false);
        await ctx.close();
      }
      assert(bad.length === 0, [...new Set(bad)].slice(0, 8).join(' | '));
    });
  }
  await check('credit sheet: balance, history in plain words, Request cash out from Alex; pending reads "Cash out requested: $9, pending" + Cancel request', async () => {
    const { ctx, page } = await open('Wren', 390, 'light', {}, { more: false });
    await page.locator('header [data-credit-chip]').click();
    const sheet = page.locator('[data-credit-sheet]');
    await sheet.waitFor();
    const t = squash(await sheet.innerText());
    assert(/\$9 credit/.test(t) && /Request cash out from Alex/.test(t) && (await sheet.locator('[data-credit-change]').count()) >= 1, t);
    await ctx.close();
    const pia = await open('Pia', 390, 'light', {}, { more: false });
    await pia.page.locator('header [data-credit-chip]').click();
    const t2 = squash(await pia.page.locator('[data-credit-sheet]').innerText());
    assert(/Cash out requested: \$9, pending/.test(t2) && /Cancel request/.test(t2), t2);
    await pia.ctx.close();
  });
  for (const scheme of ['light', 'dark']) {
    await check(`${scheme}: Drop out dialog by keyboard: focus moves in, stays in on Tab, Escape closes it, focus back on Drop out`, async () => {
      const { ctx, page } = await open('Ryan', 390, scheme, {}, { more: false });
      const link = page.locator(`#row-${S[2]}`).getByRole('button', { name: 'Drop out' });
      await link.focus();
      await page.keyboard.press('Enter');
      await page.locator('dialog[open]').waitFor();
      const inside = () => page.evaluate(() => {
        const a = document.activeElement;
        return !!a && (a === document.body || !!a.closest('dialog[open]'));
      });
      assert(await page.evaluate(() => !!document.activeElement.closest('dialog[open]')), 'focus did not move into the dialog');
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        assert(await inside(), `Tab ${i + 1} left the dialog: ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80))}`);
      }
      const title = await page.locator('dialog[open] h2').innerText();
      assert(/^Out for tomorrow\?|^Out for (this )?Thu/.test(title) || /Thursday|Thu/.test(title), `title "${title}"`);
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
      assert((await page.locator('dialog[open]').count()) === 0, 'Escape did not close');
      assert(await link.evaluate((el) => el === document.activeElement), `focus went to ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80))}`);
      assert((await page.locator(`#row-${S[2]}`).getAttribute('data-mine')) === 'in', 'Escape dropped him out');
      await ctx.close();
    });
    await check(`${scheme}: credit sheet by keyboard: opens from the chip, focus stays in, Escape closes, focus back on the chip`, async () => {
      const { ctx, page } = await open('Wren', 390, scheme, {}, { more: false });
      const chip = page.locator('header [data-credit-chip]');
      await chip.focus();
      await page.keyboard.press('Enter');
      await page.locator('[data-credit-sheet]').waitFor();
      assert(await page.evaluate(() => !!document.activeElement.closest('dialog[open]')), 'focus not in the sheet');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        assert(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('dialog[open]')), `Tab ${i + 1} left the sheet`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      assert((await page.locator('dialog[open]').count()) === 0, 'Escape did not close');
      assert(await chip.evaluate((el) => el === document.activeElement), `focus went to ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80))}`);
      await ctx.close();
    });
  }
  await check('Go back in the Drop out dialog closes it and puts focus back on Drop out', async () => {
    const { ctx, page } = await open('Ryan', 320, 'light', {}, { more: false });
    const link = page.locator(`#row-${S[2]}`).getByRole('button', { name: 'Drop out' });
    await link.click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Go back' }).click();
    await page.waitForTimeout(300);
    assert((await page.locator('dialog[open]').count()) === 0, 'still open');
    assert(await link.evaluate((el) => el === document.activeElement), `focus on ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80))}`);
    await ctx.close();
  });

  /* ---------------- keyboard: Tab reaches every control, in order, with a visible focus ring ---------------- */
  for (const [w, scheme, name] of [
    [390, 'light', 'Ryan'],
    [390, 'dark', 'Wren'],
    [320, 'light', 'Zed'],
    [320, 'dark', 'Sam'],
  ]) {
    await check(`${w}px ${scheme} (${name}): Tab reaches every control in screen order, each with a visible focus ring (3:1)`, async () => {
      const { ctx, page } = await open(name, w, scheme);
      const expected = await page.evaluate(() =>
        [...document.querySelectorAll('header button, header a[href], main button, main a[href]')]
          .filter((e) => e.checkVisibility() && !e.disabled && e.tabIndex >= 0 && !e.closest('.sr-only, dialog, .leaving'))
          .map((e) => (e.dataset.k = Math.random().toString(36).slice(2))),
      );
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      const seen = [];
      const ringBad = [];
      for (let i = 0; i < expected.length + 4; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return null;
          const cs = getComputedStyle(a);
          const parse = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          const lum = (c) => parse(c).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
          let bg = 'rgb(255,255,255)';
          for (let e = a.parentElement; e; e = e.parentElement) {
            const c = getComputedStyle(e).backgroundColor;
            if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
              bg = c;
              break;
            }
          }
          const ratio = cs.outlineStyle !== 'none' ? (Math.max(lum(cs.outlineColor), lum(bg)) + 0.05) / (Math.min(lum(cs.outlineColor), lum(bg)) + 0.05) : 0;
          const r = a.getBoundingClientRect();
          const card = a.closest('article');
          return {
            k: a.dataset.k,
            label: (a.getAttribute('aria-label') || a.textContent).trim().slice(0, 30),
            ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 ? ratio : cs.boxShadow !== 'none' ? 99 : 0,
            top: r.top + scrollY,
            card: card ? [...document.querySelectorAll('.schedule > article')].indexOf(card) : -1,
            inView: r.bottom > 0 && r.top < innerHeight,
          };
        });
        if (!f) continue;
        seen.push(f);
        if (f.ring < 3) ringBad.push(`"${f.label}" ring ${f.ring.toFixed ? f.ring.toFixed(2) : f.ring}`);
        if (!f.inView) ringBad.push(`"${f.label}" focused off screen`);
      }
      const got = new Set(seen.map((s) => s.k));
      const missed = expected.filter((k) => !got.has(k));
      const missedLabels = await page.evaluate((ks) => ks.map((k) => document.querySelector(`[data-k="${k}"]`)?.textContent.trim().slice(0, 30)), missed);
      assert(missed.length === 0, `Tab never reached ${missedLabels.join(', ')}`);
      const cards = seen.map((s) => s.card).filter((c) => c >= 0);
      assert(cards.every((c, i) => i === 0 || c >= cards[i - 1]), `focus jumps between cards: ${cards.join(',')}`);
      assert(ringBad.length === 0, [...new Set(ringBad)].slice(0, 8).join(' | '));
      await ctx.close();
    });
  }
  await check('named controls: calendar icon, filter switch, CREDIT chip, not you?, Undo, Drop out, light/dark', async () => {
    const { ctx, page } = await open('Sam', 390, 'light');
    const card = page.locator(`#row-${S[3]}`);
    await card.getByRole('link', { name: 'Add Tue, Nov 10 to calendar' }).waitFor({ timeout: 2000 });
    await card.getByRole('button', { name: 'Undo' }).waitFor({ timeout: 2000 });
    await card.getByRole('button', { name: 'Drop out' }).waitFor({ timeout: 2000 });
    await page.getByRole('button', { name: /^Showing all games\. Switch to my games$/ }).waitFor({ timeout: 2000 });
    await page.getByRole('button', { name: 'Not you?' }).waitFor({ timeout: 2000 });
    await page.getByRole('button', { name: /^Light or dark: Auto\. Tap to change\.$/ }).waitFor({ timeout: 2000 });
    await ctx.close();
    const w = await open('Wren', 390, 'light', {}, { more: false });
    await w.page.getByRole('button', { name: '$9 credit. Open your credit' }).waitFor({ timeout: 2000 });
    await w.ctx.close();
  });
  await check('each card is a labelled article ("Thursday, Nov 5, 8:00 to 10:00 PM. You\'re in"), the date tile is hidden from screen readers', async () => {
    const { ctx, page } = await open('Ryan', 390, 'light');
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.schedule > article')].map((a) => ({
        name: document.getElementById(a.getAttribute('aria-labelledby'))?.textContent.trim(),
        tileHidden: a.querySelector('.tile-wrap')?.getAttribute('aria-hidden') === 'true',
      })),
    );
    const bad = r.filter((x) => !x.name || !/^\w+day, \w{3} \d+, /.test(x.name) || !x.tileHidden);
    assert(bad.length === 0, JSON.stringify(bad.slice(0, 3)));
    await ctx.close();
  });

  /* ---------------- big text ----------------
   * Text made 150% / 200% bigger (root and body size) while the screen stays the same width: what Safari's text
   * size (aA) and Larger Text amount to on a phone. Problems are sorted: the known defects get their own BUG checks,
   * everything else must stay clean. */
  for (const [w, pct] of [
    [390, 150],
    [320, 150],
    [390, 200],
  ]) {
    const found = { other: [], money: [], header: [], tonight: [], later: [] };
    for (const name of ['Ryan', 'Wren', 'Zed', BMS]) {
      const { ctx, page } = await open(name, w, 'light');
      await page.addStyleTag({ content: `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` });
      await page.waitForTimeout(250);
      const f = await page.evaluate(collectFacts);
      const sort = (x, tier) => {
        if (known.eyebrow(x)) return null; // deliberate "..."
        if (/^h1\. "[^"]*" \(\d+x\d+ in \d+x\d+\)$/.test(x)) return null; // the name ends in "..." (deliberate, Nov 2026)
        if (tier === 'later' && /broken mid-word/.test(x)) return 'later';
        if (/pchip|cal-icon-link|court-status|st-tail|span\.chip-credit/.test(x)) return 'money';
        if (known.headerName(x) || /spills out of the (credit-chip|today)/.test(x) || /^(h1|div\.title-line|div\.topbar-text)/.test(x)) return 'header';
        return 'other';
      };
      const add = (x, where, tier) => {
        const k = sort(x, tier);
        if (k) found[k].push(`${name.split(' ')[0]}${where ? ` ${where}` : ''}: ${x}`);
      };
      if (f.sw > f.vw) add(`page ${f.sw}px wide in ${f.vw}`);
      for (const x of f.offScreen) add(x, 'past the edge');
      for (const c of f.cards) {
        for (const x of [...c.overlaps, ...c.leaks, ...c.clipped]) add(x, lab(c.id), c.tier);
        if (c.tonight && !c.tonightIn) found.tonight.push(`${name.split(' ')[0]} ${lab(c.id)}: TONIGHT runs past its strip`);
      }
      for (const x of [...f.header.overlaps, ...f.header.clipped, ...f.header.spill]) add(x, 'header');
      if (name === 'Wren' && pct === 200) await shot(page, `390-light-text200-${name}.png`);
      if (name === 'Ryan') await shot(page, `${w}-light-text${pct}-${name}.png`);
      if (name === 'Wren' && pct === 150 && w === 320) await shot(page, `320-light-text150-${name}.png`);
      await ctx.close();
    }
    const tag = `big text ${pct}% at ${w}px`;
    const list = (a) => `${a.length} problems: ${[...new Set(a)].slice(0, 8).join(' | ')}`;
    await check(`${tag}: no sideways scroll, nothing past the edge, overlapping or cut off (cards, Pay card, header)`, async () => {
      assert(found.other.length === 0, list(found.other));
    });
    await check(`${tag}: the money chip ("$14 due · $9 credit") and the "Court not booked" + calendar line stay inside the card`, async () => {
      assert(found.money.length === 0, list(found.money));
    });
    await check(`${tag}: LATER rows keep a readable middle column (names and status not broken letter by letter beside a wide button)`, async () => {
      assert(found.later.length === 0, list(found.later));
    });
    await check(`${tag}: the TONIGHT word stays inside its blue strip`, async () => {
      assert(found.tonight.length === 0, list(found.tonight));
    });
    await check(`${tag}: the player's name (ends in "..." when long), CREDIT chip and date square in the header are whole (no "Wre / n", no text out of its box)`, async () => {
      assert(found.header.length === 0, list(found.header));
    });
  }

  /* ---------------- reduce motion ---------------- */
  await check('reduce motion: nothing moves on load, on I\'m in, or on the banner (fade only)', async () => {
    const { ctx, page } = await open('Quinn', 390, 'light', { reducedMotion: 'reduce' });
    const running = () =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && !(a.effect?.target?.closest?.('.pop') && /fade/.test(a.animationName || '')) && !a.effect?.target?.classList?.contains('spinner'))
          .map((a) => `${a.animationName || a.transitionProperty} on ${a.effect?.target?.className}`),
      );
    assert((await running()).length === 0, `on load: ${await running()}`);
    const card = page.locator(`#row-${S[11]}`);
    await card.getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop').waitFor();
    const r = await running();
    assert(r.length === 0, `after I'm in: ${r}`);
    const banner = await page.locator('.pop').evaluate((el) => getComputedStyle(el).animationName);
    assert(banner === 'banner-fade-in', `banner ${banner}`);
    await ctx.close();
  });

  /* ---------------- no Venmo set: I paid instead of Pay ---------------- */
  await ok(await areq.put(BASE + '/api/admin/group', { data: { venmoUrl: null }, headers: { Origin: BASE } }), 'no venmo');
  await check('no Venmo link: the card shows "I paid" (filled), the Pay card "I paid" + "Pay Alex however you usually do." (320 and 390, light and dark)', async () => {
    for (const [w, scheme] of COMBOS) {
      const { ctx, page } = await open('Ryan', w, scheme);
      const f = await page.evaluate(collectFacts);
      const c = cardOf(f, S[2]);
      assert(hasBtn(c, /^I paid$/) && !hasBtn(c, /^Pay$/), `${w} ${scheme}: ${c.text}`);
      assert(f.pay && /Pay Alex however you usually do\./.test(f.pay.text) && f.pay.controls.some((x) => x.text === 'I paid'), f.pay && f.pay.text);
      const taps = await page.evaluate(measureTaps, 'main');
      // (The calendar icon and the 1.5 px edge under I paid are their own BUG checks above.)
      const small = taps.filter((t) => !known.calTap(t) && !known.edgeSteal(t) && (t.w < 43.5 || t.h < 43.5));
      assert(small.length === 0 && c.overlaps.length === 0 && c.leaks.length === 0, `${JSON.stringify(small)} ${c.overlaps} ${c.leaks}`);
      if (w === 320 && scheme === 'light') await shot(page, '320-light-no-venmo.png');
      await ctx.close();
    }
  });
  await ok(await areq.put(BASE + '/api/admin/group', { data: { venmoUrl: 'https://venmo.com/u/organizer' }, headers: { Origin: BASE } }), 'venmo back');

  /* ---------------- Friday: THIS WEEK holds one game ---------------- */
  await clock('2026-11-06T09:00:00-05:00');
  await check('Friday Nov 6: THIS WEEK has exactly one game (Saturday), headers still in order, no sideways scroll at 320 dark', async () => {
    const { ctx, page } = await open('Ryan', 320, 'dark');
    const f = await page.evaluate(collectFacts);
    const n = (t) => f.cards.filter((x) => x.tier === t).length;
    assert(n('this') === 1 && f.tiers.map((t) => t.label).join('|') === 'This week|Next week|Later', `${n('this')} ${JSON.stringify(f.tiers)}`);
    assert(f.sw <= f.vw && f.offScreen.length === 0, f.offScreen.join(' | '));
    await ctx.close();
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed, ${openCount} open (known, listed in docs/AUDIT_SCENARIOS_player.md)`);
  if (failures.length) console.log(`failing:\n  ${failures.join('\n  ')}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
