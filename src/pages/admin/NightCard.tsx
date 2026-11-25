// Zip 88 (🎾88.rolling courts), pictures 1 to 3: the organizer's ONE card on game night. It replaces the green "Round 3 of 6" banner, the round's
// scores box and the folded tournament card under them. Header (the name, "Americano · 10 players", the "1 of 2 in" pill), the round bars (tap
// one: All rounds at that round), one box per court (Score while playing, the score once in: tap it to fix), who sits now, All rounds and
// Standings, then the quiet Pause and Player left (each asks "Are you sure?" first). Both styles draw it from src/pages/admin/nightCardData.ts.
// Zip 89 (🎾89.smart pacing): when the server offers a bonus (shared/smartPacing.ts), a slim green line above All rounds / Standings: "Ahead of
// time" and Add a round (44 px). A tap asks "Are you sure?" in place (two equal buttons: Yes green, No red outline); Yes adds it at once. Ignored,
// nothing changes; the line goes when the offer does. Hidden while Pause or Player left is asking, or the Player left sheet is open.
import { useState } from 'react';
import type { BonusOffer } from '../../../shared/tournament';
import { Pickleball } from '../../ui';
import type { NightBox, NightModel } from './nightCardData';

/** The question for each bonus (the button always says Add a round). */
const BONUS_ASK: Record<BonusOffer['kind'], string> = { round: 'Add a round?', semis: 'Add semifinals?', bestOf3: 'Make the Final best of 3?' };
import './night-card88.css';

export function NightCard({
  name,
  m,
  busy,
  paused,
  onScore,
  onBar,
  onAll,
  onStandings,
  onPause,
  onLeft,
  bonus,
  onBonus,
  holdBonus,
}: {
  name: string;
  m: NightModel;
  busy: boolean;
  paused: boolean;
  /** Score (or tap the score to fix) on a court's game. */
  onScore: (num: number) => void;
  /** A round bar: All rounds at that round. */
  onBar: (round: number) => void;
  onAll: () => void;
  onStandings: () => void;
  onPause: () => void;
  onLeft: () => void;
  /** Zip 89: the bonus offer (absent: no line), its tap (with the offer's key), and a sheet open that hides it (Player left). */
  bonus?: BonusOffer | null;
  onBonus?: (key: string) => void;
  holdBonus?: boolean;
}) {
  const [ask, setAsk] = useState<null | 'pause' | 'left'>(null);
  const [askBonus, setAskBonus] = useState<string | null>(null);
  const offer = bonus && onBonus && !ask && !holdBonus ? bonus : null;
  return (
    <section
      className="nc"
      aria-label={`${name}, ${m.inCount} of ${m.boxes.length} in`}
      data-nc={m.kind}
      data-tm-night
      data-tm-am-night={m.kind === 'americano' ? true : undefined}
    >
      <div className="nc-head">
        <span className="nc-ball" aria-hidden="true">
          <Pickleball />
        </span>
        <span className="nc-words">
          <h2 className="nc-name">{name}</h2>
          <span className="nc-style" data-nc-style>
            {m.style}
          </span>
        </span>
        {!m.allIn && m.boxes.length > 0 && (
          <span className="nc-in" data-nc-in={`${m.inCount}/${m.boxes.length}`}>
            {m.inCount} of {m.boxes.length} in
          </span>
        )}
      </div>
      <div className="nc-body">
        <ol className="nc-bars" aria-label="Rounds">
          {m.bars.map((b) => (
            <li key={b.key} className={b.wide ? 'nc-bar-li nc-wide' : 'nc-bar-li'}>
              <button
                type="button"
                className={`nc-bar nc-${b.state}`}
                onClick={() => onBar(b.rounds[0] ?? 1)}
                aria-label={`${b.label}: ${b.state === 'done' ? 'done' : b.state === 'now' ? 'being played' : b.state === 'early' ? 'started early' : 'not started'}. Opens All rounds.`}
                data-nc-bar={b.key}
                data-state={b.state}
              >
                <span className="nc-bar-line" aria-hidden="true" />
                <span className="nc-bar-label">{b.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <>
          {m.boxes.map((b) => (
            <CourtBox key={b.court} b={b} busy={busy} onScore={() => onScore(b.num)} />
          ))}
          {m.sitting.length > 0 && (
            <p className="nc-sit" data-nc-sitting={m.sitting.length}>
              <span className="nc-sit-word">Sitting:</span>
              <span className="nc-sit-balls" aria-hidden="true">
                {m.sitting.map((_, i) => (
                  <Pickleball key={i} />
                ))}
              </span>
              <span className="nc-sit-names">{m.sitting.join(', ')}</span>
            </p>
          )}
        </>
        {offer &&
          (askBonus === offer.key ? (
            <div className="nc-ahead nc-ahead-ask" role="group" aria-label={`${BONUS_ASK[offer.kind]} Are you sure?`} data-nc-bonus-ask={offer.kind}>
              <span className="nc-ahead-q">
                {BONUS_ASK[offer.kind]} Are you sure?
              </span>
              <span className="nc-ahead-btns">
                <button
                  type="button"
                  className="nc-ahead-yes"
                  disabled={busy}
                  onClick={() => {
                    setAskBonus(null);
                    onBonus!(offer.key);
                  }}
                  data-nc-bonus-yes
                >
                  Yes
                </button>
                <button type="button" className="nc-ahead-no" onClick={() => setAskBonus(null)} data-nc-bonus-no>
                  No
                </button>
              </span>
            </div>
          ) : (
            <div className="nc-ahead" data-nc-bonus={offer.kind}>
              <span className="nc-ahead-word">Ahead of time</span>
              <button type="button" className="nc-ahead-add" disabled={busy} onClick={() => setAskBonus(offer.key)} data-nc-bonus-add>
                Add a round
              </button>
            </div>
          ))}
        <div className="nc-btns">
          <button type="button" className="nc-btn" onClick={onAll} data-nc-all data-tm-am-all>
            All rounds
          </button>
          <button type="button" className="nc-btn" onClick={onStandings} data-nc-standings data-tm-am-standings>
            Standings
          </button>
        </div>
        {ask ? (
          <div className="nc-ask" role="group" aria-label="Are you sure?" data-nc-ask={ask}>
            <span className="nc-ask-q">{ask === 'pause' ? 'Pause the night?' : 'Did a player leave?'} Are you sure?</span>
            <span className="nc-ask-btns">
              <button
                type="button"
                className="nc-quiet nc-yes"
                disabled={busy}
                onClick={() => {
                  const was = ask;
                  setAsk(null);
                  if (was === 'pause') onPause();
                  else onLeft();
                }}
                data-nc-yes
              >
                Yes
              </button>
              <button type="button" className="nc-quiet" onClick={() => setAsk(null)} data-nc-no>
                No
              </button>
            </span>
          </div>
        ) : (
          <div className="nc-quiet-row">
            {/* Resume needs no question: it only puts the night back on. */}
            <button type="button" className="nc-quiet" disabled={busy} onClick={() => (paused ? onPause() : setAsk('pause'))} data-tm-pause>
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="nc-quiet" disabled={busy} onClick={() => setAsk('left')} data-tm-player-left>
              Player left
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** One court: "Court 1", the target, the round pill and the status chip; then the two sides with Score (or the score) between them. */
function CourtBox({ b, busy, onScore }: { b: NightBox; busy: boolean; onScore: () => void }) {
  const scored = b.scoreA !== null && b.scoreB !== null;
  const side = (s: 'a' | 'b') => (b.winner === null ? 'nc-side' : b.winner === s ? 'nc-side nc-win' : 'nc-side nc-lose');
  return (
    <article
      className={`nc-box nc-box-${b.status}`}
      aria-label={`${b.where}, ${b.pill.text}, ${b.status === 'playing' ? 'Playing' : 'Done'}`}
      data-nc-court={b.court}
      data-nc-game={b.num}
      data-status={b.status}
    >
      <div className="nc-box-head">
        <span className="nc-box-left">
          <span className="nc-court">{b.where}</span>
          {b.playTo === 11 ? (
            <span className="nc-to" data-nc-to={11}>
              Play to 11
            </span>
          ) : (
            <span className="nc-to-pill" data-nc-to={b.playTo}>
              Play to {b.playTo}
            </span>
          )}
        </span>
        <span className="nc-box-right">
          <span className={`nc-pill nc-pill-${b.pill.tone}`} data-nc-pill={b.pill.text} data-tone={b.pill.tone}>
            {b.pill.text}
          </span>
          <span className={`nc-pill nc-chip-${b.status}`} data-nc-status>
            {b.status === 'playing' ? 'Playing' : 'Done'}
          </span>
        </span>
      </div>
      <div className="nc-row">
        <span className={`${side('a')} nc-side-a`}>{b.a}</span>
        {b.status === 'playing' && !scored ? (
          <button type="button" className="nc-score-btn" disabled={busy} onClick={onScore} data-nc-score={b.num} data-tm-am-fix={b.num}>
            Score
          </button>
        ) : (
          <button
            type="button"
            className="nc-score-box"
            disabled={busy}
            onClick={onScore}
            aria-label={scored ? `${b.scoreA} to ${b.scoreB}. Fix the score.` : 'Off. Fix.'}
            data-nc-fix={b.num}
          >
            {scored ? `${b.scoreA} – ${b.scoreB}` : 'Off'}
          </button>
        )}
        <span className={`${side('b')} nc-side-b`}>{b.b}</span>
      </div>
      {b.series && (
        <p className="nc-series" data-nc-series>
          Best of 3 · {b.series}
        </p>
      )}
    </article>
  );
}
