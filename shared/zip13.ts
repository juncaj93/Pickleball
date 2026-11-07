// Zip 13 (Nov 2026): three organizer switches, each ships OFF.
//  - PLAYERS_REDO: the admin Players tab redone (one-line rows, one money chip, a details sheet and an edit sheet that slide up).
//  - SWAP_BUTTON: tap "Admin" in the organizer header to jump to your own player page, and "Go to Admin" at the bottom of a player page
//    to come back. Only for a phone signed in as the organizer; players never see it.
//  - ADMIN_UNDO: an Undo button for 5 seconds on the toast after a money or game action on the organizer screens. The save waits those 5
//    seconds and is dropped if Undo is tapped, so an undone tap never reaches the database.
// Each: a wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change), and a
// private per-phone link that sends the header below.

export type Zip13Switch = 'playersRedo' | 'swapButton' | 'adminUndo';

export const ZIP13: Record<Zip13Switch, { task: string; header: string; link: string; env: 'PLAYERS_REDO' | 'SWAP_BUTTON' | 'ADMIN_UNDO'; name: string }> = {
  playersRedo: { task: 'players_redo_on', header: 'X-Players-Redo', link: 'playersredo', env: 'PLAYERS_REDO', name: 'Players redo' },
  swapButton: { task: 'swap_button_on', header: 'X-Swap-Button', link: 'swapbutton', env: 'SWAP_BUTTON', name: 'Swap to Alex' },
  adminUndo: { task: 'admin_undo_on', header: 'X-Admin-Undo', link: 'adminundo', env: 'ADMIN_UNDO', name: 'Undo on admin toasts' },
};

/** The three task_log rows (the speed switch answers them from its one read, so they add no database trip). */
export const ZIP13_TASKS: ReadonlySet<string> = new Set(Object.values(ZIP13).map((z) => z.task));

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function zip13Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** How long the Undo button stays on an organizer toast, and how long the save waits. */
export const ADMIN_UNDO_MS = 5000;
