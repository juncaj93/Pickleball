import { shortGameHeadsUpParts, shortGameTag, viewPrice } from '../../../shared/gameLength';
import type { AdminSessionView } from '../../../shared/api';
import type { AdminCtx } from '../Admin';

// Zip 9, "Short games" (SHORT_GAMES). Organizer screens only. Nothing here shows unless the server said the switch is on for this
// screen (`ctx.d.shortGames`), and the tag only on a game the server priced from its own row (`s.shortGame`).

export { boxMinutes } from '../../../shared/gameLength';

/**
 * The heads-up right under the Start and End boxes on Add game and Edit game: "1.5 hour game. Court $36. Players pay $11 each (4 in),
 * less if more join." It shows only while the times make a length with its own row (today: exactly 90 minutes) and goes away as soon as
 * they change. Nothing for a normal 2 hour game or any other length.
 */
export function ShortGameHeadsUp({ ctx, minutes }: { ctx: AdminCtx; minutes: number | null }) {
  if (ctx.d.shortGames !== true || minutes === null) return null;
  const parts = shortGameHeadsUpParts(minutes, ctx.d.longGames === true);
  if (!parts) return null;
  return (
    <div className="z9-headsup" role="status" data-short-headsup>
      <svg className="z9-headsup-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 10.6v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="7.4" r="1.3" fill="currentColor" />
      </svg>
      <div>
        <strong className="z9-headsup-title">{parts.title}</strong>
        <span className="z9-headsup-body">{parts.body}</span>
      </div>
    </div>
  );
}

/** The small "1.5 HR" pill under the time on an organizer game tile; its full words ("1.5 hr game · $11 each") are read out. */
export function ShortGameTilePill({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  if ((ctx.d.shortGames !== true && ctx.d.longGames !== true) || !s.shortGame) return null;
  const p = viewPrice(s, ctx.d.group.settings);
  const words = shortGameTag(p);
  if (!words || !p.row) return null;
  return (
    <span className="z9-len-pill" data-short-tag title={words}>
      <span aria-hidden="true">{p.row.short.toUpperCase()}</span>
      <span className="sr-only">{words}</span>
    </span>
  );
}

/** "1.5 hr game · $11 each" as a line (the folded Home row), or null for a normal game. */
export function shortGameLine(ctx: AdminCtx, s: AdminSessionView): string | null {
  if ((ctx.d.shortGames !== true && ctx.d.longGames !== true) || !s.shortGame) return null;
  return shortGameTag(viewPrice(s, ctx.d.group.settings));
}
