// Zip 58 (🎾58.tourney4), the player's Home after a tournament ends (pictures 38 to 40, videos 44 and 45):
//   the WINNERS TICKER: a slim full-width bar at the top of Home that runs right to left with the tournament's name and its winners (Locked
//   doubles: "CHAMPIONS", the team and both winners with their medals; Americano: "WINNER" then "RUNNER-UP"), for the banner length the
//   organizer chose (1 week to start). The server stops sending it when that time is up, so it disappears by itself. Reduced motion: it stands still.
//   the CONGRATULATIONS card: once, for each winner (and Americano's runner-up), until Nice.
// Only while the server sends `tourAwards` (the Tournaments switch on, a tournament this player could see): otherwise nothing here draws.
import { Fragment, useState } from 'react';
import type { TickerView, TourAwardsView } from '../shared/tournament';
import { AlertCard } from './AlertCard';
import { api, ApiError, isDemo } from './lib';
import { useToast } from './ui';
import { Medals } from './Medals';
import './tour-awards.css';

type Item = { kind: 'label'; text: string } | { kind: 'name'; text: string; medals: number } | { kind: 'dot' };

function itemsOf(t: TickerView): Item[] {
  const out: Item[] = [{ kind: 'label', text: t.name }, { kind: 'dot' }];
  if (t.champions) {
    out.push({ kind: 'label', text: 'Champions' }, { kind: 'name', text: t.champions.team, medals: 0 });
    for (const p of t.champions.players) out.push({ kind: 'name', text: p.name, medals: p.medals });
  }
  if (t.winner) out.push({ kind: 'label', text: 'Winner' }, { kind: 'name', text: t.winner.name, medals: t.winner.medals });
  if (t.winner && t.runnerUp) out.push({ kind: 'dot' });
  if (t.runnerUp) out.push({ kind: 'label', text: 'Runner-up' }, { kind: 'name', text: t.runnerUp.name, medals: t.runnerUp.medals });
  out.push({ kind: 'dot' });
  return out;
}

function TickerRun({ items, hidden }: { items: Item[]; hidden?: boolean }) {
  return (
    <span className="tw-run" aria-hidden={hidden ? 'true' : undefined}>
      {items.map((x, i) => (
        <Fragment key={i}>
          {x.kind === 'label' ? (
            <span className="tw-label">{x.text}</span>
          ) : x.kind === 'dot' ? (
            <span className="tw-dot" aria-hidden="true" />
          ) : (
            <span className="tw-name">
              {x.text}
              {x.medals > 0 && <Medals n={x.medals} />}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** The slim winners bar (full width, under the title). Two copies of the line run side by side so the loop never shows a gap. */
export function WinnersTicker({ t }: { t: TickerView }) {
  const items = itemsOf(t);
  const words = [t.name, t.champions ? `Champions ${t.champions.team}, ${t.champions.players.map((p) => p.name).join(' and ')}` : '', t.winner ? `Winner ${t.winner.name}` : '', t.runnerUp ? `Runner-up ${t.runnerUp.name}` : '']
    .filter(Boolean)
    .join('. ');
  return (
    <div className="tw" role="region" aria-label={words} data-tour-ticker={t.key}>
      <div className="tw-track">
        <TickerRun items={items} />
        <TickerRun items={items} hidden />
      </div>
    </div>
  );
}

/** The one-time congratulations card (pictures 38 to 40): a check, the words, and Nice (it does not come back). */
export function CongratsCard({ c, onChanged }: { c: NonNullable<TourAwardsView['congrats']>; onChanged: () => Promise<unknown> }) {
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (gone) return null;
  return (
    <AlertCard
      as="section"
      tone="green"
      icon="ok"
      label="Congratulations"
      className="tw-congrats"
      title={c.title}
      sub={c.sub}
      data={{ 'data-tour-congrats': c.key }}
      actions={
        <button
          type="button"
          className="btn block big tw-nice"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('POST', '/api/tournament/award-seen', { tournamentId: c.tournamentId });
              setGone(true);
              void onChanged();
            } catch (err) {
              // View as, or the connection: the card stays; the next tap tries again. Zip 76: said like every other button.
              if (isDemo(err)) toast(err.message);
              else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
            } finally {
              setBusy(false);
            }
          }}
          data-tour-nice
        >
          Nice
        </button>
      }
    />
  );
}

/** The file's one door from Home (one lazy load): the ticker (`t`) or the congratulations card (`c`). */
export default function TourAwardsPart({ t, c, onChanged }: { t?: TickerView; c?: NonNullable<TourAwardsView['congrats']>; onChanged?: () => Promise<unknown> }) {
  return t ? <WinnersTicker t={t} /> : c ? <CongratsCard c={c} onChanged={onChanged ?? (async () => undefined)} /> : null;
}
