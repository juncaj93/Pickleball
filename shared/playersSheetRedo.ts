// Zip 32 (Nov 2026): PLAYERS_SHEET_REDO ("Players sheet redo"), ships OFF. Organizer only, look only.
//  - The "Players · Thu, Nov 12" sheet that opens from the money cell on an admin Home game card (and from the gear menu's "Players") gets
//    Alex's mock (mocks/1_players_sheet): a summary row ("1 of 3 paid · $14 each" and the purple Remind button), one slim grey notice for
//    anyone who declined, ONE card of players (name, who marked it paid, a Paid chip, or "Owes $14" with Mark paid and Request, and a
//    three-dot menu holding Remove), and an ADD SOMEONE section of tappable name chips with one green button.
//  - Every action is the one the sheet and the money card already have: Mark paid, Request (the Venmo request link), Remind (the Remind
//    sheet), Remove (the same confirmation and the same Undo), and Give spot for the Add button. No money rule changes, no database change.
//  - A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change), and a private
//    per-phone link (/admin?playerssheet=on) that sends the header below. With it off the old sheet is exactly as it was.

export const PLAYERS_SHEET_REDO = { task: 'players_sheet_redo_on', header: 'X-Players-Sheet', link: 'playerssheet', env: 'PLAYERS_SHEET_REDO', name: 'Players sheet redo' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who sees it is Settings' call. */
export function playersSheetRedoAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
