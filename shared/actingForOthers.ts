// Zip 30 (Nov 2026): ACTING_FOR_OTHERS ("Acting for others"), ships OFF. Organizer only, look only.
//  - Each phone keeps a random code (made on the phone, stored in its browser with a cookie as a backup; src/phoneTag.ts). A player's own
//    tap sends it and the site writes it into the History line that tap already makes (admin_audit_log.device_tag, migration 0018). Player
//    screens never read it, and the tap does no extra read for it (server/phoneTag.ts).
//  - Organizer screens work out, from those lines alone, which name each phone usually acts as, and point out a tap made for someone else:
//    a line in History ("Brandon said I'm in for Tue, Nov 10 (from Mitchel's phone)") and the "Acting for others" card at the top of Home.
//  - Nothing is blocked, asked or sent. No Telegram, no push, players never see any of it.
//  - A wrangler.toml kill switch (allowed unless "off"; "off" also stops the recording), a Settings > Feature switches row (one task_log row),
//    and a private per-phone link (/admin?actingothers=on).

export const ACTING_OTHERS = { task: 'acting_others_on', header: 'X-Acting-Others', link: 'actingothers', env: 'ACTING_FOR_OTHERS', name: 'Acting for others' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who sees it is Settings' call. */
export function actingOthersAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** The header and cookie a phone sends its code in (the cookie is the backup when the browser's storage was cleared). */
export const PHONE_TAG_HEADER = 'X-Phone-Tag';
export const PHONE_TAG_COOKIE = 'pb_phone';

/** A phone code: 16 to 40 letters, digits, - or _ (the phone makes 22). Anything else is ignored (no code). */
export function validPhoneTag(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{16,40}$/.test(raw);
}

/** The rule's numbers: a phone needs this many earlier taps before it has a usual name, and more than half of them as one name. */
export const LEARN_AFTER = 3;
/** How far back the organizer screens look at phone codes (the History lines older than this never get a "from" note). */
export const LOOKBACK_DAYS = 180;
/** How long a tap stays on the Home card (History keeps it). */
export const CARD_DAYS = 7;

/** One History line with a phone code, as the server reads it (oldest first). */
export interface TaggedLine {
  id: string;
  tag: string;
  /** The name the phone acted as (the line's actor). */
  name: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Where a flagged tap came from: a phone whose usual name is `name`, or a phone too new to have one. */
export type From = { kind: 'phone'; name: string } | { kind: 'new' };

const SEAT_ACTIONS = /^player_(join|withdraw|still_in|check_in|decline|claim|self_paid|self_unpaid)$/;
const MONEY_ACTIONS = new Set(['credit_used', 'credit_undone', 'cash_out_used', 'refund_requested', 'refund_request_canceled']);

/**
 * Is this line a player's own tap (the kind that teaches a phone its name and can be flagged)? The automatic credit use on I'm in is part
 * of the I'm in itself, and the organizer's own I'm in from Home is the organizer's.
 */
export function isPlayerTap(line: Pick<TaggedLine, 'action' | 'details'>): boolean {
  if (line.details.organizer === true || line.details.auto === true) return false;
  return SEAT_ACTIONS.test(line.action) || MONEY_ACTIONS.has(line.action);
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * THE RULE, applied to every phone's taps in time order (each tap is judged on the taps before it, so a later tap never changes an
 * earlier verdict):
 *  - A phone's usual name is the name it acted as most, once it has made at least 3 taps and more than half of them were as that name.
 *  - A tap is "for someone else" when (a) the phone has a usual name and acts as a different name ("from Mitchel's phone"), or (b) the
 *    phone is still too new to have one (1 or 2 taps so far) and acts as a name it has never acted as ("from a new phone").
 *  - Never flagged: a phone's very first tap; a tap from a phone that has a tie between names (two people sharing it equally); a tap
 *    from a phone that Alex's own player name has used (`exempt`).
 * Taps without a code (the organizer's phone, View as, old app versions) are not in `lines` at all.
 * Returns the flagged lines by id.
 */
export function judgeTaps(lines: TaggedLine[], exempt: (name: string) => boolean = () => false): Map<string, From> {
  const out = new Map<string, From>();
  const phones = new Map<string, { counts: Map<string, { name: string; n: number }>; total: number; alex: boolean }>();
  for (const line of lines) {
    if (!isPlayerTap(line)) continue;
    let p = phones.get(line.tag);
    if (!p) phones.set(line.tag, (p = { counts: new Map(), total: 0, alex: false }));
    const me = key(line.name);
    if (!p.alex && p.total > 0) {
      const usual = usualName(p.counts, p.total);
      if (usual) {
        if (key(usual) !== me) out.set(line.id, { kind: 'phone', name: usual });
      } else if (p.total < LEARN_AFTER && !p.counts.has(me)) {
        out.set(line.id, { kind: 'new' });
      }
    }
    const c = p.counts.get(me);
    if (c) c.n += 1;
    else p.counts.set(me, { name: line.name, n: 1 });
    p.total += 1;
    if (exempt(line.name)) p.alex = true;
  }
  return out;
}

function usualName(counts: Map<string, { name: string; n: number }>, total: number): string | null {
  if (total < LEARN_AFTER) return null;
  let top: { name: string; n: number } | null = null;
  for (const c of counts.values()) if (!top || c.n > top.n) top = c;
  return top && top.n * 2 > total ? top.name : null;
}

/** The note History adds to a flagged line: "from Mitchel's phone" or "from a new phone". */
export function fromNote(f: From): string {
  return f.kind === 'phone' ? `from ${f.name}'s phone` : 'from a new phone';
}

/** The verb on the Home card: "Mitchel signed up for Brandon", "A new phone marked paid for Nathan". */
export function cardVerb(action: string): string {
  switch (action.replace(/^player_/, '')) {
    case 'join':
      return 'signed up';
    case 'withdraw':
      return 'backed out';
    case 'still_in':
      return 'said still in';
    case 'check_in':
      return 'confirmed';
    case 'decline':
      return 'said no';
    case 'claim':
      return 'took the open spot';
    case 'self_paid':
      return 'marked paid';
    case 'self_unpaid':
      return 'unmarked paid';
    case 'credit_used':
      return 'used credit';
    case 'credit_undone':
      return 'undid credit';
    case 'cash_out_used':
      return 'used cash-out credit';
    case 'refund_requested':
      return 'asked for a refund';
    case 'refund_request_canceled':
      return 'took back a refund request';
    default:
      return 'acted';
  }
}

/** One row of the Home card, as the server sends it. `by` null = a new phone. */
export interface ActingRow {
  id: string;
  at: string;
  by: string | null;
  verb: string;
  name: string;
}

/** The card's rows from the judged lines: the last 7 days, newest first. */
export function cardRows(lines: TaggedLine[], judged: Map<string, From>, nowMs: number): ActingRow[] {
  const since = nowMs - CARD_DAYS * 86_400_000;
  const rows: ActingRow[] = [];
  for (const line of lines) {
    const f = judged.get(line.id);
    if (!f || Date.parse(line.createdAt) < since) continue;
    rows.push({ id: line.id, at: line.createdAt, by: f.kind === 'phone' ? f.name : null, verb: cardVerb(line.action), name: line.name });
  }
  return rows.reverse();
}

/** The rows still to show after the X: only taps newer than the newest one dismissed on this phone. */
export function afterDismiss(rows: ActingRow[], dismissedAt: string | null): ActingRow[] {
  if (!dismissedAt) return rows;
  return rows.filter((r) => r.at > dismissedAt);
}
