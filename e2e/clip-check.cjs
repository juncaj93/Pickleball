/* Zip 18 round 2: a page check that fails when any text, tile or button is cut off, overlaps, or sticks out of its box.
 *
 *   const { findClipping } = require('./clip-check.cjs');
 *   const problems = await page.evaluate(findClipping, { root: 'main' });
 *
 * What counts as a problem (each one a short line naming the element and the numbers):
 *  - text outside its box: a piece of text (each line of it) that reaches outside the nearest box drawn around it (a button, a link
 *    drawn as a button, a pill, a tile, or anything with a border or a background of its own);
 *  - a box cut off: a button, pill or tile that reaches outside an ancestor that hides what overflows (so part of it is not drawn);
 *  - text cut off: an element that hides its overflow and holds more than it shows, unless it ends in "..." on purpose
 *    (text-overflow: ellipsis or a line clamp: the long names);
 *  - overlap: two buttons, pills or tiles in the same row drawn on top of each other.
 * Hidden things (display none, zero size, visibility hidden, the sr-only text) and the bottom tab bar's own fixed layer are skipped.
 */
function findClipping(opts) {
  const root = document.querySelector((opts && opts.root) || 'body') || document.body;
  const slack = 1.5;
  const out = [];
  const label = (el) => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${el.id ? '#' + el.id.slice(0, 16) : ''} «${t}»`;
  };
  const shown = (el) => {
    if (!el.isConnected) return false;
    if (el.closest('.sr-only, [aria-hidden="true"] .sr-only')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  /** A box of its own: something drawn with an edge the text has to stay inside. */
  const isBox = (el) => {
    if (el.matches('button, a.btn, a.ac-btn, .ac-btn, .btn, .pill, .chip, .pchip, .tile, .ptile, .today, .date-tile, .gd-btn, .r2-book, [class*="pill"], [class*="tile"]')) return true;
    const cs = getComputedStyle(el);
    const border = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none');
    return border || !transparent(cs.backgroundColor);
  };
  const hidesOverflow = (cs) => /hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflowY);
  const onPurpose = (el) => {
    const cs = getComputedStyle(el);
    return cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || el.closest('[data-clip-ok]');
  };
  const inside = (a, b) => a.left >= b.left - slack && a.right <= b.right + slack && a.top >= b.top - slack && a.bottom <= b.bottom + slack;
  const fmt = (r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  const skip = (el) => el.closest('.tabbar, .sr-only, svg, [data-clip-skip]');

  // 1 and 3: text outside its box, text cut off.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || skip(el) || !shown(el)) continue;
    // The nearest box around this text.
    let box = el;
    while (box && box !== root && !isBox(box)) box = box.parentElement;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    // Text inside an element that ends in "..." on purpose may run past its own box by design (the ellipsis box clips it).
    let ellipsis = null;
    for (let a = el; a && a !== root; a = a.parentElement) {
      if (onPurpose(a) && hidesOverflow(getComputedStyle(a))) {
        ellipsis = a;
        break;
      }
    }
    // A single word split over two lines ("Vic" as V / i / c, "Game / s"): broken in the middle.
    const words = n.textContent.trim().split(/\s+/);
    // (A web address, like the private player link, wraps on purpose: skipped.)
    if (rects.length > 1 && words.length === 1 && words[0].length > 1 && !/[/:@.]/.test(words[0])) {
      const lines = new Set(rects.map((r) => Math.round(r.top)));
      if (lines.size > 1) out.push(`word broken: "${words[0].slice(0, 30)}" over ${lines.size} lines in ${label(el)}`);
    }
    if (box && box !== root) {
      const b = box.getBoundingClientRect();
      for (const r of rects) {
        // Clipped on purpose by an ellipsis box: only the part that box shows counts.
        const e = ellipsis ? ellipsis.getBoundingClientRect() : null;
        const vis = e ? { left: Math.max(r.left, e.left), right: Math.min(r.right, e.right), top: Math.max(r.top, e.top), bottom: Math.min(r.bottom, e.bottom) } : r;
        if (vis.right - vis.left <= 0.5 || vis.bottom - vis.top <= 0.5) continue;
        if (!inside(vis, b)) {
          const key = `out|${label(box)}|${n.textContent.trim().slice(0, 20)}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push(`text outside its box: "${n.textContent.trim().slice(0, 30)}" at ${fmt(vis)} outside ${label(box)} at ${fmt(b)}`);
          }
          break;
        }
      }
    }
  }
  // 2 and 3: boxes cut off by a parent that hides overflow; elements that hide more text than they show.
  const all = [...root.querySelectorAll('*')].filter((el) => !skip(el) && shown(el));
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (hidesOverflow(cs) && !onPurpose(el) && (el.textContent || '').trim()) {
      const overW = el.scrollWidth - el.clientWidth > slack && /hidden|clip/.test(cs.overflowX);
      const overH = el.scrollHeight - el.clientHeight > slack && /hidden|clip/.test(cs.overflowY);
      // A box whose own text is short enough is fine even if a decoration (a glow) reaches out.
      if ((overW || overH) && !el.matches('main, .page, body, html, dialog, .sheet, .sheet-body, [class*="scroll"], details')) {
        const kids = [...el.querySelectorAll('*')].filter((k) => shown(k) && (k.textContent || '').trim());
        const er = el.getBoundingClientRect();
        const cut = kids.find((k) => {
          const kr = k.getBoundingClientRect();
          if (inside(kr, er) || k.closest('[data-clip-ok]')) return false;
          // Inside a line that ends in "..." on purpose (its own or a parent's, up to this box): by design.
          for (let a = k; a && a !== el; a = a.parentElement) if (onPurpose(a)) return false;
          return true;
        });
        if (cut) out.push(`cut off: ${label(cut)} at ${fmt(cut.getBoundingClientRect())} inside ${label(el)} at ${fmt(er)} (hides ${overW ? 'width' : 'height'})`);
      }
    }
    if (el.matches('button, a.ac-btn, .ac-btn, .btn, .pill, .pchip, .tile, .ptile, .today, [class*="tile"], [class*="pill"]')) {
      const r = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (!hidesOverflow(acs) || a.matches('html, body, main, .page, dialog, .sheet, .sheet-body, [class*="scroll"]')) continue;
        const ar = a.getBoundingClientRect();
        if (!inside(r, ar)) {
          out.push(`box cut off: ${label(el)} at ${fmt(r)} by ${label(a)} at ${fmt(ar)}`);
          break;
        }
      }
    }
  }
  // 2a: every circle (a player's ball or an empty seat) is fully drawn: inside each ancestor that hides overflow, up to its card.
  for (const ball of root.querySelectorAll('.dots > *')) {
    const r = ball.getBoundingClientRect();
    if (r.width === 0 || ball.closest('.sr-only, .tabbar')) continue;
    const card = ball.closest('.card, .ac, .hv2-short, .scard') || root;
    for (let a = ball.parentElement; a && a !== card.parentElement; a = a.parentElement) {
      if (!hidesOverflow(getComputedStyle(a)) && a !== card) continue;
      const ar = a.getBoundingClientRect();
      if (!inside(r, ar)) {
        out.push(`circle cut off: in ${label(ball.closest('.dots'))} at ${fmt(r)} by ${label(a)} at ${fmt(ar)}`);
        break;
      }
    }
  }
  // 2b: a button, pill, tile or the circles must sit inside the INNER edge (inside the border) of the card it is in, cut or not: a tile whose
  // bottom edge lands on the card's own border reads as cut off (the folded Home row's TOM tile, Nov 8).
  const innerOf = (a) => {
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    return { left: r.left + parseFloat(cs.borderLeftWidth), right: r.right - parseFloat(cs.borderRightWidth), top: r.top + parseFloat(cs.borderTopWidth), bottom: r.bottom - parseFloat(cs.borderBottomWidth) };
  };
  for (const el of all) {
    if (!el.matches('.tile, .ptile, .r2m-tile, .cl-balls .dots, .pill, .hv2-pill, .ac-btn, .gd-btn')) continue;
    const card = el.parentElement && el.parentElement.closest('.card, .ac, .hv2-short, .scard');
    if (!card) continue;
    const r = el.getBoundingClientRect();
    const c = innerOf(card);
    if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5)
      out.push(`outside its card: ${label(el)} at ${fmt(r)} in ${label(card)} (inner ${Math.round(c.left)},${Math.round(c.top)} to ${Math.round(c.right)},${Math.round(c.bottom)})`);
  }
  // 4: buttons, pills and tiles drawn on top of each other (siblings in one row).
  const things = all.filter((el) => el.matches('button, a.ac-btn, .ac-btn, .pill, .pchip, [class*="chip"], .tile, .ptile, [class*="pill"], .cl-balls .dots, .pr-name') && !el.closest('.hv2-a11y, .sr-only'));
  for (let i = 0; i < things.length; i++)
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i];
      const b = things[j];
      if (a.contains(b) || b.contains(a)) continue;
      // Same row of controls, or the same card (the circles next to the time and the court pill sit in different columns of one row).
      const cardA = a.closest('.card, .ac, .hv2-short, .scard');
      if (a.parentElement !== b.parentElement && !(cardA && cardA === b.closest('.card, .ac, .hv2-short, .scard'))) continue;
      const x = a.getBoundingClientRect();
      const y = b.getBoundingClientRect();
      const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
      const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
      if (w > 2 && h > 2) out.push(`overlap: ${label(a)} at ${fmt(x)} and ${label(b)} at ${fmt(y)}`);
    }
  // 5: the page never scrolls sideways (something wider than the screen).
  const sw = document.documentElement.scrollWidth;
  if (sw > window.innerWidth + 1) {
    const wide = all.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).slice(-1)[0];
    out.push(`page wider than the screen: ${sw} > ${window.innerWidth}${wide ? ` (${label(wide)} at ${fmt(wide.getBoundingClientRect())})` : ''}`);
  }
  return out;
}

module.exports = { findClipping };
