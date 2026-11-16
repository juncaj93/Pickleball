// Zip 51b (Alex, Mon Nov 16): MONEY_NOTE ("Money change note"), ships OFF. Player screen only.
//
// When what a player owes changes because of SOMEONE ELSE, that player sees one short amber card at the top of their screen until they tap
// "Got it". Four events, Alex's words:
//   - a sub takes your late-dropped spot, the debt is cleared       "Rowan took your spot. Your $14 is cleared."
//   - a host with a guest, a sub takes one of the 2 spots           "Rowan took one of your 2 spots. $14 is cleared, $14 still owed."
//   - the game moved to another day, the late drop is cleared       "Thu's game moved. Your late drop is cleared."   (Zip 49)
//   - the organizer puts you back In after a late drop              "You're back in. Your late drop is cleared."     (Zip 51, F-15)
// Only the person whose money changed sees it, once per event, never for something they did themselves, and only for events from the moment
// the Settings row went on (no backfill). No text, no Telegram.
//
// Stored with no schema change, all in task_log, at group level (session_id NULL, like the switches and the venue "Mark paid" rows, so a move
// to another day, which clears that game's own marks, can never bring a note back):
//   - the switch row                 task 'money_note_on'            (its `at` is the no-backfill start)
//   - "Got it"                        task 'money_note_seen:<id>'     (one per note; detail: the player's id)
//   - an organizer's back In          task 'money_note_back_in'       (detail: game and player; written only while the switch is on)
// The other three events are the History lines the site already writes ("late_fee_cleared", why 'sub' or 'moved'); the note is read from them.

import { formatPrice as dollars } from './money';

export const MONEY_NOTE = {
  task: 'money_note_on',
  name: 'Money change note',
  seenPrefix: 'money_note_seen:',
  backInTask: 'money_note_back_in',
} as const;

/** Notes older than this are not shown any more (the same 60 days the Good news line looks back). */
export const MONEY_NOTE_DAYS = 60;

export type MoneyNoteKind = 'sub' | 'sub_one' | 'moved' | 'back_in';

export interface MoneyNoteFacts {
  kind: MoneyNoteKind;
  /** Who took the spot (sub, sub_one). */
  sub?: string;
  /** What was cleared, in cents (sub, sub_one). */
  clearedCents?: number;
  /** What is still owed after it, in cents (sub_one). */
  stillCents?: number;
  /** The game's day before the move ("Thu"), for moved. */
  day?: string;
}


/** The card's one sentence, word for word. */
export function moneyNoteText(f: MoneyNoteFacts): string {
  switch (f.kind) {
    case 'sub':
      return `${f.sub || 'Someone'} took your spot. Your ${dollars(f.clearedCents ?? 0)} is cleared.`;
    case 'sub_one':
      return `${f.sub || 'Someone'} took one of your 2 spots. ${dollars(f.clearedCents ?? 0)} is cleared, ${dollars(f.stillCents ?? 0)} still owed.`;
    case 'moved':
      return `${f.day ?? 'The'}${f.day ? "'s" : ''} game moved. Your late drop is cleared.`;
    case 'back_in':
      return "You're back in. Your late drop is cleared.";
  }
}

/** The weekday a game was on, short ("Thu"), in the group's time zone. */
export function weekdayOf(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date(iso));
}

/** One "late_fee_cleared" History line, as the note reads it. */
export interface ClearedLine {
  why?: unknown;
  playerId?: unknown;
  sub?: unknown;
  guest?: unknown;
  debtCents?: unknown;
  from?: unknown;
}

/**
 * The note for one History line about THIS player, or null when it is not one of Alex's four (canceled games, the organizer's own Clear: the
 * player saw those happen through the organizer, and the Good news line already covers them). `flatCents` is the game's one-seat price.
 */
export function noteFromLine(d: ClearedLine, flatCents: number, startsAt: string, tz: string): MoneyNoteFacts | null {
  const debt = typeof d.debtCents === 'number' && d.debtCents > 0 ? d.debtCents : flatCents;
  const sub = typeof d.sub === 'string' && d.sub ? d.sub : undefined;
  if (d.why === 'sub') {
    // Zip 42: a sub took the guest's half of a pair's debt; the seat still owes the other share (the same price).
    if (typeof d.guest === 'string' && d.guest) return { kind: 'sub_one', sub, clearedCents: debt, stillCents: debt };
    return { kind: 'sub', sub, clearedCents: debt };
  }
  if (d.why === 'moved') return { kind: 'moved', day: weekdayOf(typeof d.from === 'string' && d.from ? d.from : startsAt, tz) };
  return null;
}
