# GAME PLAN TABLE (single source of truth for zips 57 and 61; Zip 89 changed the round times and the end buffer, and the rows below were made again from the same rules with the new numbers)
Generated from the rules below. Players 6 to 16, 1 or 2 courts, 2, 2.5 and 3 hours (courts are booked in half hours; if Alex ever picks another length, use the same rules with that many minutes). Follow it exactly and unit test EVERY row (rounds, game length, finish time).

## RULES
- One round takes: games to 11 = 20 minutes, to 9 = 16, to 7 = 13 (includes changeover; Zip 89, was 23, 19 and 16). Keep a 20 minute buffer at the end (awards, overrun; Zip 89, was 10). Total must be at most court minutes minus 20.
- LOCKED DOUBLES (even count only; an odd count is Americano, see zip 64). Teams = players / 2.
  - 3 teams: everyone plays the other two, then the top 2 play the Final. One game at a time (3 teams), so a second court adds nothing.
  - 4 teams: round robin (3 rounds on 2 courts), then Final and 3rd place together on 2 courts.
  - 5 teams: round robin (5 rounds, one team sits each round), then Final and 3rd place together.
  - 6 teams: two pools of 3, then semifinals, then Final and 3rd place.
  - 7 teams: Pool A of 4 and Pool B of 3, then semifinals, then Final and 3rd place. When Pool B is done, Pool A uses the second court.
  - 8 teams: two pools of 4, one game per pool per round, then semifinals, then Final and 3rd place.
  - With ONE court there is no 3rd place game, and every game is played one after another (a pool is played in turn). Semifinal rule: pool winner plays the other pool's runner-up.
  - Pool or round robin games use the longest length (to 11, then 9, then 7) that fits. Semifinals, Final and 3rd place are always to 11.
- AMERICANO (any count 6 to 16). Players on court each round = 4 x the smaller of (courts, players divided by 4, rounded down). Everyone else sits. Nobody sits twice before everyone has sat once. Partners and opponents spread as evenly as the size allows. Rounds = (court minutes minus 20) divided by the round length, rounded down. Use the longest game length (11, then 9, then 7) that gives EVERY player at least 4 games.
- NO means it does not fit. Never silently run over: at Finalize and when tickets close, show Alex the amber line "Too tight for {n} players on {c} court(s). Use 2 courts or add court time." He may still Finalize. If he does, use games to 7 and let the Time check banner say how far behind it will run.

## LOCKED DOUBLES: players, courts, then per court time: game length for pool or round robin, total rounds, minutes used
- 6 players, 1 court: 2h: to 11, 4 rounds, 80 min | 2.5h: to 11, 4 rounds, 80 min | 3h: to 11, 4 rounds, 80 min
- 6 players, 2 courts: 2h: to 11, 4 rounds, 80 min | 2.5h: to 11, 4 rounds, 80 min | 3h: to 11, 4 rounds, 80 min
- 8 players, 1 court: 2h: to 7, 7 rounds, 98 min | 2.5h: to 9, 7 rounds, 116 min | 3h: to 11, 7 rounds, 140 min
- 8 players, 2 courts: 2h: to 11, 4 rounds, 80 min | 2.5h: to 11, 4 rounds, 80 min | 3h: to 11, 4 rounds, 80 min
- 10 players, 1 court: 2h: NO | 2.5h: NO | 3h: to 7, 11 rounds, 150 min
- 10 players, 2 courts: 2h: to 9, 6 rounds, 100 min | 2.5h: to 11, 6 rounds, 120 min | 3h: to 11, 6 rounds, 120 min
- 12 players, 1 court: 2h: NO | 2.5h: NO | 3h: to 9, 9 rounds, 156 min
- 12 players, 2 courts: 2h: to 11, 5 rounds, 100 min | 2.5h: to 11, 5 rounds, 100 min | 3h: to 11, 5 rounds, 100 min
- 14 players, 1 court: 2h: NO | 2.5h: NO | 3h: NO
- 14 players, 2 courts: 2h: NO | 2.5h: to 9, 7 rounds, 120 min | 3h: to 11, 7 rounds, 140 min
- 16 players, 1 court: 2h: NO | 2.5h: NO | 3h: NO
- 16 players, 2 courts: 2h: NO | 2.5h: to 7, 8 rounds, 118 min | 3h: to 11, 8 rounds, 160 min

## AMERICANO: players, courts, then per court time: game length, rounds, games per player
- 6 players, 1 court: 2h: to 9, 6 rounds, 4.0 games each | 2.5h: to 11, 6 rounds, 4.0 games each | 3h: to 11, 8 rounds, 5.3 games each
- 7 players, 1 court: 2h: to 7, 7 rounds, 4.0 games each | 2.5h: to 9, 8 rounds, 4.6 games each | 3h: to 11, 8 rounds, 4.6 games each
- 8 players, 1 court: 2h: NO | 2.5h: to 9, 8 rounds, 4.0 games each | 3h: to 11, 8 rounds, 4.0 games each
- 8 players, 2 courts: 2h: to 11, 5 rounds, 5.0 games each | 2.5h: to 11, 6 rounds, 6.0 games each | 3h: to 11, 8 rounds, 8.0 games each
- 9 players, 1 court: 2h: NO | 2.5h: to 7, 10 rounds, 4.4 games each | 3h: to 9, 10 rounds, 4.4 games each
- 9 players, 2 courts: 2h: to 11, 5 rounds, 4.4 games each | 2.5h: to 11, 6 rounds, 5.3 games each | 3h: to 11, 8 rounds, 7.1 games each
- 10 players, 1 court: 2h: NO | 2.5h: to 7, 10 rounds, 4.0 games each | 3h: to 9, 10 rounds, 4.0 games each
- 10 players, 2 courts: 2h: to 11, 5 rounds, 4.0 games each | 2.5h: to 11, 6 rounds, 4.8 games each | 3h: to 11, 8 rounds, 6.4 games each
- 11 players, 1 court: 2h: NO | 2.5h: NO | 3h: to 7, 12 rounds, 4.4 games each
- 11 players, 2 courts: 2h: to 9, 6 rounds, 4.4 games each | 2.5h: to 11, 6 rounds, 4.4 games each | 3h: to 11, 8 rounds, 5.8 games each
- 12 players, 1 court: 2h: NO | 2.5h: NO | 3h: to 7, 12 rounds, 4.0 games each
- 12 players, 2 courts: 2h: to 9, 6 rounds, 4.0 games each | 2.5h: to 11, 6 rounds, 4.0 games each | 3h: to 11, 8 rounds, 5.3 games each
- 13 players, 1 court: 2h: NO | 2.5h: NO | 3h: NO
- 13 players, 2 courts: 2h: to 7, 7 rounds, 4.3 games each | 2.5h: to 9, 8 rounds, 4.9 games each | 3h: to 11, 8 rounds, 4.9 games each
- 14 players, 1 court: 2h: NO | 2.5h: NO | 3h: NO
- 14 players, 2 courts: 2h: to 7, 7 rounds, 4.0 games each | 2.5h: to 9, 8 rounds, 4.6 games each | 3h: to 11, 8 rounds, 4.6 games each
- 15 players, 1 court: 2h: NO | 2.5h: NO | 3h: NO
- 15 players, 2 courts: 2h: NO | 2.5h: to 9, 8 rounds, 4.3 games each | 3h: to 11, 8 rounds, 4.3 games each
- 16 players, 1 court: 2h: NO | 2.5h: NO | 3h: NO
- 16 players, 2 courts: 2h: NO | 2.5h: to 9, 8 rounds, 4.0 games each | 3h: to 11, 8 rounds, 4.0 games each

(Under 8 players a second court is never used, so 6 and 7 players list one court only for Americano.)

## STARTING SUGGESTION on the admin card (the "Plan:" line)
- Locked doubles or Americano: 6 = 1 court 2.5h, 8 = 2 courts 2h, 10 = 2 courts 2.5h, 12 = 2 courts 3h, 14 = 2 courts 3h, 16 = 2 courts 3h. Odd counts: 7 = 1 court 2.5h, 9 = 2 courts 2.5h, 11 = 2 courts 2.5h, 13 = 2 courts 3h, 15 = 2 courts 3h. This is only the starting suggestion. The Courts and Plays choices in Finalize decide the real plan.
