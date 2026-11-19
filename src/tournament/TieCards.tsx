// Zip 58 (🎾58.tourney4), the PLAYER side of a tie and the playoffs (pictures 20 to 22). Part of the tournament card's own download.
//   Three-way tie: one line, the wheel, "<team>: spin the wheel" (a button only on the phones of the team that spins; the server picks).
//   The wheel picked: the small wheel, "<team> get the bye", their players.
//   Playoff: Game A, Game B, then the games the tie feeds (57's Your games rows).
//   Also now: the 3rd place game on the other court, under the Final's card.
import { useState } from 'react';
import type { PlayerDayView, PlayerTieView, PlayoffRow, PlayerTournamentView } from '../../shared/tournament';
import { api, ApiError } from '../lib';
import { useToast } from '../ui';
import { Wheel } from './parts';
import { Court, errorText } from './GameDayView';
import './tie-cards.css';

const WAYS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
/** "Three-way tie". */
export const tieTitle = (n: number): string => `${WAYS[n] ?? n}-way tie`;

/**
 * The tie card (picture 20). `replay`: the wheel was spun on another phone a moment ago and this phone has not shown it: it spins to the answer
 * once, then `onSeen`.
 */
export function TieCard({
  t,
  tie,
  org,
  onChanged,
  replay,
  onSeen,
}: {
  t: PlayerTournamentView;
  tie: PlayerTieView;
  org: string;
  onChanged: () => Promise<unknown>;
  replay?: boolean;
  onSeen?: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [spun, setSpun] = useState<number | null>(null);
  const names = tie.teams.map((x) => x.name);
  const who = tie.spinner ? tie.spinner.name : org;
  if (tie.state === 'pick') {
    return (
      <section className="tc-gd-card tc-tie" aria-label={tieTitle(tie.teams.length)} data-tc-tie={tie.key} data-state="pick">
        <h3 className="tc-gd-label tc-tie-head">{tieTitle(tie.teams.length)}</h3>
        <p className="tc-tie-line">{org} picks who goes through.</p>
        <ul className="tc-gd-rows">
          {tie.teams.map((x) => (
            <li key={x.name} className="tc-gd-row tc-gd-teamrow">
              <span className="tc-gd-main">
                <b>{x.name}</b>
                <span>{x.players.join(' + ')}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const result = replay && tie.bye ? tie.bye.index : spun;
  async function doSpin() {
    setBusy(true);
    try {
      const r = await api<{ index: number }>('POST', '/api/tournament/spin', { tournamentId: t.id, key: tie.key });
      setSpun(r.index);
    } catch (err) {
      toast(errorText(err), 'error');
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) void onChanged();
      setBusy(false);
    }
  }
  return (
    <section className="tc-gd-card tc-tie" aria-label={tieTitle(tie.teams.length)} data-tc-tie={tie.key} data-state={result === null ? 'spin' : 'spinning'}>
      <h3 className="tc-gd-label tc-tie-head">{tieTitle(tie.teams.length)}</h3>
      <p className="tc-tie-line">Each team beat one of the others.</p>
      <div className="tc-tie-wheel">
        <Wheel
          names={names}
          result={result}
          spinKey={result !== null ? tie.key : null}
          onDone={() => {
            onSeen?.();
            if (!replay) void onChanged().finally(() => setBusy(false));
          }}
        />
      </div>
      {result !== null && tie.bye && <p className="tc-tie-result">{tie.bye.name} get the bye</p>}
      {tie.canSpin && !replay ? (
        <button type="button" className="tc-tie-spin" disabled={busy || result !== null} onClick={() => void doSpin()} data-tc-tie-spin>
          {who}: spin the wheel
        </button>
      ) : (
        <p className="tc-tie-spin tc-tie-spin-wait" data-tc-tie-wait>
          {who}: spin the wheel
        </p>
      )}
    </section>
  );
}

/** "The wheel picked" (picture 21): the small wheel with the bye team's slice lit, "<team> get the bye", their players. */
export function WheelPickedCard({ tie }: { tie: PlayerTieView }) {
  if (!tie.bye) return null;
  return (
    <section className="tc-gd-card tc-tie-picked" aria-label="The wheel picked" data-tc-tie-picked={tie.key}>
      <h3 className="tc-gd-label tc-tie-head">The wheel picked</h3>
      <div className="tc-tie-picked-row">
        <Wheel names={tie.teams.map((x) => x.name)} result={tie.bye.index} small />
        <span className="tc-tie-picked-text">
          <b>{tie.bye.name} get the bye</b>
          <span>{tie.bye.players.join(' + ')}</span>
        </span>
      </div>
    </section>
  );
}

/** The Playoff card (picture 21): Game A, Game B, then the Final and 3rd place (or the semifinals) the tie feeds. */
export function PlayoffCard({ rows, day }: { rows: PlayoffRow[]; day: PlayerDayView }) {
  return (
    <section className="tc-gd-card" aria-label="Playoff" data-tc-playoff>
      <h3 className="tc-gd-label">Playoff</h3>
      <ul className="tc-gd-rows">
        {rows.map((r) => (
          <li key={r.label + r.title} className={`tc-gd-row tc-gd-game tc-gd-s-${r.state}`} data-tc-playoff-row={r.label} data-state={r.state}>
            <span className="tc-gd-left">
              <b>{r.label}</b>
              <Court n={r.court} set={day.courtsSet} />
            </span>
            <span className="tc-gd-main">
              <b>{r.title}</b>
              <span>{r.sub}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Also now · Court 2 · 3rd place" (picture 22): the other game being played beside this player's Final. */
export function AlsoNowCard({ a }: { a: NonNullable<PlayerDayView['alsoNow']> }) {
  const where = a.court !== null ? ` · Court ${a.court}` : '';
  return (
    <section className="tc-gd-card tc-also" aria-label={`Also now${where} · ${a.label}`} data-tc-also-now>
      <h3 className="tc-gd-label tc-tie-head">
        Also now{where} · {a.label}
      </h3>
      <p className="tc-also-body">
        <b>
          {a.a.name} vs {a.b.name}
        </b>
        <span>
          {a.a.players.join(' + ')} vs {a.b.players.join(' + ')}
        </span>
      </p>
    </section>
  );
}
