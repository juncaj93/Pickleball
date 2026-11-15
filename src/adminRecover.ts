// Zip 48 (speed split): the pure parts of getting the organizer file back after a failed fetch (src/adminChunk.ts uses them). No React,
// no organizer code, so the rules are tested on their own (tests/zip48-loader.test.ts).

/**
 * A <link rel="stylesheet"> that failed has no sheet. Put a fresh copy right after it (same place, so the style order stays the same), wait
 * for it, then remove the failed one. Only built files under /assets/ are touched.
 */
export async function refetchFailedStyles(doc: Document = document): Promise<void> {
  const failed = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter(
    (l) => !l.sheet && /\/assets\/[^/]+\.css$/.test(l.getAttribute('href') ?? ''),
  );
  await Promise.all(
    failed.map(
      (old) =>
        new Promise<void>((resolve, reject) => {
          const fresh = doc.createElement('link');
          fresh.rel = 'stylesheet';
          fresh.crossOrigin = old.crossOrigin;
          fresh.href = old.getAttribute('href')!;
          fresh.addEventListener('load', () => {
            old.remove();
            resolve();
          });
          fresh.addEventListener('error', () => {
            fresh.remove();
            reject(new Error(`Unable to load ${fresh.href}`));
          });
          old.after(fresh);
        }),
    ),
  );
}

/** How long one automatic reload "counts": a second failure inside this time shows the Try again screen instead of reloading again. */
export const RELOAD_GUARD_MS = 60_000;
export const RELOAD_KEY = 'pb_admin_reload_at';

/**
 * What to do after the organizer file failed to arrive. Pure, so the rule is tested on its own (tests/zip48-loader.test.ts).
 * - The network answers (`online`): the file must be gone (an old page after a deploy), so reload, but only once a minute on its own;
 *   a tap on Try again may always reload.
 * - The network does not answer: show the Try again screen (a reload would only show the phone's own error page).
 */
export function afterLoadFailed(o: { online: boolean; userAsked: boolean; lastReloadAt: number | null; nowMs: number }): 'reload' | 'retry-screen' {
  if (!o.online) return 'retry-screen';
  if (o.userAsked) return 'reload';
  if (o.lastReloadAt !== null && o.nowMs - o.lastReloadAt >= 0 && o.nowMs - o.lastReloadAt < RELOAD_GUARD_MS) return 'retry-screen';
  return 'reload';
}

/** Does the site answer at all? A tiny no-store question to the page address (no data, nothing saved). */
export async function siteAnswers(timeoutMs = 6000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
  const t = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    const r = await fetch('/', { method: 'HEAD', cache: 'no-store', signal: ctrl?.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** The address opens the organizer screens (the same test the page router uses). */
export const isAdminPath = (path: string) => /^\/admin\/?$/.test(path);

