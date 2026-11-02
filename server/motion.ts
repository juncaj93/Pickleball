import type { Ctx } from './context';
import { MOTION_ADMIN_HEADER, MOTION_HEADER, motionAdminOnForAll, motionOnForAll } from '../shared/motion';

// Is the motion on for this request? Yes when:
//  - the MOTION var (wrangler.toml) says "on" (for everyone), or
//  - this phone opened the site once with ?motion=on (it then sends the X-Motion: on header: Alex's private test
//    switch, that phone only), or
//  - this is the organizer's in-browser demo (View as), which always shows it.
// Visual only. It changes nothing that is saved, charged or sent.
export function motionFor(ctx: Ctx): boolean {
  if (motionOnForAll(ctx.env.MOTION)) return true;
  if (ctx.env.SANDBOX) return true;
  return (ctx.req.headers.get(MOTION_HEADER) ?? '').toLowerCase() === 'on';
}

// Is the motion on for the ORGANIZER screens? The organizer side has its own switch (MOTION_ADMIN) so the player
// motion, which is already on for everyone, does not drag the organizer motion live with it. Yes when:
//  - the MOTION_ADMIN var (wrangler.toml) says "on", or
//  - this phone opened the site once with ?motionadmin=on (it then sends X-Motion-Admin: on: Alex's private test
//    switch, that phone only).
// Visual only. It changes nothing that is saved, charged or sent.
export function motionAdminFor(ctx: Ctx): boolean {
  if (motionAdminOnForAll(ctx.env.MOTION_ADMIN)) return true;
  return (ctx.req.headers.get(MOTION_ADMIN_HEADER) ?? '').toLowerCase() === 'on';
}
