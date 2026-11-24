// Zip 87 (🎾87.card polish, picture 9): the Prizes sheet's boxes for BOTH styles. The planned style on top ("Plan now"), the other under it
// ("If Americano" / "If Locked doubles"): Locked doubles pays each player of the 1st and 2nd place teams, Americano 1st and 2nd place. Above them
// the money left ("Tickets $162 − courts $120 = $42 left") and "Suggested for both styles" with Use these (fills both boxes; nothing fills
// without the tap). Each box shows what it costs and what the organizer keeps. Used by the Home card's Prizes sheet (saved with the Edit save)
// and by the night's Edit awards (saved with the awards save), so both are the same sheet. Organizer only.
import { useState } from 'react';
import { formatPrice } from '../../../shared/money';
import { MAX_PRICE_CENTS, type TournamentFormat } from '../../../shared/tournament';
import { suggestedBoxes } from '../../../shared/tournamentMoney';
import { boxCostCents, type PlacePrizes, type StylePrizes } from '../../../shared/tournamentPrizes';
import './prize-boxes.css';

/** The two boxes while the organizer types: a box that does not read as whole dollars is null. */
export type BoxesDraft = { doubles: { first: number | null; second: number | null }; americano: { first: number | null; second: number | null } };

export const draftOf = (p: StylePrizes): BoxesDraft => ({ doubles: { ...p.doubles }, americano: { ...p.americano } });

/** The boxes to send, or null while one of them does not read as whole dollars. */
export function sendOf(d: BoxesDraft): Omit<StylePrizes, 'saved'> | null {
  const all = [d.doubles.first, d.doubles.second, d.americano.first, d.americano.second];
  if (all.some((x) => x === null)) return null;
  return { doubles: d.doubles as PlacePrizes, americano: d.americano as PlacePrizes };
}

const sameBoxes = (d: BoxesDraft, s: Omit<StylePrizes, 'saved'>) =>
  d.doubles.first === s.doubles.first && d.doubles.second === s.doubles.second && d.americano.first === s.americano.first && d.americano.second === s.americano.second;

const signed = (cents: number) => (cents >= 0 ? `+${formatPrice(cents)}` : `−${formatPrice(-cents)}`);

/** A whole-dollar box ("$ 14"), null while it does not read as whole dollars from $0 to $200. */
function Dollars({ cents, onChange, label, data }: { cents: number | null; onChange: (c: number | null) => void; label: string; data: string }) {
  const [text, setText] = useState(cents === null ? '' : String(cents / 100));
  return (
    <span className="pz-money">
      <span aria-hidden="true">$</span>
      <input
        type="text"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim();
          const c = /^\d{1,3}$/.test(v) ? Number(v) * 100 : null;
          onChange(c !== null && c <= MAX_PRICE_CENTS ? c : null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        data-pz-money={data}
      />
    </span>
  );
}

function Box({
  style,
  top,
  tag,
  value,
  onChange,
  leftCents,
  fill,
}: {
  style: TournamentFormat;
  top: boolean;
  tag: string;
  value: BoxesDraft['doubles'];
  onChange: (v: BoxesDraft['doubles']) => void;
  leftCents: number;
  fill: number;
}) {
  const doubles = style === 'doubles';
  const title = top ? (doubles ? 'Locked doubles' : 'Americano') : doubles ? 'If Locked doubles' : 'If Americano';
  const ok = value.first !== null && value.second !== null;
  const cost = ok ? boxCostCents(style, value as PlacePrizes) : null;
  const keep = cost === null ? null : leftCents - cost;
  const row = (place: 'first' | 'second') => {
    const words = place === 'first' ? (doubles ? '1st place team' : '1st place') : doubles ? '2nd place team' : '2nd place';
    return (
      <div className="pz-row">
        <span className="pz-row-words">
          <span>{words}</span>
          {doubles && <span className="pz-each">each player</span>}
        </span>
        <Dollars
          key={`${style}${place}${fill}`}
          cents={value[place]}
          onChange={(c) => onChange({ ...value, [place]: c })}
          label={`${title}: ${words}${doubles ? ', each player' : ''}`}
          data={`${style}-${place}`}
        />
      </div>
    );
  };
  return (
    <section className={top ? 'pz-box pz-top' : 'pz-box'} aria-label={title} data-pz-box={style} data-pz-top={top || undefined}>
      <div className="pz-box-head">
        <h3 className="pz-box-title">{title}</h3>
        {top && <span className="pz-tag">{tag}</span>}
      </div>
      {row('first')}
      {row('second')}
      <div className="pz-foot" data-pz-cost={cost ?? ''} data-pz-keep={keep ?? ''}>
        <span>Costs {cost === null ? '$?' : formatPrice(cost)}</span>
        {keep !== null && <span className={keep >= 0 ? 'pz-keep' : 'pz-keep pz-short'}>You keep {signed(keep)}</span>}
      </div>
    </section>
  );
}

/**
 * The sheet's body above Save: the money left, "Suggested for both styles" with Use these, then the two boxes (the planned style on top).
 * `tickets` and `courts`: before the night the tickets expected; on the night the tickets actually paid (the caller decides).
 */
export function PrizeBoxes({
  tickets,
  courts,
  planned,
  tag,
  value,
  onChange,
}: {
  tickets: number;
  courts: number;
  planned: TournamentFormat;
  tag: string;
  value: BoxesDraft;
  onChange: (v: BoxesDraft) => void;
}) {
  const [fill, setFill] = useState(0);
  const left = tickets - courts;
  const suggested = suggestedBoxes(left);
  const same = sameBoxes(value, suggested);
  const other: TournamentFormat = planned === 'doubles' ? 'americano' : 'doubles';
  return (
    <div className="pz" data-pz>
      <p className="pz-left" data-pz-left={left}>
        Tickets {formatPrice(tickets)} − courts {formatPrice(courts)} = <b>{formatPrice(Math.abs(left))} {left >= 0 ? 'left' : 'short'}</b>
      </p>
      <div className="pz-suggest">
        <p className="pz-suggest-words">Suggested for both styles</p>
        <button
          type="button"
          className="pz-use"
          disabled={same}
          onClick={() => {
            onChange({ doubles: { ...suggested.doubles }, americano: { ...suggested.americano } });
            setFill((n) => n + 1);
          }}
          data-pz-use
        >
          {same ? 'Using these' : 'Use these'}
        </button>
      </div>
      {[planned, other].map((style, i) => (
        <Box key={style} style={style} top={i === 0} tag={tag} value={value[style]} onChange={(v) => onChange({ ...value, [style]: v })} leftCents={left} fill={fill} />
      ))}
    </div>
  );
}
