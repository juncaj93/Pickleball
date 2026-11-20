// Zip 71 (🎾71.teams), part 1: the words of the partner-taps rule (the first answer from a side counts). Its own file, used only by the
// server (server/tournamentDay.ts, server/americanoDay.ts), so none of it rides in the player download: the phones get the finished line.

/** Zip 71 (partner taps): a teammate answered first, so this partner sees a line instead of buttons (and the server refuses a second answer).
 *  `said`: "Vic said Net Ninjas won." or "Vic entered 11 to 8."; `others`: the other side's team or players; `org`: the organizer. */
export function waitingLine(said: string, others: readonly string[], org: string): string {
  const xs = [...others, org];
  return `${said} Waiting for ${xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`} to confirm.`;
}
export const saidWon = (by: string, team: string): string => `${by} said ${team} won.`;
export const saidScore = (by: string, x: number, y: number): string => `${by} entered ${Math.max(x, y)} to ${Math.min(x, y)}.`;
/** Zip 71: a Locked doubles game where both teams say they won ("No, we won"): only the organizer settles it. */
export const bothSayWon = (a: string, b: string, org: string): string => `${a} and ${b} both say they won. ${org} will decide.`;
