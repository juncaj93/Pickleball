import { ADMIN_COOKIE, type Ctx } from './context';
import { actingOthersAllowed, PHONE_TAG_COOKIE, PHONE_TAG_HEADER, validPhoneTag } from '../shared/actingForOthers';

// Zip 30, "Acting for others" (shared/actingForOthers.ts): the phone code a player's own tap carries, read from the request alone.
// No database read here, ever: the code only rides along inside the History line the tap already writes (repo.ts audit()).
// No code (null) when:
//  - the wrangler.toml kill switch ACTING_FOR_OTHERS is "off" (nothing is recorded at all),
//  - the request comes from a phone signed in as the organizer (the organizer cookie is sent with every /api request from that phone,
//    so Alex's own taps on his admin phone, including the player screen there, are never recorded or flagged),
//  - it is the View as / demo copy (SANDBOX: nothing there is real, and the live server refuses View as taps anyway),
//  - the phone sent nothing, or something that is not a phone code.
// Recording does NOT wait for the Settings row: the switch only decides what the organizer screens show. So once migration 0018 is in,
// codes are written quietly with the switch off too, and a phone already has its usual name the day the switch goes on.

export function phoneTagOf(ctx: Ctx): string | null {
  if (ctx.env.SANDBOX) return null;
  if (!actingOthersAllowed(ctx.env.ACTING_FOR_OTHERS)) return null;
  if (ctx.cookies[ADMIN_COOKIE]) return null;
  const header = ctx.req.headers.get(PHONE_TAG_HEADER);
  if (validPhoneTag(header)) return header;
  const cookie = ctx.cookies[PHONE_TAG_COOKIE];
  return validPhoneTag(cookie) ? cookie : null;
}
