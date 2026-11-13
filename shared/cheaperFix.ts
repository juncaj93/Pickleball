// Zip 39 (🎾39.moneyfix): CHEAPER_FIX ("Made cheaper after paying"), ships OFF. It moves money, so it has a Settings row and a kill switch.
//  - A late fee kept on a game whose price went DOWN after a player paid (made shorter with Short games on, or Booking hours turned off on
//    a 2.5 or 3 hour game): the late cancel with the fee kept, the late drop that leaves the game short, and the no-show at Finalize keep
//    only the fee (the lower price now) on the seat; whatever the seat holds above it comes back as credit at that moment. It is the
//    mirror of Zip 27 A-02 (a game made PRICIER asks the gap at the same three moments). A played seat already got the extra back at
//    Finalize, and a Reopen and redo already reprices; neither changes.
//  - Audit A item A-18: a new "Price per player" (Settings > Money) reprices the seats of open games at once, the way the Short games and
//    Booking hours rows already do: an unpaid seat whose credit now covers the price is paid with it, and a seat paid with credit that is
//    now short owes the rest (cash is never taken back; it is settled at Finalize).
//  - Off: every path is exactly as before. Nothing about it is stored per game or per seat.
//  - A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change), and a
//    private per-phone link (/admin?cheaperfix=on) that sends the header below. Like Short games, the link only counts for a phone signed
//    in as the organizer: a player's own drop follows the Settings row only.

export const CHEAPER_FIX = { task: 'cheaper_fix_on', header: 'X-Cheaper-Fix', link: 'cheaperfix', env: 'CHEAPER_FIX', name: 'Made cheaper after paying' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function cheaperFixAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
