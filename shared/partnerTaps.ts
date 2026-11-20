// Zip 71 (🎾71.teams): the words of the first-answer rule (Alex, Nov 20: no confirming; the first answer from any of the 4 players in a game is
// the result). Its own file, used only by the server (server/tournamentDay.ts, server/americanoDay.ts), so none of it rides in the player download.

/** A refused second answer: who gave the result that stands, and who can change it ("Vic said Net Ninjas won. Ask Alex to fix it."). */
export const firstAnswer = (said: string, org: string): string => `${said} Ask ${org} to fix it.`;
export const saidWon = (by: string, team: string): string => `${by} said ${team} won.`;
export const saidScore = (by: string, x: number, y: number): string => `${by} entered ${Math.max(x, y)} to ${Math.min(x, y)}.`;
