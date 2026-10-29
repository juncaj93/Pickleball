// What the organizer's Text menu offers for a game right now, and who each
// text goes to. No React here, so tests can use it. The site only opens
// Messages with the words ready; it never sends anything.
import type { AdminDashboard, AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import {
  canceledMessage,
  checkInMessage,
  finalMessage,
  movedMessage,
  needPlayersMessage,
  paymentMessage,
  promotedMessage,
  remindAllMessage,
  shareMessage,
  siteAddress,
} from '../../../shared/messages';

export interface TextItem {
  id: 'share' | 'need' | 'checkin' | 'promoted' | 'canceled' | 'moved' | 'final';
  /** Menu name. */
  label: string;
  body: string;
  /** Group chat (no numbers, you pick the chat) or saved numbers. */
  chat: boolean;
  /** Numbers to open a group text to (empty for a group chat). */
  phones: string[];
  /** Names with no number saved. */
  missing: string[];
  /** The small gray line: who it goes to. */
  who: string;
}

/** Numbers and missing names for some roster rows (the organizer is never texted). */
export function reach(rows: AdminRosterEntry[], meId: string | null) {
  const people = rows.filter((r) => r.playerId !== meId);
  return { phones: people.filter((r) => r.phone).map((r) => r.phone!), missing: people.filter((r) => !r.phone).map((r) => r.name), count: people.length };
}

function toNumbers(label: string, rows: AdminRosterEntry[], meId: string | null): Pick<TextItem, 'chat' | 'phones' | 'missing' | 'who'> {
  const r = reach(rows, meId);
  return { chat: false, phones: r.phones, missing: r.missing, who: `${label} · ${r.count}` };
}

const GROUP = { chat: true, phones: [] as string[], missing: [] as string[], who: 'Group chat, you pick' };

/** The Text menu for one game: only the texts that fit it right now. */
export function sessionTexts(d: AdminDashboard, s: AdminSessionView, nowMs: number): TextItem[] {
  const tz = d.group.timezone;
  const link = siteAddress(d.group.playerLink);
  const me = d.me?.id ?? null;
  const items: TextItem[] = [];
  const signed = s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted');
  // After the game: once finalized, the one post-game note for the group chat.
  if (Date.parse(s.startsAt) <= nowMs) {
    if (s.finalized && !s.state.flags.canceled) {
      items.push({ id: 'final', label: 'Final price', body: finalMessage(s, tz, s.finalized.playedCount, s.finalized.priceCents, d.group.settings.pricePerPlayerCents, link), ...GROUP });
    }
    return items;
  }

  if (s.state.flags.canceled) {
    items.push({ id: 'canceled', label: 'Canceled', body: canceledMessage(s, tz, nowMs, link), ...toNumbers('Everyone signed up and waiting', signed, me) });
    return items;
  }
  const n = s.confirmedCount;
  const confirmed = s.roster.filter((r) => r.status === 'confirmed');

  if (s.moved && s.plannedStartsAt) {
    items.push({ id: 'moved', label: 'Moved', body: movedMessage(s, s.plannedStartsAt, tz, nowMs, link), ...toNumbers('Everyone signed up and waiting', signed, me) });
  }
  items.push({ id: 'share', label: 'Share the game', body: shareMessage(s, tz, nowMs, link), ...GROUP });
  if (n < 4) items.push({ id: 'need', label: 'Need players', body: needPlayersMessage(s, tz, nowMs, 4 - n, link), ...GROUP });
  // 4 or more in: the Check-in goes to everyone signed up, the waitlist too.
  if (n >= 4) items.push({ id: 'checkin', label: 'Check-in', body: checkInMessage(s, tz, nowMs, link), ...toNumbers('Everyone signed up', signed, me), who: 'Everyone signed up' });
  // A waitlisted player who moved in after a drop (above the max, someone left).
  for (const r of confirmed.filter((x) => x.promotionReason === 'spot_opened' && x.promotedAt && !x.promotionNotifiedAt && x.playerId !== me)) {
    items.push({ id: 'promoted', label: `Spot opened: ${r.name}`, body: promotedMessage(s, tz, nowMs, link), ...toNumbers(r.name, [r], me) });
  }
  return items;
}

/** The text for the card that asks you to fill a game: whichever of Need players, Check-in, or just Share fits. */
export function fillTexts(d: AdminDashboard, s: AdminSessionView, nowMs: number): TextItem[] {
  const all = sessionTexts(d, s, nowMs);
  const lead = all.filter((i) => i.id === 'need' || i.id === 'checkin');
  return lead.length ? lead : all.filter((i) => i.id === 'share');
}

// ---------- Payment reminders ----------

/** Games a player owes for now: unpaid and confirmed, from the day-before check-in on (plus `extra`). */
export function owedGames(d: AdminDashboard, playerId: string, extra?: AdminSessionView) {
  const nowMs = Date.parse(d.now);
  const games: { s: AdminSessionView; cents: number }[] = [];
  for (const s of d.sessions) {
    if (s.state.flags.canceled) continue;
    const r = s.roster.find((x) => x.playerId === playerId);
    if (!r || r.isOrganizer || r.status !== 'confirmed' || r.paymentStatus !== 'unpaid' || r.shareCents === null || r.owesCents <= 0) continue;
    if (s.id !== extra?.id && nowMs < Date.parse(s.startsAt) - d.group.settings.checkInHours * 3600_000) continue;
    games.push({ s, cents: r.owesCents });
  }
  return games;
}

/** "Hey Ryan, you owe $14 for pickleball Tue Nov 3. Pay here: ..." (the total, if more than one game). */
export function reminderText(d: AdminDashboard, playerId: string, name: string, extra?: AdminSessionView): string {
  const games = owedGames(d, playerId, extra);
  return paymentMessage(name, games.reduce((n, g) => n + g.cents, 0), games.map((g) => g.s), d.group.timezone, siteAddress(d.group.playerLink));
}

/** Everyone who owes right now, with their number, for "Remind all unpaid". */
export function unpaidPeople(d: AdminDashboard) {
  const owing = d.players.filter((p) => owedGames(d, p.id).length > 0);
  return {
    phones: owing.filter((p) => p.phone).map((p) => p.phone!),
    missing: owing.filter((p) => !p.phone).map((p) => p.name),
    count: owing.length,
    body: remindAllMessage(siteAddress(d.group.playerLink)),
  };
}
