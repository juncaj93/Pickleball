// Zip 72 (🎾72.scores): every Locked doubles answer is a score now. The older tests (zips 57, 58, 71) were written with "We won" and a winner for
// the organizer's Fix; these two helpers keep what those tests mean while sending what the screens send today.
//   asScore('won')   -> { action: 'score', mine: 11, theirs: 7 }   (this player's side won 11 to 7)
//   asScore('lost')  -> { action: 'score', mine: 7, theirs: 11 }
//   withScore({ action: 'result', winner: 'a' }) -> { action: 'result', a: 11, b: 7 }   (winner null still clears)
export function asScore(action: string): Record<string, unknown> {
  if (action === 'won') return { action: 'score', mine: 11, theirs: 7 };
  if (action === 'lost') return { action: 'score', mine: 7, theirs: 11 };
  return { action };
}

export function withScore(body: Record<string, unknown>): Record<string, unknown> {
  if (body.action !== 'result' || (body.winner !== 'a' && body.winner !== 'b')) return body;
  const { winner, ...rest } = body;
  return { ...rest, a: winner === 'a' ? 11 : 7, b: winner === 'a' ? 7 : 11 };
}
