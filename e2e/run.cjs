/* Browser tests: drives the real app (Vite dev server + local SQLite API)
 * in Chromium with an iPhone-sized screen.
 *
 *   npm run test:e2e
 *
 * Against a deployed copy instead (it creates a group there, so only point
 * this at a throwaway test site, never the real one):
 *
 *   E2E_BASE_URL=https://example.pages.dev E2E_SETUP_TOKEN=... npm run test:e2e
 *
 * Needs Playwright with Chromium available (`npx playwright install chromium`
 * if it isn't already on your machine).
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5199;
const REMOTE = process.env.E2E_BASE_URL ? process.env.E2E_BASE_URL.replace(/\/$/, '') : null;
const BASE = REMOTE ?? `http://localhost:${PORT}`;
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN ?? 'e2e-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');
/** The plain site address the texts use ("pickleball.juncaj.net" live). */
const SITE = BASE.replace(/^https?:\/\//, '');

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 600)}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Drop out now waits 5 seconds for Undo before it is sent: confirm, then wait until the server has it. */
async function confirmDrop(p) {
  const sent = p.waitForResponse((r) => /\/withdraw$/.test(r.url()), { timeout: 15000 });
  await p.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
  // In the organizer's demo (View as...) nothing goes over the network, so just wait out the hold.
  await Promise.race([sent, p.waitForTimeout(6000)]);
  sent.catch(() => {});
  await p.waitForTimeout(400);
}

/** Bottom tab bar button (card buttons can share the same label). */
const tab = (page, name) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${name}`) });
/** Session cards on the organizer Home (attention cards above them are articles too). */
const sessionCards = (page) => page.locator('section[aria-labelledby="sessions-title"] article');
/** Open a session card's "More" buttons (Money, Texts, Reschedule, Invite, Cancel). */
async function more(card) {
  const gear = card.getByRole('button', { name: /^Session options/ });
  // Wait until the card has drawn, then open the options unless they're open.
  await gear.waitFor();
  if ((await gear.getAttribute('aria-expanded')) !== 'true') await gear.click();
  await card.locator('.options').waitFor();
}

/** The Money tab, with this session's payments opened. */
async function moneyFor(page, card) {
  const id = (await card.getAttribute('id')).replace('session-', '');
  await tab(page, 'Money').click();
  const d = page.locator(`details.money-sess[data-session="${id}"]`);
  await d.waitFor();
  await d.evaluate((el) => (el.open = true));
  return d;
}

/**
 * A Venmo Pay link: the web link and the app link carry exactly this amount
 * (14, 9, ...) and the note "Pickleball Tue Nov 3 - Name", spaces as %20.
 */
async function venmoLinkOk(link, dollars, name) {
  const web = await link.getAttribute('href');
  const app = await link.getAttribute('data-app-href');
  assert(web.startsWith(`https://venmo.com/?txn=pay&recipients=organizer&amount=${dollars}&note=`), `bad web link ${web}`);
  assert(app.startsWith(`venmo://paycharge?txn=pay&recipients=organizer&amount=${dollars}&note=`), `bad app link ${app}`);
  for (const u of [web, app]) {
    const q = u.slice(u.indexOf('?') + 1);
    assert(!q.includes('+') && q.includes('Pickleball%20'), `spaces should be %20, never +: ${u}`);
    const params = new URLSearchParams(q);
    assert(params.get('amount') === String(dollars), `amount was ${params.get('amount')}`);
    const re = new RegExp(`^Pickleball (Tue|Thu) [A-Z][a-z]{2} \\d{1,2}(, (Tue|Thu) [A-Z][a-z]{2} \\d{1,2})* - ${name}$`);
    assert(re.test(params.get('note')), `Venmo note was ${params.get('note')}`);
  }
}

/** Tap Pay, then come back: the pickleball page never leaves its tab. */
async function payAndComeBack(page, link) {
  await toVenmo(page, link);
  await page.locator('.schedule article').first().waitFor();
}

/**
 * Tap Pay on the test iPhone: the Venmo app link goes nowhere here (no app),
 * the pickleball page stays put, no other tab opens, and no website link is
 * offered.
 */
async function toVenmo(page, link) {
  const before = page.url();
  const tabs = page.context().pages().length;
  await link.click();
  await page.waitForTimeout(1800);
  assert(page.url() === before, `Pay left the pickleball page: ${page.url()}`);
  assert(page.context().pages().length === tabs, 'Pay opened another tab on the phone');
  assert((await page.getByText(/Open Venmo website/).count()) === 0, 'no website link under Pay');
}

/** "I paid" is a quiet gray button right next to Pay, never a second green one. */
async function quietNextToPay(card) {
  const pay = await card.getByRole('link', { name: /^Pay \$\d+ with Venmo$/ }).evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, r: el.getBoundingClientRect().toJSON() }));
  const paid = await card.getByRole('button', { name: 'I paid' }).evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, r: el.getBoundingClientRect().toJSON() }));
  assert(pay.bg !== paid.bg, 'I paid should be quiet, not green');
  // Compact cards: Pay sits beside the amber chip; "I paid" is a small underlined link on the line below (or beside the middle block in a LATER row).
  assert(paid.r.height <= 30, `I paid should be a small link, it is ${paid.r.height}px tall`);
  assert(paid.r.y + paid.r.height / 2 > pay.r.y + pay.r.height / 2 - 2 || paid.r.x + paid.r.width <= pay.r.x, 'I paid sits under or left of Pay, a quiet link');
}

/** Home lists 4 sessions at first; show them all. */
async function showAll(page) {
  const btn = page.getByRole('button', { name: /^Show all \d+$/ });
  if (await btn.count()) await btn.click();
}

/** Open a card's gear panel and its "Text" choices. */
async function textMenu(card) {
  await more(card);
  const btn = card.getByRole('button', { name: 'Text', exact: true });
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  const menu = card.locator('.text-menu');
  await menu.locator('.text-row').first().waitFor();
  return menu;
}

/** Who and what an sms: link opens Messages with (iPhone and Android forms). */
function smsOf(href) {
  const m = href.match(/^sms:(?:\/\/open\?addresses=)?([^?&]*)[?&]body=(.*)$/);
  if (!m) throw new Error(`not an sms link: ${href}`);
  return { to: m[1] ? m[1].split(',') : [], body: decodeURIComponent(m[2]) };
}

/** Close a session card's options panel. */
async function closeOptions(card) {
  const gear = card.getByRole('button', { name: /^Session options/ });
  if ((await gear.getAttribute('aria-expanded')) === 'true') await gear.click();
  await card.locator('.options').waitFor({ state: 'detached' });
}

/** How far the test server's clock is pinned from real time (see the start of the run). */
let BASE_OFFSET = 0;

/** Open every collapsed Settings section (they remember being open). */
async function openSections(page) {
  await page.locator('details.set-sect').first().waitFor();
  await page.evaluate(() => document.querySelectorAll('details.set-sect:not([open])').forEach((d) => (d.open = true)));
  await page.waitForFunction(() => document.querySelectorAll('details.set-sect:not([open])').length === 0);
}

/** A Settings row (name, box, and its error or retry line). */
const rowOf = (field) => field.locator('xpath=ancestor::*[@data-row][1]');
/** Wait for that row's tiny "Saved" check. */
async function savedIn(field) {
  await rowOf(field).locator('.save-mark.saved').waitFor();
}
/** Type a setting and let it save itself: leave the box, or just pause. */
async function autoSet(field, value, { pause = false } = {}) {
  await field.fill(value);
  if (!pause) await field.blur();
  await savedIn(field);
  // Let the check fade so the next save shows a fresh one.
  await rowOf(field).locator('.save-mark.saved').waitFor({ state: 'detached', timeout: 5000 });
}


/** What counts as a "thing" on a card or a Settings row for the overlap checks. */
const CARD_ITEMS = 'button, a[href], input, .court-status, .tile, .sched-time, .late-tag, .holiday, .holiday-text, .court-sub, .players-line, .in-count, .names-line, .dots, .pchip, .tonight-tag, .sched-status, .credit-note, .sched-sub';
const SETTINGS_ITEMS = 'summary > span, .set-label, .set-input, .set-row input, .field-label, .auto-field input, .check, .set-body > button, .set-line button, .save-retry, .field-error';

/**
 * In the page: every visible thing inside each root is checked against its
 * neighbors (no overlaps) and against its card (nothing cut off or poking
 * out). Plain text links are measured by their text, not their invisible
 * 44px tap area.
 */
function layoutReport({ roots, items }) {
  const visual = (el) => {
    const cs = getComputedStyle(el);
    const solid = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || parseFloat(cs.borderTopWidth) > 0 || el.matches('input, select');
    if (solid) return el.getBoundingClientRect();
    const r = document.createRange();
    r.selectNodeContents(el);
    let b = r.getBoundingClientRect();
    // Text cut short with "…" only shows inside its own box.
    if (b.width && cs.overflow !== 'visible') {
      const own = el.getBoundingClientRect();
      b = DOMRect.fromRect({ x: Math.max(b.left, own.left), y: b.top, width: Math.min(b.right, own.right) - Math.max(b.left, own.left), height: b.height });
    }
    if (b.width && b.height) return b;
    const svg = el.querySelector('svg');
    return svg ? svg.getBoundingClientRect() : el.getBoundingClientRect();
  };
  const problems = [];
  let checked = 0;
  for (const root of document.querySelectorAll(roots)) {
    if (!root.offsetParent) continue;
    const card = root.getBoundingClientRect();
    const els = [...root.querySelectorAll(items)].filter((e) => e.offsetParent !== null && e.getClientRects().length && e.checkVisibility() && !e.closest('[hidden], dialog:not([open]), .sr-only'));
    const boxes = els.map((e) => ({ e, b: visual(e), label: (e.getAttribute('aria-label') || e.innerText || e.className || e.tagName).trim().slice(0, 30) }));
    for (const x of boxes) {
      checked++;
      if (x.b.left < card.left - 1 || x.b.right > card.right + 1) problems.push(`"${x.label}" pokes past its card`);
      if (x.b.right > window.innerWidth + 1) problems.push(`"${x.label}" runs off the screen`);
      const tx = x.e.matches('input, select, textarea') ? null : x.e;
      if (tx && tx.scrollWidth > tx.clientWidth + 2 && getComputedStyle(tx).textOverflow !== 'ellipsis' && getComputedStyle(tx).overflow !== 'visible') problems.push(`"${x.label}" is cut off`);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
        const w = Math.min(a.b.right, b.b.right) - Math.max(a.b.left, b.b.left);
        const h = Math.min(a.b.bottom, b.b.bottom) - Math.max(a.b.top, b.b.top);
        if (w > 1 && h > 1) problems.push(`"${a.label}" overlaps "${b.label}" [${a.e.className}:${Math.round(a.b.left)}-${Math.round(a.b.right)}x${Math.round(a.b.top)}-${Math.round(a.b.bottom)} vs ${b.e.className}:${Math.round(b.b.left)}-${Math.round(b.b.right)}x${Math.round(b.b.top)}-${Math.round(b.b.bottom)}]`);
      }
  }
  return { problems, checked };
}

/**
 * In the page: every card (and sheet) with more than one filled green button.
 * Green is the color a plain "btn" gets; only buttons whose own card is this
 * one count, so a card inside a card is judged on its own.
 */
function greenReport() {
  // A plain button's green, and the player cards' own green (and mint in dark mode).
  const greens = new Set();
  for (const host of [document.body, document.querySelector('.schedule'), document.querySelector('.pay-card')]) {
    if (!host) continue;
    const probe = document.createElement('button');
    probe.className = 'btn';
    host.appendChild(probe);
    greens.add(getComputedStyle(probe).backgroundColor);
    probe.remove();
  }
  const green = [...greens].join(' | ');
  const box = '.card, article, .sched, .draft, dialog[open] .sheet-body';
  const problems = [];
  let cards = 0;
  for (const card of document.querySelectorAll(`main :is(${box}), dialog[open] .sheet-body`)) {
    if (!card.getClientRects().length || !card.checkVisibility()) continue;
    cards++;
    const filled = [...card.querySelectorAll('button, a')].filter((b) => b.closest(box) === card && b.checkVisibility() && greens.has(getComputedStyle(b).backgroundColor));
    if (filled.length > 1) problems.push(`"${(card.getAttribute('aria-label') || card.id || card.className).slice(0, 40)}" has ${filled.length} green buttons: ${filled.map((b) => b.textContent.trim()).join(', ')}`);
  }
  return { problems, cards, green };
}

/**
 * In the page: the paper-calendar tiles and the gentle fade. Every weekday is
 * red and readable; every word on a card passes 4.5:1 with no faded opacity;
 * each later week's tile outline stands out a little less than the one before.
 */
function designReport() {
  const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = (c) => rgb(c).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const problems = [];
  // Extra (hand-added) games use a light weekday on an ink tile (cream tile with dark text in dark mode) by design.
  const dows = [...document.querySelectorAll('.tile:not(.extra) .dow, header .today .dow')].filter((d) => d.checkVisibility());
  for (const d of dows) {
    const color = getComputedStyle(d).color;
    const [r, g, b] = rgb(color);
    if (!(r > g + 50 && r > b + 40)) problems.push(`weekday "${d.textContent}" is not red: ${color}`);
    const c = contrast(color, bgOf(d));
    if (c < 4.5) problems.push(`weekday "${d.textContent}" contrast ${c.toFixed(2)}`);
  }
  const cards = [...document.querySelectorAll('main article')].filter((a) => a.checkVisibility() && a.querySelector('.tile'));
  for (const card of cards) {
    if (card.classList.contains('off')) continue; // a canceled session keeps its own look
    for (const el of card.querySelectorAll('*')) {
      if (!el.checkVisibility() || el.closest('.sr-only, button:disabled, dialog')) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      let op = 1;
      for (let e = el; e && e !== document.body; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      if (op < 0.999) problems.push(`faded text "${el.textContent.trim().slice(0, 20)}" (opacity ${op.toFixed(2)})`);
      const c = contrast(getComputedStyle(el).color, bgOf(el));
      if (c < 4.5) problems.push(`low contrast ${c.toFixed(2)}: "${el.textContent.trim().slice(0, 24)}" (tier ${card.dataset.tier || 'this'})`);
    }
  }
  // Tiles by tier (this week, next week, later): each tier steps down, a thinner outline or a lighter one.
  const order = ['this', 'next', 'later'];
  const byTier = {};
  for (const card of cards) {
    const t = card.querySelector('.tile');
    const cs = getComputedStyle(t);
    (byTier[card.dataset.tier || 'this'] ??= []).push({ w: parseFloat(cs.borderTopWidth), c: contrast(cs.borderTopColor, cs.backgroundColor), size: t.getBoundingClientRect().width });
  }
  const avgOf = (rows, k) => rows.reduce((s, v) => s + v[k], 0) / rows.length;
  const present = order.filter((t) => byTier[t]);
  const levels = present.map((t) => order.indexOf(t));
  for (let i = 1; i < present.length; i++) {
    const a = byTier[present[i - 1]];
    const b = byTier[present[i]];
    const smaller = avgOf(b, 'size') < avgOf(a, 'size') - 4;
    if (!smaller) problems.push(`tier ${present[i]} tile is not smaller than ${present[i - 1]}`);
    if (!(avgOf(b, 'w') < avgOf(a, 'w') - 0.3 || avgOf(b, 'c') < avgOf(a, 'c') - 0.3)) problems.push(`tier ${present[i]} tile outline is not lighter or thinner than ${present[i - 1]}`);
  }
  return { problems, levels, dows: dows.length };
}

/** In the page: scrolled to the very bottom, is the last button or link hidden by the floating tab bar? */
function lastNotCovered() {
  window.scrollTo(0, document.documentElement.scrollHeight);
  const bar = document.querySelector('.tabbar');
  if (!bar) return null;
  const top = bar.getBoundingClientRect().top;
  // Only things on screen: not the insides of a closed section.
  const all = [...document.querySelectorAll('main button, main a[href], main input, main summary')].filter((e) => e.offsetParent !== null && e.checkVisibility() && e.getBoundingClientRect().height > 0);
  const last = all.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).pop();
  const r = last.getBoundingClientRect();
  return r.bottom > top + 1 ? `"${(last.innerText || last.getAttribute('aria-label') || '').trim()}" sits under the tab bar (${Math.round(r.bottom - top)}px)` : null;
}

/** In the page: the player header's pieces, for the one-line checks. */
function headerReport() {
  const head = document.querySelector('header.topbar');
  const h1 = head.querySelector('h1');
  const nu = head.querySelector('.not-you');
  const mode = head.querySelector('.mode-btn');
  const sq = head.querySelector('.today');
  const line = head.querySelector('.title-line') || h1;
  const box = (e) => e && e.getBoundingClientRect();
  const parts = { name: box(h1), notYou: box(nu), mode: box(mode), square: box(sq) };
  const vis = (b) => b && b.width > 0 && b.left >= -1 && b.right <= window.innerWidth + 1;
  let overlap = null;
  const keys = Object.keys(parts);
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const a = parts[keys[i]];
      const b = parts[keys[j]];
      if (!a || !b) continue;
      // The mode button's 44px tap area may touch the date square; its drawn circle may not.
      const ai = keys[i] === 'mode' ? { left: a.left + 4, right: a.right - 4, top: a.top + 4, bottom: a.bottom - 4 } : a;
      const bi = keys[j] === 'mode' ? { left: b.left + 4, right: b.right - 4, top: b.top + 4, bottom: b.bottom - 4 } : b;
      if (Math.min(ai.right, bi.right) - Math.max(ai.left, bi.left) > 1 && Math.min(ai.bottom, bi.bottom) - Math.max(ai.top, bi.top) > 1) overlap = `${keys[i]} / ${keys[j]}`;
    }
  const after = getComputedStyle(mode, '::after');
  return {
    welcome: /Welcome,/.test(head.innerText),
    oneLine: line.getBoundingClientRect().height < 40 && nu.getClientRects().length === 1,
    height: line.getBoundingClientRect().height,
    allVisible: vis(parts.notYou) && vis(parts.mode) && vis(parts.square) && (() => {
      const r = document.createRange();
      r.selectNodeContents(nu);
      return r.getBoundingClientRect().width <= parts.notYou.width + 1;
    })(),
    overlap,
    boxes: parts,
    nameFits: h1.scrollWidth <= h1.clientWidth + 1,
    ellipsis: getComputedStyle(h1).textOverflow === 'ellipsis' && h1.scrollWidth > h1.clientWidth,
    modeTap: Math.min(parts.mode.width, parts.mode.height),
    modeCircle: parts.mode.width - parseFloat(after.left) - parseFloat(after.right),
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/status`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('dev server did not start');
}

async function main() {
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'e2e.sqlite');
  rmSync(dbFile, { force: true });
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  let serverLog = '';
  const server = REMOTE
    ? null
    : spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
        cwd: ROOT,
        env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group, so stopping it also stops the Vite process npx starts.
        detached: true,
      });
  const stopServer = () => {
    if (!server) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
  process.on('exit', stopServer);
  server?.stdout.on('data', (d) => (serverLog += d));
  server?.stderr.on('data', (d) => (serverLog += d));

  const proxy = REMOTE && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {};
  const browser = await chromium.launch(proxy);
  // The browsers' clocks start where the test server's does (Tue Oct 27,
  // 12:30 AM Eastern, see below), so both agree on which games are over.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts);
    await ctx.addInitScript((off) => {
      if (!off) return;
      const RealDate = Date;
      const now = () => RealDate.now() + off;
      function PinnedDate(...args) {
        if (!new.target) return new RealDate(now()).toString();
        return args.length ? new RealDate(...args) : new RealDate(now());
      }
      PinnedDate.prototype = RealDate.prototype;
      PinnedDate.now = now;
      PinnedDate.parse = RealDate.parse;
      PinnedDate.UTC = RealDate.UTC;
      globalThis.Date = PinnedDate;
    }, BASE_OFFSET);
    return ctx;
  };
  const pageErrors = [];
  const phone = (width = 390) => ({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    // Animations off for steady measurements; the motion check turns them back on.
    reducedMotion: 'reduce',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  async function newPage(width, colorScheme = 'light') {
    const ctx = await browser.newContext({ ...phone(width), colorScheme });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && pageErrors.push(m.text()));
    return page;
  }

  try {
    await waitForServer();
    // Pin the test server's clock (and the browsers', below) so results never
    // depend on the day or time this runs: every run starts at Tue Oct 27,
    // 2026, 12:30 AM Eastern, game day before the 8:00 AM money card, with the
    // first November games inside their booking window. Time then moves on
    // normally from there.
    if (!REMOTE) {
      BASE_OFFSET = Date.parse('2026-10-27T00:30:00-04:00') - Date.now();
      await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.now() + BASE_OFFSET }) });
    }
    const admin = await newPage();
    let playerLink = '';

    console.log('Setup');
    await check('landing page sends a new organizer to setup', async () => {
      await admin.goto(BASE);
      await admin.getByRole('button', { name: 'Set up the group' }).click();
      await admin.getByRole('heading', { name: 'Set up your group' }).waitFor();
    });

    await check('setup creates the group and shows the player link', async () => {
      await admin.getByLabel('Setup code').fill(SETUP_TOKEN);
      await admin.getByLabel('Group name').fill('Dink Dynasty');
      await admin.getByLabel('PIN', { exact: true }).fill(PIN);
      await admin.getByLabel('PIN again').fill(PIN);
      await admin.getByLabel('Your Venmo link (optional)').fill('https://venmo.com/u/organizer');
      const names = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
      for (let i = 0; i < names.length; i++) {
        await admin.getByLabel(`Player ${i + 1} name`).fill(names[i]);
        await admin.getByLabel(`Player ${i + 1} phone`).fill(`313555010${i}`);
      }
      await admin.getByRole('button', { name: 'Create group' }).click();
      await admin.getByText('Share this link with your players').waitFor();
      playerLink = (await admin.locator('code.link').textContent()).trim();
      // The player link is now just the site address.
      assert(playerLink === BASE, `player link should be the plain address, was ${playerLink}`);
      await admin.screenshot({ path: path.join(SHOTS, 'setup-done.png'), fullPage: true });
    });

    await check('organizer Home is lean: no first-visit notice, no guiding filler, today\'s date top right', async () => {
      await admin.getByRole('button', { name: 'Go to the organizer dashboard' }).click();
      await tab(admin, 'Home').waitFor();
      await sessionCards(admin).first().waitFor();
      assert((await admin.getByRole('note').count()) === 0, 'first-visit notice should be gone');
      for (const filler of [/never sends texts/, /Texts are never sent automatically/, /Times shown in Eastern time/, /When the venue gives you a court/, /After you book, come back/, /Earned when 6 played/, /Hidden from everyone/]) {
        assert((await admin.getByText(filler).count()) === 0, `filler still shown: ${filler}`);
      }
      // Today as a calendar square: "MON" over a big "26", Eastern time.
      const square = admin.locator('header .today');
      const now = new Date(Date.now() + BASE_OFFSET);
      const dow = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Detroit' }).toUpperCase();
      const day = now.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/Detroit' });
      assert((await square.locator('.dow').innerText()).trim() === dow, `square weekday was not ${dow}`);
      assert((await square.locator('.day').innerText()).trim() === day, `square day was not ${day}`);
      const long = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Detroit' });
      assert((await square.getAttribute('aria-label')) === `Today is ${long}`, 'square needs a spoken date');
      const box = await square.boundingBox();
      const vw = admin.viewportSize().width;
      assert(box.x + box.width > vw - 24 && Math.abs(box.width - box.height) <= 4, 'date square should sit at the top right');
      // Name, View as… and the date square share one row; the band stays short.
      const band = await admin.locator('header.topbar').boundingBox();
      const viewAs = await admin.locator('header').getByRole('button', { name: 'View as…' }).boundingBox();
      const name = await admin.locator('header h1').boundingBox();
      assert(Math.abs(viewAs.y + viewAs.height / 2 - (box.y + box.height / 2)) < 8 && name.y < box.y + box.height, 'header items should share one row');
      assert(band.height <= 80, `green header is ${band.height}px tall`);
      await admin.screenshot({ path: path.join(SHOTS, 'admin-home.png'), fullPage: true });
    });

    await check('nothing to do: no "Needs attention" section at all; View as… sits in the green header', async () => {
      // A day-before or last-call card may be due right now, depending on the clock. Clear it to empty the list.
      const todo = admin.locator('section[aria-labelledby="todo-title"]');
      if (await todo.count()) {
        await todo.getByRole('heading', { name: 'Needs attention' }).waitFor();
        while ((await todo.getByRole('button', { name: 'Done', exact: true }).count()) > 0) {
          const n = await todo.locator('article').count();
          await todo.getByRole('button', { name: 'Done', exact: true }).first().click();
          await admin.waitForFunction((was) => document.querySelectorAll('section[aria-labelledby="todo-title"] article').length < was, n);
        }
      }
      assert((await admin.getByRole('heading', { name: 'Needs attention' }).count()) === 0, 'empty Needs attention should be hidden');
      assert((await admin.getByText('Nothing needs you right now').count()) === 0, 'empty-state box should be gone');
      const viewAs = admin.locator('header').getByRole('button', { name: 'View as…' });
      await viewAs.waitFor();
      assert((await admin.getByRole('button', { name: 'View as…' }).count()) === 1, 'View as… should appear once, in the header');
      const b = await viewAs.boundingBox();
      const header = await admin.locator('header.topbar').boundingBox();
      const square = await admin.locator('header .today').boundingBox();
      // Top right: just left of the date square, inside the green band.
      assert(square.x - (b.x + b.width) < 16 && b.x > header.width / 2 && b.y + b.height <= header.y + header.height, 'View as… should be at the top right of the header');
      assert(b.height >= 44, `View as… is too small to tap (${b.height}px)`);
    });

    await check('booking window: amber inside 14 days, quiet gray "Booking opens [date]" further out; badge counts only the amber ones', async () => {
      const cards = sessionCards(admin);
      const all = admin.getByRole('button', { name: /^Show all/ });
      if (await all.count()) await all.click();
      const today = Date.now() + BASE_OFFSET;
      let amber = 0;
      let gray = 0;
      for (let i = 0; i < (await cards.count()); i++) {
        const c = cards.nth(i);
        const kind = await c.getAttribute('data-court');
        if (kind === 'needs') {
          amber++;
          await c.locator('.court-banner').getByText('Court not booked', { exact: true }).waitFor();
        }
        if (kind === 'later') {
          gray++;
          const text = (await c.locator('.court-status').innerText()).trim();
          const m = text.match(/^Booking opens (Sun|Mon|Tue|Wed|Thu|Fri|Sat), ([A-Z][a-z]{2} \d{1,2})$/);
          assert(m, `quiet card said: ${text}`);
          // The opening date is 14 days before the session.
          const day = (await c.locator('h2').innerText()).trim().replace(/^[A-Z][a-z]{2}, /, '');
          let start = new Date(`${day}, ${new Date(today).getFullYear()} 12:00`);
          if (start.getTime() < today - 60 * 24 * 3600_000) start = new Date(`${day}, ${new Date(today).getFullYear() + 1} 12:00`);
          const opens = new Date(start.getTime() - 14 * 24 * 3600_000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          assert(text === `Booking opens ${opens}`, `quiet card said "${text}", expected "Booking opens ${opens}" for ${day}`);
          const look = await c.evaluate((el) => ({ border: getComputedStyle(el).borderTopStyle, banner: el.querySelectorAll('.court-banner').length }));
          assert(look.border !== 'dashed' && look.banner === 0, 'far-off sessions should not get the amber look');
          assert((await c.getByRole('button', { name: 'I booked it' }).count()) === 0, 'quiet card should keep I booked it under More');
        }
      }
      assert(amber > 0 && gray > 0, `expected both looks, got ${amber} amber and ${gray} gray`);
      // Counted by calendar date: the session exactly 14 days out is open from 12:00 AM today.
      const in14 = new Date(today + 14 * 24 * 3600_000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Detroit' });
      const card14 = sessionCards(admin).filter({ has: admin.locator('h2', { hasText: in14 }) });
      if (await card14.count()) {
        assert((await card14.getAttribute('data-court')) === 'needs', `${in14} is 14 days out and should be open to book`);
        await card14.locator('.court-banner').getByRole('button', { name: 'I booked it' }).waitFor();
      }
      // The badge reminds from 7:00 AM on the day booking opens (the test clock is 12:30 AM).
      const reminded = await sessionCards(admin).locator('xpath=self::*[@data-remind="true"]').count();
      const badge = (await tab(admin, 'Home').locator('.badge').innerText()).replace(/\D/g, '');
      const todoCards = await admin.locator('section[aria-labelledby="todo-title"] article').count();
      assert(Number(badge) === reminded + todoCards, `badge was ${badge}, expected ${reminded + todoCards}`);
      assert(reminded <= amber, 'only open courts are reminded about');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-window.png'), fullPage: true });
      await admin.reload();
      await sessionCards(admin).first().waitFor();
    });

    await check('sessions are grouped by calendar week with a divider', async () => {
      const section = admin.locator('section[aria-labelledby="sessions-title"]');
      const labels = await section.locator('.week-break h3').allInnerTexts();
      assert(labels.length >= 2, `expected week dividers, got ${labels}`);
      assert(/^(This week|Next week|Week of [A-Z][a-z]{2} \d{1,2})$/i.test(labels[0].trim()), `first divider was ${labels[0]}`);
      // No two dividers in a row, and never more than 2 sessions (Tue + Thu) between them.
      const kids = await section.evaluate((el) => [...el.querySelectorAll(':scope > .week-break, :scope > article')].map((n) => (n.matches('.week-break') ? 'H3' : n.tagName)));
      let run = 0;
      for (const k of kids) {
        if (k === 'H3') {
          run = 0;
          continue;
        }
        run++;
        assert(run <= 2, 'a week has more than 2 sessions without a divider');
      }
    });

    await check('tab bar: five equal tabs (Home, Players, Money, History, Settings) with their own icons in every state; short and low', async () => {
      const icons = async () => admin.getByRole('navigation', { name: 'Organizer sections' }).locator('button svg').evaluateAll((s) => s.map((x) => x.getAttribute('data-icon')));
      for (const name of ['Settings', 'History', 'Players', 'Money', 'Home']) {
        await tab(admin, name).click();
        const got = await icons();
        assert(JSON.stringify(got) === JSON.stringify(['home', 'people', 'dollar', 'history', 'gear']), `icons with ${name} selected were ${got}`);
      }
      const widths = await admin.locator('nav.tabbar button').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().width)));
      assert(widths.length === 5 && Math.max(...widths) - Math.min(...widths) <= 1, `tabs should be equal: ${widths}`);
      const gaps = await admin.locator('nav.tabbar li').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().left));
      const steps = gaps.slice(1).map((x, i) => Math.round(x - gaps[i]));
      assert(Math.max(...steps) - Math.min(...steps) <= 1, `tabs should be evenly spaced: ${steps}`);
      const gear = await admin.locator('nav.tabbar svg[data-icon="gear"] path').getAttribute('d');
      assert((gear.match(/L/g) || []).length >= 28, 'Settings icon should be a cog with teeth');
      const bar = await admin.locator('nav.tabbar').boundingBox();
      const vh = admin.viewportSize().height;
      assert(bar.height <= 58, `tab bar is ${bar.height}px tall`);
      assert(vh - (bar.y + bar.height) <= 10, `tab bar should sit low (gap ${vh - (bar.y + bar.height)}px)`);
      const tabs = await admin.locator('nav.tabbar button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
      assert(tabs.every((h) => h >= 44), `tabs too short to tap: ${tabs}`);
    });

    await check('floating tab pill has exactly Home, Players, Money, History, Settings', async () => {
      const nav = admin.getByRole('navigation', { name: 'Organizer sections' });
      const labels = (await nav.getByRole('button').allInnerTexts()).map((t) => t.trim().split('\n')[0].trim().replace(/\d+$/, '').trim());
      assert(JSON.stringify(labels) === JSON.stringify(['Home', 'Players', 'Money', 'History', 'Settings']), `tabs were ${labels}`);
      const box = await nav.boundingBox();
      const vw = admin.viewportSize().width;
      assert(box.x > 8 && box.x + box.width < vw - 8, 'pill should float clear of the screen edges');
      const radius = await nav.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
      assert(radius >= 24, 'pill should be fully rounded');
      assert((await nav.locator('svg').count()) === 5, 'expected five drawn icons');
      const pillBg = await nav.evaluate((el) => getComputedStyle(el).backgroundColor);
      // "rgb(r g b)", "rgba(r, g, b, a)" or "color(srgb r g b / a)": the alpha is the 4th number, or after "/".
      const nums = pillBg.match(/[\d.]+/g).map(Number);
      const alpha = pillBg.includes('/') ? Number(pillBg.split('/')[1].match(/[\d.]+/)[0]) : pillBg.startsWith('rgba') ? nums[3] : 1;
      assert(alpha >= 0.95, `pill should be solid, background was ${pillBg}`);
      const pad = await admin.evaluate(() => parseFloat(getComputedStyle(document.querySelector('main.page')).paddingBottom));
      assert(pad >= box.height + 24, `not enough room under the last card for the pill (${pad}px)`);
      await admin.locator('header img.brand-logo').waitFor();
      for (const scheme of ['light', 'dark']) {
        await admin.emulateMedia({ colorScheme: scheme });
        const logo = await admin.locator('header img.brand-logo').evaluate((img) => ({
          loaded: img.complete && img.naturalWidth === 128,
          backing: getComputedStyle(img).backgroundColor,
          width: img.getBoundingClientRect().width,
        }));
        assert(logo.loaded, `header logo did not load in ${scheme} mode`);
        assert(logo.backing === 'rgb(255, 255, 255)', `logo should sit on a light backing in ${scheme} mode`);
        assert(logo.width === 32, `header logo should be 32px, was ${logo.width}`);
      }
      await admin.emulateMedia({ colorScheme: 'light' });
      assert((await admin.locator('link[rel="icon"]').getAttribute('href')) === '/favicon-32.png', 'tab icon should be the logo');
      for (const f of ['/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/favicon-32.png', '/logo-header.png']) {
        const r = await admin.request.get(BASE + f);
        assert(r.ok() && r.headers()['content-type'].includes('image/png'), `${f} missing`);
      }
      const bg = await admin.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
      assert(bg[0] === bg[1] && bg[0] !== 'rgba(0, 0, 0, 0)', `page background not set on html: ${bg}`);
    });

    await check('Settings: short page; sections start closed, open and close with a tap, and remember', async () => {
      await tab(admin, 'Settings').click();
      await admin.locator('details.set-sect').first().waitFor();
      const titles = (await admin.locator('details.set-sect > summary > span:first-child').allInnerTexts()).map((s) => s.trim());
      for (const want of ['Group', 'Money', 'Schedule', 'Access', 'Advanced', 'Change PIN', 'Backup']) {
        assert(titles.includes(want), `missing section ${want}: ${titles}`);
      }
      assert(!titles.includes('Calendar'), 'the Calendar section is gone');
      assert(!titles.includes('Add to Home Screen'), 'the Add to Home Screen row is gone');
      assert(!titles.includes('Recent changes'), 'Recent changes moved to History');
      assert((await admin.locator('details.set-sect[open]').count()) === 0, 'every section should start closed');
      assert((await admin.getByText('How this works').count()) === 0, '"How this works" should be gone');
      assert((await admin.getByText(/Texts are never sent automatically/).count()) === 0, 'How this works notes should be gone');
      // The most used things are at the top.
      const quick = admin.getByRole('region', { name: 'Quick settings' });
      assert((await quick.getByText('Monthly money').count()) === 0, 'Monthly money moved to the Money tab');
      await quick.getByRole('button', { name: 'Copy' }).waitFor();
      await quick.getByRole('button', { name: 'Dark', exact: true }).waitFor();
      const quickBox = await quick.boundingBox();
      const firstSect = await admin.locator('details.set-sect').first().boundingBox();
      assert(quickBox.y < firstSect.y, 'quick settings should come first');
      // Sign out is the last thing on the page.
      const signOut = await admin.getByRole('button', { name: 'Sign out' }).boundingBox();
      const lastSect = await admin.locator('details.set-sect').last().boundingBox();
      assert(signOut.y > lastSect.y, 'Sign out should be at the very bottom');
      // Short: about two iPhone screens even with everything closed.
      const height = await admin.evaluate(() => document.documentElement.scrollHeight);
      assert(height <= 2 * 844, `Settings is ${height}px tall`);
      const rows = await admin.locator('details.set-sect > summary').evaluateAll((s) => s.map((x) => x.getBoundingClientRect().height));
      assert(rows.every((h) => h >= 44), `section rows too short to tap: ${rows}`);
      await admin.screenshot({ path: path.join(SHOTS, 'settings-closed.png'), fullPage: true });
      // Open and close; open ones are remembered after a reload.
      await admin.locator('details[data-section="schedule"] > summary').click();
      await admin.getByLabel(/Day-before check-in/).waitFor();
      await admin.locator('details[data-section="advanced"] > summary').click();
      await admin.getByLabel(/Plan sessions ahead/).waitFor();
      await admin.locator('details[data-section="advanced"] > summary').click();
      assert(!(await admin.getByLabel(/Plan sessions ahead/).isVisible()), 'Advanced should close again');
      // The phone remembers it as soon as the section finishes closing.
      await admin.waitForFunction(() => !JSON.parse(localStorage.getItem('pb_settings_open') || '[]').includes('advanced'));
      await admin.reload();
      await tab(admin, 'Settings').click();
      await admin.locator('details[data-section="schedule"][open]').waitFor();
      assert((await admin.locator('details[data-section="advanced"][open]').count()) === 0, 'closed sections stay closed');
    });

    await check('Settings autosave: change a number, leave the box, "Saved", reload, it stuck; no Save settings button', async () => {
      await tab(admin, 'Settings').click();
      await openSections(admin);
      assert((await admin.getByRole('button', { name: 'Save settings' }).count()) === 0, 'Save settings button should be gone');
      const field = admin.getByLabel(/Day-before check-in/);
      assert((await field.getAttribute('inputmode')) === 'numeric', 'should show the number keypad');
      await field.fill('');
      assert((await field.inputValue()) === '', 'field should stay empty, not jump to 0');
      await field.blur();
      // Empty is never saved: the short error shows, and the old value stays saved.
      await rowOf(field).getByText('Enter a whole number from 1 to 72.').waitFor();
      await field.pressSequentially('30');
      await field.blur();
      await savedIn(field);
      await admin.reload();
      await tab(admin, 'Settings').click();
      await openSections(admin);
      assert((await admin.getByLabel(/Day-before check-in/).inputValue()) === '30', 'check-in hours did not stick');
      // Text boxes save after a one-second pause too, without leaving the box.
      const name = admin.getByLabel('Your name');
      await name.fill('Robin');
      await savedIn(name);
      await name.blur();
      await autoSet(admin.getByLabel(/Day-before check-in/), '24');
      assert((await admin.getByText('Warn before cancellation deadline').count()) === 0, 'old setting still shown');
      await admin.getByLabel(/Plan sessions ahead/).waitFor();
    });

    await check('Settings autosave: an invalid value shows its error and is not saved; a failed save offers a retry', async () => {
      await openSections(admin);
      const reminder = admin.getByLabel(/Booking reminder/);
      const before = await reminder.inputValue();
      await reminder.fill('99');
      await reminder.blur();
      await rowOf(reminder).getByText('Enter a number from 1 to 30.').waitFor();
      assert((await rowOf(reminder).locator('.save-mark.saved').count()) === 0, 'an invalid value must not say Saved');
      await admin.reload();
      await tab(admin, 'Settings').click();
      await openSections(admin);
      assert((await admin.getByLabel(/Booking reminder/).inputValue()) === before, 'the bad value should not have been saved');
      // The network drops: keep what was typed, offer a retry, and the retry saves it.
      const last = admin.getByLabel(/Last call/);
      const lastBefore = await last.inputValue();
      await admin.route('**/api/admin/group', (route) => route.abort());
      await last.fill('11');
      await last.blur();
      const retry = rowOf(last).getByRole('button', { name: "Couldn't save. Tap to retry." });
      await retry.waitFor();
      assert((await last.inputValue()) === '11', 'what was typed should stay');
      await admin.unroute('**/api/admin/group');
      await retry.click();
      await savedIn(last);
      await admin.reload();
      await tab(admin, 'Settings').click();
      await openSections(admin);
      assert((await admin.getByLabel(/Last call/).inputValue()) === '11', 'the retry did not save');
      await autoSet(admin.getByLabel(/Last call/), lastBefore);
    });

    await check('Settings: every setting still saves (a few changed and put back)', async () => {
      await openSections(admin);
      const before = {
        membership: await admin.getByLabel('Monthly membership').inputValue(),
        last: await admin.getByLabel(/Last call/).inputValue(),
        venue: await admin.getByLabel('Venue street address').inputValue(),
        reminder: await admin.getByLabel(/Booking reminder/).inputValue(),
      };
      await autoSet(admin.getByLabel('Monthly membership'), '31');
      await autoSet(admin.getByLabel(/Last call/), '12');
      await autoSet(admin.getByLabel('Venue street address'), '40100 Six Mile Rd, Northville, MI');
      await autoSet(admin.getByLabel(/Booking reminder/), '13');
      await admin.reload();
      await tab(admin, 'Settings').click();
      await openSections(admin);
      assert((await admin.getByLabel('Monthly membership').inputValue()) === '31', 'membership did not save');
      assert((await admin.getByLabel(/Last call/).inputValue()) === '12', 'last call did not save');
      assert((await admin.getByLabel('Venue street address').inputValue()) === '40100 Six Mile Rd, Northville, MI', 'address did not save');
      assert((await admin.getByLabel(/Booking reminder/).inputValue()) === '13', 'booking reminder did not save');
      // Toggles save right away.
      const access = admin.getByLabel('Anyone with the site address can use it');
      const wasOpen = await access.isChecked();
      await access.click();
      await rowOf(access).locator('.save-mark.saved').waitFor();
      await access.click();
      await rowOf(access).locator('.save-mark.saved').waitFor();
      assert((await access.isChecked()) === wasOpen, 'access toggled back');
      // Put everything back.
      await autoSet(admin.getByLabel('Monthly membership'), before.membership);
      await autoSet(admin.getByLabel(/Last call/), before.last);
      await autoSet(admin.getByLabel('Venue street address'), before.venue);
      await autoSet(admin.getByLabel(/Booking reminder/), before.reminder);
      await admin.reload();
      await tab(admin, 'Settings').click();
      await openSections(admin);
      assert((await admin.getByLabel('Monthly membership').inputValue()) === before.membership, 'membership not put back');
    });

    await check('Settings: dark mode follows the phone, or Light / Dark', async () => {
      const bgOf = () => admin.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const light = await bgOf();
      await admin.getByRole('button', { name: 'Dark', exact: true }).click();
      const dark = await bgOf();
      assert(light !== dark, 'Dark did not change the colors');
      await admin.reload();
      await tab(admin, 'Home').waitFor();
      assert((await bgOf()) === dark, 'Dark was not remembered after reload');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-dark.png'), fullPage: true });
      await tab(admin, 'Settings').click();
      await openSections(admin);
      await admin.getByRole('button', { name: 'Auto', exact: true }).click();
      assert((await bgOf()) === light, 'Auto should follow the (light) phone setting');
      await tab(admin, 'Home').click();
    });

    await check('Players screen formats phone numbers like (313) 555-0100', async () => {
      await tab(admin, 'Players').click();
      await admin.getByText('(313) 555-0100').waitFor();
      await tab(admin, 'Home').click();
    });

    console.log('Players');
    const players = {};
    const firstCard = (p) => p.locator('article').first();
    async function openAs(name) {
      const p = await newPage();
      players[name] = p;
      await p.goto(playerLink);
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await p.getByRole('button', { name, exact: true }).click();
      await p.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
      return p;
    }
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) {
      await check(`${name} picks a name and taps "I'm in"`, async () => {
        const p = await openAs(name);
        await firstCard(p).getByRole('button', { name: "I'm in" }).click();
        await firstCard(p).locator('.tile-check').waitFor();
      });
    }

    await check('the 5th person is simply in: "5 in", five pickleballs, no empty circles, no waitlist', async () => {
      const p = await openAs('Emery');
      const card = firstCard(p);
      // Under 4 it reads "3 of 4 in"; from 4 on just the number.
      await card.locator('.in-count', { hasText: /^4 in$/ }).waitFor();
      assert((await card.getByRole('button', { name: 'Join waitlist' }).count()) === 0, 'the 5th person should not be sent to a waitlist');
      await card.getByRole('button', { name: "I'm in" }).click();
      await card.locator('.tile-check').waitFor();
      await card.locator('.in-count', { hasText: /^5 in$/ }).waitFor();
      assert((await card.locator('.dots .ball').count()) === 5, `five balls, got ${await card.locator('.dots .ball').count()}`);
      assert((await card.locator('.dots .dot').count()) === 0, 'no empty circles past 4');
      assert((await card.locator('.waitlist-line').count()) === 0, 'nobody waits below the max');
      const who = await card.locator('.names-line').getAttribute('title');
      for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) assert(who.includes(n), `${n} missing from ${who}`);
      assert(!who.includes('Frankie'), 'people who have not signed up should not show');
      await p.screenshot({ path: path.join(SHOTS, 'player-five.png'), fullPage: true });
    });

    await check('the phone remembers the name: next visit says "Alex" with "not you?"', async () => {
      const p = players.Alex;
      await p.goto(BASE);
      await p.goto(playerLink);
      await p.getByRole('heading', { name: 'Alex', exact: true, level: 1 }).waitFor();
      await p.getByRole('button', { name: 'Not you?' }).waitFor();
      assert((await p.getByRole('heading', { name: 'Who are you?' }).count()) === 0, 'asked for the name again');
    });

    // Pay prompts only show once a court is booked (a game with no court reads like a normal game and asks for nothing).
    // The checks up to "someone drops out of 6" are about the flat $14, so they run on a game with a booked court; it is put
    // back afterwards so the later "not booked" checks still start from a game that needs a court. See e2e/no-court.cjs.
    const courtGame = (await (await admin.request.get(`${BASE}/api/admin/dashboard`)).json()).sessions.find((x) => !x.state.flags.past).id;
    assert((await admin.request.post(`${BASE}/api/admin/sessions/${courtGame}/booked`, { data: {}, headers: { Origin: BASE } })).ok(), 'could not book the first game');
    await check('player Home is one button per session, no extra screens', async () => {
      await players.Alex.reload(); // the court was just booked: draw the card as it is now
      const card = firstCard(players.Alex);
      await card.locator('.btn:not(.outline)').first().waitFor();
      const buttons = (await card.getByRole('button').allInnerTexts()).map((t) => t.trim());
      // One filled green button per card; "Drop out" is a quiet link, not a button look.
      const filled = await card.locator('.btn:not(.outline)').allInnerTexts();
      assert(filled.length === 1, `expected one filled button, got ${filled} (all: ${buttons})`);
      assert(buttons.includes('Drop out') && !buttons.includes("I'm out"), `"I'm out" should read "Drop out": ${buttons}`);
    });

    await check('players never see phone numbers or the PIN', async () => {
      const html = await players.Alex.content();
      assert(!html.includes('3135550') && !html.includes('555-01'), 'phone number leaked into player page');
      assert(!html.includes(PIN), 'PIN leaked');
    });

    console.log('4, then 5, then 6: everyone is simply in');
    await check('a 6th person is simply in too: "6 in", six balls, no "Good news, we now have 6" line', async () => {
      const p = await openAs('Frankie');
      const card = firstCard(p);
      await card.getByRole('button', { name: "I'm in" }).click();
      await card.locator('.tile-check').waitFor();
      await card.locator('.in-count', { hasText: /^6 in$/ }).waitFor();
      assert((await card.locator('.dots .ball').count()) === 6 && (await card.locator('.dots .dot').count()) === 0, 'six balls, no empty circles');
      assert((await p.locator('.toast', { hasText: /Good news/ }).count()) === 0, 'no "Good news" toast');
      await players.Emery.reload();
      await firstCard(players.Emery).locator('.in-count', { hasText: /^6 in$/ }).waitFor();
      assert((await players.Emery.getByText(/Good news, we now have|even number/).count()) === 0, 'the "Good news, we now have 6" line is gone');
      assert((await players.Emery.locator('.waitlist-line').count()) === 0, 'nobody waits below the max');
      await players.Emery.screenshot({ path: path.join(SHOTS, 'player-six.png'), fullPage: true });
    });

    await check('organizer Home with 6 in: the card counts "6 in" with six balls; no Now 6 card; the Text menu is Share the game and Check-in (no Down to 5 or Now 6)', async () => {
      await admin.reload();
      const card = sessionCards(admin).first();
      await card.locator('.players-line .players-count', { hasText: /^6 in$/ }).waitFor();
      assert((await card.locator('.players-line .dots .ball').count()) === 6 && (await card.locator('.players-line .dots .dot').count()) === 0, 'six balls, no empty circles');
      assert((await admin.locator('article[data-suggest="now6"], article[data-suggest="down5"]').count()) === 0, 'Now 6 / Down to 5 cards are gone');
      assert((await admin.getByText(/Good news, we have 6/).count()) === 0, 'old Now 6 wording still on Home');
      const menu = await textMenu(card);
      const names = (await menu.locator('.text-row .text-name').allInnerTexts()).map((x) => x.trim());
      assert(JSON.stringify(names) === JSON.stringify(['Share the game', 'Check-in']), `menu was ${names}`);
      assert((await menu.locator('.text-row[data-text="down5"], .text-row[data-text="now6"]').count()) === 0, 'no Down to 5 or Now 6 rows');
      await closeOptions(card);
    });

    await check('6 in: everyone owes the flat $14 (no $9, no $5 credit); joined people see no credit-back note; no credit chip without credit', async () => {
      for (const name of ['Casey', 'Frankie']) {
        const p = players[name];
        await p.reload();
        const card = firstCard(p);
        await card.getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
        assert((await card.locator('a.pay-btn').innerText()).trim() === 'Pay', `${name} should see a Pay button`);
        assert((await card.locator('[data-owe]').innerText()).trim() === '$14 due', `${name} should see the "$14 due" chip`);
        assert((await card.getByRole('link', { name: /^Pay \$9/ }).count()) === 0, `${name} should not see a $9 price`);
        // The credit-back note is only for someone who has not joined; joined people see nothing.
        assert((await card.locator('[data-pay-note], [data-credit-note]').count()) === 0, `${name}: joined people see no credit-back note`);
        assert((await p.getByText(/You get credit back if 5 or more play|credit toward your next|6 are playing|6-person discount|includes your \$5 credit/).count()) === 0, `${name} sees old credit wording`);
        assert((await p.locator('.schedule').getByText(/You owe|Pay with Venmo/).count()) === 0, `${name} sees a money block on a session row`);
        assert((await p.locator('[data-credit-chip], [data-credit-line]').count()) === 0, `${name} has no credit, so no chip or credit line`);
      }
      await admin.reload();
      assert((await admin.getByText(/Refund \$5 each/).count()) === 0, 'old refund card still shown');
      assert((await admin.getByRole('checkbox', { name: /refunded/i }).count()) === 0, 'Refunded checkbox still shown');
      await players.Frankie.screenshot({ path: path.join(SHOTS, 'player-flat-price.png'), fullPage: true });
    });

    await check('someone drops out of 6: "5 in", nothing for the organizer to sort out, everyone still owes $14', async () => {
      const card = firstCard(players.Casey);
      await card.getByRole('button', { name: 'Drop out' }).click();
      await confirmDrop(players.Casey);
      await card.getByRole('button', { name: "I'm in" }).waitFor();
      await card.locator('.in-count', { hasText: /^5 in$/ }).waitFor();
      assert((await card.locator('[data-credit-back]').count()) === 0, 'an unpaid drop gives no credit line');
      await admin.reload();
      await sessionCards(admin).first().locator('.players-line .players-count', { hasText: /^5 in$/ }).waitFor();
      for (const gone of [/5 going/, /need 4 or 6/, /Was 6, now/, /Refund needed/]) assert((await admin.getByRole('article', { name: gone }).count()) === 0, `old card ${gone} still on Home`);
      assert((await admin.getByRole('button', { name: /Back to 4|Done, I sorted it out/ }).count()) === 0, 'old sort-it-out buttons still on Home');
      assert((await admin.locator('[data-finalize]').count()) === 0, 'no Finalize card before the game');
      for (const name of ['Frankie', 'Alex']) {
        await players[name].reload();
        await firstCard(players[name]).getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
        assert((await players[name].getByText(/6-person discount|credit toward your next/).count()) === 0, 'old wording');
      }
      await admin.screenshot({ path: path.join(SHOTS, 'admin-five-in.png'), fullPage: true });
    });
    assert(
      (await admin.request.put(`${BASE}/api/admin/sessions/${courtGame}/booking`, { data: { bookingStatus: 'needs_booking', courtCostCents: null }, headers: { Origin: BASE } })).ok(),
      'could not put the first game back to not booked',
    );

    console.log('Booking & payments');
    await check('Home: court and players are separate lines; no chip; no duplicate court cards', async () => {
      await admin.reload();
      const section = admin.locator('section[aria-labelledby="sessions-title"]');
      const BOOK = 'https://mobileapp.courtreserve.com/Online/Reservations/Bookings/13765?sId=19442';
      const CANCEL = 'https://mobileapp.courtreserve.com/Online/Bookings/List/13765?type=1';
      const link = section.locator('.week-break').first().getByRole('link', { name: /^Book a court/ });
      assert((await link.getAttribute('href')) === BOOK, 'wrong CourtReserve link');
      assert((await link.getAttribute('target')) === '_blank', 'CourtReserve should open in a new tab');
      assert((await admin.getByText('Book on CourtReserve').count()) === 0, 'old button wording still shown');
      assert((await admin.locator('a[href*="courtreserve.com"]').evaluateAll((as, ok) => as.every((a) => ok.includes(a.href) && a.target === '_blank'), [BOOK, CANCEL])), 'every CourtReserve link should be the booking or cancel page, in a new tab');
      // Its own color, so it reads as leaving the site, plus an arrow.
      const colors = await admin.evaluate(() => {
        const ext = document.querySelector('a.btn.external');
        const probe = document.createElement('button');
        probe.className = 'btn';
        document.body.appendChild(probe);
        const r = { ext: getComputedStyle(ext).backgroundColor, main: getComputedStyle(probe).backgroundColor, arrow: !!ext.querySelector('svg.ext-icon') };
        probe.remove();
        return r;
      });
      assert(colors.ext !== colors.main && colors.arrow, `Book a court should look different from the green buttons: ${JSON.stringify(colors)}`);
      await sessionCards(admin).first().waitFor();
      for (const name of [/^Courts to book/, /^Waiting on the court/, /^Short on players/]) {
        assert((await admin.getByRole('article', { name }).count()) === 0, `old ${name} card still on Home`);
      }
      assert((await sessionCards(admin).locator('.chip').count()) === 0, 'session cards should have no status chip');
      // Court buttons live only inside session cards, plus "I booked it" on the "Do this now" card (no court yet).
      for (const label of ['I booked it', 'Court opened', "Didn't open"]) {
        const all = await admin.getByRole('button', { name: label, exact: true }).count();
        const inCards = await sessionCards(admin).getByRole('button', { name: label, exact: true }).count();
        const onDoNow = await admin.locator('.do-now').getByRole('button', { name: label, exact: true }).count();
        assert(all === inCards + onDoNow && (label === 'I booked it' || onDoNow === 0), `${label} shows outside a session card`);
      }
      const cards = sessionCards(admin);
      for (let i = 0; i < (await cards.count()); i++) {
        const c = cards.nth(i);
        assert((await c.locator('.court-status').count()) >= 1, 'every card needs a court line');
        if ((await c.getAttribute('data-court')) !== 'off') {
          const line = (await c.locator('.players-line .players-count').innerText()).trim();
          // "3 of 4 in" under 4, then "5 in", and "10 in, full" at the max.
          const m = line.match(/^(\d+)( of 4)? in(, full)?$/);
          assert(m, `players line was ${line}`);
          const filled = Number(m[1]);
          assert(!!m[2] === filled < 4, `"of 4" only under 4: ${line}`);
          // A pickleball per person, empty circles only up to the first 4, never more.
          const balls = await c.locator('.players-line .dots .ball').count();
          const empties = await c.locator('.players-line .dots .dot').count();
          assert(balls === filled, `expected a ball per player, got ${balls} for "${line}"`);
          assert(empties === Math.max(0, 4 - filled), `expected ${Math.max(0, 4 - filled)} empty circles, got ${empties} for "${line}"`);
          assert((await c.locator('.players-line .dots svg').count()) === balls, 'balls are drawn inline, no image files');
          const named = filled ? (await c.locator('.players-line .names-line').getAttribute('title')).split(', ') : [];
          assert(named.length === filled && named.every((n) => /^[A-Z][a-z]+$/.test(n)), `names should show: ${named}`);
        }
      }
    });

    await check('not booked: amber dashed border, banner with I booked it; one tap books it', async () => {
      const card = sessionCards(admin).first();
      assert((await card.getAttribute('data-court')) === 'needs', 'first card should need a court');
      const banner = card.locator('.court-banner');
      await banner.getByText('Court not booked', { exact: true }).waitFor();
      assert((await banner.locator('svg.court-icon').count()) === 1, 'banner needs an icon with the words');
      const look = await card.evaluate((el) => ({ style: getComputedStyle(el).borderTopStyle, banner: getComputedStyle(el.querySelector('.court-banner')).backgroundColor }));
      assert(look.style === 'dashed', `not-booked border should be dashed, was ${look.style}`);
      // A Book link right next to I booked it, to the booking page.
      const book = banner.getByRole('link', { name: /^Book/ });
      assert((await book.getAttribute('href')) === 'https://mobileapp.courtreserve.com/Online/Reservations/Bookings/13765?sId=19442', 'banner Book link should go to the booking page');
      const bb = await book.boundingBox();
      const ib = await banner.getByRole('button', { name: 'I booked it' }).boundingBox();
      assert(Math.abs(bb.y - ib.y) < 4 && bb.x < ib.x, 'Book should sit right before I booked it');
      for (const scheme of ['light', 'dark']) {
        await admin.emulateMedia({ colorScheme: scheme });
        await card.screenshot({ path: path.join(SHOTS, `card-needs-${scheme}.png`) });
        await admin.locator('.week-break').first().screenshot({ path: path.join(SHOTS, `book-pill-${scheme}.png`) });
      }
      await admin.emulateMedia({ colorScheme: 'light' });
      await admin.screenshot({ path: path.join(SHOTS, 'admin-not-booked.png') });
      await banner.getByRole('button', { name: 'I booked it' }).click();
      await admin.locator('.toast', { hasText: 'Court booked' }).waitFor();
      assert((await admin.locator('dialog[open]').count()) === 0, 'I booked it should not ask anything');
      const booked = sessionCards(admin).first();
      assert((await booked.getAttribute('data-court')) === 'booked', 'card should now be booked');
      await booked.locator('.court-line').getByText('Court booked', { exact: true }).waitFor();
      await booked.getByText(/^Cancel by .*8:00 AM/).waitFor();
      const edge = await booked.evaluate((el) => ({ style: getComputedStyle(el).borderLeftStyle, width: parseFloat(getComputedStyle(el).borderLeftWidth) }));
      assert(edge.style === 'solid' && edge.width >= 6, `booked card needs a solid left edge: ${JSON.stringify(edge)}`);
      assert((await booked.locator('.court-banner').count()) === 0, 'booked card should have no banner');
    });

    await check('Edit booking: no court number; reservation number and cost under More details', async () => {
      const card = sessionCards(admin).first();
      await more(card);
      await card.getByRole('button', { name: 'Edit booking' }).click();
      const edit = admin.locator('dialog[open]');
      await edit.getByLabel(/Cancellation deadline/).waitFor();
      assert((await edit.getByLabel(/Court #|Court number/).count()) === 0, 'court number field still in Edit booking');
      assert(!(await edit.getByLabel(/Reservation number/).isVisible()), 'extras should be tucked under More details');
      await edit.getByText('More details').click();
      await edit.getByLabel(/Reservation number/).fill('R-1042');
      await edit.getByLabel(/Court cost/).fill('48.37');
      await edit.getByLabel('Court cost (only you see this)').waitFor();
      assert((await edit.getByText(/Split four ways/i).count()) === 0, 'old split helper text still shown');
      await edit.getByText(/Deadline: .*8:00 AM$/).waitFor();
      await admin.screenshot({ path: path.join(SHOTS, 'admin-booking.png') });
      await edit.getByRole('button', { name: 'Save booking' }).click();
      await admin.locator('.toast', { hasText: 'Booking saved' }).waitFor();
      await more(card);
      await card.getByText('Reservation #R-1042', { exact: false }).waitFor();
      await card.getByText('$48.37 (only you see this)', { exact: false }).waitFor();
      assert((await admin.getByText(/Court #|Court number/).count()) === 0, 'court number shows on organizer Home');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-booked.png') });
      await players.Alex.reload();
      const row = firstCard(players.Alex);
      await row.locator('.sched-status').getByText('Court booked', { exact: true }).waitFor();
      assert((await players.Alex.getByText(/Court #/).count()) === 0, 'court number shows to players');
      assert((await players.Alex.getByText('Court not booked', { exact: true }).count()) > 0, 'other sessions should say Court not booked');
      assert((await row.getByRole('button', { name: /I booked it|Court opened/ }).count()) === 0, 'players get no court buttons');
    });

    await check('no summary line above the sessions', async () => {
      assert((await admin.locator('.court-summary').count()) === 0, 'summary line should be gone');
      assert((await admin.getByText(/\d+ needs? a court/).count()) === 0, 'summary text should be gone');
    });

    await check('session card: only the gear at the top right (no phone button); it opens Share the game and a 2 by 2 grid', async () => {
      const card = sessionCards(admin).first();
      await card.locator('.tile').waitFor();
      await card.locator('.players-line .dots > *').first().waitFor();
      await closeOptions(card);
      assert((await card.getByRole('button', { name: /^(More|Less)$/ }).count()) === 0, 'More / Less should be gone');
      assert((await card.locator('[data-icon="phone"]').count()) === 0, 'no phone button on the card');
      assert((await card.locator('.card-icons button').count()) === 1, 'only the gear at the top right');
      const gear = card.getByRole('button', { name: /^Session options for / });
      const gb = await gear.boundingBox();
      const cb = await card.boundingBox();
      assert(gb.x + gb.width > cb.x + cb.width - 24, 'gear at the top right');
      const tapArea = { w: gb.width, h: Math.max(gb.height, await gear.evaluate((b) => parseFloat(getComputedStyle(b, '::before').height) || 0)) };
      assert(tapArea.w >= 44 && tapArea.h >= 44, `icon tap area ${tapArea.w}x${tapArea.h}`);
      // Collapsed: no main button any more (the poll lives in Texts).
      const visible = async () => (await card.locator('button:visible, a.btn:visible').allInnerTexts()).map((x) => x.trim()).filter((x) => x && !/^(Undo|Hours OK|I'm in|Out)$/.test(x));
      assert(JSON.stringify(await visible()) === '[]', `collapsed card buttons were ${await visible()}`);
      await gear.click();
      assert((await gear.getAttribute('aria-expanded')) === 'true', 'gear should say it is open');
      const opts = card.locator('.options');
      const textBtn = opts.getByRole('button', { name: 'Text', exact: true });
      const sb = await textBtn.boundingBox();
      const ob = await opts.boundingBox();
      assert(sb.width > ob.width * 0.9, 'Text should be the full-width main button');
      assert((await textBtn.locator('svg[data-icon="message"]').count()) === 1, 'Text has a message icon');
      // Text has its own color family: not the green buttons, not the blue CourtReserve links, and strong contrast.
      const tc = await textBtn.evaluate((el) => {
        const rgb = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const probe = document.createElement('button');
        probe.className = 'btn';
        document.body.appendChild(probe);
        const green = getComputedStyle(probe).backgroundColor;
        probe.className = 'btn external';
        const blue = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const bg = getComputedStyle(el).backgroundColor;
        const [a, b] = [lum(rgb(bg)), lum(rgb(getComputedStyle(el).color))];
        const [r, g, bl] = rgb(bg);
        return { bg, green, blue, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), spread: Math.max(r, g, bl) - Math.min(r, g, bl) };
      });
      assert(tc.bg !== tc.green && tc.bg !== tc.blue, `Text should not match the green or blue buttons: ${JSON.stringify(tc)}`);
      assert(tc.spread < 30, `Text should be a neutral charcoal, not green or blue: ${JSON.stringify(tc)}`);
      assert(tc.contrast >= 7, `Text needs strong contrast: ${tc.contrast.toFixed(2)}`);
      const gb2 = await opts.locator('.opt-grid').boundingBox();
      assert(sb.y < gb2.y, 'Text sits above the grid');
      assert((await opts.getByRole('button', { name: /^Copy/ }).count()) === 0 && (await opts.locator('.other-texts').count()) === 0, 'no Copy or Other texts');
      const grid = await opts.locator('.opt-grid > *').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { text: e.textContent.trim().replace(/\s+/g, ' ').replace(' (opens CourtReserve)', ''), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        }),
      );
      // Once the court is booked, Add to calendar joins the grid and Cancel session takes the last full row.
      const isBooked = (await card.getAttribute('data-court')) === 'booked';
      const want = isBooked ? ['Edit booking', 'Players', 'Modify court', 'Add to calendar', 'Cancel session'] : ['Edit booking', 'Players', 'Modify court', 'Cancel session'];
      assert(JSON.stringify(grid.map((g) => g.text)) === JSON.stringify(want), `grid was ${grid.map((g) => g.text)}`);
      assert(grid[0].y === grid[1].y && grid[2].y === grid[3].y && grid[0].x === grid[2].x && grid[1].x === grid[3].x, 'grid should be 2 by 2');
      const four = grid.slice(0, 4);
      assert(new Set(four.map((g) => g.w)).size === 1 && new Set(grid.map((g) => g.h)).size === 1, `grid buttons should match: ${JSON.stringify(grid)}`);
      if (isBooked) assert(grid[4].x === grid[0].x && grid[4].w > grid[0].w * 1.8, 'Cancel session spans the last row');
      assert(grid.every((g) => g.h >= 44 && g.h < 60), 'grid buttons fit on one line, 44px+');
      const modify = opts.getByRole('link', { name: /^Modify court/ });
      assert((await modify.getAttribute('href')) === 'https://mobileapp.courtreserve.com/Online/Bookings/List/13765?type=1' && (await modify.getAttribute('target')) === '_blank', 'Modify court link');
      const cancelBg = await opts.getByRole('button', { name: 'Cancel session' }).evaluate((el) => getComputedStyle(el).color);
      const dangerFg = await admin.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--danger-fg').trim());
      assert(cancelBg !== '' && dangerFg !== '', 'Cancel session uses the red style');
      for (const gone of ['Text the group poll', 'Money', 'Texts', 'Reschedule', 'Invite substitutes', 'Change or cancel court']) {
        assert((await card.getByRole('button', { name: gone, exact: true }).count()) === 0 && (await card.getByRole('link', { name: gone, exact: true }).count()) === 0, `${gone} should be gone from the card`);
      }
      assert((await admin.getByText(/Invite (substitutes|people|someone)/).count()) === 0, 'Invite substitutes should be gone everywhere');
      await card.screenshot({ path: path.join(SHOTS, 'card-options.png') });
      await gear.click();
      await opts.waitFor({ state: 'detached' });
    });

    await check('Share the game: the same words for every game, the plain site address, and opens with no numbers (pick the chat)', async () => {
      const card = sessionCards(admin).first();
      const menu = await textMenu(card);
      const href = await menu.locator('.text-row[data-text="share"] a').getAttribute('href');
      const { body, to } = smsOf(href);
      assert(to.length === 0, `share should open with no numbers, had ${to.length}`);
      const m = body.match(/^Pickleball (tonight|tomorrow|today|(?:Tue|Thu) [A-Z][a-z]{2} \d{1,2}), \d{1,2}:\d{2} PM\. In or out here: (\S+)$/);
      assert(m, `share text was: ${body}`);
      assert(m[2] === SITE, `share link should be the plain site address ${SITE}: ${m[2]}`);
      assert(!/\bsent\b|ASAP|text me/i.test(body), 'bad words');
      await closeOptions(card);
    });

    await check('court cost never shows to players', async () => {
      for (const name of ['Alex', 'Blair']) {
        await players[name].reload();
        await firstCard(players[name]).waitFor();
        const html = await players[name].content();
        assert(!html.includes('48.37') && !html.includes('4837'), `court cost leaked to ${name}`);
      }
    });

    await check('"Text" opens only the texts that fit (no Poll, Day before, Last call or Spot open); Share and Need players pick the chat; Check-in goes to the players in', async () => {
      const card = sessionCards(admin).first();
      const menu = await textMenu(card);
      const names = (await menu.locator('.text-row .text-name').allInnerTexts()).map((x) => x.trim());
      assert(names.includes('Share the game'), `choices missing Share the game: ${names}`);
      for (const gone of ['Poll', 'Day before', 'Last call', 'Spot open']) assert(!names.includes(gone), `${gone} is gone: ${names}`);
      assert(!names.includes('Canceled'), 'a live session has no Canceled text');
      const inCount = await card.locator('.players-line .dots .ball').count();
      assert(names.includes('Need players') === inCount < 4, 'Need players only when fewer than 4 are in');
      assert(names.includes('Check-in') === (inCount >= 4), 'Check-in only when 4 or more are in');
      for (const gone of ['Down to 5', 'Now 6']) assert(!names.includes(gone), `${gone} is gone: ${names}`);
      for (const row of await menu.locator('.text-row').all()) {
        const id = await row.getAttribute('data-text');
        const link = row.locator('a.text-choice');
        const { to } = smsOf(await link.getAttribute('href'));
        const who = (await row.locator('.text-who').innerText()).trim();
        if (id === 'share' || id === 'need') {
          assert(who === 'Group chat, you pick' && to.length === 0, `${id}: "${who}", ${to.length} numbers`);
          assert((await row.locator('.missing-numbers').count()) === 0, `${id}: no missing-numbers note`);
        }
        if (id === 'checkin') assert(who === 'Everyone signed up' && to.length > 0, `${id} goes to the numbers saved: ${who}, ${to.length}`);
        assert((await link.boundingBox()).height >= 44, 'choices 44px+');
      }
      // Tapping a choice opens Messages and says it's ready, never "sent".
      await menu.locator('.text-row[data-text="share"] a').evaluate((a) => a.addEventListener('click', (e) => e.preventDefault(), { once: true }));
      await menu.locator('.text-row[data-text="share"] a').click();
      await menu.getByText('Message ready', { exact: true }).waitFor();
      assert(!/\bsent\b/i.test(await menu.innerText()), 'never say sent');
      await admin.screenshot({ path: path.join(SHOTS, 'texts-menu.png') });
      await closeOptions(card);
    });

    await check('holiday is gone from player cards; the organizer keeps a plain Election Day note with Hours OK (Nov 3)', async () => {
      if (Date.now() + BASE_OFFSET > Date.parse('2026-11-04T03:00:00Z')) return; // only while Nov 3, 2026 is still upcoming
      await players.Alex.reload();
      const card = players.Alex.locator('article', { hasText: 'Tuesday, Nov 3' });
      await card.waitFor();
      assert((await card.locator('.holiday, .holiday-text').count()) === 0, 'players no longer see a holiday pill on cards');
      assert(!/Election Day/.test(await players.Alex.locator('.schedule').innerText()), 'players see no holiday name on cards');
      await admin.reload();
      const hcard = sessionCards(admin).filter({ hasText: 'Election Day' }).first();
      await hcard.locator('.holiday', { hasText: 'Election Day · check hours' }).waitFor();
      const plain = await hcard.locator('.holiday').first().evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth }));
      assert(plain.bg === 'rgba(0, 0, 0, 0)' && plain.border === '0px', `the organizer's holiday label is plain text now: ${JSON.stringify(plain)}`);
      await hcard.getByRole('button', { name: 'Venue is open normal hours' }).click();
      await hcard.locator('.holiday', { hasText: /^Election Day$/ }).waitFor();
      await admin.reload();
      const after = sessionCards(admin).filter({ hasText: 'Election Day' }).first();
      await after.locator('.holiday', { hasText: /^Election Day$/ }).waitFor();
      assert(!/✓/.test(await after.locator('.holiday-actions').innerText()), 'no check mark on the pill');
      assert((await after.getByText('check hours').count()) === 0, 'check venue hours should be gone after confirming');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-holiday-confirmed.png'), fullPage: true });
      await after.getByRole('button', { name: 'Undo' }).click();
      await after.locator('.holiday', { hasText: 'Election Day · check hours' }).waitFor();
      await players.Alex.reload();
      assert(!(await players.Alex.content()).includes('check hours'), 'players must never see "check hours"');
    });

    await check('everyone confirmed owes a flat $14 (all 5, not $9 for anyone); mark paid updates only that player', async () => {
      const card = sessionCards(admin).first();
      const sheet = await moneyFor(admin, card);
      assert((await sheet.getByText('owes $14').count()) === 5, `expected five people owing $14, got ${await sheet.getByText('owes $14').count()}`);
      assert((await sheet.getByText(/owes \$9|\$5 credit/).count()) === 0, 'old prices still shown');
      assert((await sheet.locator('[data-price-each]').innerText()).trim() === '$14', 'each player pays $14 until finalized');
      assert((await sheet.locator('[data-finalized-line]').count()) === 0, 'not finalized yet');
      const alexRow = sheet.locator('li', { hasText: 'Alex' }).first();
      await alexRow.getByRole('button', { name: 'Mark paid' }).click();
      await sheet.getByText('1/5 paid').waitFor();
      assert((await sheet.getByRole('button', { name: 'Mark paid' }).count()) === 4, 'other players changed');
      await alexRow.getByText(/paid \$14 on (Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2} · not finalized yet/).waitFor();
    });

    await check('payment reminder is a draft, not a sent text', async () => {
      const sheet = admin.locator('details.money-sess[data-session][open]').first();
      const blairRow = sheet.locator('li', { hasText: 'Blair' }).first();
      await blairRow.getByRole('button', { name: 'Payment reminder' }).click();
      const draft = blairRow.locator('.draft');
      assert((await draft.getByText('Message ready', { exact: true }).count()) === 0, 'not ready until Messages opens');
      await draft.getByText(/^Hey Blair, you owe \$\d+ for pickleball( \w{3} \w{3} \d+)?\. Pay here: \S+$/).waitFor();
      const href = await draft.getByRole('link', { name: 'Open in Messages' }).getAttribute('href');
      assert(href.startsWith('sms:+13135550101&body='), `bad sms link ${href}`);
    });

    await check('message drafts have no Copy buttons: the main button opens Messages', async () => {
      const draft = admin.locator('details.money-sess[data-session][open] .draft').first();
      assert((await draft.getByRole('button', { name: /^Copy/ }).count()) === 0, 'no Copy next to a message');
      await draft.getByRole('link', { name: 'Open in Messages' }).waitFor();
    });

    await check('opening Messages shows "Message ready", never "sent"', async () => {
      const draft = admin.locator('details.money-sess[data-session][open] .draft').first();
      await draft.evaluate((el) => {
        // Don't let the test browser try to launch an SMS app.
        el.querySelector('a[href^="sms:"]').addEventListener('click', (e) => e.preventDefault());
      });
      await draft.getByRole('link', { name: 'Open in Messages' }).click();
      await draft.getByText('Message ready', { exact: true }).waitFor();
      assert(!/\bsent\b/i.test(await draft.innerText()), 'the draft must never say it was sent');
      assert((await draft.getByRole('button', { name: /sent/i }).count()) === 0, 'no "I sent it" button');
      await tab(admin, 'Home').click();
    });

    await check('after signing up: Pay opens Venmo but never marks paid; "I paid" marks paid (self-marked); "Didn\'t pay?" undoes it; my Mark paid has no tag; all logged', async () => {
      const p = players.Devon;
      await p.context().route('https://venmo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Venmo</p>' }));
      await p.reload();
      const row = firstCard(p);
      const pay = row.getByRole('link', { name: 'Pay $14 with Venmo' });
      await pay.waitFor();
      assert((await pay.innerText()).trim() === 'Pay', 'button should say Pay');
      assert((await row.locator('[data-owe]').innerText()).trim() === '$14 due', 'the amber chip says $14 due');
      const dropBtn = row.getByRole('button', { name: 'Drop out' });
      assert(!(await dropBtn.evaluate((el) => el.classList.contains('btn'))), 'Drop out is a quiet underlined link, not a button');
      assert((await dropBtn.evaluate((el) => getComputedStyle(el).textDecorationLine)) === 'underline', 'Drop out is underlined');
      assert((await pay.evaluate((el) => el.classList.contains('btn'))), 'Pay is the one filled button');
      await venmoLinkOk(pay, 14, 'Devon');
      // On a computer, Pay opens the Venmo website in a new tab; this page stays.
      {
        const desk = await browser.newContext({ storageState: await p.context().storageState(), viewport: { width: 1280, height: 800 } });
        await desk.route('https://venmo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Venmo</p>' }));
        const dp = await desk.newPage();
        await dp.goto(p.url());
        const dpay = firstCard(dp).getByRole('link', { name: 'Pay $14 with Venmo' });
        const href = await dpay.getAttribute('href');
        const [tab] = await Promise.all([desk.waitForEvent('page'), dpay.click()]);
        await tab.waitForLoadState();
        assert(tab.url() === href, `computer: new tab went to ${tab.url()}`);
        assert(dp.url() === p.url(), 'computer: the pickleball tab stayed');
        await desk.close();
      }
      // "I paid" is there from the start, quiet, next to Pay (for Apple Cash and the like).
      await row.getByRole('button', { name: 'I paid' }).waitFor();
      await quietNextToPay(row);
      // Pay: the Venmo app opens on top; back from Venmo, Pay and "I paid" are both still there.
      await payAndComeBack(p, pay);
      await firstCard(p).getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      const iPaid = firstCard(p).getByRole('button', { name: 'I paid' });
      await iPaid.waitFor();
      await quietNextToPay(firstCard(p));
      await p.reload();
      await firstCard(p).getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      await firstCard(p).getByRole('button', { name: 'I paid' }).waitFor();
      assert((await p.getByText(/may not have marked this paid|Already paid\?/).count()) === 0, 'the old note is gone');
      await admin.reload();
      let sheet = await moneyFor(admin, sessionCards(admin).first());
      let devonRow = sheet.locator('li', { hasText: 'Devon' }).first();
      await devonRow.getByText(/owes \$14/).waitFor();
      // "I paid": Paid with a check and a tiny "Didn't pay?" right under it.
      await firstCard(p).getByRole('button', { name: 'I paid' }).click();
      await p.locator('.toast', { hasText: 'Marked paid' }).waitFor();
      const paidTag = firstCard(p).locator('.paid-tag', { hasText: /^Paid/  });
      await paidTag.waitFor();
      const undo = firstCard(p).getByRole('button', { name: "Didn't pay?" });
      const tb = await paidTag.boundingBox();
      const ub = await undo.boundingBox();
      assert(ub.y >= tb.y + tb.height - 1 && Math.abs(ub.x - tb.x) < 4, '"Didn\'t pay?" sits right under Paid');
      assert((await undo.evaluate((b) => getComputedStyle(b).textDecorationLine)) === 'underline' && !(await undo.evaluate((b) => b.classList.contains('btn'))), 'a quiet underlined link');
      await admin.reload();
      sheet = await moneyFor(admin, sessionCards(admin).first());
      devonRow = sheet.locator('li', { hasText: 'Devon' }).first();
      await devonRow.locator('.self-tag', { hasText: 'self-marked' }).waitFor();
      // "Didn't pay?" takes it back: Pay is there again.
      await undo.click();
      await firstCard(p).getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      await firstCard(p).getByRole('button', { name: 'I paid' }).waitFor();
      // The organizer marks it: no tag, and no "Didn't pay?" for the player.
      await admin.reload();
      sheet = await moneyFor(admin, sessionCards(admin).first());
      devonRow = sheet.locator('li', { hasText: 'Devon' }).first();
      await devonRow.getByRole('button', { name: 'Mark paid' }).click();
      await admin.locator('.toast', { hasText: 'Devon marked paid' }).waitFor();
      assert((await devonRow.locator('.self-tag').count()) === 0, 'no tag when I mark it');
      await p.reload();
      await firstCard(p).locator('.paid-tag', { hasText: /^Paid/  }).waitFor();
      assert((await firstCard(p).getByRole('button', { name: "Didn't pay?" }).count()) === 0, 'no undo for the organizer\'s mark');
      assert((await firstCard(p).getByRole('link', { name: /Pay \$/ }).count()) === 0, 'Pay should be gone once paid');
      // Logged.
      await tab(admin, 'History').click();
      await admin.getByRole('button', { name: 'Activity' }).click();
      const acts = admin.getByRole('list', { name: 'Activity' });
      await acts.getByText(/^Devon marked their payment paid for /).first().waitFor();
      await acts.getByText(/^Devon unmarked their payment for /).first().waitFor();
      await acts.getByText(/^Robin marked Devon paid for /).first().waitFor();
      await tab(admin, 'Home').click();
    });

    await check('game day: the payment card shows at the top from 8:00 AM, with the right amount and a Venmo note', async () => {
      // The first session's date, and 7:59 / 8:00 AM Eastern that day.
      const first = await admin.evaluate(async () => {
        const d = await (await fetch('/api/admin/dashboard')).json();
        return d.sessions.find((s) => Date.parse(s.endsAt) > Date.now() && s.status !== 'canceled');
      });
      const date = new Date(first.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
      const eight = [`${date}T08:00:00-04:00`, `${date}T08:00:00-05:00`]
        .map((s) => Date.parse(s))
        .find((ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Detroit' }) === '08');
      const clock = (atMs) => admin.request.post(`${BASE}/__dev/clock`, { data: { atMs } });
      try {
        await clock(eight - 60_000);
        const p = players.Blair;
        await p.reload();
        await p.locator('.schedule article').first().waitFor();
        assert((await p.getByRole('region', { name: 'Payment' }).count()) === 0, 'no payment card before 8:00 AM');

        await clock(eight);
        await p.reload();
        const card = p.getByRole('region', { name: 'Payment' });
        await card.getByRole('heading', { name: 'Tonight: you owe $14' }).waitFor();
        // At the very top, above the sessions.
        const cardBox = await card.boundingBox();
        const rowBox = await p.locator('.schedule article').first().boundingBox();
        assert(cardBox.y < rowBox.y, 'payment card should sit above the sessions');
        assert((await p.locator('main > *').first().getAttribute('aria-label')) === 'Payment', 'payment card should be first on the page');
        const pay = card.getByRole('link', { name: 'Pay $14 with Venmo' });
        await venmoLinkOk(pay, 14, 'Blair');
        assert((await pay.boundingBox()).height >= 48, 'big Pay with Venmo button');
        // Before paying the flat price, the card says the final price can be lower.
        assert((await card.locator('[data-pay-note], [data-credit-note]').count()) === 0, 'no credit-back note on the pay card (it now sits under I\'m in for people who have not joined)');
        // A quiet "I paid" is there from the start; Pay stays after coming back from Venmo.
        await card.getByRole('button', { name: 'I paid' }).waitFor();
        await p.context().route('https://venmo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Venmo</p>' }));
        await toVenmo(p, pay);
        await card.getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
        const paidBtn = card.getByRole('button', { name: 'I paid' });
        await paidBtn.waitFor();
        const looks = await Promise.all([pay, paidBtn].map((b) => b.evaluate((el) => getComputedStyle(el).backgroundColor)));
        assert(looks[0] !== looks[1], 'I paid should be quiet, not a second green button');
        assert((await card.getByText(/Already paid\? Ignore this/).count()) === 0, 'reminder shown too early');
        assert((await p.locator('.schedule').getByText(/You owe|Pay with Venmo/).count()) === 0, 'rows stay free of money');
        for (const scheme of ['light', 'dark']) {
          await p.emulateMedia({ colorScheme: scheme });
          await p.screenshot({ path: path.join(SHOTS, `player-pay-card-${scheme}.png`) });
        }
        await p.emulateMedia({ colorScheme: 'light' });

        // Paid, and not playing: no card.
        for (const name of ['Alex', 'Casey']) {
          await players[name].reload();
          await players[name].locator('.schedule article').first().waitFor();
          assert((await players[name].getByRole('region', { name: 'Payment' }).count()) === 0, `${name} should have no payment card`);
        }
        // Marking Blair paid makes the card go away on Blair's phone.
        await admin.reload();
        const tonight = admin.getByRole('article', { name: 'Mark paid tonight' });
        await tonight.getByRole('button', { name: /Mark Blair paid/ }).click();
        const toast = admin.locator('.toast');
        await toast.first().waitFor();
        assert(/Blair marked paid/.test(await toast.first().innerText()), `after Mark Blair paid: "${await toast.first().innerText()}"`);
        await p.reload();
        await p.locator('.schedule article').first().waitFor();
        assert((await p.getByRole('region', { name: 'Payment' }).count()) === 0, 'card should go once marked paid');
      } finally {
        await clock(Date.now() + BASE_OFFSET);
      }
    });

    await check('schedule rows: date tile, time without EDT/EST, and a small calendar link', async () => {
      const row = firstCard(players.Blair);
      const tile = (await row.locator('.tile').innerText()).replace(/\s+/g, ' ').trim();
      assert(/^(TUE|THU|TONIGHT) \d{1,2} [A-Z]{3}$/.test(tile), `date tile was "${tile}"`);
      // Only the start time sits under the tile ("8 PM"); the end is left off for a usual-length game (see e2e/card-times.cjs).
      const timeEl = row.locator('.sched-time', { hasText: /^8 PM$|^7:30 PM$/ });
      await timeEl.waitFor();
      const tb = await row.locator('.tile').boundingBox();
      const mb = await timeEl.boundingBox();
      assert(mb.y >= tb.y + tb.height && Math.abs(mb.x + mb.width / 2 - (tb.x + tb.width / 2)) < 6, 'the time sits centered under the date tile');
      assert(!/8:00 to 10:00 PM|7:30 to 10:00 PM/.test(await row.locator('.sched-body').innerText()), 'the long time line is gone from the card body');
      // TONIGHT: a blue strip inside the tile where the weekday would be; never clipped, never covered by the check badge.
      const strip = row.locator('.tile .tonight-tag');
      if (await strip.count()) {
        const sb = await strip.boundingBox();
        assert(sb.x >= tb.x && sb.x + sb.width <= tb.x + tb.width + 0.5 && sb.y >= tb.y, 'the TONIGHT strip fits inside the tile');
        assert((await strip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)), 'the TONIGHT strip text is not clipped');
        const chk = row.locator('.tile-check');
        if (await chk.count()) {
          const cb = await chk.boundingBox();
          const overlap = Math.min(sb.x + sb.width, cb.x + cb.width) - Math.max(sb.x, cb.x) > 1 && Math.min(sb.y + sb.height, cb.y + cb.height) - Math.max(sb.y, cb.y) > 1;
          assert(!overlap, 'the check badge covers the TONIGHT strip');
        }
        assert((await strip.evaluate((el) => getComputedStyle(el).textTransform || 'none')) !== undefined && (await strip.innerText()).trim() === 'TONIGHT', 'the strip says TONIGHT');
      }
      assert(!/\b(EDT|EST)\b/.test(await players.Blair.locator('main').innerText()), 'EDT/EST still on screen');
      const cal = row.getByRole('link', { name: /to calendar$/ });
      assert(!(await cal.getAttribute('class')).includes('btn'), 'calendar should be a small link, not a big button');
    });

    await check('Add to Calendar downloads a Pickleball event at 8:00 to 10:00 PM', async () => {
      const link = firstCard(players.Blair).getByRole('link', { name: /to calendar$/ });
      const href = await link.getAttribute('href');
      assert(/^\/api\/sessions\/[0-9a-f-]{36}\/calendar\.ics$/.test(href), `bad calendar link ${href}`);
      const res = await players.Blair.request.get(BASE + href);
      assert(res.headers()['content-type'].includes('text/calendar'), 'not a calendar file');
      const ics = await res.text();
      assert(ics.includes('SUMMARY:Pickleball') && ics.includes('LOCATION:Northville Pickleball Club'), 'wrong event');
      assert(/DTSTART;TZID=America\/Detroit:\d{8}T200000\r\n/.test(ics), 'event should start at 8:00 PM Eastern, written in Eastern time');
      assert(/DTEND;TZID=America\/Detroit:\d{8}T220000\r\n/.test(ics), 'event should end at 10:00 PM Eastern');
      assert(ics.includes('BEGIN:VTIMEZONE') && !/DTSTART:[^\r]*Z/.test(ics), 'calendar file should not be in universal time');
    });

    console.log('Usual days & suggestions');
    await check('organizer sets usual days and Regular / Occasional on the Players screen', async () => {
      await tab(admin, 'Players').click();
      await admin.getByRole('button', { name: 'Edit Devon' }).click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByRole('group', { name: 'Usual days' }).getByRole('button', { name: 'Tue' }).click();
      await sheet.getByRole('group', { name: 'Usual days' }).getByRole('button', { name: 'Thu' }).click();
      await sheet.getByRole('button', { name: 'Save' }).click();
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await admin.locator('li', { hasText: 'Devon' }).locator('.p-line2', { hasText: /Tue Thu$/ }).waitFor();
      await admin.getByRole('button', { name: 'Add a person' }).click();
      const add = admin.locator('dialog[open]');
      await add.getByLabel('Name', { exact: true }).fill('Ryan');
      await add.getByRole('button', { name: 'Occasional' }).click();
      await add.getByRole('button', { name: 'Save' }).click();
      await admin.locator('li', { hasText: 'Ryan' }).getByText('Occasional').waitFor();
      await tab(admin, 'Home').click();
    });

    await check('a regular gets "Want in on ...? Yes / No"; Yes shows "You\'re in" with no payment', async () => {
      const p = players.Devon;
      await p.reload();
      const card = p.getByRole('region', { name: /^Want in (tonight|tomorrow|(Tuesday|Thursday)|next (Tuesday|Thursday)|on (the )?[A-Za-z0-9, ']+)\?/ });
      await card.waitFor();
      await p.screenshot({ path: path.join(SHOTS, 'player-suggestion.png'), fullPage: true });
      await card.getByRole('button', { name: 'Yes' }).click();
      const answer = p.getByRole('region', { name: 'Your answer' });
      await answer.getByRole('heading', { name: /You're in|on the waitlist/ }).waitFor();
      // Signing up never asks for money; that waits for game day.
      assert((await answer.locator('a[href*="venmo"]').count()) === 0 && (await answer.getByText(/\$\d/).count()) === 0, 'no payment at sign-up');
      await answer.getByRole('button', { name: 'Done' }).click();
      await answer.waitFor({ state: 'detached' });
    });

    await check('tapping No hides the suggestion', async () => {
      const p = players.Devon;
      const card = p.getByRole('region', { name: /^Want in / });
      if ((await card.count()) === 0) return; // nothing else unanswered within 8 days
      const before = await card.innerText();
      await card.getByRole('button', { name: 'No' }).click();
      await p.waitForFunction((b) => {
        const el = [...document.querySelectorAll('section')].find((x) => x.textContent.startsWith('Want in '));
        return !el || el.innerText !== b;
      }, before);
    });

    await check('occasional people get no suggestions', async () => {
      const p = await openAs('Ryan');
      await p.locator('article').first().waitFor();
      assert((await p.getByRole('region', { name: /^Want in / }).count()) === 0, 'occasional player got a suggestion');
    });

    console.log('Open address');
    let privateLink = '';
    await check('the plain address opens "Who are you?" with a small Organizer sign-in link; no private-site screen', async () => {
      const p = await newPage();
      await p.goto(BASE);
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      assert((await p.getByText(/private group site/i).count()) === 0, 'old private-site screen still shown');
      const signIn = p.getByRole('link', { name: 'Organizer sign-in' });
      await signIn.waitFor();
      const box = await signIn.boundingBox();
      const lastBtn = await p.getByRole('button', { name: 'Add my name' }).boundingBox();
      assert(box.y > lastBtn.y, 'Organizer sign-in should be at the bottom');
      await p.getByRole('button', { name: 'Blair', exact: true }).click();
      await p.getByRole('heading', { name: 'Blair', exact: true, level: 1 }).waitFor();
      await p.locator('.schedule article').first().waitFor();
      // Only "Who are you?" has the sign-in link; the schedule ends with a thin line.
      assert((await p.getByRole('link', { name: 'Organizer sign-in' }).count()) === 0, 'no Organizer sign-in at the bottom of the player page');
      await p.locator('main > .page-end').waitFor({ state: 'attached' });
      await p.reload();
      await p.getByRole('heading', { name: 'Blair', exact: true, level: 1 }).waitFor();
      await p.screenshot({ path: path.join(SHOTS, 'player-plain-address.png'), fullPage: true });
      // "not you?" brings back "Who are you?", with the link exactly as before.
      await p.getByRole('button', { name: 'Not you?' }).click();
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await p.getByRole('link', { name: 'Organizer sign-in' }).waitFor();
      await p.getByRole('button', { name: 'Cancel' }).click();
    });

    await check('Settings: turning the open address OFF goes back to link-only; the long link still works', async () => {
      await tab(admin, 'Settings').click();
      await openSections(admin);
      await admin.getByText('Old private link').click();
      privateLink = (await admin.locator('details code.link').textContent()).trim();
      assert(/\/g\/[A-Za-z0-9_-]{20,}$/.test(privateLink), `private link was ${privateLink}`);
      await admin.getByLabel('Anyone with the site address can use it').uncheck();
      await savedIn(admin.getByLabel('Anyone with the site address can use it'));
      assert((await admin.getByRole('region', { name: 'Quick settings' }).locator('.set-link').textContent()).includes('/g/'), 'link-only should show the long link');
      const p = await newPage();
      await p.goto(BASE);
      await p.getByText('Open the link your organizer sent you').waitFor();
      await p.getByRole('link', { name: 'Organizer sign-in' }).waitFor();
      await p.goto(privateLink);
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await admin.getByLabel('Anyone with the site address can use it').check();
      await savedIn(admin.getByLabel('Anyone with the site address can use it'));
      await p.goto(BASE);
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
    });

    await check('Settings: a group word is asked once on a new phone, then remembered', async () => {
      await autoSet(admin.getByLabel(/Group word/), 'Dink');
      const p = await newPage();
      await p.goto(BASE);
      await p.getByLabel("What's the group word?").fill('nope');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByText("That's not the group word.").waitFor();
      await p.getByLabel("What's the group word?").fill('dink');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await p.reload();
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      // Phones that already picked their name aren't asked.
      await players.Alex.reload();
      await firstCard(players.Alex).waitFor();
      assert((await players.Alex.getByLabel("What's the group word?").count()) === 0, 'known phones should not be asked');
      await admin.getByRole('button', { name: 'Remove the group word' }).click();
      await admin.getByRole('button', { name: 'Remove the group word' }).waitFor({ state: 'detached' });
      const q = await newPage();
      await q.goto(BASE);
      await q.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await tab(admin, 'Home').click();
    });

    console.log('Roster, names, home screen');
    await check('who\'s in: only people who signed up, as dots and plain names; nobody else listed', async () => {
      await players.Alex.reload();
      const card = firstCard(players.Alex);
      await card.locator('.names-line strong', { hasText: 'Alex' }).waitFor();
      assert((await card.locator('.roster li.out').count()) === 0, 'faded not-signed-up names should be gone');
      const styles = await players.Alex.evaluate(() => {
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        const bg = (c) => ((probe.className = c), getComputedStyle(probe).backgroundColor);
        const colors = [bg('chip tone-ok'), bg('chip tone-warn'), bg('chip tone-danger')];
        probe.remove();
        return { pill: getComputedStyle(document.querySelector('.dots .ball .ball-skin')).fill, colors };
      });
      assert(!styles.colors.includes(styles.pill), `ball uses a status color: ${styles.pill}`);
      assert((await card.locator('.in-pills, .spots, .me-tag').count()) === 0, 'no name chips or black pill on the player card');
    });

    await check('players see today\'s date top right and week dividers, without filler', async () => {
      const p = players.Casey;
      await p.reload();
      await p.locator('.schedule article').first().waitFor();
      assert(/^(SUN|MON|TUE|WED|THU|FRI|SAT)$/.test((await p.locator('header .today .dow').innerText()).trim()), 'player date square weekday');
      assert(/^\d{1,2}$/.test((await p.locator('header .today .day').innerText()).trim()), 'player date square day');
      await p.locator('header').getByRole('button', { name: 'Not you?' }).waitFor();
      const labels = await p.locator('.schedule .week-break').allInnerTexts();
      assert(labels.length >= 2, `expected week dividers on the player screen, got ${labels}`);
      for (const filler of [/standby list so we're ready/, /Nobody on standby yet/, /so this one is off/]) {
        assert((await p.getByText(filler).count()) === 0, `filler still shown: ${filler}`);
      }
      await p.screenshot({ path: path.join(SHOTS, 'player-weeks.png'), fullPage: true });
    });

    await check('players can sign up for a session whose court is not booked yet; the button is never faded', async () => {
      const p = players.Casey;
      await p.reload();
      await p.locator('.schedule article').first().waitFor();
      const more = p.getByRole('button', { name: /^More sessions/ });
      if (await more.count()) await more.click();
      const rows = p.locator('.schedule article').filter({ has: p.locator('.sched-status[data-court="later"], .sched-status[data-court="needs"]') });
      const pick = rows.filter({ has: p.getByRole('button', { name: "I'm in", exact: true }) }).last();
      const row = p.locator(`article[aria-labelledby="${await pick.getAttribute('aria-labelledby')}"]`);
      const btn = row.getByRole('button', { name: "I'm in", exact: true });
      await btn.waitFor();
      const look = await btn.evaluate((el) => ({ disabled: el.disabled, opacity: getComputedStyle(el).opacity }));
      assert(!look.disabled && look.opacity === '1', `I'm in looks turned off: ${JSON.stringify(look)}`);
      // In the text column, right of the date tile and under the names; a full-size tap target.
      const tcol = await row.locator('.sched-tilecol').boundingBox();
      const b = await btn.boundingBox();
      const court = await row.locator('.sched-status').boundingBox();
      const laterRow = (await row.getAttribute('data-tier')) === 'later';
      assert(b.x >= tcol.x + tcol.width && (laterRow || b.y >= court.y + court.height), 'button should sit in the text column (under the status line; on the right in a flat LATER row)');
      assert(b.height >= 44, `button is ${b.height}px tall`);

      // The confirmation is a small bubble next to the button, and nothing on the page moves.
      await btn.scrollIntoViewIfNeeded();
      const before = await p.evaluate(() => document.documentElement.scrollHeight);
      const rowTop = (await row.boundingBox()).y;
      {
        const nb = await btn.boundingBox();
        b.x = nb.x;
        b.y = nb.y;
        b.width = nb.width;
        b.height = nb.height;
      }
      await btn.click();
      const pop = p.locator('.pop');
      await pop.waitFor();
      // The tapped button turns into a Drop out link, so the bubble is checked against where the button was just before the tap.
      assert((await pop.innerText()).trim() === "You're in", `banner said ${await pop.innerText()}`);
      // The banner: bottom center of the screen, just above the bottom edge, never next to the tapped button.
      await pop.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})))); // it slides up the last 8px while fading in
      const pb = await pop.boundingBox();
      const vw = p.viewportSize().width;
      const vh = p.viewportSize().height;
      assert(pb.x >= 0 && pb.x + pb.width <= vw && pb.y >= 0 && pb.width <= 342, `banner must stay on screen and at most about 340px wide: ${JSON.stringify(pb)}`);
      assert(Math.abs(pb.x + pb.width / 2 - vw / 2) < 3, 'banner is centered');
      assert(vh - (pb.y + pb.height) >= 16 && vh - (pb.y + pb.height) <= 24, `banner sits 16 to 24px above the bottom, it is ${vh - (pb.y + pb.height)}px (see e2e/banner.cjs)`);
      const style = await pop.evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), hidden: el.getAttribute('aria-hidden'), pos: getComputedStyle(el).position, icon: !!el.querySelector('.toast-icon') }));
      assert(style.size >= 13 && style.hidden === 'true' && style.pos === 'fixed' && style.icon, `banner style: ${JSON.stringify(style)}`);
      await p.locator('[aria-live="polite"]', { hasText: "You're in" }).waitFor({ state: 'attached' });
      assert(Math.abs((await row.boundingBox()).y - rowTop) < 2 && (await p.evaluate(() => document.documentElement.scrollHeight)) >= before - 2, 'the bubble must not push the page around');
      assert((await p.locator('.toast:not(.pop)').count()) === 0, 'old white banner should be gone');
      await pop.waitFor({ state: 'detached', timeout: 3500 });
      await p.screenshot({ path: path.join(SHOTS, 'player-joined.png') });

      // Errors: same bubble, stronger color, stays about 4 seconds.
      const out = row.getByRole('button', { name: 'Drop out', exact: true });
      await p.route('**/api/sessions/*/withdraw', (r) => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'test', message: 'Try again' }) }));
      await out.click();
      await confirmDrop(p);
      const err = p.locator('.pop.pop-error');
      await err.waitFor();
      const colors = await p.evaluate(() => {
        const e = document.querySelector('.pop.pop-error');
        const probe = document.createElement('div');
        probe.className = 'pop';
        probe.style.visibility = 'hidden';
        document.body.appendChild(probe);
        const r = [getComputedStyle(e).backgroundColor, getComputedStyle(probe).backgroundColor];
        probe.remove();
        return r;
      });
      assert(colors[0] !== colors[1], 'error bubble should use a stronger color');
      await p.waitForTimeout(3000);
      assert((await err.count()) === 1, 'error bubble should stay about 4 seconds');
      await err.waitFor({ state: 'detached', timeout: 2500 });
      await p.unroute('**/api/sessions/*/withdraw');
      await out.click();
      await confirmDrop(p);
    });

    await check('player rows are light: count and dots on one line, every name on the line under it, no money', async () => {
      const p = players.Alex;
      await p.reload();
      const row = firstCard(p);
      await row.locator('.names-line').waitFor();
      const tops = await row.locator('.in-line > *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2));
      assert(Math.max(...tops) - Math.min(...tops) < 6, 'count and dots should sit on one line');
      const line = await row.locator('.in-line').boundingBox();
      const names = await row.locator('.names-line').boundingBox();
      assert(names.y >= line.y + line.height - 1, 'names sit on their own line under the dots');
      assert(!/\+\d/.test(await row.locator('.names-line').innerText()), 'no "+N"');
      assert((await row.getByText(/You owe/).count()) === 0, 'no money block on the row');
    });

    await check('organizer and players see the same dots and names, in sign-up order', async () => {
      await admin.reload();
      const card = sessionCards(admin).first();
      await card.locator('.players-line .dots > *').first().waitFor();
      const adminNames = await card.locator('.players-line .names-line').getAttribute('title');
      const p = players.Alex;
      await p.reload();
      const row = firstCard(p);
      await row.locator('.names-line').waitFor();
      const playerNames = await row.locator('.names-line').getAttribute('title');
      assert(adminNames && adminNames === playerNames, `organizer ${adminNames} vs player ${playerNames}`);
      assert((await card.locator('.players-line .dots .ball').count()) === (await row.locator('.in-line .dots .ball').count()), 'same number of balls on both screens');
      assert((await card.locator('.players-line .dots .dot').count()) === (await row.locator('.in-line .dots .dot').count()), 'same number of empty circles on both screens');
      // Same ball on both screens: round (width = height), same yellow-green skin. (Player cards draw them a bit bigger now.)
      const look = async (page, sel) =>
        page.locator(sel).first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return `${Math.abs(r.width - r.height) < 0.5} ${getComputedStyle(el.querySelector('.ball-skin')).fill}`;
        });
      assert((await look(admin, 'section[aria-labelledby="sessions-title"] .dots .ball')) === (await look(p, '.schedule .dots .ball')), 'balls should look the same');
      assert((await row.locator('.dots .ball.me').count()) === 1, 'your own ball is marked');
      for (const scheme of ['light', 'dark']) {
        await admin.emulateMedia({ colorScheme: scheme });
        await p.emulateMedia({ colorScheme: scheme });
        await card.screenshot({ path: path.join(SHOTS, `pills-admin-${scheme}.png`) });
        await row.screenshot({ path: path.join(SHOTS, `pills-player-${scheme}.png`) });
      }
      await admin.emulateMedia({ colorScheme: 'light' });
      await p.emulateMedia({ colorScheme: 'light' });
    });

    await check('no Add to Home Screen tip or row anywhere; the player page ends with a thin line; the icon still works', async () => {
      const p = await newPage();
      await p.goto(playerLink);
      await p.getByRole('button', { name: 'Alex', exact: true }).click();
      await p.locator('article').first().waitFor();
      assert((await p.getByText(/Home Screen/i).count()) === 0, 'Home Screen tip still on the player page');
      assert((await p.locator('.footer-tip').count()) === 0, 'tip box still there');
      // The very end: just a thin line and a little space.
      const end = p.locator('main > .page-end');
      await end.waitFor({ state: 'attached' });
      const last = await p.evaluate(() => {
        const kids = [...document.querySelector('main').children].filter((e) => e.offsetParent !== null || e.classList.contains('page-end'));
        const el = kids[kids.length - 1];
        return { cls: el.className, border: getComputedStyle(el).borderTopWidth, text: el.textContent.trim() };
      });
      assert(last.cls === 'page-end' && last.border === '1px' && last.text === '', `page should end with a thin line: ${JSON.stringify(last)}`);
      assert((await p.getByRole('link', { name: 'Organizer sign-in' }).count()) === 0, 'no Organizer sign-in under the schedule');
      const manifest = await (await p.request.get(BASE + '/manifest.webmanifest')).json();
      assert(manifest.display === 'standalone', 'should open full screen from the icon');
      assert(!manifest.start_url, 'no start_url, so each player keeps their own link');
      assert((await p.locator('link[rel="apple-touch-icon"]').getAttribute('href')) === '/apple-touch-icon.png', 'icon spot missing');
      await tab(admin, 'Settings').click();
      await openSections(admin);
      assert((await admin.locator('details[data-section="a2hs"]').count()) === 0, 'Settings still has Add to Home Screen');
      assert((await admin.getByText(/Add to Home Screen/).count()) === 0, 'Add to Home Screen text in Settings');
      await tab(admin, 'Home').click();
    });

    await check('"Add my name": duplicate check, then preferred days, then Welcome', async () => {
      const p = await newPage();
      await p.goto(playerLink);
      await p.getByRole('button', { name: 'Add my name' }).click();
      await p.getByLabel('Your name').fill('ryan');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('heading', { name: 'Is this you?' }).waitFor();
      await p.getByRole('button', { name: 'Ryan', exact: true }).waitFor();
      await p.getByRole('button', { name: "No, I'm new" }).click();
      await p.getByText(/Someone already uses "ryan"/).waitFor();
      await p.getByLabel('Your name').fill('Morgan');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('heading', { name: 'Any preferred days?' }).waitFor();
      for (const b of ['Tuesday', 'Thursday', 'Both', 'Skip']) await p.getByRole('button', { name: b, exact: true }).waitFor();
      await p.getByRole('button', { name: 'Both', exact: true }).click();
      await p.getByRole('heading', { name: 'Morgan', exact: true, level: 1 }).waitFor();
      await p.getByRole('button', { name: 'Not you?' }).waitFor();
      await p.screenshot({ path: path.join(SHOTS, 'player-added-name.png'), fullPage: true });
      await tab(admin, 'Players').click();
      await admin.reload();
      await tab(admin, 'Players').click();
      const row = admin.locator('li', { hasText: 'Morgan' });
      await row.locator('.new-tag', { hasText: 'New' }).waitFor();
      await row.locator('.p-line2', { hasText: /Tue Thu$/ }).waitFor();
    });

    await check('removing a name: deleted if no history, hidden if they have some', async () => {
      await admin.getByRole('button', { name: 'Edit Morgan' }).click();
      await admin.locator('dialog[open]').getByRole('button', { name: 'Remove from list' }).click();
      await admin.locator('dialog[open]', { hasText: 'Remove Morgan?' }).getByRole('button', { name: 'Remove', exact: true }).click();
      await admin.locator('.toast', { hasText: 'Morgan removed' }).waitFor();
      await admin.locator('li', { hasText: 'Morgan' }).waitFor({ state: 'detached' });
      await admin.getByRole('button', { name: 'Edit Ryan' }).click();
      await admin.locator('dialog[open]').getByRole('button', { name: 'Remove from list' }).click();
      await admin.locator('dialog[open]', { hasText: 'Remove Ryan?' }).getByRole('button', { name: 'Remove', exact: true }).click();
      await admin.locator('.toast', { hasText: /Ryan (removed|hidden)/ }).waitFor();
      await tab(admin, 'Home').click();
    });

    console.log('View as');
    /** Every row of every table in the test site's database, to prove a demo saved nothing. */
    const dbRows = () => {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(dbFile, { readOnly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
      const out = {};
      for (const t of tables) out[t] = JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all());
      db.close();
      return out;
    };
    /** Changes sent to the test site while `fn` runs (sign-out aside). */
    const changesSent = async (page, fn) => {
      const sent = [];
      const onReq = (r) => r.method() !== 'GET' && r.url().includes('/api/') && !r.url().endsWith('/api/admin/logout') && sent.push(`${r.method()} ${r.url()}`);
      page.context().on('request', onReq);
      try {
        await fn();
      } finally {
        page.context().off('request', onReq);
      }
      return sent;
    };
    const sameRows = (before, after) => {
      const diff = Object.keys({ ...before, ...after }).filter((t) => before[t] !== after[t]);
      assert(diff.length === 0, `the demo changed the database: ${diff}`);
    };

    await check('"View as..." demo: taps show their effect (I\'m in, Pay then I paid, Paid, I\'m out), and nothing is saved', async () => {
      await admin.reload();
      const before = dbRows();
      const sent = await changesSent(admin, async () => {
        await admin.getByRole('button', { name: 'View as…' }).click();
        await admin.locator('dialog[open]').getByText('Demo: taps work, nothing is saved.').waitFor();
        await admin.locator('dialog[open]').getByRole('button', { name: 'Blair', exact: true }).click();
        await admin.getByRole('region', { name: 'Viewing as a player' }).getByText('Viewing as').waitFor();
        await admin.locator('.demo-bars .pretend-bar', { hasText: 'Demo, nothing is saved' }).waitFor();
        await admin.getByRole('heading', { name: 'Blair', exact: true, level: 1 }).waitFor();
        await admin.screenshot({ path: path.join(SHOTS, 'admin-view-as.png'), fullPage: true });
        const second = admin.locator('article').nth(1);
        await second.getByRole('button', { name: "I'm in" }).click();
        await second.locator('.tile-check').waitFor();
        await second.locator('.names-line', { hasText: 'Blair' }).waitFor();
        // Pay shows the next step and opens nothing.
        const url = admin.url();
        const pay = second.getByRole('link', { name: /^Pay \$\d+ with Venmo$/ });
        if (await pay.count()) {
          await pay.click();
          await second.getByRole('button', { name: 'I paid' }).click();
          await second.locator('.paid-tag', { hasText: 'Paid' }).waitFor();
          await second.getByRole('button', { name: "Didn't pay?" }).waitFor();
          assert(admin.url() === url && admin.context().pages().length === 1, 'Pay opened something in the demo');
        }
        await admin.screenshot({ path: path.join(SHOTS, 'admin-view-as-after-in.png'), fullPage: true });
        await second.getByRole('button', { name: 'Drop out' }).click();
        await confirmDrop(admin);
        await second.getByRole('button', { name: "I'm in" }).waitFor();
        // Reset throws the demo changes away.
        await second.getByRole('button', { name: "I'm in" }).click();
        await second.locator('.tile-check').waitFor();
        await admin.locator('.pretend-bar').getByRole('button', { name: 'Reset' }).click();
        await second.getByRole('button', { name: "I'm in" }).waitFor();
        assert((await second.locator('.tile-check').count()) === 0, 'Reset should throw the sign-up away');
        await admin.getByRole('button', { name: 'Exit' }).click();
        await tab(admin, 'Home').waitFor();
        assert((await admin.locator('.pretend-bar').count()) === 0, 'leaving the demo hides the bar');
      });
      assert(sent.length === 0, `the demo sent changes to the site: ${sent}`);
      sameRows(before, dbRows());
      await players.Blair.reload();
      assert((await players.Blair.locator('article').nth(1).locator('.tile-check').count()) === 0, 'Blair is not really signed up');
      // Blair signs up on her own phone (the next checks start from here).
      const own = players.Blair.locator('article').nth(1);
      await own.getByRole('button', { name: "I'm in" }).click();
      await own.locator('.tile-check').waitFor();
    });

    await check('"Pretend it\'s..." demo: the site follows that time, organizer taps show their effect (Mark paid), Reset and End work, nothing is saved', async () => {
      await admin.reload();
      const before = dbRows();
      const sent = await changesSent(admin, async () => {
        await admin.getByRole('button', { name: 'View as…' }).click();
        const sheet = admin.locator('dialog[open]');
        await sheet.getByRole('heading', { name: "Pretend it's…" }).waitFor();
        await sheet.getByRole('button', { name: 'After the game' }).click();
        const bar = admin.locator('.pretend-bar');
        await bar.waitFor();
        const label = await bar.innerText();
        assert(/Demo, nothing is saved · (Tue|Thu) [A-Z][a-z]{2} \d{1,2}, 10:30 PM/.test(label), `bar says: ${label}`);
        assert(!/UTC|GMT|EDT|EST/.test(label), 'no time zone letters in the bar');
        // Mark paid works in the demo.
        await tab(admin, 'Money').click();
        // The payment lists fold closed when the page refreshes; open them to look.
        const openAll = () => admin.locator('details.money-sess').evaluateAll((els) => els.forEach((el) => (el.open = true)));
        await admin.locator('details.money-sess').first().waitFor();
        await openAll();
        const sess = admin.locator('details.money-sess', { has: admin.getByRole('button', { name: 'Mark paid' }) }).first();
        if (await sess.count()) {
          const id = await sess.getAttribute('data-session');
          const inSess = () => admin.locator(`details.money-sess[data-session="${id}"]`);
          const unmarks = async () => {
            await openAll();
            return inSess().getByRole('button', { name: 'Unmark' }).count();
          };
          const before = await unmarks();
          await inSess().getByRole('button', { name: 'Mark paid' }).first().click();
          for (let i = 0; i < 50 && (await unmarks()) === before; i++) await admin.waitForTimeout(100);
          assert((await unmarks()) === before + 1, 'Mark paid should show its effect in the demo');
          // Reset: back to how it was.
          await bar.getByRole('button', { name: 'Reset' }).click();
          for (let i = 0; i < 50 && (await unmarks()) !== before; i++) await admin.waitForTimeout(100);
          assert((await unmarks()) === before, 'Reset should throw the payment away');
        }
        await tab(admin, 'Home').click();
        await bar.getByRole('button', { name: 'End' }).click();
        assert((await admin.locator('.pretend-bar').count()) === 0, 'End hides the bar');
        // A reload ends it too.
        await admin.getByRole('button', { name: 'View as…' }).click();
        await admin.locator('dialog[open]').getByRole('button', { name: 'Game day, 8:30 AM' }).click();
        await bar.waitFor();
        await admin.reload();
        await tab(admin, 'Home').waitFor();
        assert((await admin.locator('.pretend-bar').count()) === 0, 'a reload ends the demo');
      });
      assert(sent.length === 0, `the demo sent changes to the site: ${sent}`);
      sameRows(before, dbRows());
    });

    await check('coming back to the page after 30 seconds quietly shows the latest (no reload, no spinner)', async () => {
      const a = players.Alex;
      await a.reload();
      const before = await a.locator('article').nth(1).locator('.in-line').textContent();
      // The phone goes to another app...
      const away = (state) =>
        a.evaluate((st) => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
          document.dispatchEvent(new Event('visibilitychange'));
        }, state);
      await away('hidden');
      // ...someone else signs up for that game meanwhile...
      const sid = (await a.locator('article').nth(1).locator('[id^="s-"]').first().getAttribute('id')).slice(2);
      const c = players.Casey;
      const res = await c.evaluate((id) => fetch(`/api/sessions/${id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()), sid);
      assert(res.result === 'confirmed' || res.result === 'waitlisted', `Casey's sign-up: ${JSON.stringify(res)}`);
      // ...and 31 seconds later the phone comes back.
      await a.evaluate(() => {
        const real = Date.now;
        Date.now = () => real() + 31_000;
      });
      await away('visible');
      await a.waitForFunction((was) => document.querySelectorAll('article')[1]?.querySelector('.in-line')?.textContent !== was, before, { timeout: 5000 });
      assert((await a.locator('.spinner').count()) === 0, 'no spinner on a quiet refresh');
      // Casey goes back out so the next checks start as before.
      await c.evaluate((id) => fetch(`/api/sessions/${id}/withdraw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), sid);
      await a.reload();
    });

    await check('Settings > Backup downloads a backup file with everything in it', async () => {
      await tab(admin, 'Settings').click();
      await openSections(admin);
      const [dl] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('link', { name: 'Download backup file' }).click()]);
      assert(/^pickleball-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), `file name: ${dl.suggestedFilename()}`);
      const file = await dl.path();
      const b = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
      assert(b.format === 'pickleball-backup' && b.tables.players.length >= 6 && b.tables.sessions.length > 0, 'backup is missing data');
      await tab(admin, 'Home').click();
    });

    console.log('Filling a session');
    await check('players fill the second session themselves (Invite substitutes is gone)', async () => {
      for (const name of ['Alex', 'Casey', 'Frankie']) {
        await players[name].reload();
        const card = players[name].locator('article').nth(1);
        await card.locator('.in-line .in-count').waitFor();
        // Stop at 4 (nobody waits any more: a 5th would simply be in).
        if ((await card.locator('.in-line .in-count').innerText()).trim() === '4 in') break;
        const btn = card.getByRole('button', { name: "I'm in" });
        if (await btn.count()) {
          await btn.click();
          await card.locator('.tile-check').waitFor();
        }
      }
      await admin.reload();
      await sessionCards(admin).first().waitFor();
      assert((await admin.getByText(/Invite substitutes/).count()) === 0, 'Invite substitutes should be gone');
    });

    console.log('Court waitlist');
    await check('court waitlist: players tap the join button and read it as a normal game (the organizer sees standby); the share text is the usual one; Court opened moves them in', async () => {
      const card = sessionCards(admin).nth(3);
      const day = (await card.locator('h2').innerText()).trim(); // e.g. "Thu, Nov 5"
      await more(card);
      await card.getByRole('button', { name: 'On court waitlist' }).click();
      const banner = card.locator('.court-banner');
      await banner.getByRole('button', { name: 'Court opened' }).waitFor();
      await banner.getByRole('button', { name: "Didn't open" }).waitFor();
      await banner.getByText('Court waitlist', { exact: true }).waitFor();
      assert((await card.getAttribute('data-court')) === 'waitlist', 'card should show the court waitlist look');
      assert((await card.getByRole('button', { name: 'I booked it' }).count()) === 0, 'waitlist card should not offer I booked it');
      // Words and both buttons on a single row inside the banner.
      const words = await banner.locator('.court-status').boundingBox();
      const opened = await banner.getByRole('button', { name: 'Court opened' }).boundingBox();
      const didnt = await banner.getByRole('button', { name: "Didn't open" }).boundingBox();
      // The two buttons stay together; the words never run under them.
      const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      assert(Math.abs(opened.y - didnt.y) < 4, 'the two buttons should sit side by side');
      assert(!hit(words, opened) && !hit(words, didnt), 'banner words should not overlap the buttons');
      await card.screenshot({ path: path.join(SHOTS, 'card-court-waitlist.png') });
      await admin.screenshot({ path: path.join(SHOTS, 'admin-court-waitlist.png') });
      const texts = await textMenu(card);
      const shareBody = smsOf(await texts.locator('.text-row[data-text="share"] a').getAttribute('href')).body;
      assert(/^Pickleball (?:tonight|tomorrow|today|(?:Tue|Thu) [A-Z][a-z]{2} \d{1,2}), \d{1,2}:\d{2} PM\. In or out here: \S+$/.test(shareBody), `waitlist share text: ${shareBody}`);
      assert((await texts.locator('.text-row[data-text="poll"]').count()) === 0, 'no Poll');
      await closeOptions(card);

      for (const name of ['Casey', 'Devon']) {
        const p = players[name];
        await p.reload();
        const row = p.locator('article', { hasText: day.replace(/^(Tue|Thu), /, (m) => (m.startsWith('Tue') ? 'Tuesday, ' : 'Thursday, ')) });
        // With no court booked the game reads like a normal one: Court not booked, I'm in, You're in. Never waiting or standby words.
        await row.locator('.sched-status').getByText('Court not booked', { exact: true }).waitFor();
        await row.getByRole('button', { name: "I'm in" }).click();
        await row.locator('.sched-status').getByText("You're in", { exact: true }).waitFor();
        assert(!/waitlist|waiting|standby/i.test(await row.innerText()), `no waiting words on a game without a court: ${await row.innerText()}`);
        assert((await row.getByLabel('Money for this session').count()) === 0, 'players owe nothing before a court is booked');
      }
      await players.Casey.screenshot({ path: path.join(SHOTS, 'player-standby.png'), fullPage: true });

      await admin.reload();
      const c2 = sessionCards(admin).nth(3);
      // Everyone on standby, by name, on a line of its own.
      await c2.locator('.players-line .waitlist-line', { hasText: /^Standby: \w+, \w+$/ }).waitFor();
      assert((await admin.getByRole('article', { name: /^Waiting on the court/ }).count()) === 0, 'no separate waiting card');
      await c2.getByRole('button', { name: 'Court opened' }).click();
      await admin.locator('.toast', { hasText: 'Court opened' }).waitFor();
      assert((await admin.locator('dialog[open]').count()) === 0, 'Court opened should not ask anything');
      await c2.locator('.court-line').getByText('Court booked', { exact: true }).waitFor();
      await admin.reload();
      if (await admin.locator('.sg-more').count()) await admin.locator('.sg-more').click();
      const tell = admin.getByRole('article', { name: new RegExp(`^Spot opened: ${day}`) });
      await tell.locator('.sg-preview').first().waitFor();
      assert(/A spot opened and you're in for pickleball (tonight|tomorrow|today|(Tue|Thu) [A-Z][a-z]{2} \d{1,2}), \d{1,2}:\d{2} PM\. \S+$/.test(await tell.first().getByRole('link', { name: /^Text/ }).getAttribute('aria-label')), 'spot opened text');
      assert((await admin.getByRole('article', { name: /^Now 6/ }).count()) === 0, 'Now 6 is gone');

      const p = players.Casey;
      await p.reload();
      const row = p.locator('article', { hasText: day.replace(/^(Tue|Thu), /, (m) => (m.startsWith('Tue') ? 'Tuesday, ' : 'Thursday, ')) });
      await row.locator('.sched-status').getByText('Court booked', { exact: true }).waitFor();
      await row.getByText("Good news, the court opened, so you're in.").waitFor();
      await row.getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      // The court-waitlist banner keeps its words and buttons on one row (checked before it opened).
    });

    await check('check-in the night before: the Do this now card opens the Check-in text with no numbers, hides after the tap; never "sent"', async () => {
      const first = await admin.evaluate(async () => {
        const d = await (await fetch('/api/admin/dashboard')).json();
        const later = d.sessions.filter((s) => Date.parse(s.startsAt) > Date.parse(d.now) + 30 * 3600_000 && s.status !== 'canceled' && s.confirmedCount === 4);
        return later.find((s) => s.bookingStatus === 'booked') ?? later[0];
      });
      assert(first, 'need a later session with 4 in');
      // The night-before card is for games with a booked court.
      if (first.bookingStatus !== 'booked') await admin.request.post(`${BASE}/api/admin/sessions/${first.id}/booked`, { data: {}, headers: { Origin: BASE } });
      const clock = (atMs) => admin.request.post(`${BASE}/__dev/clock`, { data: { atMs } });
      try {
        await clock(Date.parse(first.startsAt) - 20 * 3600_000);
        await admin.reload();
        // The night before, the check-in is the "Do this now" card's job (no separate suggestion card): its
        // button opens Messages with the Check-in words and NO numbers, so the group chat can be picked.
        // The addressed version (all their numbers) stays in the game's Text menu.
        assert((await admin.locator(`article[data-suggest="checkin"][data-session="${first.id}"]`).count()) === 0, 'no second check-in card');
        if (await admin.locator('.dn-more[aria-expanded="false"]').count()) await admin.locator('.dn-more').click();
        const card = admin.locator(`.dn-card[data-task="night"][data-session="${first.id}"]`);
        await card.waitFor({ timeout: 5000 }).catch(async () => {
          const names = await admin.locator('article').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label')).filter(Boolean));
          throw new Error(`no night-before card for ${first.startsAt}; Home shows: ${names.join(' | ')}`);
        });
        assert((await card.locator('.dn-text').innerText()).trim() === 'Tonight: 4 players in.', `card words: ${await card.locator('.dn-text').innerText()}`);
        const open = card.getByRole('link', { name: /^Text the group to confirm/ });
        const href = await open.getAttribute('href');
        assert(/^sms:[&?]body=/.test(href), `should open with no numbers: ${href}`);
        // The game is 20 hours away, so later the same day: "tonight".
        const want = `Pickleball tonight, 8:00 PM. Can't make it? Update here: ${SITE}`;
        assert(smsOf(href).body === want, `Messages opens with: ${smsOf(href).body}`);
        assert(!/\bsent\b/i.test(await card.innerText()), 'card must never say sent');
        await admin.screenshot({ path: path.join(SHOTS, 'admin-check-in-card.png'), fullPage: true });
        await card.evaluate((el) => el.querySelector('a[href^="sms"]').addEventListener('click', (e) => e.preventDefault()));
        await open.click();
        await card.waitFor({ state: 'detached' });
        // Later the same day, still 4 in: it stays done, also after a reload (the tap is saved on the server).
        await clock(Date.parse(first.startsAt) - 12.5 * 3600_000);
        await admin.reload();
        await admin.locator('main').waitFor();
        assert((await admin.locator(`.dn-card[data-task="night"][data-session="${first.id}"]`).count()) === 0, 'came back after the tap');
        assert((await admin.locator(`article[data-suggest="checkin"][data-session="${first.id}"]`).count()) === 0, 'suggestion came back');
      } finally {
        await clock(Date.now() + BASE_OFFSET);
        await admin.reload();
      }
    });

    console.log('Reschedule & cancel');
    await check('organizer can move a session to a new time', async () => {
      const card = sessionCards(admin).first();
      await more(card);
      assert((await card.getByRole('button', { name: 'Reschedule' }).count()) === 0, 'no separate Reschedule button');
      await card.getByRole('button', { name: 'Edit booking' }).click();
      const sheet = admin.locator('dialog[open]');
      // Moving lives inside Edit booking, tucked away until needed.
      assert(!(await sheet.getByLabel('Start', { exact: true }).isVisible()), 'Move this session should start closed');
      await sheet.getByText('Move this session').click();
      const change = sheet.getByRole('link', { name: /^Change court on CourtReserve/ });
      assert((await change.getAttribute('href')) === 'https://mobileapp.courtreserve.com/Online/Bookings/List/13765?type=1', 'reschedule should link to the modify/cancel page');
      await sheet.getByLabel('Start', { exact: true }).fill('19:30');
      // The end moves with the start (the game keeps its 2 hours).
      await sheet.getByText(/New time: .*7:30 to 9:30 PM$/).waitFor();
      await sheet.getByRole('button', { name: 'Move session' }).click();
      // Straight to a ready text for the group, with an optional reason.
      const moved = admin.locator('dialog[open]');
      await moved.getByText(/^Moved · /).waitFor();
      const bubble = moved.locator('.bubble');
      assert(/^Pickleball (Tue|Thu) [A-Z][a-z]{2} \d{1,2} is moved to (?:tonight|tomorrow|today|(?:Tue|Thu) [A-Z][a-z]{2} \d{1,2}), 7:30 PM\. \S+$/.test((await bubble.innerText()).trim()), `moved text was: ${await bubble.innerText()}`);
      await moved.getByLabel(/Reason/).fill('Court swap');
      await bubble.getByText(/7:30 PM\. Court swap\. \S+$/).waitFor();
      await moved.getByRole('link', { name: 'Text the players who are in' }).waitFor();
      assert((await moved.getByRole('button', { name: /^Copy/ }).count()) === 0, 'no Copy');
      assert(!/\bsent\b/i.test(await moved.innerText()), 'never say sent');
      // Then: is the court booked for the new time? The answer sets the court status.
      await moved.getByRole('group', { name: 'Is the court booked for the new time?' }).getByRole('button', { name: 'Yes' }).click();
      await moved.getByRole('button', { name: 'Yes', pressed: true }).waitFor();
      await admin.keyboard.press('Escape');
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await card.getByText('7:30 to 9:30 PM', { exact: true }).waitFor();
    });

    await check('a booked session links to the CourtReserve modify/cancel page from More and from Cancel session', async () => {
      const CANCEL = 'https://mobileapp.courtreserve.com/Online/Bookings/List/13765?type=1';
      const card = sessionCards(admin).first();
      assert((await card.getAttribute('data-court')) === 'booked', 'first card should be booked here');
      await more(card);
      const link = card.getByRole('link', { name: /^Modify court/ });
      assert((await link.getAttribute('href')) === CANCEL && (await link.getAttribute('target')) === '_blank', 'More should link to the modify/cancel page');
      await card.getByRole('button', { name: 'Cancel session' }).click();
      const dlg = admin.locator('dialog[open]');
      const inDialog = dlg.getByRole('link', { name: /^Cancel court on CourtReserve/ });
      assert((await inDialog.getAttribute('href')) === CANCEL, 'cancel dialog should link to the modify/cancel page');
      await admin.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached' }).catch(() => {});
      assert((await card.getAttribute('data-court')) === 'booked', 'closing the dialog must not cancel');
    });

    await check('canceling needs confirmation and warns it does not cancel the court', async () => {
      const card = sessionCards(admin).nth(1);
      await more(card);
      await card.getByRole('button', { name: 'Cancel session' }).click();
      const dlg = admin.locator('dialog[open]');
      await dlg.getByText('This does not cancel your court').waitFor();
      await dlg.getByRole('button', { name: 'Go back' }).click();
      await card.getByRole('button', { name: 'Cancel session' }).waitFor();
      assert((await card.getByText('Canceled', { exact: true }).count()) === 0, 'canceled without confirming');
      // Someone pays first (on the Money tab), so there's someone to pay back.
      const moneySheet = await moneyFor(admin, card);
      const payer = (await moneySheet.locator('li', { has: admin.getByRole('button', { name: 'Mark paid' }) }).first().locator('strong').innerText()).trim();
      await moneySheet.getByRole('button', { name: 'Mark paid' }).first().click();
      await admin.locator('.toast', { hasText: 'marked paid' }).waitFor();
      await tab(admin, 'Home').click();
      await more(card);
      await card.getByRole('button', { name: 'Cancel session' }).click();
      await admin.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
      const after = admin.locator('dialog[open]');
      await after.getByText(/^Canceled · /).waitFor();
      const bubble = after.locator('.bubble');
      const want = /^Pickleball (Tue|Thu) [A-Z][a-z]{2} \d{1,2} is canceled\. If you paid, it's now your credit\. You can request a cash out on the site\. \S+$/;
      assert(want.test((await bubble.innerText()).trim()), `cancel text was: ${await bubble.innerText()}`);
      assert(!/Text me|stays as your credit/.test(await bubble.innerText()), 'old cancel wording');
      await after.getByLabel(/Reason/).fill('Rain');
      await bubble.getByText(/is canceled\. Rain\. If you paid, it's now your credit\. You can request a cash out on the site\. \S+$/).waitFor();
      await after.getByRole('link', { name: 'Text the players who were in' }).waitFor();
      assert(!/\bsent\b/i.test(await after.innerText()), 'never say sent');
      // Whoever paid has it as credit now, automatically: a list, nothing to tap.
      const back = after.locator('[data-credit-back-list]');
      await back.getByRole('heading', { name: 'Now their credit' }).waitFor();
      const row = back.locator('li', { hasText: payer });
      await row.getByText('$14 credit', { exact: true }).waitFor();
      assert((await after.getByRole('region', { name: 'Pay back' }).count()) === 0, 'the old Pay back list is gone');
      assert((await after.getByRole('link', { name: /^Refund / }).count()) === 0 && (await after.getByRole('button', { name: /Mark refunded|Keep .* as credit/ }).count()) === 0, 'no Refund or Keep as credit buttons: credit is automatic');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-canceled-text.png') });
      await admin.keyboard.press('Escape');
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await card.getByText('Canceled', { exact: true }).first().waitFor();
      assert((await admin.getByRole('article', { name: /^Pay back|Refund needed/ }).count()) === 0, 'no refund card on Home: the money is credit');
      // The Money row for the canceled game says the same.
      const sheet = await moneyFor(admin, card);
      await sheet.getByText('Nobody owes for it. Anyone who paid has it as credit.').waitFor();
      await sheet.locator('[data-credit-back-list] li', { hasText: payer }).getByText('$14 credit', { exact: true }).waitFor();
      assert((await sheet.locator('li[data-refund]').count()) === 0, 'old refund rows on the Money tab');
      await tab(admin, 'Home').click();
      // The player sees their money as credit on that game, with a way to ask for it back, and the credit chip in the header.
      const p = players[payer];
      assert(p, `no open phone for ${payer}`);
      await p.reload();
      const prow = p.locator('article', { has: p.locator(`#s-${(await card.getAttribute('id')).replace('session-', '')}`) });
      // No "Your $14 is now credit. Request refund" line on the card any more; the chip carries it.
      assert((await prow.locator('[data-credit-back]').count()) === 0, 'the refund line is gone from the card');
      assert(!/Request refund|Your \$14 is now credit/.test(await prow.innerText()), 'no refund wording on the card');
      const chip = p.locator('header [data-credit-chip]');
      assert((await chip.innerText()).replace(/\s+/g, ' ').trim() === 'CREDIT $14', `chip was "${await chip.innerText()}"`);
      assert((await p.locator('[data-credit-line]').count()) === 0, 'the old "You have $14 credit" line is gone');
      // Tapping the chip opens the credit sheet, ready to ask.
      await chip.click();
      const cs = p.locator('[data-credit-sheet]');
      await cs.waitFor();
      await cs.locator('[data-credit-balance]').getByText('$14 credit').waitFor();
      await p.keyboard.press('Escape');
      await p.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      // Put the credit back as the payment: the organizer marks the refund paid from the Players tab, so later checks start clean.
      await tab(admin, 'Players').click();
      await admin.context().route('https://venmo.com/**', (r) => r.abort());
      const refund = admin.locator(`[data-credit-refund="${payer}"]`);
      assert(/amount=14&note=Pickleball%20credit%20refund$/.test(await refund.getAttribute('href')), `refund link ${await refund.getAttribute('href')}`);
      await refund.click();
      await admin.locator(`[data-credit-mark="${payer}"]`).click();
      await admin.locator('.toast', { hasText: 'Credit marked refunded' }).waitFor();
      await admin.locator(`li.player-row[data-player="${payer}"]`).getByText(/Credit \$/).waitFor({ state: 'detached' });
      await tab(admin, 'Home').click();
      await p.reload();
      await p.locator('.schedule article').first().waitFor();
      assert((await p.locator('header [data-credit-chip]').count()) === 0, 'the chip goes once the credit is paid back');
    });

    await check('Money tab: monthly summary on top, who paid per session, pay back and credits; organizer only', async () => {
      await tab(admin, 'Settings').click();
      assert((await admin.getByText('Monthly money').count()) === 0, 'Monthly money moved out of Settings');
      await tab(admin, 'Money').click();
      await admin.getByRole('heading', { name: 'Monthly money' }).waitFor();
      // Order: the month first, then Who paid, then pay back / credits.
      const order = await admin.evaluate(() => [...document.querySelectorAll('main h2')].map((h) => h.textContent.trim()));
      assert(order[0] === 'Monthly money' && order.indexOf('Who paid') > 0, `Money tab order: ${order}`);
      const sess = admin.locator('details.money-sess[data-session]').first();
      await sess.waitFor();
      assert(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2} · \d of \d paid/.test((await sess.locator('summary').innerText()).trim()), 'session summary shows who paid');
      await sess.evaluate((el) => (el.open = true));
      await sess.getByRole('button', { name: /^Mark (un)?paid$/ }).first().waitFor();
      assert((await admin.getByRole('button', { name: 'Back to Settings' }).count()) === 0, 'no Back to Settings on the Money tab');
      const month = admin.getByLabel('Month', { exact: true });
      const now = await month.inputValue();
      assert(/^\d{4}-\d{2}$/.test(now), `month picker value ${now}`);
      for (const label of ['Collected', 'Court costs', 'Credits owed', 'Membership']) await admin.locator('.money-sum dt', { hasText: label }).waitFor();
      const line = (await admin.locator('.bottom-line').innerText()).trim();
      assert(/^(Surplus: \$[\d.]+ toward the \$30 membership|You covered \$[\d.]+ of the court costs|Players covered the court costs|Nothing played yet)$/.test(line), `bottom line was ${line}`);
      await admin.getByRole('button', { name: 'Next month' }).click();
      await admin.waitForFunction((was) => document.querySelector('#mm-month').value !== was, now);
      await admin.screenshot({ path: path.join(SHOTS, 'admin-monthly-money.png'), fullPage: true });
      await tab(admin, 'Settings').click();
      await openSections(admin);
      await admin.getByLabel('Typical court cost').waitFor();
      assert((await admin.getByLabel('Typical court cost').inputValue()) === '48', 'typical court cost defaults to $48');
      assert((await admin.getByLabel('Monthly membership').inputValue()) === '30', 'membership defaults to $30');
      await tab(admin, 'Home').click();
      // Players never see any of it.
      for (const name of ['Alex', 'Casey']) {
        await players[name].reload();
        await players[name].locator('.schedule article').first().waitFor();
        const text = await players[name].locator('body').innerText();
        assert(!/Monthly money|membership|Surplus|You covered|Players covered|court cost/i.test(text), `${name} sees private money`);
      }
    });

    for (const [width, scheme] of [[360, 'dark'], [430, 'light']]) {
      await check(`Monthly money and the cancel text fit at ${width}px (${scheme})`, async () => {
        const ctx = await browser.newContext({ ...phone(width), colorScheme: scheme });
        const p = await ctx.newPage();
        await p.goto(`${BASE}/admin`);
        await p.getByLabel('Organizer PIN').fill(PIN);
        await p.getByRole('button', { name: 'Sign in' }).click();
        await tab(p, 'Money').click();
        await p.locator('.bottom-line').waitFor();
        const small = await p.evaluate(() =>
          [...document.querySelectorAll('main button, main a.btn, main summary')]
            .filter((b) => b.offsetParent !== null)
            .map((b) => [b.textContent.trim().slice(0, 20), b.getBoundingClientRect().height])
            .filter(([, h]) => h < 43.5),
        );
        assert(small.length === 0, `Money tab buttons under 44px: ${JSON.stringify(small)}`);
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 0, `monthly money overflows by ${overflow}px`);
        await p.screenshot({ path: path.join(SHOTS, `monthly-${width}-${scheme}.png`), fullPage: true });
        await ctx.close();
      });
    }

    console.log('First session date');
    await check('Settings "First session" hides earlier sessions from Home and players', async () => {
      await tab(admin, 'Settings').click();
      await openSections(admin);
      const field = admin.getByLabel('First session');
      // A date one week after the first upcoming session.
      await tab(admin, 'Home').click();
      const firstShown = await sessionCards(admin).first().locator('h2').innerText();
      await tab(admin, 'Settings').click();
      await openSections(admin);
      const iso = await admin.evaluate(() => {
        const d = new Date();
        d.setDate(d.getDate() + 9);
        return d.toISOString().slice(0, 10);
      });
      await field.fill(iso);
      await savedIn(field);
      await tab(admin, 'Home').click();
      await admin
        .waitForFunction((was) => {
          const h = document.querySelector('section[aria-labelledby="sessions-title"] article h2');
          return h && h.textContent !== was;
        }, firstShown, { timeout: 10000 })
        .catch(() => {});
      const nowFirst = await sessionCards(admin).first().locator('h2').innerText();
      assert(nowFirst !== firstShown, `Home still starts at ${firstShown}`);
      await players.Alex.reload();
      await firstCard(players.Alex).locator('h2').waitFor();
      const playerFirst = await firstCard(players.Alex).locator('h2').innerText();
      assert(!playerFirst.includes(firstShown.split(', ')[1]), `players still see ${firstShown}`);
      // "Show this session" brings one back; then the court never opens.
      await tab(admin, 'Home').click();
      const hidden = admin.getByRole('region', { name: 'Before your first session date' });
      const row = hidden.locator('li').filter({ hasText: 'Nov 3' });
      if (await row.count()) {
        await row.getByRole('button', { name: 'Show this session' }).click();
        await admin.locator('.toast', { hasText: 'is showing' }).waitFor();
        const shown = sessionCards(admin).filter({ hasText: 'Tue, Nov 3' }).first();
        await more(shown);
        await shown.getByRole('button', { name: 'On court waitlist' }).click();
        await shown.getByRole('button', { name: "Didn't open" }).click();
        await admin.locator('dialog[open]').getByRole('button', { name: 'Mark it off' }).click();
        await shown.getByText("Court didn't open").first().waitFor();
        await players.Alex.reload();
        await players.Alex.locator('article', { hasText: 'Tuesday, Nov 3' }).getByText("Court didn't open").waitFor();
      }
      // Put it back for the rest of the checks.
      await tab(admin, 'Settings').click();
      await openSections(admin);
      await admin.getByLabel('First session').fill('');
      await savedIn(admin.getByLabel('First session'));
      await tab(admin, 'Home').click();
    });

    console.log('Late drops & calendar');
    await check('late drop: tag on Home and the card, a paid drop becomes credit by itself (chip, credit line, Request refund), spot-open text, count on Players', async () => {
      const first = await admin.evaluate(async () => {
        const d = await (await fetch('/api/admin/dashboard')).json();
        return d.sessions.find((s) => Date.parse(s.startsAt) > Date.parse(d.now) && s.status !== 'canceled' && s.roster.some((r) => r.name === 'Frankie' && r.status === 'confirmed'));
      });
      assert(first, 'need a session Frankie is in');
      const clock = (atMs) => admin.request.post(`${BASE}/__dev/clock`, { data: { atMs } });
      try {
        // Frankie pays, then drops 2 hours before.
        await admin.evaluate(
          ({ sid, pid }) => fetch(`/api/admin/sessions/${sid}/payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: pid, paid: true }) }),
          { sid: first.id, pid: first.roster.find((r) => r.name === 'Frankie').playerId },
        );
        await clock(Date.parse(first.startsAt) - 2 * 3600_000);
        const f = players.Frankie;
        await f.reload();
        const row = f.locator('article', { has: f.locator(`#s-${first.id}`) });
        await row.getByRole('button', { name: 'Drop out' }).click();
        await confirmDrop(f);

        await admin.reload();
        const card = admin.getByRole('article', { name: /^Late drop/ });
        await card.locator('.late-tag', { hasText: 'Late drop' }).first().waitFor();
        await card.locator('.rows li', { hasText: 'Frankie' }).first().waitFor();
        await card.locator('.rows li', { hasText: 'Frankie' }).first().getByText(/^dropped (Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/).waitFor();
        // What Frankie paid is credit now, automatically: no Refund question on the card.
        await card.locator('.rows li', { hasText: 'Frankie' }).first().getByText(/· \$14 is their credit now$/).waitFor();
        assert((await card.getByText(/Refund\?/).count()) === 0 && (await card.getByRole('link', { name: /^Refund/ }).count()) === 0 && (await card.getByRole('button', { name: /Mark refunded|Keep .* credit/ }).count()) === 0, 'the old Refund / Keep as credit choice is gone');
        // Frankie's phone: the line on that game, the chip in the header, the sheet's history.
        await f.reload();
        const frow = f.locator('article', { has: f.locator(`#s-${first.id}`) });
        assert((await frow.locator('[data-credit-back]').count()) === 0 && !/Request refund/.test(await frow.innerText()), 'no refund line on the dropped game');
        const chip = f.locator('header [data-credit-chip]');
        assert((await chip.innerText()).replace(/\s+/g, ' ').trim() === 'CREDIT $14', `chip was "${await chip.innerText()}"`);
        assert((await f.locator('[data-credit-line]').count()) === 0, 'the old "You have $14 credit" line is gone');
        // The chip sits right before the date tile and is as tall as it.
        const cb = await chip.boundingBox();
        const sq = await f.locator('header .today').boundingBox();
        assert(cb.x + cb.width <= sq.x && sq.x - (cb.x + cb.width) <= 20, `chip should sit just left of the date tile (${JSON.stringify(cb)} vs ${JSON.stringify(sq)})`);
        assert(Math.abs(cb.height - sq.height) <= 3 && Math.abs(cb.y - sq.y) <= 3, `chip should be as tall as the date tile (${cb.height} vs ${sq.height})`);
        await chip.click();
        const cs = f.locator('[data-credit-sheet]');
        await cs.waitFor();
        await cs.locator('[data-credit-balance]').getByText('$14 credit').waitFor();
        await cs.locator('[data-credit-history] li').first().getByText(/^[A-Z][a-z]{2} \d{1,2}: \$14 back from [A-Z][a-z]{2} \d{1,2} \(you dropped\)$/).waitFor();
        await cs.locator('[data-request-refund]').waitFor();
        await f.keyboard.press('Escape');
        await f.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
        // The text for the opened spot is now the suggestion card for that game (not a second copy on the late-drop card).
        assert((await card.locator('.bubble').count()) === 0, 'the late-drop card no longer carries a text');
        // From 6:00 PM the night before, the "Do this now" card carries this text instead of a suggestion card.
        if (await admin.locator('.dn-more[aria-expanded="false"]').count()) await admin.locator('.dn-more').click();
        const sug = admin.locator(`article[data-suggest][data-session="${first.id}"], .dn-card[data-task="night"][data-session="${first.id}"]`).first();
        await sug.waitFor();
        // Whichever fits the game now: the spot opened for someone moved in, need players, or the check-in once it is back to 4 or 6.
        const spot = smsOf(await sug.getByRole('link', { name: /^Text/ }).getAttribute('href'));
        assert(/^(A spot opened and you're in for pickleball [^.]+, \d{1,2}:\d{2} PM\.|Need \d+ more for pickleball (tonight|today|tomorrow|(Tue|Thu) [A-Z][a-z]{2} \d{1,2}), \d{1,2}:\d{2} PM\. In\?|Pickleball [^.]+, \d{1,2}:\d{2} PM\. Can't make it\? Update here:) [a-z0-9.:]+$/.test(spot.body), `spot text was: ${spot.body}`);
        assert(!/ASAP|text me/i.test(spot.body), 'no "text me ASAP"');
        assert((await sug.getByRole('button', { name: /^Copy/ }).count()) === 0, 'no Copy on the card');
        assert(!/\bsent\b/i.test(await sug.innerText()), 'never say sent');
        assert(!/\bsent\b/i.test(await card.innerText()), 'never say sent');
        const sc = admin.locator(`#session-${first.id}`);
        await sc.locator('.late-tag').waitFor();
        await sc.locator('.late-line').getByText(/Frankie \d{1,2}:\d{2} (AM|PM)/).waitFor();
        await admin.screenshot({ path: path.join(SHOTS, 'admin-late-drop.png'), fullPage: true });
        await card.getByRole('button', { name: 'Done', exact: true }).click();
        await card.waitFor({ state: 'detached' });
        // Logged, with the credit.
        await tab(admin, 'History').click();
        await admin.getByRole('button', { name: 'Activity' }).click();
        await admin.getByRole('list', { name: 'Activity' }).getByText(/^Frankie got \$14 back as credit for (Tue|Thu), [A-Z][a-z]{2} \d{1,2} \(dropped out\)$/).first().waitFor();
        // Count on Players, organizer only; the credit shows there too, and the organizer can pay it back from here (Venmo, then Mark refunded).
        await tab(admin, 'Players').click();
        await admin.locator('li', { hasText: 'Frankie' }).getByText(/1 late drop\b/).waitFor();
        await admin.locator('li.player-row[data-player="Frankie"]').getByText('Credit $14').waitFor();
        await admin.context().route('https://venmo.com/**', (r) => r.abort());
        const refund = admin.locator('[data-credit-refund="Frankie"]');
        assert(/amount=14&note=Pickleball%20credit%20refund$/.test(await refund.getAttribute('href')), `refund link ${await refund.getAttribute('href')}`);
        assert((await admin.locator('[data-credit-mark="Frankie"]').count()) === 0, 'Mark refunded only after Venmo was opened');
        await refund.click();
        await admin.locator('[data-credit-mark="Frankie"]').click();
        await admin.locator('.toast', { hasText: 'Credit marked refunded' }).waitFor();
        await admin.locator('li.player-row[data-player="Frankie"]').getByText('Credit $14').waitFor({ state: 'detached' });
        await tab(admin, 'Home').click();
        await f.reload();
        await f.locator('.schedule article').first().waitFor();
        assert((await f.locator('header [data-credit-chip]').count()) === 0, 'the chip goes once the credit is paid back');
        await players.Alex.reload();
        await players.Alex.locator('.schedule article').first().waitFor();
        assert((await players.Alex.getByText(/Late drop/i).count()) === 0, 'players never see late drops');
      } finally {
        await clock(Date.now() + BASE_OFFSET);
      }
    });

    await check('calendar: no subscription text or links anywhere; the old feed address returns "Not found"', async () => {
      const banned = /Subscribe in Apple Calendar|subscribed calendar|Calendar link|webcal:|\/api\/cal\//i;
      const p = players.Alex;
      await p.reload();
      await p.locator('.schedule article').first().waitFor();
      assert(!banned.test(await p.content()), 'player screen still mentions the subscription');
      for (const t of ['Home', 'Money', 'Players', 'Settings']) {
        await tab(admin, t).click();
        if (t === 'Settings') await openSections(admin);
        await admin.waitForTimeout(150);
        assert(!banned.test(await admin.content()), `${t} still mentions the subscription`);
      }
      assert((await admin.locator('details[data-section="calendar"]').count()) === 0, 'Calendar section should be gone');
      await tab(admin, 'Players').click();
      await admin.getByRole('button', { name: 'Edit Alex' }).click();
      assert((await admin.locator('dialog[open]').getByText(/Calendar link/).count()) === 0, 'per-player calendar switch should be gone');
      await admin.keyboard.press('Escape');
      for (const old of [`/api/cal/${'a'.repeat(43)}.ics`, '/api/cal/whatever.ics']) {
        const res = await p.request.get(BASE + old);
        assert(res.status() === 404, `${old} gave ${res.status()}`);
        assert((await res.text()).trim() === 'Not found', 'should be a plain "Not found"');
      }
      for (const gone of ['/api/me/calendar', '/api/admin/calendar']) {
        assert((await admin.request.get(BASE + gone)).status() === 404, `${gone} should be gone`);
      }
      await tab(admin, 'Home').click();
    });

    await check('"Add to calendar" shows after "I\'m in" and after "I booked it"; the file is Eastern time, not GMT', async () => {
      const icsOk = async (page, href) => {
        const res = await page.request.get(BASE + href);
        assert(res.headers()['content-type'].includes('text/calendar'), 'not a calendar file');
        const ics = await res.text();
        assert(/DTSTART;TZID=America\/Detroit:\d{8}T200000\r\n/.test(ics) && /DTEND;TZID=America\/Detroit:\d{8}T220000\r\n/.test(ics), 'should be 8:00 to 10:00 PM Eastern');
        assert(!/DTSTART:[^\r]*Z|GMT/.test(ics), 'should not be in GMT');
        assert(ics.includes('LOCATION:Northville Pickleball Club') && /URL:http[^\r]*\?s=/.test(ics), 'club and site link');
      };
      // A player: nothing until "I'm in", then a small quiet link on that session.
      const p = players.Frankie;
      await p.reload();
      const rows = p.locator('.schedule article');
      await rows.first().waitFor();
      let row = null;
      for (let i = 2; i < (await rows.count()); i++) {
        if (await rows.nth(i).getByRole('button', { name: "I'm in" }).count()) {
          row = rows.nth(i);
          break;
        }
      }
      assert(row, 'need a session Frankie can join');
      assert((await row.getByRole('link', { name: /to calendar$/ }).count()) === 0, 'no calendar link before signing up');
      await row.getByRole('button', { name: "I'm in" }).click();
      const cal = row.getByRole('link', { name: /^Add .* to calendar$/ });
      await cal.waitFor();
      assert((await cal.locator('svg').count()) === 1 && (await cal.innerText()).trim() === '', 'a small calendar icon');
      assert(!(await cal.getAttribute('class')).includes('btn'), 'small and quiet, not a big button');
      await icsOk(p, await cal.getAttribute('href'));
      await row.getByRole('button', { name: 'Drop out' }).click();
      await confirmDrop(p);
      await row.getByRole('link', { name: /to calendar$/ }).waitFor({ state: 'detached' });
      // The organizer: inside the gear panel of a booked card, never floating under the gear.
      await tab(admin, 'Home').click();
      await showAll(admin);
      const amber = sessionCards(admin).filter({ has: admin.locator('.court-banner') }).filter({ hasText: 'Court not booked' }).first();
      const id = await amber.getAttribute('id');
      assert((await amber.getByRole('link', { name: /to calendar$/ }).count()) === 0, 'no calendar link before booking');
      await amber.getByRole('button', { name: 'I booked it' }).click();
      const booked = admin.locator(`#${id}`);
      await booked.locator('.court-line').getByText('Court booked', { exact: true }).waitFor();
      await closeOptions(booked);
      assert((await booked.getByRole('link', { name: /to calendar$/ }).count()) === 0, 'no calendar icon under the gear');
      assert((await booked.locator('.cal-btn').count()) === 0, 'the floating calendar icon is gone');
      await more(booked);
      const orgCal = booked.locator('.options .opt-grid').getByRole('link', { name: /to calendar$/ });
      await orgCal.waitFor();
      assert((await orgCal.innerText()).trim() === 'Add to calendar', 'says Add to calendar');
      await icsOk(admin, await orgCal.getAttribute('href'));
      await admin.screenshot({ path: path.join(SHOTS, 'admin-add-to-calendar.png') });
      // Put the court back to "not booked" for the checks after this one.
      const sid = id.replace('session-', '');
      const sess = (await (await admin.request.get(`${BASE}/api/admin/dashboard`)).json()).sessions.find((x) => x.id === sid);
      await admin.request.put(`${BASE}/api/admin/sessions/${sid}/booking`, { data: { bookingStatus: 'needs_booking', cancellationDeadlineAt: sess.cancellationDeadlineAt }, headers: { Origin: BASE } });
    });

    await check('no Upcoming / Past toggle: sessions start right under the header; "Book a court" rides on the first divider; small week labels; spots on the count line', async () => {
      await admin.reload();
      await sessionCards(admin).first().waitFor();
      assert((await admin.locator('.sessions-bar').count()) === 0, 'the old sessions row should be gone');
      assert((await admin.getByRole('group', { name: 'Which sessions' }).count()) === 0, 'no Upcoming / Past toggle');
      assert((await admin.getByRole('button', { name: 'Past', exact: true }).count()) === 0, 'no Past button');
      const now = Date.parse(await admin.evaluate(async () => (await (await fetch('/api/admin/dashboard')).json()).now));
      const ends = await admin.evaluate(async () => (await (await fetch('/api/admin/dashboard')).json()).sessions.map((x) => [x.id, x.endsAt]));
      const shownIds = await sessionCards(admin).evaluateAll((cs) => cs.map((c) => c.id.replace('session-', '')));
      for (const id of shownIds) assert(Date.parse(ends.find((e) => e[0] === id)[1]) > now, 'Home should only show upcoming sessions');
      assert((await admin.getByRole('heading', { name: 'Sessions', exact: true }).evaluate((h) => h.getBoundingClientRect().width <= 1)), '"Sessions" heading should be hidden');
      // The pill sits at the right end of the first divider and adds no height to it.
      const first = admin.locator('.week-break').first();
      const pill = first.getByRole('link', { name: /^Book a court/ });
      assert((await pill.getAttribute('href')) === 'https://mobileapp.courtreserve.com/Online/Reservations/Bookings/13765?sId=19442' && (await pill.getAttribute('target')) === '_blank', 'Book a court opens CourtReserve in a new tab');
      const line = await first.boundingBox();
      const plain = await admin.locator('.week-break').nth(1).boundingBox();
      assert(Math.abs(line.height - plain.height) <= 1, `the divider with the pill is ${line.height}px, a plain one is ${plain.height}px`);
      const pb = await pill.boundingBox();
      const vw = admin.viewportSize().width;
      assert(pb.x + pb.width > vw - 40, 'pill at the right end of the line');
      assert((await pill.locator('svg.ext-icon').count()) === 1, 'pill has the arrow');
      const wk = await admin.locator('.week-break').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert(wk <= 11.5, `week label is ${wk}px`);
      // A card with nobody in yet: "0 of 4 in" and four small circles on one line.
      const all = admin.getByRole('button', { name: /^Show all/ });
      if (await all.count()) await all.click();
      const card = sessionCards(admin).filter({ hasText: '0 of 4 in' }).first();
      const count = await card.locator('.players-count').boundingBox();
      const spot = await card.locator('.players-line .dot').first().boundingBox();
      assert(Math.abs(count.y + count.height / 2 - (spot.y + spot.height / 2)) < 6, 'count and spots should share a line');
      const open = card.locator('.players-line .dot:not(.in):not(.me)');
      if (await open.count()) {
        const o = await open.first().boundingBox();
        assert(o.width <= 16 && o.height <= 16, `open spot should be a small circle (${o.width}x${o.height})`);
      }
    });

    console.log('Accessibility & layout');
    await check('every button and link has an accessible name', async () => {
      for (const p of [admin, players.Alex]) {
        const unnamed = await p.evaluate(() =>
          [...document.querySelectorAll('button, a[href]')]
            .filter((el) => el.offsetParent !== null)
            .filter((el) => !(el.getAttribute('aria-label') || el.textContent.trim()))
            .map((el) => el.outerHTML.slice(0, 80)),
        );
        assert(unnamed.length === 0, `unnamed controls: ${unnamed.join(' | ')}`);
      }
    });

    await check('touch targets are at least 44px tall', async () => {
      for (const p of [admin, players.Alex]) {
        const small = await p.evaluate(() =>
          [...document.querySelectorAll('.btn, .tabbar button, .icon-btn, .icon-round, .segmented button')]
            .filter((el) => el.offsetParent !== null)
            .filter((el) => {
              // Count an invisible tap area drawn with ::before (small Pay, "not you?").
              const b = getComputedStyle(el, '::before');
              const extra = b.content !== 'none' && b.position === 'absolute' ? -2 * Math.min(0, parseFloat(b.top) || 0) + Math.max(0, (parseFloat(b.height) || 0) - el.getBoundingClientRect().height) : 0;
              return el.getBoundingClientRect().height + extra < 43.5;
            })
            .map((el) => el.textContent.trim()),
        );
        assert(small.length === 0, `too small: ${small.join(', ')}`);
      }
    });

    await check('keyboard: Tab reaches controls with a visible focus ring, Escape closes dialogs', async () => {
      await tab(admin, 'Players').click();
      await admin.keyboard.press('Tab');
      const outline = await admin.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert(outline !== 'none', 'no focus outline');
      await admin.getByRole('button', { name: 'Edit Alex' }).focus();
      await admin.keyboard.press('Enter');
      await admin.locator('dialog[open]').waitFor();
      await admin.keyboard.press('Escape');
      await admin.locator('dialog[open]').waitFor({ state: 'detached' });
    });

    await check('times show in Eastern 12-hour format, never UTC', async () => {
      await tab(admin, 'Home').click();
      const text = await admin.locator('main').innerText();
      assert(/8:00 to 10:00 PM/.test(text), 'missing time range');
      assert(!/\b(EDT|EST)\b/.test(text), 'EDT/EST should be gone from screens');
      assert(!/UTC|GMT|\d{2}:\d{2}:\d{2}/.test(text), 'found UTC or 24h time');
    });

    for (const [width, scheme] of [[360, 'light'], [390, 'dark'], [430, 'light'], [375, 'dark']]) {
      await check(`sessions per iPhone screen at ${width}px (${scheme}): organizer 4+ on a short 664px screen (was 3 at 360/375), player 3+`, async () => {
        const ctx = await browser.newContext({ ...phone(width), viewport: { width, height: 664 }, colorScheme: scheme });
        const p = await ctx.newPage();
        await p.goto(`${BASE}/admin`);
        await p.getByLabel('Organizer PIN').fill(PIN);
        await p.getByRole('button', { name: 'Sign in' }).click();
        await sessionCards(p).first().waitFor();
        await sessionCards(p).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 8));
        const fitAdmin = await p.evaluate(() => {
          const limit = document.querySelector('.tabbar').getBoundingClientRect().top;
          return [...document.querySelectorAll('section[aria-labelledby="sessions-title"] article')].filter((a) => {
            const r = a.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= limit;
          }).length;
        });
        await p.screenshot({ path: path.join(SHOTS, `dense-admin-${width}-${scheme}.png`) });
        // On this short screen it was 3 at 360/375 and 4 at 390/430 before; now 4 everywhere (5 to 6 on a full-height phone).
        assert(fitAdmin >= 4, `only ${fitAdmin} organizer session cards fit on screen`);
        const small = await p.evaluate(() =>
          [...document.querySelectorAll('main button:not(.link-btn), main a.btn, header button, nav.tabbar button')]
            .filter((b) => b.offsetParent !== null)
            .map((b) => {
              // A small-looking button can carry an invisible 44px tap area (::before).
              const tap = getComputedStyle(b, '::before');
              const extra = tap.content !== 'none' && tap.position === 'absolute' ? parseFloat(tap.height) || 0 : 0;
              return [b.textContent.trim(), Math.max(b.getBoundingClientRect().height, extra)];
            })
            .filter(([, h]) => h < 43.5),
        );
        assert(small.length === 0, `buttons under 44px: ${JSON.stringify(small)}`);
        const tiny = await p.evaluate(() =>
          [...document.querySelectorAll('main *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.textContent.trim()).slice(0, 5),
        );
        assert(tiny.length === 0, `text too small to read: ${tiny}`);

        await p.goto(playerLink);
        await p.getByRole('button', { name: 'Alex', exact: true }).click();
        await p.locator('.schedule article').first().waitFor();
        await p.locator('.schedule article').first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30));
        const fitPlayer = await p.evaluate(() =>
          [...document.querySelectorAll('.schedule article')].filter((a) => {
            const r = a.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight;
          }).length,
        );
        await p.screenshot({ path: path.join(SHOTS, `dense-player-${width}-${scheme}.png`) });
        assert(fitPlayer >= 3, `only ${fitPlayer} player rows fit on screen`);
        await ctx.close();
      });
    }

    for (const [width, scheme] of [[360, 'light'], [375, 'dark'], [390, 'light'], [430, 'dark'], [360, 'dark'], [430, 'light']]) {
      await check(`no sideways scrolling at ${width}px in ${scheme} mode (player, organizer, link page)`, async () => {
        const p = await newPage(width, scheme);
        const urls = [playerLink, `${BASE}/admin`];
        for (const url of urls) {
          await p.goto(url);
          await p.waitForLoadState('networkidle');
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert(overflow <= 0, `${url} overflows by ${overflow}px`);
        }
        // The floating pill never covers the last card on the organizer Home.
        await p.goto(`${BASE}/admin`);
        const signIn = p.getByLabel('Organizer PIN');
        await signIn.or(sessionCards(p).first()).first().waitFor();
        if (await signIn.isVisible().catch(() => false)) {
          await signIn.fill(PIN);
          await p.getByRole('button', { name: 'Sign in' }).click();
        }
        await sessionCards(p).first().waitFor();
        const showAll = p.getByRole('button', { name: /^Show all/ });
        if (await showAll.count()) await showAll.click();
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const gap = await p.evaluate(() => {
          const cards = [...document.querySelectorAll('main article, main section.card')];
          const last = cards[cards.length - 1].getBoundingClientRect();
          const pill = document.querySelector('.tabbar').getBoundingClientRect();
          return pill.top - last.bottom;
        });
        assert(gap >= 0, `the pill covers the last card by ${-gap}px at ${width}px`);
        await p.screenshot({ path: path.join(SHOTS, `admin-${width}-${scheme}.png`), fullPage: false });
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.screenshot({ path: path.join(SHOTS, `admin-top-${width}-${scheme}.png`), fullPage: false });
        await p.goto(playerLink);
        await p.getByRole('button', { name: 'Alex', exact: true }).click();
        await p.locator('article').first().waitFor();
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 0, `player home overflows by ${overflow}px`);
        // "Welcome, Alex  not you?": small gray underlined text on the same line, never a button shape.
        const nu = await p.evaluate(() => {
          const b = document.querySelector('header .not-you');
          const h = document.querySelector('header h1');
          const sq = document.querySelector('header .today');
          const line = document.querySelector('header .title-line');
          const r = b.getBoundingClientRect();
          const hr = h.getBoundingClientRect();
          const cs = getComputedStyle(b);
          const before = getComputedStyle(b, '::before');
          return {
            text: b.textContent.trim(),
            name: b.getAttribute('aria-label'),
            sameLine: r.top < hr.bottom && r.bottom > hr.top,
            rightOfName: r.left >= hr.right - 1,
            size: parseFloat(cs.fontSize),
            border: cs.borderTopWidth,
            bg: cs.backgroundColor,
            underline: cs.textDecorationLine,
            tap: parseFloat(before.height),
            oneLine: line.getBoundingClientRect().height < 40,
            squareInside: sq.getBoundingClientRect().right <= window.innerWidth,
            notOverSquare: r.right <= sq.getBoundingClientRect().left,
          };
        });
        assert(nu.text === 'not you?' && nu.name === 'Not you?', `not you text: ${nu.text}`);
        assert(nu.sameLine && nu.rightOfName, 'not you? should sit right next to the name');
        assert(nu.size <= 13 && nu.border === '0px' && nu.bg === 'rgba(0, 0, 0, 0)' && nu.underline.includes('underline'), `not you? should be small plain text: ${JSON.stringify(nu)}`);
        assert(nu.tap >= 44, `not you? tap area is ${nu.tap}px`);
        assert(nu.oneLine && nu.squareInside && nu.notOverSquare, `header wraps or pushes the date square at ${width}px`);
        await p.screenshot({ path: path.join(SHOTS, `player-${width}-${scheme}.png`), fullPage: false });
      });
    }

    for (const [width, scheme] of [[360, 'light'], [375, 'dark'], [390, 'dark'], [430, 'light']]) {
      await check(`booking form, reschedule and Settings date fields fit at ${width}px (${scheme})`, async () => {
        const p = await admin.context().newPage();
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        const fits = async (what) => {
          const r = await p.evaluate(() => {
            const vw = window.innerWidth;
            const fields = [...document.querySelectorAll('dialog[open] input, main input')].filter((el) => el.offsetParent !== null);
            const worst = Math.max(0, ...fields.map((el) => el.getBoundingClientRect().right - vw));
            const d = document.querySelector('dialog[open]');
            const dialogOverflow = d ? d.scrollWidth - d.clientWidth : 0;
            return { worst, dialogOverflow, page: document.documentElement.scrollWidth - vw };
          });
          assert(r.worst <= 0 && r.dialogOverflow <= 0 && r.page <= 0, `${what} runs past the edge: ${JSON.stringify(r)}`);
        };
        await p.goto(`${BASE}/admin`);
        const card = sessionCards(p).first();
        await more(card);
        await card.getByRole('button', { name: 'Edit booking' }).click();
        await p.locator('dialog[open]').getByLabel(/Cancellation deadline/).waitFor();
        await fits('booking form');
        await p.screenshot({ path: path.join(SHOTS, `booking-${width}-${scheme}.png`) });
        await p.keyboard.press('Escape');
        await more(card);
        await card.getByRole('button', { name: 'Edit booking' }).click();
        await p.locator('dialog[open]').getByText('Move this session').click();
        await p.locator('dialog[open]').getByLabel('Date').waitFor();
        await fits('move-this-session form');
        await p.keyboard.press('Escape');
        await tab(p, 'Settings').click();
        await openSections(p);
        await p.getByLabel('First session').waitFor();
        await fits('Settings');
        await p.close();
      });
    }

    // ---------- Overlap checks: organizer Home cards and every Settings row ----------
    // Put the cards in every state the Home page can show.
    {
      const api = (method, url, data) => admin.request.fetch(`${BASE}${url}`, { method, data, headers: { Origin: BASE } });
      const d = await (await api('GET', '/api/admin/dashboard')).json();
      const live = d.sessions.filter((x) => !x.state.flags.canceled && !x.state.flags.started);
      const later = live.filter((x) => !x.state.flags.bookingWindowOpen && x.bookingStatus === 'needs_booking');
      if (!live.some((x) => x.courtState === 'waitlist') && later.length > 1) await api('POST', `/api/admin/sessions/${later[later.length - 1].id}/court`, { action: 'waitlist' });
      const hol = live.find((x) => x.holiday);
      if (hol && !hol.holidayHoursOk) await api('POST', `/api/admin/sessions/${hol.id}/holiday-hours`, { ok: true });
    }
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`no overlaps or cut-off text on Home cards and Settings rows at ${width}px (${scheme}); the tab bar never covers the last button`, async () => {
        const p = await admin.context().newPage();
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await sessionCards(p).first().waitFor();
        await showAll(p);
        const kinds = await sessionCards(p).evaluateAll((cs) => [...new Set(cs.map((c) => c.dataset.court))]);
        for (const k of ['needs', 'later', 'waitlist', 'booked']) assert(kinds.includes(k), `no ${k} card to check (${kinds})`);
        assert(await p.locator('.holiday-actions .link-btn', { hasText: 'Undo' }).count(), 'no holiday card with Undo to check');
        // Open the gear on two cards too, so the options grid is checked.
        await more(sessionCards(p).first());
        await more(sessionCards(p).nth(2));
        const home = await p.evaluate(layoutReport, { roots: 'main article', items: CARD_ITEMS });
        assert(home.problems.length === 0, `Home: ${home.problems.slice(0, 4).join(' | ')}`);
        assert(home.checked > 40, `only ${home.checked} things checked`);
        const covered = await p.evaluate(lastNotCovered);
        assert(!covered, `Home: ${covered}`);
        await tab(p, 'Settings').click();
        await openSections(p);
        const set = await p.evaluate(layoutReport, { roots: 'main .card', items: SETTINGS_ITEMS });
        assert(set.problems.length === 0, `Settings: ${set.problems.slice(0, 4).join(' | ')}`);
        // Each row: the name gets real width, the box is small and inside the card.
        const rows = await p.evaluate(() =>
          [...document.querySelectorAll('.set-row')].map((r) => {
            const label = r.querySelector('.set-label').getBoundingClientRect();
            const box = r.querySelector('.set-input, .switch').getBoundingClientRect();
            const card = r.closest('.card').getBoundingClientRect();
            return { name: r.querySelector('.set-label').innerText.split('\n')[0], label: label.width, box: box.width, inside: box.right <= card.right - 1 && box.left > label.right - 1 };
          }),
        );
        assert(rows.length >= 9, `only ${rows.length} setting rows`);
        for (const r of rows) {
          // The date box is wider on purpose; its name ("First session") is short.
          assert(r.label >= (/First session/.test(r.name) ? 100 : 130), `"${r.name}" is squeezed to ${Math.round(r.label)}px`);
          assert(r.inside, `"${r.name}" box pokes past the card or over the name`);
          assert(r.box <= 90 || /First session/.test(r.name), `"${r.name}" box is ${Math.round(r.box)}px wide`);
        }
        // Names wrap by word, never letter by letter: never more lines than words.
        const broken = await p.evaluate(() =>
          [...document.querySelectorAll('.set-row .set-name')]
            .map((n) => {
              const r = document.createRange();
              r.selectNodeContents(n.firstChild);
              const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
              return { text: n.firstChild.textContent.trim(), lines, words: n.firstChild.textContent.trim().split(/\s+/).length };
            })
            .filter((x) => x.lines > x.words || x.lines > 3),
        );
        assert(broken.length === 0, `setting names break badly: ${JSON.stringify(broken)}`);
        const coveredSet = await p.evaluate(lastNotCovered);
        assert(!coveredSet, `Settings: ${coveredSet}`);
        await p.screenshot({ path: path.join(SHOTS, `settings-open-${width}-${scheme}.png`), fullPage: true });
        await p.close();
      });
    }

    // ---------- "View as a player" is a true simulation ----------
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`"View as" at ${width}px (${scheme}): same header with "not you?", switching names never touches my sign-in, Exit goes back`, async () => {
        const p = await admin.context().newPage();
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await tab(p, 'Home').waitFor();
        const cookiesBefore = JSON.stringify((await p.context().cookies()).map((c) => [c.name, c.value]).sort());
        const storeBefore = await p.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k !== 'pb_settings_open').sort()));
        const writes = [];
        p.on('request', (r) => r.method() !== 'GET' && writes.push(`${r.method()} ${new URL(r.url()).pathname}`));
        await p.getByRole('button', { name: 'View as…' }).click();
        await p.locator('dialog[open]').getByRole('button', { name: 'Alex', exact: true }).click();
        const bar = p.getByRole('region', { name: 'Viewing as a player' });
        await bar.getByText('Viewing as').waitFor();
        // The player's real header: the name, "not you?", the mode button, the date square.
        await p.getByRole('heading', { name: 'Alex', exact: true, level: 1 }).waitFor();
        const notYou = p.getByRole('button', { name: 'Not you?' });
        assert(await notYou.isVisible(), '"not you?" should show in the simulation');
        assert(await p.locator('.topbar .mode-btn').isVisible(), 'mode button should show in the simulation');
        assert((await p.getByText(/Welcome,/).count()) === 0, 'no "Welcome,"');
        assert((await p.getByRole('button', { name: /^History/ }).count()) === 0 && (await p.locator('nav.tabbar').count()) === 0, 'no History tab in View as');
        // The exit bar is its own row above the header, covering nothing.
        const barBox = await bar.boundingBox();
        const headBox = await p.locator('header.topbar').boundingBox();
        assert(barBox.y + barBox.height <= headBox.y + 1, 'the demo bar should sit above the header, not over it');
        await notYou.click();
        await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
        await p.getByRole('button', { name: 'Blair', exact: true }).click();
        await p.getByRole('heading', { name: 'Blair', exact: true, level: 1 }).waitFor();
        await bar.getByText('Blair').waitFor();
        await p.locator('.schedule article').first().waitFor();
        assert(writes.length === 0, `switching wrote to the server: ${writes}`);
        assert(JSON.stringify((await p.context().cookies()).map((c) => [c.name, c.value]).sort()) === cookiesBefore, 'sign-in cookies changed');
        assert((await p.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k !== 'pb_settings_open').sort()))) === storeBefore, 'something was saved to this phone');
        await p.screenshot({ path: path.join(SHOTS, `view-as-${width}-${scheme}.png`) });
        await bar.getByRole('button', { name: 'Exit' }).click();
        await tab(p, 'Home').waitFor();
        await p.getByRole('heading', { name: 'Dink Dynasty', level: 1 }).waitFor();
        assert((await p.request.get(`${BASE}/api/admin/dashboard`)).status() === 200, 'still signed in as organizer');
        assert(writes.length === 0, `wrote to the server: ${writes}`);
        await p.close();
      });
    }

    // ---------- Player header: name, "not you?", light/dark button, date square ----------
    {
      for (const name of ['Maximilian Johnson', 'Bartholomew Alexander Montgomery-Smythe']) {
        await admin.request.post(`${BASE}/api/admin/players`, { data: { name, isRegular: false }, headers: { Origin: BASE } });
      }
    }
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`player header at ${width}px (${scheme}): short, long and very long names on one line; mode button cycles; no footer`, async () => {
        const p = await newPage(width, scheme);
        for (const name of ['Alex', 'Maximilian Johnson', 'Bartholomew Alexander Montgomery-Smythe']) {
          await p.goto(BASE);
          const nu = p.getByRole('button', { name: 'Not you?' });
          await p.locator('.not-you, .name-grid').first().waitFor();
          if (await p.locator('.name-grid').count()) {
            await p.getByRole('button', { name, exact: true }).click();
          } else {
            await nu.click();
            await p.getByRole('button', { name, exact: true }).click();
          }
          await p.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
          const h = await p.evaluate(headerReport);
          assert(!h.welcome, 'no "Welcome," text');
          assert(h.oneLine, `${name}: header wraps (${h.height}px)`);
          assert(h.allVisible, `${name}: something is cut off: ${JSON.stringify(h.boxes)}`);
          assert(!h.overlap, `${name}: header pieces overlap: ${h.overlap}`);
          assert(h.nameFits || h.ellipsis, `${name}: name neither fits nor shortens with …`);
          if (name.length > 30) assert(h.ellipsis, `${name}: a very long name should shorten with …`);
          assert(h.modeTap >= 44 && h.modeCircle >= 32 && h.modeCircle <= 38, `mode button tap ${h.modeTap}, circle ${h.modeCircle}`);
          await p.screenshot({ path: path.join(SHOTS, `header-${width}-${scheme}-${name.split(' ')[0]}.png`), clip: { x: 0, y: 0, width, height: 90 } });
        }
        // Auto → Light → Dark, with the speech-bubble toast, and the page changes.
        const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
        const mode = p.locator('.topbar .mode-btn');
        await p.evaluate(() => localStorage.removeItem('pb_theme'));
        await p.reload();
        await mode.waitFor();
        assert((await mode.getAttribute('data-mode')) === 'system', 'Auto is the default');
        const auto = await bg();
        await mode.click();
        await p.locator('.toast', { hasText: 'Light' }).waitFor();
        assert((await mode.getAttribute('data-mode')) === 'light', 'second is Light');
        const light = await bg();
        await mode.click();
        await p.locator('.toast', { hasText: 'Dark' }).waitFor();
        const dark = await bg();
        assert(light !== dark, 'Light and Dark should look different');
        assert(auto === (scheme === 'dark' ? dark : light), 'Auto should match the phone');
        await p.reload();
        await mode.waitFor();
        assert((await mode.getAttribute('data-mode')) === 'dark' && (await bg()) === dark, 'Dark should survive a reload');
        await mode.click();
        await p.locator('.toast', { hasText: 'Auto (matches your phone)' }).waitFor();
        assert((await bg()) === auto, 'back to Auto');
        // No footer row and no Help sheet; nothing scrolls sideways.
        assert((await p.locator('footer, .player-footer').count()) === 0, 'no footer row');
        assert((await p.getByRole('link', { name: 'Help' }).count()) + (await p.getByRole('button', { name: 'Help' }).count()) === 0, 'no Help link');
        assert((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'sideways scrolling');
        // In "View as", the same header and button; it never changes the organizer's saved setting.
        const o = await admin.context().newPage();
        await o.setViewportSize({ width, height: 844 });
        await o.emulateMedia({ colorScheme: scheme });
        await o.goto(`${BASE}/admin`);
        await tab(o, 'Home').waitFor();
        const saved = await o.evaluate(() => localStorage.getItem('pb_theme'));
        const orgBg = await o.evaluate(() => getComputedStyle(document.body).backgroundColor);
        await o.getByRole('button', { name: 'View as…' }).click();
        await o.locator('dialog[open]').getByRole('button', { name: 'Maximilian Johnson', exact: true }).click();
        await o.getByRole('heading', { name: 'Maximilian Johnson', exact: true, level: 1 }).waitFor();
        const sim = await o.evaluate(headerReport);
        assert(sim.oneLine && sim.allVisible && !sim.overlap && !sim.welcome, `simulation header differs: ${JSON.stringify(sim)}`);
        const simMode = o.locator('.topbar .mode-btn');
        await simMode.click();
        await simMode.click();
        assert((await o.evaluate(() => localStorage.getItem('pb_theme'))) === saved, 'View as changed the organizer setting');
        await o.getByRole('region', { name: 'Viewing as a player' }).getByRole('button', { name: 'Exit' }).click();
        await tab(o, 'Home').waitFor();
        assert((await o.evaluate(() => getComputedStyle(document.body).backgroundColor)) === orgBg, 'organizer colors should come back after Exit');
        await o.close();
        await p.close();
      });
    }

    // ---------- History: past sessions and the activity log ----------
    await check('History > Activity: marking someone paid shows up at the top with the right Eastern time', async () => {
      const api = (method, url, data) => admin.request.fetch(`${BASE}${url}`, { method, data, headers: { Origin: BASE } });
      const d = await (await api('GET', '/api/admin/dashboard')).json();
      const s = d.sessions.find((x) => x.roster.some((r) => r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null));
      assert(s, 'need someone unpaid');
      const r = s.roster.find((x) => x.status === 'confirmed' && x.paymentStatus === 'unpaid' && x.shareCents !== null);
      const res = await api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: true });
      assert(res.ok(), `mark paid failed ${res.status()}`);
      const serverNow = Date.parse((await (await api('GET', '/api/admin/dashboard')).json()).now);
      const fmt = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/ at /, ', ');
      await tab(admin, 'History').click();
      await admin.getByRole('button', { name: 'Activity' }).click();
      const day = new Date(s.startsAt).toLocaleDateString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric' });
      // (Earlier checks moved the test clock ahead and back, so entries from "later" can sit above it.)
      const top = admin.getByRole('list', { name: 'Activity' }).locator('li').filter({ hasText: `Robin marked ${r.name} paid for ${day}` }).first();
      await top.waitFor();
      const when = (await top.locator('.a-time').innerText()).trim();
      assert([fmt(serverNow), fmt(serverNow - 60_000)].includes(when), `time was "${when}", expected about "${fmt(serverNow)}" Eastern`);
      assert(/, \d{1,2}:\d{2} (AM|PM)$/.test(when), 'AM/PM time');
      // Players' own taps are there too, under their names.
      const all = (await admin.getByRole('list', { name: 'Activity' }).locator('.a-text').allInnerTexts()).join('\n');
      assert(/^(Alex|Blair|Casey|Devon|Emery|Frankie) said I'm in for /m.test(all), 'player sign-ups should be logged by name');
      await api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: false });
      await tab(admin, 'Home').click();
    });

    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`History at ${width}px (${scheme}): Sessions and Activity chips, compact past rows that open, no overlaps`, async () => {
        // Two days on, so this week's sessions have been played.
        await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.now() + BASE_OFFSET + 2 * 24 * 3600_000 }) });
        try {
          const p = await admin.context().newPage();
          p.setDefaultTimeout(10000);
          await p.setViewportSize({ width, height: 844 });
          await p.emulateMedia({ colorScheme: scheme });
          await p.goto(`${BASE}/admin`);
          await tab(p, 'History').click();
          const chips = p.getByRole('group', { name: 'Show' });
          assert((await chips.getByRole('button', { name: 'Sessions' }).getAttribute('aria-pressed')) === 'true', 'Sessions is the default');
          const list = p.getByRole('list', { name: 'Past sessions' });
          await list.waitFor();
          const rows = list.locator('li');
          assert((await rows.count()) >= 1, 'no past sessions listed');
          const first = (await rows.first().locator('.h-top').innerText()).replace(/\s+/g, ' ');
          assert(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2} \d{1,2}(:\d{2})? (to|PM)/.test(first), `row top was "${first}"`);
          const who = (await rows.first().locator('.h-who').innerText()).trim();
          // "4 in" until the organizer finalizes, then "5 played · $11 each".
      assert(/^(\d+ in|\d+ played · \$\d+ each|Canceled|Court didn't open)/.test(who), `row said "${who}"`);
          // Newest first.
          const ids = await rows.evaluateAll((ls) => ls.map((l) => l.dataset.session));
          const starts = await p.evaluate(async (ids) => {
            const d = await (await fetch('/api/admin/dashboard')).json();
            return ids.map((id) => d.sessions.find((x) => x.id === id).startsAt);
          }, ids);
          assert(starts.every((x, i) => i === 0 || x <= starts[i - 1]), 'past sessions should be newest first');
          const rep = await p.evaluate(layoutReport, { roots: 'main .history-list li', items: '.h-date, .h-time, .h-money, .h-who strong, .h-names, .h-canceled, .late-tag' });
          assert(rep.problems.length === 0, `History rows: ${rep.problems.slice(0, 3).join(' | ')}`);
          const tall = await rows.evaluateAll((ls) => Math.max(...ls.map((l) => l.getBoundingClientRect().height)));
          assert(tall <= 110, `rows should be compact, tallest was ${tall}px`);
          await rows.first().locator('button').click();
          const sheet = p.locator('dialog[open]');
          await sheet.locator('article.scard').waitFor();
          await p.keyboard.press('Escape');
          await sheet.waitFor({ state: 'detached' });
          await chips.getByRole('button', { name: 'Activity' }).click();
          assert((await chips.getByRole('button', { name: 'Activity' }).getAttribute('aria-pressed')) === 'true', 'Activity chip pressed');
          const acts = p.getByRole('list', { name: 'Activity' }).locator('li');
          await acts.first().waitFor();
          const times = await acts.locator('.a-time').allInnerTexts();
          assert(times.every((t) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/.test(t.trim())), `bad times: ${times.slice(0, 3)}`);
          const stamps = await acts.locator('time').evaluateAll((ts) => ts.map((t) => t.dateTime));
          assert(stamps.every((x, i) => i === 0 || x <= stamps[i - 1]), 'activity newest first');
          assert(!/\bsent\b/i.test(await p.locator('main').innerText()), 'never say sent');
          assert((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'sideways scrolling');
          await p.screenshot({ path: path.join(SHOTS, `history-${width}-${scheme}.png`) });
          await chips.getByRole('button', { name: 'Sessions' }).click();
          await list.waitFor();
          await p.close();
        } finally {
          await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.now() + BASE_OFFSET }) });
        }
      });
    }

    await check('players never see History', async () => {
      const p = players.Alex;
      await p.reload();
      await p.locator('.schedule article').first().waitFor();
      assert((await p.getByText(/^History$/).count()) === 0 && (await p.locator('nav.tabbar').count()) === 0, 'History on the player screen');
      assert((await p.request.get(`${BASE}/api/admin/activity`)).status() === 401, 'players can read the activity log');
    });

    // ---------- Court strips: one row when it fits, else label then two equal halves ----------
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`court strips at ${width}px (${scheme}): one row if it fits, else label above two equal-half buttons; no gaps, overlaps or cut-off text`, async () => {
        const p = await admin.context().newPage();
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await sessionCards(p).first().waitFor();
        await showAll(p);
        const kinds = await p.locator('.court-banner').evaluateAll((bs) => bs.map((b) => b.closest('article').dataset.court));
        assert(kinds.includes('needs') && kinds.includes('waitlist'), `need both strips, got ${kinds}`);
        const report = await p.evaluate(() =>
          [...document.querySelectorAll('.court-banner')].map((b) => {
            const cs = getComputedStyle(b);
            const padL = parseFloat(cs.paddingLeft);
            const padR = parseFloat(cs.paddingRight);
            const box = b.getBoundingClientRect();
            const left = box.left + padL;
            const right = box.right - padR;
            const label = b.querySelector('.court-status').getBoundingClientRect();
            const btns = [...b.querySelectorAll('.banner-btns > .btn')].map((x) => x.getBoundingClientRect());
            // How wide one row would need to be: a hidden copy that never wraps.
            const copy = b.cloneNode(true);
            copy.querySelectorAll('dialog').forEach((d) => d.remove());
            Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', width: 'max-content', flexWrap: 'nowrap', left: '0', top: '0' });
            b.parentElement.appendChild(copy);
            const need = copy.getBoundingClientRect().width;
            copy.remove();
            const oneRow = btns.every((x) => Math.abs(x.top - btns[0].top) < 1) && btns[0].top < label.bottom - 2;
            const btnStyle = getComputedStyle(b.querySelector('.banner-btns > .btn'));
            const body = b.closest('article').querySelector('.scard-main').getBoundingClientRect();
            return {
              kind: b.closest('article').dataset.court,
              label: b.querySelector('.court-status').innerText.trim(),
              oneRow,
              fits: need <= box.width + 0.5,
              need: Math.round(need),
              have: Math.round(box.width),
              halves: btns.length === 2 && Math.abs(btns[0].width - btns[1].width) <= 1 && Math.abs(btns[0].left - left) <= 1 && Math.abs(btns[1].right - right) <= 1,
              below: btns.every((x) => x.top >= label.bottom - 1),
              sideBySide: btns.length === 2 && Math.abs(btns[0].top - btns[1].top) < 1 && btns[0].right <= btns[1].left,
              overlap: btns.some((x) => x.left < label.right - 1 && x.top < label.bottom - 1 && x.bottom > label.top + 1),
              inside: btns.every((x) => x.left >= box.left && x.right <= box.right + 0.5) && label.right <= box.right + 0.5,
              cut: [...b.querySelectorAll('.banner-btns > .btn')].some((x) => x.scrollWidth > x.clientWidth + 1),
              btnH: Math.round(btns[0].height),
              font: parseFloat(btnStyle.fontSize),
              padTop: Math.round(parseFloat(cs.paddingTop)),
              padBottom: Math.round(parseFloat(cs.paddingBottom)),
              gapBelow: Math.round(body.top - box.bottom),
            };
          }),
        );
        for (const r of report) {
          const where = `${r.kind} strip "${r.label}"`;
          assert(r.label === (r.kind === 'waitlist' ? 'Court waitlist' : 'Court not booked'), `${where}: label`);
          assert(r.oneRow === r.fits, `${where}: ${r.oneRow ? 'one row but it does not fit' : 'two rows but one would fit'} (needs ${r.need}px, has ${r.have}px)`);
          if (!r.oneRow) assert(r.halves && r.below && r.sideBySide, `${where}: buttons should be equal halves under the label ${JSON.stringify(r)}`);
          assert(!r.overlap && r.inside && !r.cut, `${where}: overlap or cut off ${JSON.stringify(r)}`);
          assert(r.btnH >= 34 && r.btnH <= 38 && Math.abs(r.font - 15) < 0.5, `${where}: buttons ${r.btnH}px tall, ${r.font}px text`);
          assert(r.padTop >= 10 && r.padTop <= 12 && r.padTop === r.padBottom, `${where}: padding ${r.padTop}/${r.padBottom}`);
          assert(Math.abs(r.gapBelow - r.padTop) <= 2, `${where}: ${r.gapBelow}px between strip and card body, padding is ${r.padTop}px`);
        }
        // The card Book link sits on the same row as I booked it and goes to CourtReserve.
        const amber = p.locator('article[data-court="needs"] .court-banner').first();
        const book = amber.getByRole('link', { name: /^Book/ });
        assert((await book.getAttribute('href')) === 'https://mobileapp.courtreserve.com/Online/Reservations/Bookings/13765?sId=19442' && (await book.getAttribute('target')) === '_blank', 'card Book link');
        const bb = await book.boundingBox();
        const ib = await amber.getByRole('button', { name: 'I booked it' }).boundingBox();
        assert(Math.abs(bb.y - ib.y) < 1 && bb.x < ib.x, 'Book and I booked it on one row');
        // Date tile and time line up under every strip.
        const aligned = await p.evaluate(() =>
          [...document.querySelectorAll('.court-banner')].every((b) => {
            const a = b.closest('article');
            const tile = a.querySelector('.tile').getBoundingClientRect();
            const time = a.querySelector('.sched-time').getBoundingClientRect();
            return tile.top >= b.getBoundingClientRect().bottom && time.top >= b.getBoundingClientRect().bottom && Math.abs(tile.top - (time.top - 6)) < 14;
          }),
        );
        assert(aligned, 'date tile and time should sit just under the strip');
        const rep = await p.evaluate(layoutReport, { roots: 'main article', items: CARD_ITEMS });
        assert(rep.problems.length === 0, `Home: ${rep.problems.slice(0, 3).join(' | ')}`);
        await p.locator('article[data-court="waitlist"]').first().screenshot({ path: path.join(SHOTS, `strip-waitlist-${width}-${scheme}.png`) });
        await amber.locator('xpath=ancestor::article[1]').screenshot({ path: path.join(SHOTS, `strip-needs-${width}-${scheme}.png`) });
        await p.close();
      });
    }

    // ---------- Number and dollar boxes save on leave or Enter, never on a pause ----------
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`number boxes at ${width}px (${scheme}): "1" on the way to "14" is never saved; Enter or leaving saves`, async () => {
        const p = await admin.context().newPage();
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        p.setDefaultTimeout(10000);
        await p.goto(`${BASE}/admin`);
        await tab(p, 'Settings').click();
        await openSections(p);
        const saved = async () => (await (await p.request.get(`${BASE}/api/admin/dashboard`)).json()).group.settings;
        const price = p.getByLabel('Price per player');
        const before = await price.inputValue();
        const target = before === '14' ? '15' : '14';
        await price.fill('');
        await price.pressSequentially('1');
        await p.waitForTimeout(1600);
        assert((await rowOf(price).locator('.save-mark').count()) === 0, 'a pause must not save a number');
        assert((await saved()).pricePerPlayerCents === Number(before) * 100, 'the half-typed "1" reached the server');
        await price.pressSequentially(target[1]);
        await price.press('Enter');
        await savedIn(price);
        assert((await saved()).pricePerPlayerCents === Number(target) * 100, `Enter should save ${target}`);
        // Leaving the box saves too (hours this time).
        const hours = p.getByLabel(/Last call/);
        const hBefore = await hours.inputValue();
        await hours.fill('');
        await hours.pressSequentially('1');
        await p.waitForTimeout(1600);
        assert((await saved()).lastCallHours === Number(hBefore), 'a pause must not save hours');
        const hTarget = hBefore === '11' ? '12' : '11';
        await hours.pressSequentially(hTarget[1]);
        await hours.blur();
        await savedIn(hours);
        assert((await saved()).lastCallHours === Number(hTarget), `leaving should save ${hTarget}`);
        await autoSet(hours, hBefore);
        await autoSet(price, before);
        await p.close();
      });
    }

    // ---------- Fewer words: every screen still clean, and shorter ----------
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`every screen at ${width}px (${scheme}): no overlaps, nothing cut off, no sideways scrolling; Settings and Home drafts are shorter`, async () => {
        const p = await admin.context().newPage();
        p.setDefaultTimeout(10000);
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await sessionCards(p).first().waitFor();
        const ITEMS = 'button, a[href], input, h2, h3, .chip, .late-tag, .me-in-text, .names-line, .holiday-text, .extra-tag, .bubble, .set-label, summary > span, .h-date, .h-time, .h-money, .a-text, .a-time';
        const screens = { Home: 'main article, main .card', Players: 'main .card', Money: 'main .card, main details', History: 'main .card', Settings: 'main .card' };
        for (const [name, roots] of Object.entries(screens)) {
          await tab(p, name).click();
          await p.waitForTimeout(250);
          if (name === 'Settings') await openSections(p);
          const rep = await p.evaluate(layoutReport, { roots, items: ITEMS });
          assert(rep.problems.length === 0, `${name}: ${rep.problems.slice(0, 3).join(' | ')}`);
          assert((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `${name} scrolls sideways`);
        }
        // Settings with every section open was 2623px tall at 390px before the trim.
        // Alerts came later, so its own height doesn't count against that.
        if (width === 390) {
          const h = await p.evaluate(
            () => document.documentElement.scrollHeight - (document.querySelector('details[data-section="alerts"]')?.getBoundingClientRect().height ?? 0),
          );
          assert(h <= 2623 - 100, `Settings is ${h}px tall (was 2623px)`);
        }
        // Message drafts on Home: who and the number on one line, no "Draft" tag.
        await tab(p, 'Home').click();
        const heads = await p.locator('.draft .draft-head').evaluateAll((hs) => hs.map((h) => ({ h: h.getBoundingClientRect().height, t: h.textContent })));
        assert(heads.every((x) => x.h <= 30), `draft headers wrap: ${heads.filter((x) => x.h > 30).map((x) => `"${x.t}" ${x.h}px`)}`);
        assert((await p.locator('.draft').getByText('Draft', { exact: true }).count()) === 0, 'no Draft tag');
        // The player screen too.
        const pl = await newPage(width, scheme);
        await pl.goto(BASE);
        await pl.locator('.name-grid, .schedule:not(.skel-schedule)').first().waitFor();
        if (await pl.locator('.name-grid').count()) await pl.getByRole('button', { name: 'Blair', exact: true }).click();
        await pl.locator('.schedule article').first().waitFor();
        const pr = await pl.evaluate(layoutReport, { roots: 'main article, main section.card', items: 'button, a[href], .sched-time, .extra-tag, .holiday-text, .court-status, .in-count, .names-line, .dots, .tile, .pchip, .tonight-tag, .credit-note' });
        assert(pr.problems.length === 0, `player screen: ${pr.problems.slice(0, 3).join(' | ')}`);
        assert((await pl.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'player screen scrolls sideways');
        await pl.close();
        await p.close();
      });
    }

    // ---------- Players tab: compact rows with money; Money tab leads with the month ----------
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`Players at ${width}px (${scheme}): 8+ rows on a screen, pills by the name, balance and played count, Edit, tap a row for the money; Money tab summary first`, async () => {
        const p = await admin.context().newPage();
        p.setDefaultTimeout(10000);
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await tab(p, 'Players').click();
        const list = p.getByRole('list', { name: 'Players' });
        await list.waitFor();
        assert((await p.getByText(/Want in\?" nudge|Regulars get/).count()) === 0, 'the top sentence is gone');
        assert((await p.getByText(/No usual day/).count()) === 0, 'no "No usual day"');
        const rows = list.locator('li.player-row');
        assert((await rows.count()) >= 8, `only ${await rows.count()} people to show`);
        // A plain row: a short name, a balance and the played count (held money, a refund button or a wrapping name add lines).
        const heights = await rows.evaluateAll((ls) =>
          ls.filter((l) => l.querySelectorAll('.p-money > *').length <= 2 && !l.querySelector('.credit-actions') && l.querySelector('.p-name').getBoundingClientRect().height < 30).map((l) => l.getBoundingClientRect().height),
        );
        assert(heights.length >= 3, `only ${heights.length} plain rows to measure`);
        const typical = heights.slice().sort((a, b) => a - b)[Math.floor(heights.length / 2)];
        await p.screenshot({ path: path.join(SHOTS, `players-${width}-${scheme}.png`), fullPage: true });
        assert(typical >= 50 && typical <= 66, `rows are ${typical}px tall`);
        const fit = await p.evaluate(() => {
          const top = document.querySelector('main').getBoundingClientRect().top + window.scrollY;
          const limit = document.querySelector('.tabbar').getBoundingClientRect().top - top;
          return [...document.querySelectorAll('li.player-row')].filter((l) => l.getBoundingClientRect().bottom + window.scrollY - top <= limit).length;
        });
        assert(fit >= 8, `only ${fit} rows fit on one screen`);
        // Pills sit on the name's line; nothing overlaps or gets cut off.
        const pill = await rows.first().evaluate((r) => {
          const n = r.querySelector('.p-name').getBoundingClientRect();
          const pl = r.querySelector('.p-pill').getBoundingClientRect();
          return Math.abs(n.top + n.height / 2 - (pl.top + pl.height / 2)) < 6 && pl.left > n.right;
        });
        assert(pill, 'the pill should sit right after the name');
        const rep = await p.evaluate(layoutReport, { roots: 'main .player-list', items: '.p-name, .p-pill, .new-tag, .p-line2, .p-bal, .p-played, .p-edit' });
        assert(rep.problems.length === 0, `Players: ${rep.problems.slice(0, 3).join(' | ')}`);
        assert((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'sideways scrolling');
        // Balance words match the money: owed (normal), credit (green), $0 (gray); no red.
        const d = await (await p.request.get(`${BASE}/api/admin/dashboard`)).json();
        for (const r of await rows.all()) {
          const name = await r.getAttribute('data-player');
          const pl = d.players.find((x) => x.name === name);
          const bal = (await r.locator('.p-bal').innerText()).trim();
          assert(/^(Owes \$\d+(\.\d\d)?|Credit \$\d+(\.\d\d)?|\$0)$/.test(bal), `${name}: balance "${bal}"`);
          assert((await r.locator('.p-played').innerText()).trim() === `${pl.played} played`, `${name}: played count`);
          const color = await r.locator('.p-bal').evaluate((e) => getComputedStyle(e).color);
          const danger = await p.evaluate(() => getComputedStyle(document.body).getPropertyValue('--danger-fg'));
          assert(!color.includes(danger.trim()) || !danger.trim(), `${name}: no red`);
        }
        // Edit still opens the form; a row opens the money breakdown with Mark paid.
        await rows.first().getByRole('button', { name: /^Edit / }).click();
        await p.locator('dialog[open]').getByLabel('Name', { exact: true }).waitFor();
        await p.keyboard.press('Escape');
        await p.locator('dialog[open]').waitFor({ state: 'detached' });
        const devon = rows.filter({ has: p.locator('.p-name', { hasText: /^Devon$/ }) });
        await devon.locator('.player-open').click();
        const sheet = p.locator('dialog[open]');
        await sheet.getByRole('list', { name: 'Sessions' }).waitFor();
        await sheet.getByText(/played$/).first().waitFor();
        assert((await sheet.getByRole('button', { name: /^(Mark paid|Unmark)$/ }).count()) >= 1, 'Mark paid or Unmark in the breakdown');
        await p.keyboard.press('Escape');
        // Money: the monthly summary comes first, and the old actions are all there.
        await tab(p, 'Money').click();
        await p.locator('.money-sum').waitFor();
        const order = await p.evaluate(() => {
          const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? Infinity;
          return { sum: y('.money-sum'), sess: y('details.money-sess[data-session]') };
        });
        assert(order.sum < order.sess, 'summary first');
        for (const k of ['Collected', 'Court costs', 'Membership', 'Sessions played']) await p.locator('.money-sum dt', { hasText: k }).waitFor();
        await p.getByRole('heading', { name: 'Who paid' }).waitFor();
        const open = p.locator('details.money-sess[data-session]').first();
        await open.evaluate((el) => (el.open = true));
        assert((await open.getByRole('button', { name: /^(Mark paid|Unmark)$/ }).count()) >= 1, 'Mark paid / Unmark still in Money');
        await p.close();
      });
    }

    // ---------- One-off games ----------
    await check('"+ Add game": pill on the line, sheet adds a game for everyone in date order with an Extra game tag; duplicates warn; 14-day rule; Activity', async () => {
      await tab(admin, 'Home').click();
      await sessionCards(admin).first().waitFor();
      const line = admin.locator('.week-break').first();
      const pill = line.getByRole('button', { name: '+ Add game' });
      const lb = await line.boundingBox();
      const plain = await admin.locator('.week-break').nth(1).boundingBox();
      assert(Math.abs(lb.height - plain.height) <= 1, 'the pills add no height to the line');
      assert((await line.getByRole('link', { name: /^Book a court/ }).count()) === 1, 'Book a court sits next to it');
      await pill.click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByRole('heading', { name: 'Add a game' }).waitFor();
      // Quick chips: the next Wed, Sat and Sun, soonest first.
      const chips = (await sheet.getByRole('group', { name: 'Date' }).getByRole('button').allInnerTexts()).map((x) => x.trim());
      assert(chips.length === 3 && ['Wed', 'Sat', 'Sun'].every((d) => chips.some((c) => c.startsWith(d))), `chips were ${chips}`);
      assert((await sheet.getByLabel('Start').inputValue()) === '20:00' && (await sheet.getByLabel('End').inputValue()) === '22:00', 'default 8:00 to 10:00 PM');
      // A Saturday about three weeks out, so booking isn't open yet.
      const now = Date.now() + BASE_OFFSET;
      let d = new Date(now + 17 * 24 * 3600_000);
      while (d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Detroit' }) !== 'Sat') d = new Date(d.getTime() + 24 * 3600_000);
      const iso = d.toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
      const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Detroit' });
      await sheet.getByLabel('Pick a date').fill(iso);
      await sheet.getByLabel('Start').fill('10:00');
      await sheet.getByLabel('End').fill('12:00');
      await sheet.getByLabel('Note (optional)').fill('Court 3');
      await sheet.getByRole('button', { name: 'Add game', exact: true }).click();
      await admin.locator('.toast', { hasText: 'Game added' }).waitFor();
      await sheet.waitFor({ state: 'detached' });
      await showAll(admin);
      const card = sessionCards(admin).filter({ has: admin.locator('h2', { hasText: label }) }).first();
      await card.locator('.extra-tag', { hasText: 'Extra game' }).waitFor();
      await card.getByText('10:00 AM to 12:00 PM').waitFor();
      await card.getByText('Court 3').waitFor();
      assert((await card.getAttribute('data-court')) === 'later', 'three weeks out: booking not open yet');
      const opens = new Date(Date.parse(`${iso}T12:00:00Z`) - 14 * 24 * 3600_000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      await card.getByText(`Booking opens ${opens}`).waitFor();
      // In date order on Home.
      const starts = await sessionCards(admin).evaluateAll((cs) => cs.map((c) => c.id));
      const all = (await (await admin.request.get(`${BASE}/api/admin/dashboard`)).json()).sessions;
      const shownStarts = starts.map((id) => all.find((x) => `session-${x.id}` === id).startsAt);
      assert(shownStarts.every((x, i) => i === 0 || x >= shownStarts[i - 1]), 'Home in date order');
      // Duplicate: warned, not made.
      await admin.locator('.week-break').first().getByRole('button', { name: '+ Add game' }).click();
      await sheet.getByLabel('Pick a date').fill(iso);
      await sheet.getByLabel('Start').fill('10:00');
      await sheet.getByLabel('End').fill('12:00');
      await sheet.getByRole('button', { name: 'Add game', exact: true }).click();
      await sheet.getByText(/^There's already a game at (Sat), [A-Z][a-z]{2} \d{1,2}, 10:00 AM\.$/).waitFor();
      await admin.keyboard.press('Escape');
      const count = (await (await admin.request.get(`${BASE}/api/admin/dashboard`)).json()).sessions.filter((x) => x.extra).length;
      assert(count === 1, `expected one extra game, found ${count}`);
      // Players see it too, tagged, in order.
      const pl = players.Alex;
      await pl.reload();
      await pl.locator('.schedule article').first().waitFor();
      const more2 = pl.getByRole('button', { name: /^More sessions/ });
      if (await more2.count()) await more2.click();
      const prow = pl.locator('.schedule article[data-extra="yes"]');
      await prow.waitFor();
      // Extra games get their own tile (ink in light, cream in dark) instead of "Extra game" words on the card.
      const xt = await prow.locator('.tile.extra').evaluate((el) => getComputedStyle(el).backgroundColor);
      const plainTile = await pl.locator('.schedule article:not([data-extra]) .tile').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      assert(xt !== plainTile, 'the extra game tile should look different from a normal tile');
      assert((await prow.getByText('Extra game').count()) === 1 && (await prow.getByText('Extra game').first().evaluate((el) => el.classList.contains('sr-only'))), 'the words "Extra game" stay for screen readers only');
      await prow.getByText('Court 3').waitFor();
      assert((await prow.getByRole('button', { name: "I'm in" }).count()) === 1, 'players can sign up for it');
      // Logged in Activity.
      await tab(admin, 'History').click();
      await admin.getByRole('button', { name: 'Activity' }).click();
      await admin.getByRole('list', { name: 'Activity' }).getByText(`Robin added a game for ${label}`).first().waitFor();
      await tab(admin, 'Home').click();
    });

    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`Add game sheet and organizer "I'm in" at ${width}px (${scheme}): no overlaps; my name shows and counts; Out takes it back`, async () => {
        const p = await admin.context().newPage();
        p.setDefaultTimeout(10000);
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await sessionCards(p).first().waitFor();
        await showAll(p);
        // The sheet fits, nothing overlaps.
        await p.locator('.week-break').first().getByRole('button', { name: '+ Add game' }).click();
        const sheet = p.locator('dialog[open]');
        await sheet.getByRole('button', { name: 'Add game', exact: true }).waitFor();
        const sr = await p.evaluate(layoutReport, { roots: 'dialog[open] .sheet-body', items: 'button, input, .chip-btn' });
        assert(sr.problems.length === 0, `Add game sheet: ${sr.problems.slice(0, 3).join(' | ')}`);
        assert((await sheet.evaluate((d) => d.scrollWidth - d.clientWidth)) <= 0, 'sheet scrolls sideways');
        await p.keyboard.press('Escape');
        await sheet.waitFor({ state: 'detached' });
        // I'm in on a card well ahead (not a late drop when I go Out).
        const cards = sessionCards(p).filter({ has: p.getByRole('button', { name: /^I'm in for / }) });
        const pickId = await cards.nth(Math.min(3, (await cards.count()) - 1)).getAttribute('id');
        const card = p.locator(`#${pickId}`);
        const before = Number((await card.locator('.players-count').innerText()).match(/^(\d+)/)[1]);
        // My I'm in sits at the right end of the "0 of 4 in" row, on every card, in every state.
        const onRow = () =>
          p.evaluate(() =>
            [...document.querySelectorAll('section[aria-labelledby="sessions-title"] article')].flatMap((a) => {
              const mine = a.querySelector('.me-in, .me-state');
              if (!mine) return [];
              const line = mine.closest('.players-line');
              const count = line?.querySelector('.players-count')?.getBoundingClientRect();
              const r = mine.getBoundingClientRect();
              const ok = !!line && Math.abs(r.top + r.height / 2 - (count.top + count.height / 2)) < 4 && a.getBoundingClientRect().right - r.right < 20;
              return ok ? [] : [`${a.querySelector('h2')?.textContent} (${a.dataset.court})`];
            }),
          );
        assert((await onRow()).length === 0, `I'm in is off the players row: ${await onRow()}`);
        const states = await p.evaluate(() => [...new Set([...document.querySelectorAll('section[aria-labelledby="sessions-title"] article:has(.me-in)')].map((a) => a.dataset.court))]);
        assert(states.length >= 2, `expected I'm in on cards in several court states, saw ${states}`);
        const ib = await card.getByRole('button', { name: /^I'm in for / }).boundingBox();
        assert(ib.height >= 33 && ib.height <= 36, `I'm in should be as tall as the other small buttons: ${ib.height}`);
        await card.getByRole('button', { name: /^I'm in for / }).click();
        await card.locator('.me-in-text', { hasText: /^(You're in|Waitlist)$/ }).waitFor();
        const inNow = (await card.locator('.me-in-text').innerText()).trim() === "You're in";
        assert((await onRow()).length === 0, `You're in is off the players row: ${await onRow()}`);
        if (inNow) {
          await card.locator('.players-line .names-line[title*="Robin"]').waitFor();
          const after = Number((await card.locator('.players-count').innerText()).match(/^(\d+)/)[1]);
          assert(after === before + 1, `count went ${before} to ${after}`);
        }
        const rep = await p.evaluate(layoutReport, { roots: 'main article', items: CARD_ITEMS + ', .me-in-text, .names-line' });
        assert(rep.problems.length === 0, `cards with I'm in: ${rep.problems.slice(0, 3).join(' | ')}`);
        const btnBox = await card.locator('.me-state').boundingBox();
        const cardBox = await card.boundingBox();
        assert(btnBox.x + btnBox.width <= cardBox.x + cardBox.width, 'You\'re in stays inside the card');
        await card.getByRole('button', { name: /^Out of / }).click();
        await card.getByRole('button', { name: /^I'm in for / }).waitFor();
        assert((await card.locator('.players-line .names-line[title*="Robin"]').count()) === 0, 'Out takes my name off');
        // Every card state still has no overlaps with the I'm in button there.
        const rep2 = await p.evaluate(layoutReport, { roots: 'main article', items: CARD_ITEMS });
        assert(rep2.problems.length === 0, `cards: ${rep2.problems.slice(0, 3).join(' | ')}`);
        await p.close();
      });
    }

    await check('organizer "I\'m in" is logged in Activity under my name, and players see me in the roster', async () => {
      await tab(admin, 'Home').click();
      await showAll(admin);
      const cardId = await sessionCards(admin).filter({ has: admin.getByRole('button', { name: /^I'm in for / }) }).nth(2).getAttribute('id');
      const card = admin.locator(`#${cardId}`);
      const day = (await card.locator('h2').innerText()).trim();
      await card.getByRole('button', { name: /^I'm in for / }).click();
      await card.locator('.me-in-text', { hasText: "You're in" }).waitFor();
      const id = (await card.getAttribute('id')).replace('session-', '');
      await players.Alex.reload();
      await players.Alex.locator(`#row-${id} .names-line[title*="Robin"]`).waitFor();
      await tab(admin, 'History').click();
      await admin.getByRole('button', { name: 'Activity' }).click();
      await admin.getByRole('list', { name: 'Activity' }).getByText(`Robin said I'm in for ${day}`).first().waitFor();
      await tab(admin, 'Home').click();
      await showAll(admin);
      await admin.locator(`#session-${id}`).getByRole('button', { name: /^Out of / }).click();
      await admin.locator(`#session-${id}`).getByRole('button', { name: /^I'm in for / }).waitFor();
    });

    // ---------- Design follow-up: paper-calendar tiles, gentle fade, calm cards ----------
    await check('while owing: Pay and a quiet "I paid" from the start, after I\'m out then I\'m in again, and after a reload; paid stays Paid', async () => {
      const p = players.Frankie;
      await p.context().route('https://venmo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Venmo</p>' }));
      await p.reload();
      const rows = p.locator('.schedule article');
      await rows.first().waitFor();
      let id = null;
      for (let i = 2; i < (await rows.count()); i++) {
        if (await rows.nth(i).getByRole('button', { name: "I'm in" }).count()) {
          id = await rows.nth(i).getAttribute('id');
          break;
        }
      }
      assert(id, 'need a later session Frankie can join');
      const row = p.locator(`#${id}`);
      const inAgain = async () => {
        await row.getByRole('button', { name: 'Drop out' }).click();
        await confirmDrop(p);
        await row.getByRole('button', { name: "I'm in" }).click();
        await row.locator('.tile-check').waitFor();
      };
      await row.getByRole('button', { name: "I'm in" }).click();
      const pay = row.getByRole('link', { name: 'Pay $14 with Venmo' });
      await pay.waitFor();
      await venmoLinkOk(pay, 14, 'Frankie');
      await row.getByRole('button', { name: 'I paid' }).waitFor();
      await quietNextToPay(row);
      await payAndComeBack(p, pay);
      await quietNextToPay(row);
      // Out, then in again: still Pay with "I paid" next to it.
      await inAgain();
      await row.getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      await quietNextToPay(row);
      await p.reload();
      await row.getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      await quietNextToPay(row);
      // "I paid" without opening Venmo at all: Paid with the small "Didn't pay?".
      await row.getByRole('button', { name: 'I paid' }).click();
      await row.locator('.paid-tag', { hasText: /^Paid/  }).waitFor();
      await row.getByRole('button', { name: "Didn't pay?" }).waitFor();
      // Already paid, then out: the $14 is credit now (the chip appears); in again, that credit is used by itself: Paid with credit at once.
      await row.getByRole('button', { name: 'Drop out' }).click();
      await confirmDrop(p);
      assert((await row.locator('[data-credit-back]').count()) === 0, 'no refund line on the card after a paid drop');
      await p.locator('header [data-credit-chip]', { hasText: /CREDIT/ }).waitFor();
      assert((await p.locator('header [data-credit-chip]').innerText()).replace(/\s+/g, ' ').trim() === 'CREDIT $14', 'chip after dropping a paid game');
      await row.getByRole('button', { name: "I'm in" }).click();
      await row.locator('.tile-check').waitFor();
      await row.locator('.paid-tag', { hasText: 'Paid with credit' }).waitFor();
      await p.locator('header [data-credit-chip]').waitFor({ state: 'detached' });
      assert((await row.getByRole('link', { name: /Pay/ }).count()) === 0, 'no Pay once credit paid it');
      // Undo puts the $14 back in the pot: owed again, and that credit is the green Use credit, Pay is quiet.
      await row.locator('[data-undo-credit]').click();
      const use = row.locator('[data-use-credit]');
      await use.waitFor();
      assert(await use.evaluate((b) => !b.classList.contains('secondary')), 'Use credit should be the green button when the credit covers the game');
      await row.getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      assert((await row.locator('.paid-tag').count()) === 0, 'not paid any more: the payment became credit');
      await use.click();
      await row.locator('.paid-tag', { hasText: 'Paid with credit' }).waitFor();
      await p.locator('header [data-credit-chip]').waitFor({ state: 'detached' });
      // Put it back: the credit undone (back in the pot), then out (which keeps it as credit anyway), then the organizer pays it back.
      await row.locator('[data-undo-credit]').click();
      await row.getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      await row.getByRole('button', { name: 'Drop out' }).click();
      await confirmDrop(p);
      await row.getByRole('button', { name: "I'm in" }).waitFor();
      await admin.context().route('https://venmo.com/**', (r) => r.abort());
      await admin.reload();
      await tab(admin, 'Players').click();
      await admin.locator('[data-credit-refund="Frankie"]').click();
      await admin.locator('[data-credit-mark="Frankie"]').click();
      await admin.locator('.toast', { hasText: 'Credit marked refunded' }).waitFor();
      await tab(admin, 'Home').click();
      await p.reload();
      await p.locator('.schedule article').first().waitFor();
      assert((await p.locator('header [data-credit-chip]').count()) === 0, 'no credit left');
    });

    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`design at ${width}px (${scheme}): red weekdays, lighter later weeks that still pass contrast, calm signed-in card, one green button, centered month`, async () => {
        // The player screen, signed in to some sessions and not others.
        const pl = await newPage(width, scheme);
        await pl.goto(playerLink);
        await pl.getByRole('button', { name: 'Alex', exact: true }).click();
        await pl.locator('.schedule article').first().waitFor();
        const more = pl.getByRole('button', { name: /^More sessions/ });
        if (await more.count()) await more.click();
        // Sign up for a plain later session (no holiday), so there's a calm signed-in card to measure.
        const joinable = pl.locator('.schedule article:not([data-extra]):not([data-mine])').filter({ has: pl.getByRole('button', { name: "I'm in" }) });
        const joinId = await joinable.nth(Math.min(2, (await joinable.count()) - 1)).getAttribute('id');
        const joined = pl.locator(`#${joinId}`);
        // The names line is counted separately: it's new once someone is in.
        const beforeH = await joined.evaluate((a) => {
          const n = a.querySelector('.names-line');
          return a.getBoundingClientRect().height - (n ? n.getBoundingClientRect().height + 3 : 0);
        });
        await joined.getByRole('button', { name: "I'm in" }).click();
        await joined.locator('.tile-check').waitFor();
        // Whatever happens below, sign Alex back out of that session for the checks after this one.
        const joinedSession = joinId.replace('row-', '');
        const undo = () => pl.request.post(`${BASE}/api/sessions/${joinedSession}/withdraw`, { data: {}, headers: { Origin: BASE } }).catch(() => {});
        try {
          await pl.locator('.pop, .toast').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
          const d = await pl.evaluate(designReport);
          assert(d.problems.length === 0, `player: ${d.problems.slice(0, 4).join(' | ')}`);
          assert(d.levels.includes(0) && d.levels.length >= 2, `expected this week and a lighter tier, saw tiers ${d.levels}`);
          const cardLook = await pl.evaluate(() => {
            const bodyRows = (a) => {
              const kids = [...a.querySelector('.sched-body').children].filter((k) => k.checkVisibility() && !k.matches('.sched-act, h2'));
              return new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top))).size;
            };
            const plain = (a) => !a.querySelector('.game-note, .notice, .waitlist-line, p.small, .confirm-row') && !a.dataset.extra && !a.classList.contains('off');
            const all = [...document.querySelectorAll('.schedule article')];
            const mine = all.filter((a) => a.dataset.mine === 'in' && plain(a));
            const others = all.filter((a) => !a.dataset.mine && !a.querySelector('.waitlist-line') && plain(a));
            const h = (a) => a.getBoundingClientRect().height;
            const foot = (a) => {
              const f = a.querySelector('.row-foot');
              return f ? f.getBoundingClientRect().height + 3 : 0;
            };
            return {
              mine: mine.map((a) => ({ rows: bodyRows(a), h: h(a), foot: foot(a), pills: a.querySelectorAll('.me-tag, .spots, .in-pills, .holiday').length })),
              other: others.length ? Math.min(...others.map(h)) : null,
              mineCount: all.filter((a) => a.dataset.mine === 'in').length,
            };
          });
          assert(cardLook.mineCount > 0 && cardLook.mine.length > 0 && cardLook.other, `need signed-in and not-signed-in cards: ${JSON.stringify(cardLook)}`);
          for (const m of cardLook.mine) {
            // Time, court, count and dots, the names, then Pay: no more.
            assert(m.rows <= 7, `signed-in card has ${m.rows} rows`);
            assert(m.pills === 0, 'signed-in card has a pill or name chips');
          }
          // The same card before and after I'm in: rows 1 to 3 keep their height; only the names line and the optional Pay row add any.
          const after = await joined.evaluate((a) => {
            const f = a.querySelector('.act-row');
            const n = a.querySelector('.names-line');
            return { h: a.getBoundingClientRect().height - (n ? n.getBoundingClientRect().height + 3 : 0), foot: f ? f.getBoundingClientRect().height + 3 : 0 };
          });
          assert(after.h <= beforeH + 190, `signed-in card is ${after.h}px (${after.foot}px button row) vs ${beforeH}px before`);
          // Joined cards look like every other card of their tier: no green tint, no changed border or shadow (the check badge is the only mark).
          const tint = await pl.evaluate(() => {
            const look = (a) => { const c = getComputedStyle(a); return `${c.backgroundColor}|${c.borderTopColor}|${c.borderTopWidth}|${c.boxShadow}`; };
            const out = [];
            for (const tier of ['this', 'next', 'later']) {
              const mineCard = document.querySelector(`.schedule article[data-tier="${tier}"][data-mine="in"]:not(.off):not(.highlight)`);
              const other = document.querySelector(`.schedule article[data-tier="${tier}"]:not([data-mine]):not(.off):not(.highlight)`);
              if (mineCard && other && look(mineCard) !== look(other)) out.push(`${tier}: ${look(mineCard)} vs ${look(other)}`);
            }
            return out;
          });
          assert(tint.length === 0, `a joined card is tinted or highlighted: ${tint.join(' ; ')}`);
          const gp = await pl.evaluate(greenReport);
          assert(gp.problems.length === 0, `player: ${gp.problems.join(' | ')}`);
          const lp = await pl.evaluate(layoutReport, { roots: 'main article', items: CARD_ITEMS });
          assert(lp.problems.length === 0, `player cards: ${lp.problems.slice(0, 3).join(' | ')}`);
          assert((await pl.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'player page scrolls sideways');
          await pl.screenshot({ path: path.join(SHOTS, `design-player-${width}-${scheme}.png`), fullPage: true });
          await joined.getByRole('button', { name: 'Drop out' }).click();
          await confirmDrop(pl);
          await joined.getByRole('button', { name: "I'm in" }).waitFor();
        } finally {
          await undo();
          await pl.close();
        }

        // The organizer: tiles, fade, one green button, no calendar icon under the gear.
        const p = await admin.context().newPage();
        p.setDefaultTimeout(10000);
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await sessionCards(p).first().waitFor();
        await showAll(p);
        const od = await p.evaluate(designReport);
        assert(od.problems.length === 0, `organizer: ${od.problems.slice(0, 4).join(' | ')}`);
        assert((await p.locator('.cal-btn, .court-top a[href$="calendar.ics"]').count()) === 0, 'calendar icon under the gear');
        const og = await p.evaluate(greenReport);
        assert(og.problems.length === 0, `organizer: ${og.problems.join(' | ')}`);
        const lo = await p.evaluate(layoutReport, { roots: 'main article', items: CARD_ITEMS + ', .me-in-text' });
        assert(lo.problems.length === 0, `organizer cards: ${lo.problems.slice(0, 3).join(' | ')}`);
        // Money: the month name sits in the middle of its box.
        await tab(p, 'Money').click();
        const label = p.locator('.month-label');
        await label.waitFor();
        const mid = await p.evaluate(() => {
          const l = document.querySelector('.month-label').getBoundingClientRect();
          const f = document.querySelector('.month-field').getBoundingClientRect();
          return { dx: l.left + l.width / 2 - (f.left + f.width / 2), dy: l.top + l.height / 2 - (f.top + f.height / 2) };
        });
        assert(Math.abs(mid.dx) <= 2 && Math.abs(mid.dy) <= 2, `month label off center by ${JSON.stringify(mid)}`);
        assert(/^[A-Z][a-z]+ \d{4}$/.test((await label.innerText()).trim()), 'month label reads like "October 2026"');
        await p.close();
      });
    }

    // ---------- Cards: gear only, one "Text" button, no Copy anywhere ----------
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`cards at ${width}px (${scheme}): gear only; "Text" opens the choices with who they go to; no Copy or Other texts anywhere but the Settings Player link`, async () => {
        const p = await admin.context().newPage();
        p.setDefaultTimeout(10000);
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await sessionCards(p).first().waitFor();
        await showAll(p);
        assert((await sessionCards(p).locator('[data-icon="phone"]').count()) === 0, 'a card still has the phone button');
        const gearX = await sessionCards(p).locator('.card-icons button').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().right)));
        assert(gearX.length === (await sessionCards(p).count()), 'one gear per card');
        assert(Math.max(...gearX) - Math.min(...gearX) <= 8, `gears not lined up: ${gearX}`);
        let card = null;
        for (const c of await sessionCards(p).all()) {
          if ((await c.getAttribute('data-court')) !== 'off') {
            card = c;
            break;
          }
        }
        const menu = await textMenu(card);
        const order = await card.locator('.options').evaluate((o) => ({ text: o.querySelector('.text-btn').getBoundingClientRect().top, grid: o.querySelector('.opt-grid').getBoundingClientRect().top }));
        assert(order.text < order.grid, 'Text comes before the grid');
        for (const row of await menu.locator('.text-row').all()) {
          const link = row.locator('a.text-choice');
          assert((await link.getAttribute('href')).startsWith('sms:'), 'each choice opens Messages');
          const who = (await row.locator('.text-who').innerText()).trim();
          assert(/^(Group chat, you pick|Everyone signed up|.+ · \d+)$/.test(who), `who line was "${who}"`);
          const tid = await row.getAttribute('data-text');
          const { to } = smsOf(await link.getAttribute('href'));
          assert(tid !== 'down5' && tid !== 'now6', `${tid} is gone`);
          if (tid === 'share' || tid === 'need') assert(to.length === 0 && who === 'Group chat, you pick' && (await row.locator('.missing-numbers').count()) === 0, `${tid}: should pick the chat`);
          else assert(to.length + ((await row.locator('.missing-numbers').innerText().catch(() => '')).replace(/^Missing numbers:/, '').split(',').filter((x) => x.trim()).length) === (who.match(/(\d+)$/) ? Number(who.match(/(\d+)$/)[1]) : to.length + ((await row.locator('.missing-numbers').innerText().catch(() => '')).replace(/^Missing numbers:/, '').split(',').filter((x) => x.trim()).length)), `${tid}: numbers plus missing should match "${who}"`);
          assert(tid !== 'poll', 'no Poll');
        }
        const rep = await p.evaluate(layoutReport, { roots: 'main article', items: CARD_ITEMS + ', .text-name, .text-who' });
        assert(rep.problems.length === 0, `cards: ${rep.problems.slice(0, 3).join(' | ')}`);
        assert(!/\bsent\b/i.test(await p.locator('main').innerText()), 'never say sent');
        await p.screenshot({ path: path.join(SHOTS, `text-menu-${width}-${scheme}.png`) });
        // No Copy or Other texts on any tab, except the Settings Player link.
        for (const t of ['Home', 'Players', 'Money', 'History']) {
          await tab(p, t).click();
          await p.waitForTimeout(150);
          const copies = await p.locator('main').getByRole('button', { name: /^Copy/ }).count();
          assert(copies === 0, `${t} still has a Copy button`);
          assert((await p.getByText('Other texts').count()) === 0, `${t} still says Other texts`);
        }
        await tab(p, 'Settings').click();
        const quick = p.getByRole('region', { name: 'Quick settings' });
        assert((await quick.getByRole('button', { name: 'Copy', exact: true }).innerText()).trim() === 'Copy', 'Player link button should say Copy');
        assert((await p.locator('main').getByRole('button', { name: /^Copy/ }).count()) === 1, 'only the Player link Copy in Settings');
        await p.close();
      });
    }

    // ---------- Tab bar: order, and tapping the tab you're on starts it fresh ----------
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`tab bar at ${width}px (${scheme}): Home, Players, Money, History, Settings; tapping the tab you're on goes back to its top and closes what's open`, async () => {
        const p = await admin.context().newPage();
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(`${BASE}/admin`);
        await sessionCards(p).first().waitFor();
        const nav = p.getByRole('navigation', { name: 'Organizer sections' });
        const labels = (await nav.getByRole('button').allInnerTexts()).map((t) => t.trim().split('\n')[0].trim().replace(/\d+$/, '').trim());
        assert(JSON.stringify(labels) === JSON.stringify(['Home', 'Players', 'Money', 'History', 'Settings']), `tabs were ${labels}`);
        const wraps = await nav.getByRole('button').evaluateAll((bs) => bs.filter((b) => [...b.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() && (() => { const r = document.createRange(); r.selectNodeContents(n); return r.getClientRects().length > 1; })())).map((b) => b.textContent));
        assert(wraps.length === 0, `tab labels wrap: ${wraps}`);
        const sizes = await nav.getByRole('button').evaluateAll((bs) => bs.map((b) => [Math.round(b.getBoundingClientRect().width), b.getBoundingClientRect().height]));
        assert(sizes.every(([, h]) => h >= 44), `tabs under 44px: ${sizes}`);
        assert(Math.max(...sizes.map((x) => x[0])) - Math.min(...sizes.map((x) => x[0])) <= 1, `tabs not equal: ${sizes}`);
        const screens = { Home: () => sessionCards(p).first(), Players: () => p.getByRole('button', { name: 'Edit Alex' }), Money: () => p.locator('details.money-sess').first(), History: () => p.getByRole('group', { name: 'Show' }), Settings: () => p.getByRole('region', { name: 'Quick settings' }) };
        const scrollY = () => p.evaluate(() => window.scrollY);
        const scrollDown = () => p.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)));
        const waitTop = () => p.waitForFunction(() => window.scrollY === 0, null, { timeout: 4000 });
        for (const name of ['Home', 'Players', 'Money', 'History', 'Settings']) {
          await tab(p, name).click();
          await screens[name]().waitFor();
          assert((await tab(p, name).getAttribute('aria-current')) === 'page', `${name} should be highlighted`);
          const covered = await p.evaluate(lastNotCovered);
          assert(!covered, `${name}: ${covered}`);
          // Scrolled down, then tap it again: back at the top.
          await scrollDown();
          if ((await scrollY()) > 0) {
            await tab(p, name).click();
            await waitTop();
          }
        }
        // Home: an open gear panel closes and the page goes back to the top.
        await tab(p, 'Home').click();
        await showAll(p);
        const card = sessionCards(p).nth(2);
        await more(card);
        await scrollDown();
        await tab(p, 'Home').click();
        await waitTop();
        assert((await p.locator('.options').count()) === 0, 'the gear panel should close');
        assert((await p.getByRole('button', { name: /^Show all \d+$/ }).count()) === 1, 'the expanded list should fold back');
        // Players: a person's page is open; tapping Players goes back to the list.
        await tab(p, 'Players').click();
        await p.getByRole('button', { name: 'Edit Alex' }).click();
        await p.locator('dialog[open]').waitFor();
        const tb = await tab(p, 'Players').boundingBox();
        await p.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
        await p.locator('dialog[open]').waitFor({ state: 'detached' });
        await p.getByRole('button', { name: 'Edit Alex' }).waitFor();
        await waitTop();
        // Edit booking open on Home: tapping Home closes it.
        await tab(p, 'Home').click();
        await more(sessionCards(p).first());
        await sessionCards(p).first().getByRole('button', { name: 'Edit booking' }).click();
        await p.locator('dialog[open]').waitFor();
        const hb = await tab(p, 'Home').boundingBox();
        await p.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await p.locator('dialog[open]').waitFor({ state: 'detached' });
        await waitTop();
        // A different tab keeps its own spot: Home scrolled, visit Money, come back.
        await scrollDown();
        const homeAt = await scrollY();
        await tab(p, 'Money').click();
        await screens.Money().waitFor();
        assert((await scrollY()) === 0, 'Money opens at its own top');
        await tab(p, 'Home').click();
        await sessionCards(p).first().waitFor();
        assert(Math.abs((await scrollY()) - homeAt) <= 2, `Home should come back where it was (${homeAt}), was ${await scrollY()}`);
        // Settings: open sections stay open; only the scroll resets.
        await tab(p, 'Settings').click();
        await openSections(p);
        const openBefore = await p.locator('details.set-sect[open]').count();
        await scrollDown();
        await tab(p, 'Settings').click();
        await waitTop();
        assert((await p.locator('details.set-sect[open]').count()) === openBefore, 'Settings sections should stay open');
        await p.close();
      });
    }

    await check('organizer pages fit at 360px', async () => {
      const ctx = admin.context();
      const p = await ctx.newPage();
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${BASE}/admin`);
      for (const name of ['Home', 'Players', 'Settings']) {
        await tab(p, name).click();
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 0, `${name} overflows by ${overflow}px`);
      }
      await tab(p, 'Home').click();
      await p.screenshot({ path: path.join(SHOTS, 'admin-home-360.png'), fullPage: true });
    });

    // ---------- Design: every screen, four widths, light and dark ----------
    for (const width of [360, 375, 390, 430]) {
      for (const scheme of ['light', 'dark']) {
        await check(`design at ${width}px (${scheme}): every screen has no overlaps or cut-off text, no sideways scrolling, and at most one green button per card`, async () => {
          const p = await admin.context().newPage();
          p.setDefaultTimeout(10000);
          await p.setViewportSize({ width, height: 844 });
          await p.emulateMedia({ colorScheme: scheme });
          const issues = [];
          const look = async (where) => {
            const roots = 'main article, main .card, main .sched, dialog[open] .sheet-body, header.topbar, nav.tabbar';
            const lay = await p.evaluate(layoutReport, { roots, items: CARD_ITEMS + ', .me-in-text, .names-line, .chip, .p-pill, .owes-tag, h2, h3, .set-label, summary > span' });
            issues.push(...lay.problems.map((x) => `${where}: ${x}`));
            const gr = await p.evaluate(greenReport);
            issues.push(...gr.problems.map((x) => `${where}: ${x}`));
            const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            if (overflow > 0) issues.push(`${where}: scrolls sideways by ${overflow}px`);
          };
          await p.goto(`${BASE}/admin`);
          await sessionCards(p).first().waitFor();
          await showAll(p);
          await look('Home');
          // Date tiles: white (or the dark surface) with a thin outline, never solid green.
          const tile = await sessionCards(p).first().locator('.tile').evaluate((el) => {
            const cs = getComputedStyle(el);
            const probe = document.createElement('button');
            probe.className = 'btn';
            document.body.appendChild(probe);
            const green = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return { bg: cs.backgroundColor, green, border: parseFloat(cs.borderTopWidth) };
          });
          if (tile.bg === tile.green || tile.border < 1) issues.push(`date tile should be outlined, not green: ${JSON.stringify(tile)}`);
          const first = sessionCards(p).first();
          await more(first);
          await first.getByRole('button', { name: 'Text', exact: true }).click();
          await look('Home, gear panel and Text open');
          await closeOptions(first);
          await p.locator('.week-break').first().getByRole('button', { name: '+ Add game' }).click();
          await p.locator('dialog[open]').waitFor();
          await look('Add game sheet');
          await p.keyboard.press('Escape');
          await p.locator('dialog[open]').waitFor({ state: 'detached' });
          await more(first);
          await first.locator('.options').getByRole('button', { name: 'Edit booking' }).click();
          await p.locator('dialog[open]').waitFor();
          await look('Edit booking sheet');
          await p.keyboard.press('Escape');
          await p.locator('dialog[open]').waitFor({ state: 'detached' });
          await tab(p, 'Players').click();
          await p.getByRole('button', { name: 'Edit Alex' }).waitFor();
          await look('Players');
          await tab(p, 'Money').click();
          await p.locator('.money-sum').waitFor();
          await p.evaluate(() => document.querySelectorAll('details.money-sess').forEach((d) => (d.open = true)));
          await look('Money');
          // The month picker's middle box sits between the arrows, never under them.
          const mp = await p.locator('.month-picker').evaluate((el) => [...el.children].filter((c) => !c.matches('.sr-only')).map((c) => c.getBoundingClientRect()).map((r) => [r.left, r.right]));
          if (!(mp[0][1] <= mp[1][0] + 0.5 && mp[1][1] <= mp[2][0] + 0.5)) issues.push(`month picker overlaps: ${JSON.stringify(mp)}`);
          const line = await p.locator('.bottom-line').evaluate((el) => el.getClientRects().length && Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
          if (width >= 375 && line > 1) issues.push(`the Money sentence wraps to ${line} lines`);
          if ((await p.locator('main').getByText('Sessions played').count()) !== 1) issues.push('"Sessions played" should show once on Money');
          await tab(p, 'History').click();
          await p.getByRole('group', { name: 'Show' }).waitFor();
          await look('History');
          await p.getByRole('button', { name: 'Activity' }).click();
          await p.getByRole('list', { name: 'Activity' }).waitFor();
          await look('History, Activity');
          await tab(p, 'Settings').click();
          await openSections(p);
          await look('Settings');
          await tab(p, 'Home').click();
          await p.getByRole('button', { name: 'View as…' }).click();
          await p.locator('dialog[open]').waitFor();
          await look('View as sheet');
          await p.locator('dialog[open]').getByRole('button', { name: 'Alex', exact: true }).click();
          await p.locator('.schedule article').first().waitFor();
          await look('Player screen (View as)');
          const ptile = await p.locator('.schedule .tile').first().evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
          if (ptile < 1) issues.push('player date tiles need an outline');
          await p.getByRole('button', { name: 'Not you?' }).click();
          await p.locator('.name-grid').waitFor();
          await look('Who are you?');
          assert(issues.length === 0, issues.slice(0, 6).join(' | '));
          await p.close();
        });
      }
    }

    await check('motion: buttons press, balls spin in, sheets slide, the banner fades; all of it off with Reduce Motion', async () => {
      const read = async (reducedMotion) => {
        const ctx = await browser.newContext({ ...phone(390), reducedMotion });
        const p = await ctx.newPage();
        await p.goto(playerLink);
        await p.getByRole('button', { name: 'Alex', exact: true }).click();
        await p.locator('.schedule .dots .ball').first().waitFor();
        const out = await p.evaluate(() => {
          const ms = (el, pseudo) => parseFloat(getComputedStyle(el, pseudo).animationDuration) * 1000;
          // A ball added later carries .ball-new: it spins in (balls already on screen at load stay still).
          const spot = document.querySelector('.schedule .dots:not(.dots-celebrate) .ball').cloneNode(true);
          spot.classList.add('ball-new');
          document.querySelector('.schedule .dots:not(.dots-celebrate)').appendChild(spot);
          const spotName = getComputedStyle(spot).animationName;
          const spotMs = ms(spot);
          spot.remove();
          const btn = document.querySelector('.schedule .sched-btn');
          return { spot: spotName, spotMs, press: getComputedStyle(btn).transitionDuration };
        });
        await p.getByRole('button', { name: /^Out for|Drop out/ }).first().click();
        const dlg = p.locator('dialog[open]');
        await dlg.waitFor();
        out.sheet = await dlg.evaluate((d) => [getComputedStyle(d).animationName, parseFloat(getComputedStyle(d).animationDuration) * 1000]);
        await p.keyboard.press('Escape');
        await ctx.close();
        return out;
      };
      const on = await read('no-preference');
      assert(on.spot === 'ball-spin-in' && on.spotMs >= 400 && on.spotMs <= 500, `filled spots should spin in: ${JSON.stringify(on)}`);
      assert(on.sheet[0] === 'sheet-up' && on.sheet[1] >= 200, `sheets should slide up: ${JSON.stringify(on)}`);
      assert(!/^0s(, 0s)*$/.test(on.press), `buttons should press down: ${on.press}`);
      const off = await read('reduce');
      assert(off.spot === 'none' && off.sheet[0] === 'none', `Reduce Motion should stop the animations: ${JSON.stringify(off)}`);
    });

    await check('bad links show a clear error state', async () => {
      const p = await newPage();
      await p.goto(`${BASE}/t/${'x'.repeat(43)}`);
      await p.getByText("This link doesn't work").waitFor();
      await p.goto(`${BASE}/g/${'y'.repeat(24)}`);
      await p.getByText("This group link isn't valid").waitFor();
    });

    await check('wrong PIN is rejected in the UI', async () => {
      const p = await newPage();
      await p.goto(`${BASE}/admin`);
      await p.getByLabel('Organizer PIN').fill('000000');
      await p.getByRole('button', { name: 'Sign in' }).click();
      await p.getByText('That PIN is not right.').waitFor();
    });

    // ---------- After the game: Finalize, the final price, credit, refund requests, Reopen ----------
    console.log('After the game');
    const api = (method, url, data) => admin.request.fetch(`${BASE}${url}`, { method, data, headers: { Origin: BASE } });
    const dashboard = async () => (await api('GET', '/api/admin/dashboard')).json();
    const clockTo = (atMs) => admin.request.post(`${BASE}/__dev/clock`, { data: { atMs } });
    /** The Money tab with one past game's payments opened (past games have no Home card). */
    const moneyOf = async (page, id) => {
      await tab(page, 'Money').click();
      const d = page.locator(`details.money-sess[data-session="${id}"]`);
      await d.waitFor();
      await d.evaluate((el) => (el.open = true));
      return d;
    };
    const squash = (t) => t.replace(/\s+/g, ' ').trim();
    let tueId = '';
    let wedFour = null; // Wed Oct 28, 5:00 to 7:00 PM: 4 in, nobody paid
    let wedThree = null; // Wed Oct 28, 8:00 to 10:00 PM: 3 in, Devon paid
    await check('set-up: Casey rejoins Tue (5 in), two one-off games on Wed with 4 and 3 in; the clock moves to Thu night after the games', async () => {
      // The price is $14 (an earlier check types other numbers into the box and puts it back).
      assert((await api('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 1400 } })).ok(), 'price back to $14');
      await players.Casey.reload();
      const card = firstCard(players.Casey);
      await card.getByRole('button', { name: "I'm in" }).click();
      await card.locator('.tile-check').waitFor();
      await card.locator('.in-count', { hasText: /^5 in$/ }).waitFor();
      let d = await dashboard();
      const ids = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
      const tue = d.sessions.find((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === '2026-10-27');
      assert(tue && tue.confirmedCount === 5, `Tue should have 5 in, has ${tue && tue.confirmedCount}`);
      tueId = tue.id;
      const add = async (h1, h2, names, paid) => {
        const res = await api('POST', '/api/admin/sessions', { startsAt: new Date(`2026-10-28T${h1}:00:00-04:00`).toISOString(), endsAt: new Date(`2026-10-28T${h2}:00:00-04:00`).toISOString() });
        assert(res.ok(), `add game: ${res.status()} ${await res.text()}`);
        d = await dashboard();
        const game = d.sessions.find((x) => Date.parse(x.startsAt) === Date.parse(`2026-10-28T${h1}:00:00-04:00`));
        assert(game, 'the one-off game should be on the dashboard');
        for (const n of names) assert((await api('POST', `/api/admin/sessions/${game.id}/roster`, { playerId: ids[n], action: 'confirm' })).ok(), `${n} in`);
        for (const n of paid) assert((await api('POST', `/api/admin/sessions/${game.id}/payment`, { playerId: ids[n], paid: true })).ok(), `${n} paid`);
        return game;
      };
      wedFour = await add('17', '19', ['Alex', 'Blair', 'Devon', 'Frankie'], []);
      wedThree = await add('20', '22', ['Blair', 'Devon', 'Frankie'], ['Devon']);
      // Thu Oct 29, 10:30 PM Eastern: Tue and both Wed games are over.
      await clockTo(Date.parse('2026-10-29T22:30:00-04:00'));
      await admin.reload();
      await admin.locator('[data-finalize]').first().waitFor();
    });

    await check('Home after the games: a Finalize card per game with 4 or more in (date, count, preview, green Everyone played, Change who played), above the text cards; under 4 it offers Cancel session and Finalize anyway', async () => {
      const cards = admin.locator('[data-finalize]');
      assert((await cards.count()) === 3, `expected 3 Finalize cards, got ${await cards.count()}`);
      const tue = admin.locator(`[data-finalize="${tueId}"]`);
      assert(squash(await tue.locator('h3').innerText()) === 'Tue, Oct 27 · 5 in', `title was "${await tue.locator('h3').innerText()}"`);
      assert(squash(await tue.locator('[data-finalize-preview]').innerText()) === '5 played · $11 each · $3 credit back each', `preview was "${await tue.locator('[data-finalize-preview]').innerText()}"`);
      await tue.locator('[data-everyone-played]').waitFor();
      await tue.locator('[data-change-played]').waitFor();
      assert((await tue.getByRole('button', { name: /Finalize anyway|Cancel session/ }).count()) === 0, 'a 5-in game has no under-4 buttons');
      const four = admin.locator(`[data-finalize="${wedFour.id}"]`);
      assert(squash(await four.locator('[data-finalize-preview]').innerText()) === '4 played · $14 each', `4-in preview was "${await four.locator('[data-finalize-preview]').innerText()}"`);
      const three = admin.locator(`[data-finalize="${wedThree.id}"]`);
      assert(/^Only 3 in\. Cancel it \(everyone paid gets credit\) or finalize anyway at \$14 each\.$/.test(squash(await three.locator('[data-finalize-preview]').innerText())), `3-in preview was "${await three.locator('[data-finalize-preview]').innerText()}"`);
      await three.getByRole('button', { name: 'Cancel session' }).waitFor();
      await three.getByRole('button', { name: 'Finalize anyway' }).waitFor();
      assert((await three.locator('[data-everyone-played]').count()) === 0, 'no Everyone played under 4');
      // Above the text cards and the session list; one green button per card; 44px taps.
      const fy = (await cards.first().boundingBox()).y;
      const sug = admin.locator('article[data-suggest]');
      if (await sug.count()) assert(fy < (await sug.first().boundingBox()).y, 'Finalize cards come before the text cards');
      assert(fy < (await sessionCards(admin).first().boundingBox()).y, 'Finalize cards come before the sessions');
      const gr = await admin.evaluate(greenReport);
      assert(gr.problems.length === 0, gr.problems.join(' | '));
      const small = await cards.locator('button, a.btn').evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent.trim()));
      assert(small.length === 0, `buttons under 44px: ${small}`);
      assert((await admin.getByRole('article', { name: /Refund needed|5 going|Was 6/ }).count()) === 0, 'old cards');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-finalize-cards.png'), fullPage: true });
    });

    await check('Change who played: a switch per person, the preview updates live, Confirm finalizes Tue at 5 played ($11 each, $3 back)', async () => {
      const tue = admin.locator(`[data-finalize="${tueId}"]`);
      await tue.locator('[data-change-played]').click();
      const sheet = admin.locator('[data-who-played]');
      await sheet.waitFor();
      const live = sheet.locator('[data-finalize-live]');
      assert(squash(await live.innerText()) === '5 played · $11 each · $3 credit back each', `live preview was "${await live.innerText()}"`);
      const switches = sheet.getByRole('switch');
      assert((await switches.count()) === 5, `expected 5 switches, got ${await switches.count()}`);
      for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) assert(await sheet.getByRole('switch', { name: `${n} played` }).isChecked(), `${n} should start as played`);
      await sheet.getByRole('switch', { name: 'Casey played' }).click();
      await sheet.locator('[data-finalize-live]', { hasText: /^4 played · \$14 each$/ }).waitFor();
      await sheet.getByRole('switch', { name: 'Emery played' }).click();
      await sheet.locator('[data-finalize-live]', { hasText: /^3 played · \$14 each$/ }).waitFor();
      await sheet.getByRole('switch', { name: 'Casey played' }).click();
      await sheet.getByRole('switch', { name: 'Emery played' }).click();
      await sheet.locator('[data-finalize-live]', { hasText: /^5 played · \$11 each · \$3 credit back each$/ }).waitFor();
      const gr = await admin.evaluate(greenReport);
      assert(gr.problems.length === 0, gr.problems.join(' | '));
      await admin.screenshot({ path: path.join(SHOTS, 'admin-who-played.png') });
      await sheet.locator('[data-confirm-played]').click();
      await admin.locator('.toast', { hasText: 'Tue, Oct 27 is final' }).waitFor();
      await tue.waitFor({ state: 'detached' });
      assert((await admin.locator('[data-finalize]').count()) === 2, 'the other two games still need finalizing');
    });

    await check('Money after finalizing: "5 played · $11 each", $11 each, the finalized line, per-row "paid $14 · $3 back as credit" / "owes $11", green Paid, Reopen allowed; the reminder says $11', async () => {
      const sheet = await moneyOf(admin, tueId);
      assert(/^Tue, Oct 27 · 5 played · \$11 each/.test(squash(await sheet.locator('summary').innerText())), `summary was "${await sheet.locator('summary').innerText()}"`);
      assert(squash(await sheet.locator('[data-price-each]').innerText()) === '$11', 'final price each');
      assert(/^5 played · \$11 each · \$\d+ back as credit$/.test(squash(await sheet.locator('[data-finalized-line]').innerText())), `finalized line was "${await sheet.locator('[data-finalized-line]').innerText()}"`);
      for (const n of ['Alex', 'Blair', 'Devon']) {
        const row = sheet.locator(`[data-pay-row="${n}"]`);
        assert(/paid \$14 on (Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2} · \$3 back as credit/.test(squash(await row.innerText())), `${n}: ${squash(await row.innerText())}`);
        assert(await row.locator('.chip').evaluate((el) => el.classList.contains('tone-ok') && el.textContent.trim() === 'Paid'), `${n}: Paid should be green once finalized`);
      }
      for (const n of ['Casey', 'Emery']) {
        const row = sheet.locator(`[data-pay-row="${n}"]`);
        assert(/owes \$11/.test(squash(await row.innerText())) && !/\$14/.test(squash(await row.innerText())), `${n}: ${squash(await row.innerText())}`);
      }
      assert((await sheet.getByText('not finalized yet').count()) === 0, 'nothing says not finalized');
      await sheet.locator(`[data-pay-row="Emery"]`).getByRole('button', { name: 'Payment reminder' }).click();
      await sheet.locator(`[data-pay-row="Emery"] .bubble`).getByText(/^Hey Emery, you owe \$11 for pickleball Tue Oct 27\. Pay here: \S+$/).waitFor();
      const reopen = sheet.locator('[data-reopen]');
      await reopen.waitFor();
      assert(!(await reopen.isDisabled()), 'Reopen should be allowed while no credit from it was used or refunded');
      assert((await sheet.locator('[data-reopen-blocked]').count()) === 0, 'nothing blocks Reopen yet');
      // Monthly money: collected is what was kept of what was paid (3 paid x $11), the $3 each back is credits owed; Devon's Wed payment is still held.
      const sum = squash(await admin.locator('.money-sum').innerText());
      assert(/Collected \$33/.test(sum) && /Credits owed \$9/.test(sum) && /Held \$14/.test(sum), `monthly summary: ${sum}`);
      await admin.locator('[data-credits-owed-note]').waitFor();
      assert(!/kept from canceled games|Credit per person/.test(sum), 'old wording on the month');
      await tab(admin, 'Home').click();
    });

    await check('SUSPECTED CODE BUG: the finalized line on the Money tab should total the credit from finalizing (3 paid x $3 = $9 back), not Frankie\'s $14 from dropping out of the game', async () => {
      const sheet = await moneyOf(admin, tueId);
      const line = squash(await sheet.locator('[data-finalized-line]').innerText());
      await tab(admin, 'Home').click();
      assert(line === '5 played · $11 each · $9 back as credit', `finalized line was "${line}"`);
    });

    await check('players after finalizing: Emery owes the final $11 (Venmo exactly $11, "final price", no credit-back note); Alex sees a "CREDIT $3" chip left of the date tile, and the old credit line is gone', async () => {
      const e = players.Emery;
      await e.reload();
      const card = e.getByRole('region', { name: 'Payment' });
      await card.getByRole('heading', { name: 'You owe $11 for Tue, Oct 27' }).waitFor();
      await card.getByText('$11, final price').waitFor();
      const pay = card.getByRole('link', { name: 'Pay $11 with Venmo' });
      await venmoLinkOk(pay, 11, 'Emery');
      assert((await card.locator('[data-pay-note]').count()) === 0, 'no credit-back note once the price is final');
      assert((await e.locator('header [data-credit-chip]').count()) === 0, 'Emery has no credit');
      const a = players.Alex;
      await a.reload();
      const chip = a.locator('header [data-credit-chip]');
      await chip.waitFor();
      assert(squash(await chip.innerText()) === 'CREDIT $3', `chip was "${await chip.innerText()}"`);
      assert((await chip.getAttribute('aria-label')) === '$3 credit. Open your credit', `chip label ${await chip.getAttribute('aria-label')}`);
      const cb = await chip.boundingBox();
      const sq = await a.locator('header .today').boundingBox();
      const h1 = await a.locator('header h1').evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { x: b.left, width: Math.min(b.width, el.getBoundingClientRect().width) }; });
      assert(cb.x + cb.width <= sq.x && sq.x - (cb.x + cb.width) <= 20, 'chip just left of the date tile');
      assert(Math.abs(cb.height - sq.height) <= 3 && Math.abs(cb.y - sq.y) <= 3, `chip as tall as the tile (${cb.height} vs ${sq.height})`);
      assert(h1.x + h1.width <= cb.x + 1, 'the name never runs under the chip');
      assert(cb.height >= 40, `chip tap area ${cb.height}px`);
      assert((await a.locator('[data-credit-line]').count()) === 0 && (await a.getByText(/You have \$\d+ credit/).count()) === 0, 'the old "You have $X credit" line is gone');
      assert(!/Tue, Oct 27/.test(await a.getByRole('region', { name: 'Payment' }).innerText().catch(() => '')), 'Alex paid Tue: nothing owed for it');
      await a.screenshot({ path: path.join(SHOTS, 'player-credit-chip.png') });
    });

    await check('the credit sheet: "$3 credit", history "+$3 Tue, Oct 27 (5 played)", Request refund prefilled with the balance (never more), the pending line with Cancel request; the chip reads REFUND', async () => {
      const b = players.Blair;
      await b.reload();
      await b.locator('header [data-credit-chip]').click();
      const sheet = b.locator('[data-credit-sheet]');
      await sheet.waitFor();
      assert(squash(await sheet.locator('[data-credit-balance]').innerText()) === '$3 credit', `balance was "${await sheet.locator('[data-credit-balance]').innerText()}"`);
      const hist = sheet.locator('[data-credit-history] li');
      assert((await hist.count()) === 1 && / \$3 back from Oct 27 \(5 played\)$/.test(squash(await hist.first().innerText())), `history: ${await hist.allInnerTexts()}`);
      await sheet.getByText("Your credit goes on a game by itself when you tap I'm in.").waitFor();
      assert((await sheet.locator('[data-refund-pending]').count()) === 0, 'nothing pending yet');
      await sheet.locator('[data-request-refund]').click();
      const amount = sheet.getByLabel('Cash out amount');
      assert((await amount.inputValue()) === '3', `prefilled with ${await amount.inputValue()}`);
      await amount.fill('5');
      await sheet.getByRole('button', { name: /^Request cash out from/ }).click();
      await sheet.getByText('You have $3 credit.').waitFor();
      assert((await sheet.locator('[data-refund-pending]').count()) === 0, 'too much must not be requested');
      await amount.fill('3');
      await sheet.getByRole('button', { name: /^Request cash out from/ }).click();
      await b.locator('.toast', { hasText: 'Cash out requested' }).waitFor();
      const pending = sheet.locator('[data-refund-pending]');
      await pending.waitFor();
      assert(/^Cash out requested: \$3, pending Cancel request$/.test(squash(await pending.innerText())), `pending line was "${await pending.innerText()}"`);
      await pending.getByRole('button', { name: 'Cancel request' }).waitFor();
      assert((await sheet.locator('[data-request-refund]').count()) === 0, 'one request at a time');
      const gr = await b.evaluate(greenReport);
      assert(gr.problems.length === 0, gr.problems.join(' | '));
      await b.screenshot({ path: path.join(SHOTS, 'player-credit-sheet-pending.png') });
      await b.keyboard.press('Escape');
      await b.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      const chip = b.locator('header [data-credit-chip]');
      assert(squash(await chip.innerText()) === 'CASH OUT $3', `chip was "${await chip.innerText()}"`);
      assert(/cash out requested/.test(await chip.getAttribute('aria-label')), 'chip label says a cash out is requested');
      // Other players never see Blair's credit or request.
      const html = await players.Emery.content();
      assert(!/Blair.*(credit|refund)/i.test(html.replace(/\s+/g, ' ')), "Blair's credit leaked");
    });

    await check('organizer Home: the refund request card first, with a green Refund that opens Venmo for $3 with the note "Pickleball credit refund"; Not now gives the credit back', async () => {
      await admin.reload();
      const card = admin.locator('[data-refund-request="Blair"]');
      await card.waitFor();
      assert(squash(await card.locator('h3').innerText()) === 'Blair requested a refund of $3', `title was "${await card.locator('h3').innerText()}"`);
      assert((await card.boundingBox()).y < (await admin.locator('[data-finalize]').first().boundingBox()).y, 'refund requests come before the Finalize cards');
      const link = card.locator('[data-refund-venmo]');
      assert((await link.getAttribute('href')) === 'https://venmo.com/?txn=pay&amount=3&note=Pickleball%20credit%20refund', `web link ${await link.getAttribute('href')}`);
      assert((await link.getAttribute('data-app-href')) === 'venmo://paycharge?txn=pay&amount=3&note=Pickleball%20credit%20refund', `app link ${await link.getAttribute('data-app-href')}`);
      assert((await link.getAttribute('aria-label')) === 'Refund Blair $3 with Venmo', 'Refund label');
      await card.getByText('No Venmo saved for Blair: pick them in Venmo.').waitFor();
      assert((await card.locator('[data-mark-refunded]').count()) === 0, 'Mark refunded only after Venmo was opened');
      await card.locator('[data-not-now]').waitFor();
      const gr = await admin.evaluate(greenReport);
      assert(gr.problems.length === 0, gr.problems.join(' | '));
      assert(!/\bsent\b/i.test(await card.innerText()), 'never say sent');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-refund-request.png'), fullPage: true });
      await card.locator('[data-not-now]').click();
      await admin.locator('.toast', { hasText: 'Put off for now' }).waitFor();
      await card.waitFor({ state: 'detached' });
      const b = players.Blair;
      await b.reload();
      assert(squash(await b.locator('header [data-credit-chip]').innerText()) === 'CREDIT $3', 'the credit is usable again');
      await b.locator('header [data-credit-chip]').click();
      await b.locator('[data-credit-sheet] [data-request-refund]').waitFor();
      assert((await b.locator('[data-refund-pending]').count()) === 0, 'no pending request after Not now');
      await b.keyboard.press('Escape');
      await b.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
    });

    await check('request again, Refund then Mark refunded: the credit is gone for Blair, logged; Reopen on Tue is now blocked and says why', async () => {
      const b = players.Blair;
      await b.locator('header [data-credit-chip]').click();
      await b.locator('[data-credit-sheet] [data-request-refund]').click();
      await b.locator('[data-credit-sheet]').getByRole('button', { name: /^Request cash out from/ }).click();
      await b.locator('[data-refund-pending]').waitFor();
      await b.keyboard.press('Escape');
      await b.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await admin.reload();
      const card = admin.locator('[data-refund-request="Blair"]');
      await card.waitFor();
      const before = admin.url();
      await card.locator('[data-refund-venmo]').click();
      await admin.waitForTimeout(800);
      assert(admin.url() === before && admin.context().pages().length >= 1, 'Refund left the page');
      assert((await card.count()) === 1, 'opening Venmo must not mark anything');
      await card.locator('[data-mark-refunded]').click();
      await admin.locator('.toast', { hasText: 'Blair refunded' }).waitFor();
      await card.waitFor({ state: 'detached' });
      await b.reload();
      await b.locator('.schedule article').first().waitFor();
      assert((await b.locator('header [data-credit-chip]').count()) === 0, 'no chip once the credit was paid back');
      await tab(admin, 'History').click();
      await admin.getByRole('button', { name: 'Activity' }).click();
      const acts = admin.getByRole('list', { name: 'Activity' });
      await acts.getByText('Blair asked for $3 refund of their credit').first().waitFor();
      await acts.getByText("Robin put off Blair's refund request").first().waitFor();
      await acts.getByText("Robin paid Blair's credit back").first().waitFor();
      await acts.getByText('Robin finalized Tue, Oct 27: 5 played, $11 each').first().waitFor();
      await acts.getByText('Alex got $3 back as credit for Tue, Oct 27').first().waitFor();
      assert(!/\bsent\b/i.test(await acts.innerText()), 'never say sent');
      const sheet = await moneyOf(admin, tueId);
      assert(await sheet.locator('[data-reopen]').isDisabled(), 'Reopen should be blocked');
      assert(squash(await sheet.locator('[data-reopen-blocked]').innerText()) === "Can't reopen: Blair already used or got back credit from this game.", `blocked line was "${await sheet.locator('[data-reopen-blocked]').innerText()}"`);
      await tab(admin, 'Home').click();
    });

    await check('the Final price text card: the group text with the final price and the credit sentence, no numbers (pick the chat), hides after the tap', async () => {
      await admin.reload();
      if (await admin.locator('.sg-more').count()) await admin.locator('.sg-more').click();
      const card = admin.locator(`article[data-suggest="final"][data-session="${tueId}"]`);
      await card.waitFor();
      assert(/^Final price: Tue, Oct 27 · /.test(await card.getAttribute('aria-label')), `label ${await card.getAttribute('aria-label')}`);
      const { to, body } = smsOf(await card.getByRole('link', { name: /^Text/ }).getAttribute('href'));
      assert(to.length === 0, 'the final price text goes to the group chat');
      assert(body === `Pickleball Tue, Oct 27 is final: 5 played, $11 each. If you paid $14, the extra $3 is now credit on your account. ${SITE}`, `body: ${body}`);
      assert(squash(await card.locator('.sg-who').innerText()) === 'Group chat', 'who line');
      assert(!/\bsent\b/i.test(await card.innerText()), 'never say sent');
      await card.evaluate((el) => el.querySelector('a[href^="sms"]').addEventListener('click', (e) => e.preventDefault()));
      await card.getByRole('link', { name: /^Text/ }).click();
      await card.waitFor({ state: 'detached' });
    });

    await check('Everyone played on a 4-in game: $14 each and nothing back, the final text has no credit sentence; Reopen brings the Finalize card back', async () => {
      const card = admin.locator(`[data-finalize="${wedFour.id}"]`);
      await card.locator('[data-everyone-played]').click();
      await admin.locator('.toast', { hasText: 'Wed, Oct 28 is final' }).waitFor();
      await card.waitFor({ state: 'detached' });
      if (await admin.locator('.sg-more').count()) await admin.locator('.sg-more').click();
      const text = admin.locator(`article[data-suggest="final"][data-session="${wedFour.id}"]`);
      await text.waitFor();
      const { body } = smsOf(await text.getByRole('link', { name: /^Text/ }).getAttribute('href'));
      assert(body === `Pickleball Wed, Oct 28 is final: 4 played, $14 each. ${SITE}`, `body: ${body}`);
      const sheet = await moneyOf(admin, wedFour.id);
      assert(/^Wed, Oct 28 · 4 played · \$14 each/.test(squash(await sheet.locator('summary').innerText())), `summary was "${await sheet.locator('summary').innerText()}"`);
      assert(squash(await sheet.locator('[data-finalized-line]').innerText()) === '4 played · $14 each', `finalized line was "${await sheet.locator('[data-finalized-line]').innerText()}"`);
      assert((await sheet.getByText(/owes \$14/).count()) === 4, 'four owe the flat price');
      await sheet.locator('[data-reopen]').click();
      await admin.locator('.toast', { hasText: 'Reopened' }).waitFor();
      await tab(admin, 'Home').click();
      await admin.locator(`[data-finalize="${wedFour.id}"] [data-everyone-played]`).waitFor();
      assert((await admin.locator(`article[data-suggest="final"][data-session="${wedFour.id}"]`).count()) === 0, 'no final text while reopened');
      await tab(admin, 'History').click();
      await admin.getByRole('button', { name: 'Sessions' }).click();
      const rows = admin.getByRole('list', { name: 'Past sessions' }).locator('li');
      await rows.filter({ hasText: 'Tue, Oct 27' }).locator('.h-who', { hasText: /^5 played · \$11 each/ }).waitFor();
      await rows.filter({ hasText: '5:00 to 7:00 PM' }).locator('.h-who', { hasText: /^4 in/ }).waitFor();
      await tab(admin, 'Home').click();
    });

    await check('under 4 in: Finalize anyway charges the flat $14; Reopen; Cancel session turns the paid player\'s $14 into credit (list on the sheet, chip and history on the phone), no "Were you charged?" after the start', async () => {
      const card = admin.locator(`[data-finalize="${wedThree.id}"]`);
      await card.getByRole('button', { name: 'Finalize anyway' }).click();
      await admin.locator('.toast', { hasText: 'Wed, Oct 28 is final' }).waitFor();
      await card.waitFor({ state: 'detached' });
      let sheet = await moneyOf(admin, wedThree.id);
      assert(/^Wed, Oct 28 · 3 played · \$14 each/.test(squash(await sheet.locator('summary').innerText())), `summary was "${await sheet.locator('summary').innerText()}"`);
      assert(/paid \$14 on/.test(squash(await sheet.locator('[data-pay-row="Devon"]').innerText())) && !/back as credit/.test(squash(await sheet.locator('[data-pay-row="Devon"]').innerText())), 'Devon paid the flat price, nothing back');
      assert(/owes \$14/.test(squash(await sheet.locator('[data-pay-row="Frankie"]').innerText())), 'Frankie owes $14');
      await sheet.locator('[data-reopen]').click();
      await admin.locator('.toast', { hasText: 'Reopened' }).waitFor();
      await tab(admin, 'Home').click();
      await card.getByRole('button', { name: 'Cancel session' }).click();
      const dlg = admin.locator('dialog[open]');
      await dlg.getByRole('button', { name: 'Cancel session' }).waitFor();
      assert((await dlg.getByText('Were you charged for this court?').count()) === 0, 'no charge question after the game started');
      await dlg.getByRole('button', { name: 'Cancel session' }).click();
      const after = admin.locator('dialog[open]');
      await after.getByText(/^Canceled · /).waitFor();
      assert(/^Pickleball Wed Oct 28 is canceled\. If you paid, it's now your credit\. You can request a cash out on the site\. \S+$/.test((await after.locator('.bubble').innerText()).trim()), `cancel text was: ${await after.locator('.bubble').innerText()}`);
      const back = after.locator('[data-credit-back-list]');
      await back.getByRole('heading', { name: 'Now their credit' }).waitFor();
      await back.locator('li', { hasText: 'Devon' }).getByText('$14 credit', { exact: true }).waitFor();
      assert((await back.locator('li').count()) === 1, 'only the one who paid');
      await admin.keyboard.press('Escape');
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      assert((await admin.locator(`[data-finalize="${wedThree.id}"]`).count()) === 0, 'a canceled game needs no finalizing');
      // Devon: $3 from Tue and $14 from the canceled game.
      const dv = players.Devon;
      await dv.reload();
      await dv.locator('header [data-credit-chip]').waitFor();
      assert(squash(await dv.locator('header [data-credit-chip]').innerText()) === 'CREDIT $17', `chip was "${await dv.locator('header [data-credit-chip]').innerText()}"`);
      await dv.locator('header [data-credit-chip]').click();
      const hist = dv.locator('[data-credit-sheet] [data-credit-history] li');
      const lines = (await hist.allInnerTexts()).map(squash);
      assert(/: \$14 back from Oct 28 \(canceled\)$/.test(lines[0] ?? '') && /: \$3 back from Oct 27 \(5 played\)$/.test(lines[1] ?? ''), `history: ${lines}`);
      await dv.keyboard.press('Escape');
      await dv.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await tab(admin, 'Players').click();
      await admin.locator('li.player-row[data-player="Devon"]').getByText(/^(Credit \$17|\$17 credit)$/).waitFor();
      const sum = async () => {
        await tab(admin, 'Money').click();
        await admin.locator('.money-sum').waitFor();
        return squash(await admin.locator('.money-sum').innerText());
      };
      assert(/Credits owed \$20/.test(await sum()), `credits owed: ${await sum()}`); // Alex $3 and Devon $17; the $3 refunded to Blair is gone
      await tab(admin, 'Home').click();
    });

    // Devon asks for his credit back, so the refund card is on Home for the layout checks.
    await players.Devon.request.post(`${BASE}/api/me/refund-request`, { data: { cents: 1700 }, headers: { Origin: BASE } });
    for (const [width, scheme] of [[360, 'light'], [360, 'dark'], [375, 'light'], [375, 'dark'], [390, 'light'], [390, 'dark'], [430, 'light'], [430, 'dark']]) {
      await check(`after-the-game screens at ${width}px (${scheme}): refund request and Finalize cards, the Who played sheet, Money with a finalized game, the credit chip and sheet: no overlaps, nothing cut off, one green button per card, no sideways scrolling`, async () => {
        const p = await admin.context().newPage();
        p.setDefaultTimeout(10000);
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        const issues = [];
        const look = async (where, roots, items) => {
          const lay = await p.evaluate(layoutReport, { roots, items });
          issues.push(...lay.problems.map((x) => `${where}: ${x}`));
          const gr = await p.evaluate(greenReport);
          issues.push(...gr.problems.map((x) => `${where}: ${x}`));
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          if (overflow > 0) issues.push(`${where}: scrolls sideways by ${overflow}px`);
        };
        await p.goto(`${BASE}/admin`);
        await p.locator('[data-refund-request="Devon"]').waitFor();
        await p.locator(`[data-finalize="${wedFour.id}"]`).waitFor();
        const HOME_ITEMS = CARD_ITEMS + ', h3, [data-finalize-preview], .not-now, .sg-preview, .sg-kind, .sg-who';
        await look('Home', 'main article', HOME_ITEMS);
        await p.screenshot({ path: path.join(SHOTS, `after-game-home-${width}-${scheme}.png`) });
        await p.locator(`[data-finalize="${wedFour.id}"] [data-change-played]`).click();
        await p.locator('[data-who-played]').waitFor();
        await look('Who played sheet', 'dialog[open] .sheet-body', 'button, input, .set-name, .set-hint, [data-finalize-live], h2');
        await p.screenshot({ path: path.join(SHOTS, `who-played-${width}-${scheme}.png`) });
        await p.keyboard.press('Escape');
        await p.locator('dialog[open]').waitFor({ state: 'detached' });
        const sheet = await moneyOf(p, tueId);
        await sheet.locator('[data-reopen-blocked]').waitFor();
        await look('Money', 'main details', 'button, a[href], .pay-who, .chip, [data-finalized-line], [data-reopen-blocked], summary > span, .owes-tag');
        await p.screenshot({ path: path.join(SHOTS, `money-finalized-${width}-${scheme}.png`) });
        await p.close();
        // Devon's phone: the chip beside the date tile, and the sheet with the pending request.
        const pl = await newPage(width, scheme);
        await pl.goto(BASE);
        await pl.locator('.name-grid').waitFor();
        await pl.getByRole('button', { name: 'Devon', exact: true }).click();
        const chip = pl.locator('header [data-credit-chip]');
        await chip.waitFor();
        const h = await pl.evaluate(headerReport);
        // With the chip, "not you?" may move under the name (Alex, Oct 30): the name must be whole, nothing overlapping.
        if (!h.nameFits || h.overlap || !h.allVisible) issues.push(`header: ${JSON.stringify({ nameFits: h.nameFits, overlap: h.overlap, allVisible: h.allVisible })}`);
        const cb = await chip.boundingBox();
        const sq = await pl.locator('header .today').boundingBox();
        const nm = await pl.locator('header h1').evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { x: b.left, width: Math.min(b.width, el.getBoundingClientRect().width) }; });
        const nu = await pl.getByRole('button', { name: 'Not you?' }).boundingBox();
        if (!(cb.x + cb.width <= sq.x + 0.5 && sq.x - (cb.x + cb.width) <= 20)) issues.push(`chip not just left of the date tile: ${JSON.stringify([cb, sq])}`);
        if (Math.abs(cb.height - sq.height) > 3) issues.push(`chip ${cb.height}px tall, tile ${sq.height}px`);
        if (nm.x + nm.width > cb.x + 1 || nu.x + nu.width > cb.x + 1) issues.push('the name or "not you?" runs under the chip');
        if (cb.x < 0) issues.push('chip off the left edge');
        await pl.screenshot({ path: path.join(SHOTS, `credit-chip-${width}-${scheme}.png`), clip: { x: 0, y: 0, width, height: 90 } });
        await chip.click();
        await pl.locator('[data-credit-sheet] [data-refund-pending]').waitFor();
        const lay = await pl.evaluate(layoutReport, { roots: 'dialog[open] .sheet-body', items: 'button, [data-credit-balance], [data-credit-history] li, .credit-pending, p, h2' });
        issues.push(...lay.problems.map((x) => `credit sheet: ${x}`));
        const gr = await pl.evaluate(greenReport);
        issues.push(...gr.problems.map((x) => `credit sheet: ${x}`));
        await pl.screenshot({ path: path.join(SHOTS, `credit-sheet-${width}-${scheme}.png`) });
        await pl.keyboard.press('Escape');
        await pl.close();
        assert(issues.length === 0, issues.slice(0, 6).join(' | '));
      });
    }
    await check('Not now on Devon\'s request puts the $17 back; nothing on any player screen names another player\'s credit, court cost, membership or Venmo', async () => {
      await admin.reload();
      const card = admin.locator('[data-refund-request="Devon"]');
      await card.waitFor();
      assert(squash(await card.locator('h3').innerText()) === 'Devon requested a refund of $17', `title was "${await card.locator('h3').innerText()}"`);
      await card.locator('[data-not-now]').click();
      await card.waitFor({ state: 'detached' });
      for (const name of ['Emery', 'Casey']) {
        const p = players[name];
        await p.reload();
        await p.locator('.schedule article, .pay-card').first().waitFor();
        const text = squash(await p.locator('body').innerText());
        assert(!/Northville Pickleball(?! Club)|court cost|membership|Credits owed|Collected|Surplus|Venmo-|@[A-Za-z]|Credit \$|requested a refund|Refund credit balance|held/i.test(text), `${name} sees private money: ${text.slice(0, 300)}`);
        const raw = await (await p.request.get(`${BASE}/api/group`)).text();
        assert(!/creditLedger|refundRequests|courtCost|membership|"venmo":|phone/.test(raw), `${name}'s API leaks organizer data`);
      }
    });

    await check('no JavaScript errors in the browser', async () => {
      assert(pageErrors.length === 0, pageErrors.join('\n'));
    });
  } finally {
    await browser.close();
    stopServer();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failed:', failures.join('; '));
    if (process.env.E2E_DEBUG) console.log(serverLog);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
