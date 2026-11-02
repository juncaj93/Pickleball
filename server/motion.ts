import type { Ctx } from './context';
import { MOTION_HEADER, motionOnForAll } from '../shared/motion';

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
