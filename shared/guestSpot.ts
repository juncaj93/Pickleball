// Zip 42 (Nov 2026): GUEST_SPOT ("Guest spot"), ships OFF. The organizer adds a GUEST (a plus one) to a player's sign-up.
//
// THE RULES (locked by Alex):
// 1. Only the organizer adds a guest, from the player's three-dots menu on the Players sheet ("Add a guest"), first name only.
//    One guest per player per game; the menu item is hidden once that player has one.
// 2. The guest takes a real spot like a player: it counts toward the 4 to 10 and the max. A full game puts the guest on the
//    waitlist behind the host, the way a new player would be, and the guest moves in on a drop like anyone.
// 3. The host owes $28 for both: the guest's $14 sits on the host's own seat (no account, no credit for the guest). The final
//    price uses the real head count (host + guest both count). Credit back, refunds and late fees all land on the host.
// 4. Everywhere a list of players shows, the pair reads "Rowan + Sam (guest)", two ball circles. A game with no guest looks
//    exactly like today.
// 5. The host sees "Remove guest" on their own card. A host who already paid $28 and removes the guest gets $14 as credit.
// 6. The host dropping out takes the guest too (the confirm says so; "you still owe $28" only inside the 12 hours).
// 7. The organizer removing the host removes the guest too.
// 8. One alert for a pair ("... (and guest Sam)"); the organizer gets an alert when the host removes the guest. Nothing ever
//    tries to reach a guest (no phone).
// 9. The switch: wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row) and a
//    private per-phone link (/admin?guestspot=on). With it off nobody can add a guest and the site is exactly main.
//
// WHERE A GUEST LIVES (migration 0021): four columns on the HOST's own session_players row (guest_name, guest_status,
// guest_seq, guest_at). So the guest's money is the host's seat money: every payment, credit entry, refund and late fee is
// the host's by construction, and nothing in the credit ledger ever names a guest.
// A seat with a guest in counts as 2 people ("units"): it is priced at 2 x the per-person price, and every count of who is
// in adds the guests. A game with no guest has units 1 everywhere, so it reads exactly as before.

export const GUEST_SPOT = { task: 'guest_spot_on', header: 'X-Guest-Spot', link: 'guestspot', env: 'GUEST_SPOT', name: 'Guest spot' } as const;

/** The wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call (or the private link). */
export function guestSpotAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** The guest columns as they come off a session_players row (missing on a database before migration 0021). */
export interface GuestCols {
  status: string;
  guest_name?: string | null;
  guest_status?: string | null;
  played?: number | null;
  late_drop_at?: string | null;
  late_drop_done_at?: string | null;
  /** Round 2 (migration 0022): after Finalize, did the guest play (0: no; NULL: not finalized, or played with the host). */
  guest_played?: number | null;
  /** Round 2: 1 when the guest's share was marked paid before the host's. */
  guest_first?: number | null;
}

export type GuestStatus = 'confirmed' | 'waitlisted' | 'late';

/** The seat's guest holds a spot right now (the host is in and so is the guest). */
export function guestIn(r: GuestCols): boolean {
  return r.status === 'confirmed' && r.guest_status === 'confirmed' && !!r.guest_name;
}

/** The seat's guest is on the waitlist (the host is in, or waiting ahead of them). */
export function guestWaiting(r: GuestCols): boolean {
  return (r.status === 'confirmed' || r.status === 'waitlisted') && r.guest_status === 'waitlisted' && !!r.guest_name;
}

/** The seat has a guest at all (in or waiting): the organizer's "Add a guest" is hidden for it. */
export function hasGuest(r: GuestCols): boolean {
  return guestIn(r) || guestWaiting(r);
}

/**
 * The guest's share is an open late debt on the host's seat: the host dropped late with the guest in and the game was left 2 short, or
 * (round 3) the host stayed in and removed the guest late with the game left below 4. A sub or the organizer ends it.
 */
export function guestLate(r: GuestCols): boolean {
  if (r.guest_status !== 'late' || !r.guest_name) return false;
  if (r.status === 'confirmed') return true;
  return r.status === 'withdrawn' && !!r.late_drop_at && !r.late_drop_done_at;
}

/** Round 3: the host is still in, and owes their removed guest's spot until someone takes it. */
export function guestOwed(r: GuestCols): boolean {
  return r.status === 'confirmed' && guestLate(r);
}

/**
 * Round 3 (Alex): how many spots a late leave leaves the game short. `othersLeft`: everyone still in after the leave (the people waiting move
 * in at once, so they count). The game needs `min` (4, the organizer counted); a leave owes for at most the spots it takes (`spots`: 2 for a
 * host and guest, 1 for one person). A guest is an extra person: a game that still has 4 needs neither spot.
 */
export function lateShortSpots(othersLeft: number, spots: number, min = 4): number {
  return Math.max(0, Math.min(spots, min - othersLeft));
}

/**
 * How many people this seat pays for: 2 while its guest is in (or part of an open late-drop debt), else 1.
 * After Finalize the guest played exactly when the host did (the pair is marked together), so a seat that did not play owes
 * nothing for either, and a no-show late fee covers both.
 */
export function seatUnits(r: GuestCols): number {
  // Round 2 (Alex): a guest marked "did not play" at Finalize comes off: the host keeps one share.
  if (guestIn(r)) return r.guest_played === 0 ? 1 : 2;
  return guestLate(r) ? 2 : 1;
}

/** Everyone in: the confirmed seats plus their guests who are in. */
export function headCount(rows: GuestCols[]): number {
  let n = 0;
  for (const r of rows) {
    if (r.status !== 'confirmed') continue;
    n += guestIn(r) ? 2 : 1;
  }
  return n;
}

/** Guests in among these rows. */
export function guestsIn(rows: GuestCols[]): number {
  return rows.filter(guestIn).length;
}

/** "Rowan + Sam (guest)". */
export function pairName(host: string, guest: string): string {
  return `${host} + ${guest} (guest)`;
}

/** "Rowan (and guest Sam)" for alerts. */
export function alertName(host: string, guest: string | null | undefined): string {
  return guest ? `${host} (and guest ${guest})` : host;
}

export const GUEST_NAME_MAX = 20;

/**
 * The guest's first name as typed: trimmed, inner spaces collapsed, the first letter capitalized. Letters (any language),
 * spaces, hyphens, apostrophes and periods only, 1 to 20 characters. Null when it is not a usable first name.
 */
export function cleanGuestName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > GUEST_NAME_MAX) return null;
  if (!/^[\p{L}][\p{L}\p{M} '’.-]*$/u.test(s)) return null;
  return s.charAt(0).toLocaleUpperCase('en-US') + s.slice(1);
}

/** The guest of a player-screen or admin roster entry, as sent to the screens. */
export interface GuestView {
  name: string;
  status: GuestStatus;
}

export function guestViewOf(r: GuestCols): GuestView | null {
  if (!r.guest_name || !r.guest_status) return null;
  if (r.guest_status === 'confirmed' && r.status !== 'confirmed') return null;
  if (r.guest_status === 'waitlisted' && !(r.status === 'confirmed' || r.status === 'waitlisted')) return null;
  if (r.guest_status === 'late' && !guestLate(r)) return null;
  return { name: r.guest_name, status: r.guest_status as GuestStatus };
}

/**
 * The confirm a host reads before dropping out with a guest in (Alex's wording). `late`: inside the 12 hours with late fees on; `spots` is
 * how many spots the game would be left short (0 to 2) and `owesCents` what that costs if nobody takes them. Outside the window: as before.
 */
export function hostDropText(guest: string, late: { cancelBy: string; spots: number; owesCents: number } | null, fmt: (cents: number) => string): string {
  if (!late) return `Your guest ${guest} drops out too. Both spots open up for someone else.`;
  if (late.spots <= 0) return `Your guest ${guest} drops out too. Both spots open up. You don't owe anything because the game still has 4 players.`;
  if (late.spots === 1)
    return `It's past the ${late.cancelBy} cancel-by. Your guest ${guest} drops out too. If no one takes your spot, you still owe ${fmt(late.owesCents)}. Your guest's spot isn't needed.`;
  return `It's past the ${late.cancelBy} cancel-by. Your guest ${guest} drops out too. If no one takes your 2 spots, you still owe ${fmt(late.owesCents)}.`;
}

/**
 * The confirm a host reads before removing their guest (mock player_pair_3). `late`: inside the 12 hours with late fees on, and removing the
 * guest would leave the game below 4: the guest's share stays owed until someone takes the spot. Otherwise as before.
 */
export function removeGuestText(guest: string, guestShareCents: number, paid: boolean, fmt: (cents: number) => string, late: { cancelBy: string } | null = null): string {
  if (late)
    return paid
      ? `It's past the ${late.cancelBy} cancel-by and the game would drop below 4. ${guest}'s ${fmt(guestShareCents)} stays on this game unless someone takes the spot.`
      : `It's past the ${late.cancelBy} cancel-by and the game would drop below 4. If no one takes ${guest}'s spot, you still owe ${fmt(guestShareCents)}.`;
  return paid ? `${guest} comes off your tab. ${guest}'s ${fmt(guestShareCents)} goes to your credit.` : `${guest} comes off your tab. You owe ${fmt(guestShareCents)} less.`;
}

/**
 * A names line with guests (player cards, organizer cards): a guest right after its host reads "Rowan + Sam (guest)" (`guestAt`
 * marks it); a guest whose host is not next to it (the host is in, the guest still waiting) reads "Sam (Rowan's guest)". With no guest
 * the names come back exactly as given and `guestAt` is missing, so the line is drawn as before.
 */
export function guestLine(list: readonly { name: string; guestOf?: string }[]): { names: string[]; guestAt?: boolean[] } {
  if (!list.some((p) => !!p.guestOf)) return { names: list.map((p) => p.name) };
  const names: string[] = [];
  const guestAt: boolean[] = [];
  list.forEach((p, i) => {
    const prev = list[i - 1];
    const paired = !!p.guestOf && !!prev && !prev.guestOf && prev.name === p.guestOf;
    names.push(p.guestOf && !paired ? `${p.name} (${p.guestOf}'s guest)` : p.name);
    guestAt.push(paired);
  });
  return { names, guestAt };
}

/** The organizer's roster rows as a names list: each seat, its guest right after it (`status` picks who is in or who waits). */
export function rosterLine(
  roster: readonly { name: string; status: string; playerId: string; waitlistPosition?: number | null; guest?: { name: string; status: string; waitlistPosition?: number | null } }[],
  status: 'confirmed' | 'waitlisted',
  skipId?: string | null,
): { names: string[]; guestAt?: boolean[] } {
  const rows = roster.filter((r) => r.playerId !== skipId);
  if (status === 'confirmed') {
    return guestLine(rows.filter((r) => r.status === 'confirmed').flatMap((r) => [{ name: r.name }, ...(r.guest?.status === 'confirmed' ? [{ name: r.guest.name, guestOf: r.name }] : [])]));
  }
  const waiting = [
    ...rows.filter((r) => r.status === 'waitlisted').map((r) => ({ name: r.name, pos: r.waitlistPosition ?? 0 })),
    ...rows.filter((r) => r.guest?.status === 'waitlisted').map((r) => ({ name: r.guest!.name, guestOf: r.name, pos: r.guest!.waitlistPosition ?? 0 })),
  ].sort((a, b) => a.pos - b.pos);
  return guestLine(waiting.map(({ pos: _pos, ...p }) => p));
}

/** A names line as plain text: "Rowan + Sam (guest), Parker" (no guest: the names joined with ", ", exactly as before). */
export function lineText(line: { names: string[]; guestAt?: boolean[] }): string {
  return line.names.map((n, i) => (line.guestAt?.[i] ? ` + ${n} (guest)` : `${i > 0 ? ', ' : ''}${n}`)).join('');
}

/**
 * Round 2 (Alex): each person of a pair has their own paid line, while the money stays ONE record on the host's seat. `coveredCents` is
 * what the seat holds now (its payment when paid, else credit and earlier cash on it), `priceCents` the seat's whole price (two shares).
 * The covered money belongs to the host's share first, unless the guest's share was marked paid first (`guestFirst`).
 */
export function sharesPaid(
  coveredCents: number,
  priceCents: number,
  guestFirst: boolean,
): { host: boolean; guest: boolean; shareCents: number; hostOwesCents: number; guestOwesCents: number } {
  // What the seat holds is the first person's share first (up to one share), the rest is the second person's. So the two "owes" always add up
  // to exactly what the seat still owes (after a final price change, or with part credit on it, too).
  const share = Math.floor(priceCents / 2);
  const second = priceCents - share;
  const c = Math.max(0, coveredCents);
  const firstOwes = Math.max(0, share - c);
  const secondOwes = Math.max(0, second - Math.max(0, c - share));
  return guestFirst
    ? { host: secondOwes === 0, guest: firstOwes === 0, shareCents: share, hostOwesCents: secondOwes, guestOwesCents: firstOwes }
    : { host: firstOwes === 0, guest: secondOwes === 0, shareCents: share, hostOwesCents: firstOwes, guestOwesCents: secondOwes };
}

/**
 * Round 2 (Alex): the Who played sheet's notes for pairs. A host marked out takes the guest out too: "Parker didn't play, so Billy didn't
 * either." A guest marked out alone: "Billy didn't play. Parker pays for 1 share." Nothing for a pair that both played.
 */
export function whoPlayedNotes(pairs: { host: string; guest: string; hostPlayed: boolean; guestOut: boolean }[]): string[] {
  return pairs.flatMap((p) =>
    !p.hostPlayed ? [`${p.host} didn't play, so ${p.guest} didn't either.`] : p.guestOut ? [`${p.guest} didn't play. ${p.host} pays for 1 share.`] : [],
  );
}
