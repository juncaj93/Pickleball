/* The in-page measuring code of the layout checks (e2e/layout-polish.cjs). Runs inside the browser page.
 * Every function takes plain JSON in and gives plain JSON out, so Playwright can call it with page.evaluate.
 */

/** Everything that looks wrong on the page right now: sideways scroll, things past the screen edge, text cut off,
 *  text or buttons sitting on top of each other. `scope` limits it to one part (a dialog, a card). */
function audit(opts) {
  const scopeSel = opts && opts.scope;
  const allowEllipsis = (opts && opts.allowEllipsis) || [];
  // The width the phone really has (a page that is too wide makes a phone zoom out, which would hide the problem).
  const vw = window.__layoutW || innerWidth;
  const vh = innerHeight;
  const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const cls = (e) => String((e.className && e.className.baseVal) || e.className || '').split(' ')[0];
  const name = (e) => `${e.tagName.toLowerCase()}${cls(e) ? '.' + cls(e) : ''} "${squash(e.getAttribute('aria-label') || e.textContent).slice(0, 28)}"`;
  const roots = scopeSel ? [...document.querySelectorAll(scopeSel)] : [document.body];
  const all = roots.flatMap((r) => [r, ...r.querySelectorAll('*')]);
  const vis = (e) => {
    if (e.closest('.sr-only, .cc-ghost, [hidden], .leaving')) return false;
    if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const els = all.filter((e) => !/^(path|circle|rect|line|g|defs|use|polyline|polygon|ellipse|style|script|title)$/i.test(e.tagName) && vis(e));
  const out = [];
  const push = (kind, msg) => out.push(`${kind}: ${msg}`);

  if (document.documentElement.scrollWidth > vw + 1) push('sideways-scroll', `page is ${document.documentElement.scrollWidth}px wide in ${vw}px`);

  // Past the screen edge (sideways). Things inside a box that scrolls sideways on purpose are skipped.
  for (const e of els) {
    if (e.closest('[data-allow-wide]')) continue;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      // A parent that hides what is past its edge makes this look fine (e.g. a clipped animation); only report if the element's own text is drawn.
      push('past-edge', `${name(e)} ${Math.round(r.left)}..${Math.round(r.right)} in ${vw}`);
    }
  }

  // Text cut off: a box that hides overflow and has more inside than it shows.
  for (const e of els) {
    if (e.matches('svg, svg *, img')) continue;
    const cs = getComputedStyle(e);
    const hides = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    if (!hides) continue;
    if (!squash(e.textContent)) continue;
    const wide = e.scrollWidth > e.clientWidth + 1;
    const tall = e.scrollHeight > e.clientHeight + 1;
    if (!wide && !tall) continue;
    // A box that scrolls on purpose (a sheet body, a list) is not cut off.
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && tall && !wide) continue;
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && wide) continue;
    // Deliberate "…": a name or group word that ends in an ellipsis on one line.
    if (cs.textOverflow === 'ellipsis' && allowEllipsis.some((s) => e.matches(s))) continue;
    // Deliberate: a ::before tap area or a decorative strip has no text of its own; text is checked above.
    push('cut-off', `${name(e)} (${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight})`);
  }

  // Overlaps: the drawn text of two different things, or a button and anything else, on top of each other.
  const atoms = [];
  for (const e of els) {
    if (e.matches('svg *, .tile-check, .tile-check *')) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && squash(n.textContent));
    const isCtl = e.matches('button, a[href], input, select, textarea, [role="button"]');
    if (!own && !isCtl) continue;
    let trim = !isCtl;
    // Drawn box of the text itself (not the whole box the element could grow into).
    let rects = [];
    if (own) {
      for (const n of e.childNodes) {
        if (n.nodeType !== 3 || !squash(n.textContent)) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        rects.push(...[...rg.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5));
      }
    }
    if (isCtl) {
      // A button's tap area is allowed to be bigger than what is drawn (and to touch its neighbors): compare the drawn
      // words (or the icon) instead.
      const words = [];
      const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!squash(n.textContent) || n.parentElement.closest('.sr-only')) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        words.push(...[...rg.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5));
      }
      rects = words.length ? words : [e.getBoundingClientRect()];
      trim = words.length > 0;
    }
    // Only the drawn part counts: cut to every ancestor that hides what is past its edge, and trim the empty top and
    // bottom of a text line (a line box is taller than the letters, which matters for tight date tiles).
    const clips = [];
    for (let a = isCtl ? e.parentElement : e; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clips.push(a.getBoundingClientRect());
    }
    rects = rects
      .map((q) => {
        let l = q.left;
        let r = q.right;
        let t = q.top;
        let b = q.bottom;
        if (trim) {
          const pad = (b - t) * 0.22;
          t += pad;
          b -= pad;
        }
        for (const c of clips) {
          l = Math.max(l, c.left);
          r = Math.min(r, c.right);
          t = Math.max(t, c.top);
          b = Math.min(b, c.bottom);
        }
        return { left: l, right: r, top: t, bottom: b };
      })
      .filter((q) => q.right - q.left > 0.5 && q.bottom - q.top > 0.5);
    if (!rects.length) continue;
    atoms.push({ e, rects, fixed: !!e.closest('.toast, .pop, .tabbar, [role="status"], .menu-pop, .m-ptr') });
  }
  const inter = (a, b) => {
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return x > 2 && y > 2 ? [x, y] : null;
  };
  const seen = new Set();
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const p = atoms[i];
      const q = atoms[j];
      if (p.e.contains(q.e) || q.e.contains(p.e)) continue;
      // A toast or pop-up floats over the page on purpose; it must still not cover the tab bar or itself.
      if (p.fixed !== q.fixed) continue;
      // Screen-reader-only twins and the credit chip's invisible twin are not drawn.
      let hit = null;
      for (const a of p.rects) for (const b of q.rects) hit = hit || inter(a, b);
      if (!hit) continue;
      const key = `${cls(p.e)}|${cls(q.e)}|${squash(p.e.textContent).slice(0, 12)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      push('overlap', `${name(p.e)} overlaps ${name(q.e)} (${Math.round(hit[0])}x${Math.round(hit[1])})`);
    }
  }

  // Fixed bars (toast, tab bar, sheet) must be on screen.
  for (const e of document.querySelectorAll('.tabbar, .toast, dialog[open].sheet')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) push('off-screen', `${name(e)} ${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}x${vh}`);
  }
  return out;
}

/** Text that breaks in the middle of a word ("Wre / n"). Only words short enough to fit on a line count. */
function midWordBreaks(opts) {
  const sel = (opts && opts.sel) || 'h1, .names-line, .waitlist-line, .sched-status, .pchip, .btn, .ts-title, .eyebrow, button';
  const skipLong = (opts && opts.skipWordsLongerThan) || 0; // a single word longer than this is allowed to break (no spaces in a name)
  const res = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!el.checkVisibility({ visibilityProperty: true }) || el.closest('.sr-only, .cc-ghost, [hidden]')) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest('.sr-only, .cc-ghost')) continue;
      const text = n.textContent;
      // Words (runs without space, hyphen, comma, slash or dot).
      const re = /[^\s\-,/·.]+/gu;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const word = m[0];
        if (skipLong && word.length >= skipLong) continue;
        if ([...word].length < 2) continue;
        let top = null;
        let broken = false;
        for (let i = 0; i < word.length; i++) {
          if (/[\ud800-\udfff]/.test(word[i])) continue;
          const r = document.createRange();
          r.setStart(n, m.index + i);
          r.setEnd(n, m.index + i + 1);
          const q = r.getClientRects()[0];
          if (!q) continue;
          if (top !== null && q.top > top + 3) broken = true;
          top = q.top;
        }
        if (broken) res.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} word "${word}" breaks in the middle`);
      }
    }
  }
  return [...new Set(res)];
}

module.exports = { audit, midWordBreaks };
