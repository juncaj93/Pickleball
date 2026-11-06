/* A fixed "now" for the browser tests, so they pass on any day and at any hour.
 *
 * The dev server's clock is pinned with POST /__dev/clock (DEV_CLOCK=1, see vite.config.ts). This keeps every browser page in step with
 * it: once pin(browser) is called, each new context (browser.newContext and browser.newPage) starts with its Date shifted to the server's
 * clock, the same way e2e/zip7.cjs does it by hand. A context made after a later set() follows the new moment.
 *
 *   const clock = fixedClock(BASE);
 *   await clock.set(Date.parse('2026-11-05T12:00:00-05:00'));
 *   const browser = clock.pin(await chromium.launch());
 *   clock.now()   // the pinned "now", moving forward in real time like the server's
 */

/** Runs inside the page: Date (new Date() and Date.now()) reads the real time plus delta. */
function shiftDate(delta) {
  const Real = Date;
  class Shifted extends Real {
    constructor(...a) {
      if (a.length === 0) super(Real.now() + delta);
      else super(...a);
    }
    static now() {
      return Real.now() + delta;
    }
  }
  window.Date = Shifted;
}

function fixedClock(BASE) {
  let delta = 0;
  const clock = {
    /** Pin the server (and every browser context made from now on) to this moment. */
    async set(atMs) {
      delta = atMs - Date.now();
      const r = await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
      if (!r.ok) throw new Error(`could not pin the dev server clock (is DEV_CLOCK=1 set?): ${r.status}`);
    },
    /** The pinned "now" (it moves forward with real time, like the server's clock). */
    now: () => Date.now() + delta,
    /** Shift the Date of one context that already exists (pages it opens from now on). */
    shift: (ctx) => ctx.addInitScript(shiftDate, delta),
    /** Every context this browser makes from now on gets the shifted Date. Returns the browser. */
    pin(browser) {
      const real = browser.newContext.bind(browser);
      browser.newContext = async (...a) => {
        const ctx = await real(...a);
        await ctx.addInitScript(shiftDate, delta);
        return ctx;
      };
      return browser;
    },
  };
  return clock;
}

module.exports = { fixedClock, shiftDate };
