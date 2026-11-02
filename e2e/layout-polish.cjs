/* Layout polish (Nov 2026): the player and organizer screens must hold together with very big phone text, awkward names,
 * big credit amounts, a shared phone, short and narrow screens, and a keyboard. No redesign: this only measures.
 *
 *   node e2e/layout-polish.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group (a 29-letter name, a name with no spaces, emoji, accents, $140.00 of
 * credit, a moved game, a full game with a waitlist). Real browser, 320 and 390 px wide, light and dark, text at 100%,
 * 150% and 200% (root and body size, what Safari's text size and Larger Text amount to). Nothing here touches the live site.
 * Screenshots (only when LAYOUT_SHOTS is set) go to that folder, never into the repo.
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const L = require('./layout-lib.cjs');
const { audit, midWordBreaks } = require('./layout-audit.cjs');

const PORT = Number(process.env.E2E_PORT) || 5312;
const TOKEN = 'layout-setup-token-0123456789';
const SHOTS = process.env.LAYOUT_SHOTS || '';
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = L.sleep;
/** Report a list of problems as one failure (the first few, no repeats). */
const none = (list, what) => assert(list.length === 0, `${what || 'problems'} (${list.length}): ${[...new Set(list)].slice(0, Number(process.env.SHOW) || 6).join(' | ')}`);

// Names that end in "…" on purpose: the group word and the player's name in the header.
const ELLIPSIS_OK = ['.topbar h1', '.topbar .eyebrow'];
const bigText = (page, pct) =>
  pct === 100 ? Promise.resolve() : page.addStyleTag({ content: `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` });

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const { BASE } = await L.startSite({ port: PORT, name: 'layout-polish', token: TOKEN });
  const w = await L.seed({ BASE, token: TOKEN });
  const { browser, post, S, idOf } = w;
  // The organizer screens come in two layouts: LAYOUT_ADMIN_V2=on runs everything with "New admin layout" switched on for everyone.
  const ADMIN_V2 = process.env.LAYOUT_ADMIN_V2 === 'on';
  if (ADMIN_V2) await w.ok(await w.put(w.areq, '/api/admin/admin-v2', { on: true }), 'admin v2 on');
  console.log(`New admin layout: ${ADMIN_V2 ? 'ON' : 'OFF'}`);
  const phone = (width, scheme, extra = {}) => ({ viewport: { width, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: L.UA, colorScheme: scheme, ...extra });
  const shot = async (page, file) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, file), fullPage: true }).catch(() => {});
  };

  /** One player's phone with the whole schedule open and no one-time banners in the way. */
  async function openPlayer(name, width, scheme, pct, extra = {}, query = '') {
    const ctx = await browser.newContext(phone(width, scheme, extra));
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('pb_games_filter', 'all');
      } catch {}
    });
    const page = await ctx.newPage();
    await page.goto(BASE + query);
    await page.locator('.schedule article, .empty-mine').first().waitFor();
    const more = page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) {
      await more.click();
      await page.waitForTimeout(200);
    }
    await page.evaluate((x) => (window.__layoutW = x), width);
    await bigText(page, pct);
    await page.waitForTimeout(350);
    return { ctx, page };
  }

  const WIDTHS = [390, 320];
  const SIZES = [100, 150, 200];
  const LOOKS = [];
  for (const width of WIDTHS) for (const pct of SIZES) for (const scheme of ['light', 'dark']) if (scheme === 'light' || pct !== 150) LOOKS.push({ width, pct, scheme });
  const tag = (l) => `${l.width}px ${l.scheme} text ${l.pct}%`;

  /* ---------------- 1 + 2 + 3: the player home with every kind of name ---------------- */
  for (const l of LOOKS) {
    for (const who of ['Ryan', L.LONG, L.NOSPACE]) {
      await check(`player home, ${tag(l)}, ${who.length > 12 ? `"${who.slice(0, 12)}…" (${who.length} letters)` : who}: no sideways scroll, nothing cut off, overlapping or past the edge`, async () => {
        const { ctx, page } = await openPlayer(who, l.width, l.scheme, l.pct);
        const problems = await page.evaluate(audit, { allowEllipsis: ELLIPSIS_OK });
        const broken = await page.evaluate(midWordBreaks, { skipWordsLongerThan: 18 });
        if (who === L.LONG && l.pct === 200) await shot(page, `player-${l.width}-${l.scheme}-${l.pct}-long.png`);
        await ctx.close();
        none([...problems, ...broken]);
      });
    }
  }

  /* ---------------- 9: extra games (EXTRA tag, comment pill / soft box) and canceled reasons ---------------- */
  for (const l of LOOKS) {
    await check(`extra games and comments, ${tag(l)}: normal tile, EXTRA tag under the time, short comment = pill, long = soft box, none = nothing; canceled reason the same; a normal game has none of it`, async () => {
      const a = await openPlayer('Ryan', l.width, l.scheme, l.pct);
      const f = await a.page.evaluate(({ ids, S8, normal }) => {
        const rect = (e) => e && e.getBoundingClientRect();
        const info = (id) => {
          const c = document.getElementById(`row-${id}`);
          if (!c) return null;
          const col = c.querySelector('.sched-tilecol');
          const time = c.querySelector('.sched-time');
          const flag = c.querySelector('.extra-flag');
          const note = c.querySelector('.game-note');
          const st = c.querySelector('.st-canceled');
          const tile = c.querySelector('.tile.ptile');
          return {
            extraTile: !!c.querySelector('.tile.extra'),
            tileBg: tile && getComputedStyle(tile).backgroundColor,
            flag: flag && flag.textContent.trim(),
            flagBelowTime: flag && time ? rect(flag).top >= rect(time).bottom - 1 : null,
            flagInsideCol: flag && col ? rect(flag).left >= rect(col).left - 1 && rect(flag).right <= rect(col).right + 1 : null,
            noteClass: note ? note.className : null,
            noteText: note ? note.textContent.trim() : null,
            noteRadius: note ? parseFloat(getComputedStyle(note).borderTopLeftRadius) : null,
            noteBg: note ? getComputedStyle(note).backgroundColor : null,
            stClass: st ? st.className : null,
          };
        };
        // The colors must be the site's existing ones: compare with probes painted from the existing color names.
        const probe = (css) => {
          const e = document.createElement('i');
          e.style.cssText = css;
          document.body.appendChild(e);
          const v = getComputedStyle(e);
          const out = { bg: v.backgroundColor, color: v.color };
          e.remove();
          return out;
        };
        const soft = probe('background:var(--accent-soft);color:var(--accent-text)');
        const holiday = probe('background:var(--holiday-bg);color:var(--holiday-fg)');
        const flagEl = document.querySelector('.extra-flag');
        const noteEl = document.querySelector('.note-pill:not(.st-canceled), .note-box:not(.st-canceled)');
        const tokens = { noteBgOk: noteEl && getComputedStyle(noteEl).backgroundColor === soft.bg, noteColorOk: noteEl && getComputedStyle(noteEl).color === soft.color, flagBgOk: flagEl && getComputedStyle(flagEl).backgroundColor === holiday.bg, flagColorOk: flagEl && getComputedStyle(flagEl).color === holiday.color };
        return { short: info(ids.short), long: info(ids.long), none: info(ids.none), rain: info(S8), normal: info(normal), tokens };
      }, { ids: w.extras, S8: S[8], normal: S[1] });
      const bad = [];
      const nrm = f.normal;
      for (const [k, c] of Object.entries({ short: f.short, long: f.long, none: f.none })) {
        if (!c) { bad.push(`${k}: card missing`); continue; }
        if (c.extraTile) bad.push(`${k}: still the special tile`);
        if (c.tileBg !== nrm.tileBg) bad.push(`${k}: tile color ${c.tileBg} is not the normal ${nrm.tileBg}`);
        if (c.flag !== 'EXTRA' || !c.flagBelowTime || !c.flagInsideCol) bad.push(`${k}: EXTRA tag ${JSON.stringify([c.flag, c.flagBelowTime, c.flagInsideCol])}`);
      }
      if (!f.short.noteClass || !/note-pill/.test(f.short.noteClass) || f.short.noteText !== 'Bring balls') bad.push(`short comment: ${JSON.stringify([f.short.noteClass, f.short.noteText])}`);
      else if (f.short.noteRadius < 14) bad.push(`short comment is not pill-shaped (${f.short.noteRadius})`);
      if (!f.long.noteClass || !/note-box/.test(f.long.noteClass) || !/side door/.test(f.long.noteText)) bad.push(`long comment: ${JSON.stringify([f.long.noteClass, f.long.noteText])}`);
      else if (f.long.noteRadius > 16 || f.long.noteBg === 'rgba(0, 0, 0, 0)') bad.push('long comment is not a tinted box');
      if (f.none.noteClass) bad.push('no comment, yet a note shows');
      if (f.rain && !/note-pill/.test(f.rain.stClass || '')) bad.push(`canceled reason "Rain" should be a pill: ${f.rain.stClass}`);
      if (!f.tokens.noteBgOk || !f.tokens.noteColorOk) bad.push(`comment colors are not the site's accent tint/text: ${JSON.stringify(f.tokens)}`);
      if (!f.tokens.flagBgOk || !f.tokens.flagColorOk) bad.push(`EXTRA tag colors are not the site's existing extra/holiday chip colors: ${JSON.stringify(f.tokens)}`);
      if (nrm.flag || nrm.noteClass) bad.push(`a normal game shows an EXTRA tag or a note: ${JSON.stringify(nrm)}`);
      // The long canceled reason (20 characters, "Thanksgiving week") is a soft box.
      const tg = await a.page.evaluate(() => [...document.querySelectorAll('.st-canceled')].map((e) => [e.textContent.trim(), e.className]));
      const tw = tg.find((x) => /Thanksgiving week/.test(x[0]));
      if (tw && !/note-box/.test(tw[1])) bad.push(`long canceled reason should be a box: ${tw[1]}`);
      if (l.pct === 200 || (l.width === 390 && l.pct === 100)) await shot(a.page, `extra-${l.width}-${l.scheme}-${l.pct}.png`);
      await a.ctx.close();
      none(bad);
    });
  }

  /* ---------------- 3: the CREDIT text in the header ---------------- */
  for (const l of LOOKS.filter((x) => x.scheme === 'light')) {
    await check(`header credit, ${tag(l)}: label over the amount, right-aligned, whole, with "${L.LONG.slice(0, 11)}…" ($140) beside it; hidden at $0`, async () => {
      const a = await openPlayer(L.LONG, l.width, l.scheme, l.pct);
      const f = await a.page.evaluate(() => {
        const r = (e) => e.getBoundingClientRect();
        const chip = document.querySelector('header [data-credit-chip]');
        const label = chip.querySelector('.cc-label');
        const amt = chip.querySelector('.cc-now');
        const h1 = document.querySelector('header h1');
        const tools = document.querySelector('header .mode-btn');
        const today = document.querySelector('header .today');
        return {
          chip: r(chip), label: r(label), amt: r(amt), h1: r(h1), mode: r(tools), today: r(today),
          amtText: amt.textContent.trim(), labelText: label.textContent.trim(),
          h1Cut: h1.scrollWidth > h1.clientWidth + 1,
          todayCut: [...today.children].some((c) => r(c).right > r(today).right + 0.5 || r(c).left < r(today).left - 0.5),
          vw: innerWidth,
        };
      });
      assert(f.amtText === '$140' && f.labelText === 'CREDIT', `${f.labelText} ${f.amtText}`);
      assert(f.label.bottom <= f.amt.top + 3, `label ${f.label.bottom} not above amount ${f.amt.top}`);
      assert(Math.abs(f.label.right - f.amt.right) <= 2, `not right-aligned: ${f.label.right} vs ${f.amt.right}`);
      assert(f.amt.left >= f.chip.left - 1 && f.amt.right <= f.chip.right + 1 && f.label.left >= f.chip.left - 1, 'amount or label outside the chip');
      assert(f.mode.width >= 43.5 && f.today.width >= 41.5 && !f.todayCut, `squeezed: sun ${f.mode.width}, date ${f.today.width}`);
      assert(f.chip.right <= f.vw && f.today.right <= f.vw, 'past the edge');
      // The name gives way first: at normal text with the chip beside it, the name ends in "…" before anything else moves.
      if (l.pct === 100) assert(f.h1Cut, 'a 29-letter name should be cut with … at this width');
      await shot(a.page, `credit-${l.width}-${l.pct}.png`);
      await a.ctx.close();
      const b = await openPlayer('Ryan', l.width, l.scheme, l.pct);
      assert((await b.page.locator('header [data-credit-chip]').count()) === 0, 'a player with $0 shows no chip');
      await b.ctx.close();
    });
  }

  /* ---------------- 2: every name in the header, light and dark ---------------- */
  for (const l of LOOKS) {
    await check(`header names, ${tag(l)}: emoji, accents, 28 letters with no space and 29 letters all keep the sun button and date whole`, async () => {
      const bad = [];
      for (const who of [L.EMOJI, L.ACCENT, L.NOSPACE, L.LONG, 'Alex']) {
        const a = await openPlayer(who, l.width, l.scheme, l.pct);
        const p = await a.page.evaluate(audit, { scope: 'header', allowEllipsis: ELLIPSIS_OK });
        const m = await a.page.evaluate(midWordBreaks, { sel: 'header h1, header .not-you, header .eyebrow, header .today span, header .cc-label' });
        const h = await a.page.evaluate(() => {
          const h1 = document.querySelector('header h1');
          const mode = document.querySelector('header .mode-btn').getBoundingClientRect();
          const today = document.querySelector('header .today').getBoundingClientRect();
          const r = h1.getBoundingClientRect();
          return { overlapMode: Math.min(r.right, mode.right) - Math.max(r.left, mode.left) > 1 && Math.min(r.bottom, mode.bottom) - Math.max(r.top, mode.top) > 1, mode: mode.width, today: today.width };
        });
        if (h.overlapMode || h.mode < 43.5 || h.today < 41.5) bad.push(`${who.slice(0, 10)}: name over the sun button or buttons squeezed ${JSON.stringify(h)}`);
        bad.push(...p.map((x) => `${who.slice(0, 10)} ${x}`), ...m.map((x) => `${who.slice(0, 10)} ${x}`));
        await a.ctx.close();
      }
      none(bad);
    });
  }

  /* ---------------- sheets, dialogs, the name list, toasts ---------------- */
  const sheetReach = () => {
    // Everything in the open sheet can be reached: the sheet fits on screen, and its last control is visible once scrolled to the end.
    const d = document.querySelector('dialog[open]');
    if (!d) return ['no dialog open'];
    const out = [];
    const r = d.getBoundingClientRect();
    if (r.bottom > innerHeight + 1 || r.top < -1 || r.left < -1 || r.right > innerWidth + 1) out.push(`sheet box ${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)} in ${innerWidth}x${innerHeight}`);
    const scroller = [d, ...d.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1; });
    const clipped = [d, ...d.querySelectorAll('*')].filter((e) => getComputedStyle(e).overflowY === 'hidden' && e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 0 && e.matches('.sheet, .sheet-body, .stack'));
    if (clipped.length) out.push(`content clipped, no scrolling: ${clipped.map((e) => String(e.className).split(' ')[0]).join(',')}`);
    for (const s of scroller) s.scrollTop = s.scrollHeight;
    const ctls = [...d.querySelectorAll('button, a[href], input, select, textarea')].filter((e) => e.checkVisibility() && !e.closest('.sheet-head'));
    const last = ctls[ctls.length - 1];
    if (last) {
      const q = last.getBoundingClientRect();
      const dr = d.getBoundingClientRect();
      if (q.bottom > Math.min(dr.bottom, innerHeight) + 1) out.push(`last control "${(last.textContent || '').trim().slice(0, 20)}" below the sheet's bottom (${Math.round(q.bottom)} > ${Math.round(Math.min(dr.bottom, innerHeight))})`);
    }
    return out;
  };

  for (const l of LOOKS.filter((x) => x.scheme === 'light' || x.pct !== 150)) {
    await check(`credit sheet, ${tag(l)}: opens whole, nothing cut off or overlapping, scrolls to its last button`, async () => {
      const a = await openPlayer(L.LONG, l.width, l.scheme, l.pct);
      await a.page.locator('[data-credit-chip]').click();
      await a.page.locator('dialog[open]').waitFor();
      await a.page.waitForTimeout(450);
      const probs = [...(await a.page.evaluate(audit, { scope: 'dialog[open]', allowEllipsis: ELLIPSIS_OK })), ...(await a.page.evaluate(sheetReach)), ...(await a.page.evaluate(midWordBreaks, { sel: 'dialog[open] h2, dialog[open] button, dialog[open] li, dialog[open] p', skipWordsLongerThan: 18 }))];
      await shot(a.page, `creditsheet-${l.width}-${l.pct}.png`);
      await a.ctx.close();
      none(probs);
    });
    await check(`Drop out question, ${tag(l)}: whole, buttons reachable`, async () => {
      const a = await openPlayer('Ryan', l.width, l.scheme, l.pct);
      await a.page.locator('article.sched', { hasText: 'Court booked' }).first().getByRole('button', { name: /Drop out/ }).first().click();
      await a.page.locator('dialog[open]').waitFor();
      await a.page.waitForTimeout(450);
      const probs = [...(await a.page.evaluate(audit, { scope: 'dialog[open]', allowEllipsis: ELLIPSIS_OK })), ...(await a.page.evaluate(sheetReach))];
      await a.ctx.close();
      none(probs);
    });
    await check(`"Not you?" name list, ${tag(l)}: every name whole or cut with …, nothing past the edge`, async () => {
      const a = await openPlayer('Ryan', l.width, l.scheme, l.pct);
      await a.page.getByRole('button', { name: 'Not you?' }).click();
      await a.page.locator('.name-grid').waitFor();
      await a.page.waitForTimeout(350);
      const probs = await a.page.evaluate(audit, { allowEllipsis: ELLIPSIS_OK });
      await shot(a.page, `names-${l.width}-${l.pct}.png`);
      await a.ctx.close();
      none(probs);
    });
  }

  for (const l of LOOKS.filter((x) => x.scheme === 'light' || x.pct !== 150)) {
    await check(`I'm in banner and Undo, ${tag(l)}: the pop-up banner is whole and on screen (a no-court game, and credit used on a booked one)`, async () => {
      const bad = [];
      // Zed has no credit; Wren has $14 credit. Each joins, the banner is measured, then they drop out again.
      for (const [who, sid, label] of [['Zed', S[4], 'no court'], ['Wren', S[6], 'credit used']]) {
        const a = await openPlayer(who, l.width, l.scheme, l.pct);
        const card = a.page.locator(`#row-${sid}`);
        await card.scrollIntoViewIfNeeded();
        await card.getByRole('button', { name: "I'm in" }).first().click();
        await a.page.locator('.pop').waitFor();
        await a.page.waitForTimeout(450);
        const probs = await a.page.evaluate(audit, { scope: '.pop', allowEllipsis: ELLIPSIS_OK });
        const box = await a.page.locator('.pop').boundingBox();
        if (!box || box.x < -1 || box.x + box.width > l.width + 1) bad.push(`${label}: banner ${JSON.stringify(box)} not inside ${l.width}`);
        bad.push(...probs.map((x) => `${label}: ${x}`));
        await shot(a.page, `banner-${label.replace(/ /g, '-')}-${l.width}-${l.pct}.png`);
        await a.ctx.close();
        await post(w.who[who], `/api/sessions/${sid}/withdraw`, {});
      }
      none(bad);
    });
  }

  /* ---------------- 4: shared phone: switching names never shows the wrong person's credit or buttons ---------------- */
  for (const l of [{ width: 390, pct: 100, scheme: 'light' }, { width: 320, pct: 200, scheme: 'dark' }]) {
    await check(`shared phone, ${tag(l)}: after picking another name the old name's $140 and buttons never show; coming back shows them again`, async () => {
      const a = await openPlayer(L.LONG, l.width, l.scheme, l.pct);
      // Slow the next load of the games so the gap between "picked" and "loaded" is long enough to see.
      let slow = false;
      await a.page.route('**/api/group**', async (route) => {
        if (slow) await sleep(1500);
        await route.continue();
      });
      assert((await a.page.locator('header').innerText()).includes('$140'), 'the 29-letter name starts with $140');
      await a.page.getByRole('button', { name: 'Not you?' }).click();
      await a.page.locator('.name-grid').waitFor();
      await a.page.waitForTimeout(500); // the chip of the name that was just left fades out first (220 ms)
      slow = true;
      await a.page.getByRole('button', { name: 'Ryan', exact: true }).click();
      const seen = [];
      for (let i = 0; i < 24; i++) {
        const snap = await a.page.evaluate(() => ({
          text: document.body.innerText,
          cards: document.querySelectorAll('.schedule article').length,
          title: document.querySelector('header h1')?.textContent,
          around: (document.body.innerText.match(/.{0,40}\$140.{0,20}/s) || [''])[0].replace(/\s+/g, ' '),
        }));
        // While waiting: either the name list is still up, or Ryan's own page is. Never the old name's page under the new cookie.
        if (/\$140/.test(snap.text) || (snap.title === L.LONG && snap.cards > 0 && /Who are you/.test(snap.text))) seen.push(`old name's page showed: ${snap.title} ${/\$140/.test(snap.text) ? `($140 near "${snap.around}")` : ''}`);
        if (snap.title === L.LONG && snap.cards > 0) seen.push('old name\'s cards still tappable after the switch');
        await sleep(100);
      }
      slow = false;
      await a.page.locator('.schedule article').first().waitFor();
      const after = await a.page.evaluate(() => ({ title: document.querySelector('header h1')?.textContent, chip: !!document.querySelector('header [data-credit-chip]'), text: document.body.innerText }));
      assert(after.title === 'Ryan' && !after.chip && !/\$140/.test(after.text), `Ryan's page: ${after.title} chip=${after.chip}`);
      none(seen, 'wrong person on screen');
      // And back: Ryan's drop button must not appear for the 29-letter name.
      await a.page.getByRole('button', { name: 'Not you?' }).click();
      await a.page.locator('.name-grid').waitFor();
      await a.page.waitForTimeout(500);
      slow = true;
      await a.page.getByRole('button', { name: new RegExp(`^${L.LONG}`) }).click();
      const ryanLeft = [];
      for (let i = 0; i < 24; i++) {
        const snap = await a.page.evaluate(() => ({ title: document.querySelector('header h1')?.textContent, cards: document.querySelectorAll('.schedule article').length }));
        if (snap.title === 'Ryan' && snap.cards > 0) ryanLeft.push('Ryan\'s cards still tappable after switching to the other name');
        await sleep(100);
      }
      slow = false;
      await a.page.locator('header [data-credit-chip]').waitFor();
      assert(/\$140/.test(await a.page.locator('header [data-credit-chip]').innerText()), 'the $140 is back for its owner');
      none(ryanLeft, 'wrong person on screen');
      await a.ctx.close();
    });
  }

  /* ---------------- game day: the blue TONIGHT strip and the Pay card ---------------- */
  await w.clock('2026-11-03T18:00:00-05:00');
  for (const l of LOOKS) {
    for (const who of ['Ryan', L.LONG]) {
      await check(`game day (Pay card, TONIGHT strip), ${tag(l)}, ${who === 'Ryan' ? 'Ryan' : '29-letter name'}: whole, nothing cut off or overlapping`, async () => {
        const a = await openPlayer(who, l.width, l.scheme, l.pct);
        assert((await a.page.locator('.pay-card').count()) > 0 && (await a.page.locator('.tonight-tag').count()) > 0, 'the Pay card and the TONIGHT strip are there');
        const probs = [...(await a.page.evaluate(audit, { allowEllipsis: ELLIPSIS_OK })), ...(await a.page.evaluate(midWordBreaks, { skipWordsLongerThan: 18 }))];
        // The word TONIGHT stays inside its blue strip.
        const tonight = await a.page.evaluate(() => [...document.querySelectorAll('.tonight-tag')].filter((t) => t.scrollWidth > t.clientWidth + 1).map(() => 'TONIGHT runs past its strip'));
        if (who === 'Ryan' && l.pct === 200) await shot(a.page, `gameday-${l.width}-${l.scheme}.png`);
        await a.ctx.close();
        none([...probs, ...tonight]);
      });
    }
  }

  /* ---------------- the organizer's screens ---------------- */
  await w.clock('2026-11-02T09:00:00-05:00');
  async function openAdmin(width, scheme, pct, extra = {}) {
    const ctx = await browser.newContext(phone(width, scheme, extra));
    await post(ctx.request, '/api/admin/login', { pin: L.PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    const all = page.getByRole('button', { name: /^Show all/ });
    if (await all.count()) await all.click();
    await page.evaluate((x) => (window.__layoutW = x), width);
    await bigText(page, pct);
    await page.waitForTimeout(450);
    return { ctx, page };
  }
  /** The first gear button of a live game. With the new admin layout only the top 2 games are open cards (and may be canceled ones), so folded rows are opened until a live card is there. */
  async function gearBtn(page) {
    const gear = page.locator('article.scard:not(.court-off) .game-menu > button');
    for (let i = 0; i < 8 && (await gear.count()) === 0; i++) {
      const row = page.locator('.hv2-short:not(:has(.hv2-pill.off))').first();
      if (!(await row.count())) break;
      await row.click();
      await page.waitForTimeout(250);
    }
    return gear.first();
  }
  const goTab = async (page, label) => {
    await page.locator('nav.tabbar').getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await page.waitForTimeout(450);
  };
  const ADMIN_ELLIPSIS = [...ELLIPSIS_OK, '.hv2-names'];
  for (const l of LOOKS) {
    for (const tab of ['Home', 'Players', 'Money', 'History', 'Settings']) {
      await check(`organizer ${tab}, ${tag(l)}: no sideways scroll, nothing cut off, overlapping or past the edge`, async () => {
        const a = await openAdmin(l.width, l.scheme, l.pct);
        if (tab !== 'Home') await goTab(a.page, tab);
        if (tab === 'Settings') {
          for (let i = 0; i < 4; i++) for (const b of await a.page.locator('button[aria-expanded="false"]').all()) await b.click().catch(() => {});
          await a.page.waitForTimeout(300);
        }
        const probs = [...(await a.page.evaluate(audit, { allowEllipsis: l.pct === 100 ? [...ADMIN_ELLIPSIS, '.hv2-count'] : ADMIN_ELLIPSIS })), ...(await a.page.evaluate(midWordBreaks, { sel: 'h1, h2, .btn, button', skipWordsLongerThan: 18 }))];
        if (l.pct === 200 && l.scheme === 'light') await shot(a.page, `admin-${tab}-${l.width}.png`);
        await a.ctx.close();
        none(probs);
      });
    }
  }

  /* ---------------- organizer pop-ups and sheets ---------------- */
  const SHEET_LOOKS = LOOKS.filter((x) => (x.pct !== 150 && x.scheme === 'light') || (x.width === 320 && x.pct === 200));
  for (const l of SHEET_LOOKS) {
    await check(`organizer gear menu, ${tag(l)}: every row whole, on screen, above the tab bar`, async () => {
      const a = await openAdmin(l.width, l.scheme, l.pct);
      const gear = (await gearBtn(a.page));
      await gear.scrollIntoViewIfNeeded();
      await gear.click();
      await a.page.locator('.menu-pop').waitFor();
      await a.page.waitForTimeout(400);
      const probs = await a.page.evaluate(audit, { scope: '.menu-pop' });
      const box = await a.page.evaluate(() => {
        const m = document.querySelector('.menu-pop').getBoundingClientRect();
        const t = document.querySelector('nav.tabbar').getBoundingClientRect();
        return { top: m.top, bottom: m.bottom, left: m.left, right: m.right, tabTop: t.top, vw: window.__layoutW, scrolls: getComputedStyle(document.querySelector('.menu-pop')).overflowY };
      });
      if (box.left < -1 || box.right > box.vw + 1) probs.push(`menu ${Math.round(box.left)}..${Math.round(box.right)} not inside ${box.vw}`);
      if (box.bottom > box.tabTop + 1 && box.top < box.tabTop) probs.push(`menu runs under the tab bar (${Math.round(box.bottom)} > ${Math.round(box.tabTop)})`);
      await shot(a.page, `gear-${l.width}-${l.pct}.png`);
      await a.ctx.close();
      none(probs);
    });
    for (const [rowName, what] of [['Edit game', 'Edit game sheet'], ['Players', 'Players sheet'], ['Cancel session', 'Cancel question']]) {
      await check(`organizer ${what}, ${tag(l)}: whole, nothing cut off or overlapping, scrolls to its last button`, async () => {
        const a = await openAdmin(l.width, l.scheme, l.pct);
        const gear = (await gearBtn(a.page));
        await gear.scrollIntoViewIfNeeded();
        await gear.click();
        await a.page.locator('.menu-pop').getByRole('menuitem', { name: new RegExp(`^${rowName}`) }).first().click();
        await a.page.locator('dialog[open]').waitFor();
        await a.page.waitForTimeout(500);
        const probs = [...(await a.page.evaluate(audit, { scope: 'dialog[open]', allowEllipsis: ELLIPSIS_OK })), ...(await a.page.evaluate(sheetReach)), ...(await a.page.evaluate(midWordBreaks, { sel: 'dialog[open] h2, dialog[open] button, dialog[open] label, dialog[open] p', skipWordsLongerThan: 18 }))];
        await shot(a.page, `sheet-${rowName.replace(/ /g, '-')}-${l.width}-${l.pct}.png`);
        await a.ctx.close();
        none(probs);
      });
    }
  }

  /* ---------------- 6: short screens (landscape) and the keyboard ---------------- */
  const SHORT = [
    { width: 320, height: 260, name: '320x260 (small, very short)' },
    { width: 568, height: 320, name: '568x320 (iPhone SE on its side)' },
  ];
  for (const sc of SHORT) {
    for (const pct of [100, 200]) {
      await check(`short screen ${sc.name}, text ${pct}%: sheets and dialogs fit, scroll to their last button, nothing sideways`, async () => {
        const bad = [];
        const ctxOpts = { width: sc.width, scheme: 'light', pct, extra: { viewport: { width: sc.width, height: sc.height } } };
        // Player: credit sheet and the Drop out question.
        let a = await openPlayer(L.LONG, ctxOpts.width, 'light', pct, ctxOpts.extra);
        await a.page.locator('[data-credit-chip]').click();
        await a.page.locator('dialog[open]').waitFor();
        await a.page.waitForTimeout(450);
        bad.push(...(await a.page.evaluate(sheetReach)).map((x) => `credit sheet: ${x}`));
        await a.ctx.close();
        a = await openPlayer('Ryan', ctxOpts.width, 'light', pct, ctxOpts.extra);
        await a.page.locator('article.sched', { hasText: 'Court booked' }).first().getByRole('button', { name: /Drop out/ }).first().click();
        await a.page.locator('dialog[open]').waitFor();
        await a.page.waitForTimeout(450);
        bad.push(...(await a.page.evaluate(sheetReach)).map((x) => `Drop out: ${x}`));
        await a.ctx.close();
        // Organizer: Edit game and Players sheets.
        for (const rowName of ['Edit game', 'Players']) {
          const o = await openAdmin(ctxOpts.width, 'light', pct, ctxOpts.extra);
          const gear = (await gearBtn(o.page));
          await gear.scrollIntoViewIfNeeded();
          await gear.click();
          await o.page.locator('.menu-pop').getByRole('menuitem', { name: new RegExp(`^${rowName}`) }).first().click();
          await o.page.locator('dialog[open]').waitFor();
          await o.page.waitForTimeout(450);
          bad.push(...(await o.page.evaluate(sheetReach)).map((x) => `${rowName}: ${x}`));
          const sideways = await o.page.evaluate(() => document.documentElement.scrollWidth > (window.__layoutW || innerWidth) + 1);
          if (sideways) bad.push(`${rowName}: page scrolls sideways`);
          await o.ctx.close();
        }
        none(bad);
      });
    }
  }

  // A fake on-screen keyboard (an iPhone does not shrink the page; its visual viewport shrinks): 300 px tall.
  const fakeKeyboard = () => {
    const fake = {
      height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1, _l: {},
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
      removeEventListener() {},
    };
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    window.__keyboard = (px) => {
      fake.height = innerHeight - px;
      (fake._l.resize || []).forEach((f) => f());
    };
  };
  for (const l of [{ width: 390, height: 700 }, { width: 320, height: 568 }]) {
    for (const pct of [100, 200]) {
      await check(`keyboard open (300 px), ${l.width}x${l.height}, text ${pct}%: the Edit game sheet sits above the keyboard and its Save button can be reached`, async () => {
        const ctx = await browser.newContext({ ...phone(l.width, 'light'), viewport: { width: l.width, height: l.height } });
        await ctx.addInitScript(fakeKeyboard);
        await post(ctx.request, '/api/admin/login', { pin: L.PIN });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/admin`);
        await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
        await page.evaluate((x) => (window.__layoutW = x), l.width);
        await bigText(page, pct);
        const gear = await gearBtn(page);
        await gear.scrollIntoViewIfNeeded();
        await gear.click();
        await page.locator('.menu-pop').getByRole('menuitem', { name: /^Edit game/ }).first().click();
        await page.locator('dialog[open]').waitFor();
        await page.waitForTimeout(450);
        const field = page.locator('dialog[open] input, dialog[open] textarea').last();
        await field.focus();
        await page.evaluate(() => window.__keyboard(300));
        await page.waitForTimeout(450);
        const r = await page.evaluate(() => {
          const d = document.querySelector('dialog[open]');
          const dr = d.getBoundingClientRect();
          const visibleBottom = innerHeight - 300;
          const out = [];
          if (dr.bottom > visibleBottom + 1) out.push(`sheet bottom ${Math.round(dr.bottom)} is under the keyboard (visible area ends at ${visibleBottom})`);
          if (dr.top < -1) out.push(`sheet top ${Math.round(dr.top)} is above the screen`);
          for (const s of [d, ...d.querySelectorAll('*')]) if (getComputedStyle(s).overflowY === 'auto' && s.scrollHeight > s.clientHeight) s.scrollTop = s.scrollHeight;
          const save = [...d.querySelectorAll('button')].filter((b) => /^Save/.test(b.textContent.trim()))[0];
          if (!save) out.push('no Save button found');
          else {
            const q = save.getBoundingClientRect();
            if (q.bottom > visibleBottom + 1 || q.top < dr.top - 1) out.push(`Save at ${Math.round(q.top)}..${Math.round(q.bottom)}, visible area ends at ${visibleBottom}`);
          }
          return out;
        });
        // Keyboard closed again: the sheet is back where it was.
        await page.evaluate(() => window.__keyboard(0));
        await page.waitForTimeout(300);
        const back = await page.evaluate(() => document.documentElement.dataset.kb === undefined);
        await ctx.close();
        none(r);
        assert(back, 'the sheet kept the keyboard gap after the keyboard closed');
      });
    }
  }

  /* ---------------- the switch for the Pay note: OFF at ship, a private link, Settings for everyone ---------------- */
  await check('Pay note switch: off at ship (no app, still no note); ?paynote=on shows it on that phone only; ?paynote=off ends it; Settings turns it on for everyone and off again', async () => {
    await w.clock('2026-11-02T09:00:00-05:00');
    const note = (page) => page.locator('.pop', { hasText: 'No Venmo?' });
    const tap = async (page) => {
      await page.locator(`#row-${S[1]} a.pay-btn`).first().click();
      await page.waitForTimeout(2900);
      return note(page).count();
    };
    // OFF: the Pay link works as always and no note ever shows.
    let a = await openPlayer('Ryan', 390, 'light', 100);
    assert((await tap(a.page)) === 0, 'the note showed with the switch off');
    await a.ctx.close();
    // The private link: that phone only.
    a = await openPlayer('Ryan', 390, 'light', 100, {}, '/?paynote=on');
    assert((await tap(a.page)) === 1, 'the private link should show the note');
    const other = await openPlayer('Wren', 390, 'light', 100);
    assert(!(await other.page.evaluate(() => localStorage.getItem('pb_pay_note'))), 'another phone is not switched on');
    await other.ctx.close();
    await a.page.goto(BASE + '/?paynote=off');
    await a.page.locator('.schedule article').first().waitFor();
    assert((await tap(a.page)) === 0, '?paynote=off should end the private test');
    await a.ctx.close();
    // Settings > Feature switches: for everyone, no deploy.
    await w.ok(await w.put(w.areq, '/api/admin/pay-note', { on: true }), 'pay note on');
    a = await openPlayer('Ryan', 390, 'light', 100);
    assert((await tap(a.page)) === 1, 'Settings on should show the note for everyone');
    await a.ctx.close();
    await w.ok(await w.put(w.areq, '/api/admin/pay-note', { on: false }), 'pay note off');
    a = await openPlayer('Ryan', 390, 'light', 100);
    assert((await tap(a.page)) === 0, 'Settings off again: no note');
    await a.ctx.close();
  });

  /* ---------------- the row in Settings > Feature switches (collapsed section) ---------------- */
  await check('Settings > Feature switches (collapsed) holds the "No Venmo? note" switch, off at ship; flipping it saves and shows in the section note', async () => {
    const o = await openAdmin(390, 'light', 100);
    await o.page.locator('nav.tabbar').getByRole('button', { name: /^Settings/ }).click();
    const sect = o.page.locator('details.set-sect', { hasText: 'Feature switches' });
    await sect.waitFor();
    assert((await sect.evaluate((d) => d.open)) === false, 'Feature switches starts collapsed');
    await sect.locator('summary').click();
    const sw = sect.locator('[data-pay-note-all]');
    assert(!(await sw.isChecked()), 'off at ship');
    await sw.click();
    await sect.locator('[data-row="payNoteAll"] .save-mark.saved').waitFor();
    assert((await w.dash()).payNoteForAll === true, 'saved on the server');
    await sw.click();
    await o.page.waitForTimeout(600);
    assert((await w.dash()).payNoteForAll === false, 'switched off again');
    await o.ctx.close();
  });

  /* ---------------- 8: Pay button fallback ("No Venmo? Pay Alex directly") ---------------- */
  for (const where of ['card', 'Pay card']) {
    await check(`Pay fallback (${where}): no app = the note shows once, then fades; app opened = never shows; Pay link unchanged`, async () => {
      const day = where === 'Pay card' ? '2026-11-03T18:00:00-05:00' : '2026-11-02T09:00:00-05:00';
      await w.clock(day);
      const payLink = (page) => (where === 'Pay card' ? page.locator('.pay-card a.btn').first() : page.locator(`#row-${S[1]} a.pay-btn`).first());
      const note = (page) => page.locator('.pop', { hasText: 'No Venmo?' });
      // 1. No Venmo app: the page stays in view.
      let a = await openPlayer('Ryan', 390, 'light', 100, {}, '/?paynote=on');
      const link = payLink(a.page);
      await link.waitFor();
      const href = await link.getAttribute('href');
      const appHref = await link.getAttribute('data-app-href');
      assert(/^https:\/\/venmo\.com\/\?txn=pay&recipients=organizer&amount=14/.test(href) && /note=Pickleball/.test(href) && /^venmo:\/\/paycharge\?/.test(appHref), `link: ${href} ${appHref}`);
      await link.click();
      await a.page.waitForTimeout(900);
      assert((await note(a.page).count()) === 0, 'nothing before about 2 seconds');
      await note(a.page).waitFor({ timeout: 2500 });
      assert((await note(a.page).innerText()).trim() === 'No Venmo? Pay Alex directly', `text: ${await note(a.page).innerText()}`);
      assert((await a.page.locator('.pop').count()) === 1, 'one note only');
      // 6 seconds later it has gone (about 6 s on screen, plus the fade).
      await a.page.waitForTimeout(5200);
      assert((await note(a.page).count()) === 1, 'still on screen at about 5 seconds');
      await note(a.page).waitFor({ state: 'detached', timeout: 3000 });
      assert((await link.getAttribute('href')) === href, 'the Pay link is the same after the note');
      // Tapping the note closes it early.
      await link.click();
      await note(a.page).waitFor({ timeout: 4000 });
      await note(a.page).click();
      await note(a.page).waitFor({ state: 'detached', timeout: 2000 });
      await a.ctx.close();
      // 2. The app opens: the page goes hidden within the wait. Nothing shows, even after coming back.
      a = await openPlayer('Ryan', 390, 'light', 100, {}, '/?paynote=on');
      await payLink(a.page).click();
      await a.page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await a.page.waitForTimeout(2800);
      await a.page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await a.page.waitForTimeout(1500);
      assert((await note(a.page).count()) === 0, 'the app opened, yet a note showed');
      await a.ctx.close();
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
