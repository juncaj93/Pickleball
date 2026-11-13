// Previews show only what the zip being built tests (Alex, Nov 8: "a preview shows only what that zip tests by default").
//
// PREVIEW_CALM = "on" exists ONLY in [env.preview.vars] (production never has it, so on live this does nothing at all). With it, the admin
// Home shows only the cards listed below and the player page hides its alert cards (pay card, Want in, moved game, credit notes, the
// good-news line, the cash-out question); the games themselves are all there. A phone opened once with ?alerts=all sees everything, as
// before (?alerts=calm goes back). Display only: nothing is saved or changed, every switch stays as it is.
// For the next zip: change ADMIN_CALM_SHOWS to that zip's cards.

export const PREVIEW_CALM = { header: 'X-Preview-Alerts', link: 'alerts', env: 'PREVIEW_CALM' } as const;

/** What the calm admin Home still shows (Zip 35: the Second Chance cards only; Zip 15 also showed the Mark paid card, which piled up unpaid rows). */
export const ADMIN_CALM_SHOWS = ['secondChance'] as const;
