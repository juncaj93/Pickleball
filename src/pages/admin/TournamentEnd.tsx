// Zip 58 (🎾58.tourney4), the ORGANIZER side of piece 4 (server/tournamentDay.ts spin and pick, server/tournamentEnd.ts):
//   the tie card on game night (the wheel with "<team>: spin the wheel", which the organizer can always tap; or, four or more tied, one tap per place),
//   then, once the Final (or the last round) is in, End tournament (pictures 37 and 43): the slim bar, the big green "Final is done" card, and the
//   End tournament card with its rows, Edit awards (pictures 41 and 42) and Confirm winners and end. After that everything is locked.
import { useState } from 'react';
import type { AdminDayView, AdminEndView, AdminTieView, AdminTournamentView, AwardPick } from '../../../shared/tournament';
import { BANNER_WEEKS, bannerLabel } from '../../../shared/tournament';
import { groupName } from '../../../shared/scores';
import { formatPrice } from '../../../shared/money';
import { api, ApiError, VIEW_ONLY_MESSAGE } from '../../lib';
import { Sheet, useToast } from '../../ui';
import { Wheel } from '../../tournament/parts';
import { prizesOf } from '../../../shared/tournamentCard';
import { type BoxesDraft, draftOf, PrizeBoxes, sendOf } from './PrizeBoxes';
import { StandingsList } from './StandingsList';
import type { AdminCtx } from '../Admin';
import './tournament-end.css';
import { prizeWords } from '../../../shared/tournamentCard';

const WAYS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
const tieTitle = (n: number) => `${WAYS[n] ?? n}-way tie`;
const placeWord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 && /view only/i.test(err.message) ? VIEW_ONLY_MESSAGE : err.message;
  return 'That did not work. Try again.';
}

function useSave(ctx: AdminCtx) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function save<T>(fn: () => Promise<T>, done: string): Promise<T | null> {
    if (busy) return null;
    setBusy(true);
    try {
      const r = await fn();
      await ctx.reload().catch(() => undefined);
      if (done) toast(done);
      return r;
    } catch (err) {
      toast(errText(err), 'error');
      if (err instanceof ApiError && err.status === 409) void ctx.reload();
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, setBusy, save };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ties on game night
// ---------------------------------------------------------------------------------------------------------------------

/** Every tie still being settled, first on game night. */
export function AdminTieCards({ ctx, t, d }: { ctx: AdminCtx; t: AdminTournamentView; d: AdminDayView }) {
  if (!d.ties?.length) return null;
  return (
    <>
      {d.ties.map((x) => (x.mode === 'pick' ? <PickCard key={x.key} ctx={ctx} t={t} tie={x} /> : <WheelCard key={x.key} ctx={ctx} t={t} tie={x} />))}
    </>
  );
}

function WheelCard({ ctx, t, tie }: { ctx: AdminCtx; t: AdminTournamentView; tie: AdminTieView }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [spun, setSpun] = useState<number | null>(null);
  const names = tie.teams.map((x) => x.name);
  const label = tie.pool ? `${tieTitle(tie.teams.length)} · ${groupName(tie.pool)}` : tieTitle(tie.teams.length);
  if (tie.bye && spun === null) {
    return (
      <section className="tm-card tm-gd-card tm-tie" aria-label="The wheel picked" data-tm-tie-picked={tie.key}>
        <div className="tm-card-head tm-head-line">
          <h3 className="tm-label">The wheel picked</h3>
        </div>
        <div className="tm-tie-picked">
          <Wheel names={names} result={tie.bye.index} small />
          <span className="tm-tie-picked-text">
            <b>{tie.bye.name} get the bye</b>
            <span>{tie.bye.players.join(' + ')}</span>
          </span>
        </div>
      </section>
    );
  }
  async function spin() {
    setBusy(true);
    try {
      const r = await api<{ index: number }>('POST', `/api/admin/tournament/${t.id}/games`, { action: 'spin', key: tie.key });
      setSpun(r.index);
    } catch (err) {
      toast(errText(err), 'error');
      if (err instanceof ApiError && err.status === 409) void ctx.reload();
      setBusy(false);
    }
  }
  return (
    <section className="tm-card tm-gd-card tm-tie" aria-label={label} data-tm-tie={tie.key}>
      <div className="tm-card-head tm-head-line">
        <h3 className="tm-label">{label}</h3>
      </div>
      <p className="tm-tie-line">Each team beat one of the others.</p>
      <Wheel
        names={names}
        result={spun}
        spinKey={spun !== null ? tie.key : null}
        onDone={() => {
          void ctx.reload().finally(() => {
            setBusy(false);
            setSpun(null);
          });
        }}
      />
      <button type="button" className="tm-tie-spin" disabled={busy || spun !== null} onClick={() => void spin()} data-tm-tie-spin>
        {tie.spinner ? `${tie.spinner.name}: spin the wheel` : 'Spin the wheel'}
      </button>
    </section>
  );
}

function PickCard({ ctx, t, tie }: { ctx: AdminCtx; t: AdminTournamentView; tie: AdminTieView }) {
  const { busy, save } = useSave(ctx);
  const place = tie.picks.length + 1;
  return (
    <section className="tm-card tm-gd-card tm-tie" aria-label={tieTitle(tie.teams.length)} data-tm-tie-pick={tie.key}>
      <div className="tm-card-head tm-head-line">
        <h3 className="tm-label">{tieTitle(tie.teams.length)}</h3>
      </div>
      <p className="tm-tie-line">Tap the team that goes through.</p>
      <ul className="tm-tie-list">
        {tie.teams.map((x) => {
          const at = tie.picks.indexOf(x.seat);
          return (
            <li key={x.seat}>
              <button
                type="button"
                className="tm-tie-team"
                disabled={busy || at >= 0}
                onClick={() => void save(() => api('POST', `/api/admin/tournament/${t.id}/games`, { action: 'pick', key: tie.key, seat: x.seat, picks: tie.picks }), `${x.name} goes through`)}
                data-tm-tie-team={x.name}
              >
                <span className="tm-tie-team-text">
                  <b>{x.name}</b>
                  <span>{x.players.join(' + ')}</span>
                </span>
                <span className="tm-tie-team-mark">{at >= 0 ? placeWord(at + 1) : `Pick for ${placeWord(place)}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// End tournament (pictures 37, 41 to 43)
// ---------------------------------------------------------------------------------------------------------------------

const money = (cents: number) => (cents > 0 ? formatPrice(cents) : 'None');

/** The slim bar, the big green card, then the End tournament card. Replaces the round results, Pause and Player left. */
export function EndCards({ ctx, t, end }: { ctx: AdminCtx; t: AdminTournamentView; end: AdminEndView }) {
  const { busy, save } = useSave(ctx);
  const [editing, setEditing] = useState(false);
  const doubles = end.format === 'doubles';
  return (
    <>
      <section className="tm-gd-hero" aria-label={`${t.name}, ${end.hero}`} data-tm-end-hero>
        <div className="tm-gd-hero-top">
          <h2 className="tm-gd-hero-name">{t.name}</h2>
          <span className="tm-gd-hero-kicker">{end.hero}</span>
        </div>
        <span className="tm-gd-bar" aria-hidden="true">
          <span style={{ width: '100%' }} />
        </span>
      </section>
      <section className="tm-end-done" aria-label={`${end.done.kicker}. ${end.done.title}`} data-tm-end-done>
        <p className="tm-end-kicker">{end.done.kicker}</p>
        <h3 className="tm-end-title">{end.done.title}</h3>
        <p className="tm-end-sub">{end.done.sub}</p>
      </section>
      <section className="tm-card tm-gd-card tm-end" aria-label="End tournament" data-tm-end>
        <div className="tm-card-head tm-head-line">
          <h3 className="tm-label">End tournament</h3>
          <button type="button" className="tm-end-edit" onClick={() => setEditing(true)} data-tm-edit-awards>
            Edit awards
          </button>
        </div>
        {/* Zip 82 (picture 1): the final standings, between the header and the prize rows. Only the organizer, until the reveal. */}
        {end.standings?.length > 0 && (
          <div className="tm-end-standings">
            <StandingsList rows={end.standings} note="Only you see this until the reveal." data="end" />
          </div>
        )}
        <div className="tm-rows tm-end-rows">
          {doubles ? (
            <>
              <EndRow label="Winners" value={end.first.name} sub={end.first.players?.join(' + ')} data="winners" />
              <EndRow label="Medal for each" value="Yes" data="medal" />
              <EndRow
                label="Game credit for each"
                value={money(end.championCents)}
                sub={end.noCredit && end.first.players?.includes(end.noCredit) ? `${end.noCredit}: medal only` : undefined}
                data="credit"
              />
              {/* Zip 87: a 2nd place team again, only while its credit is above $0 (no medal). */}
              {end.second && (
                <>
                  <EndRow label="2nd place" value={end.second.name} sub={end.second.players?.join(' + ')} data="second" />
                  <EndRow
                    label="Credit for each"
                    value={money(end.secondCents)}
                    sub={end.noCredit && end.second.players?.includes(end.noCredit) ? `${end.noCredit}: no credit` : undefined}
                    data="second-credit"
                  />
                </>
              )}
              <EndRow label="Winners banner" value={bannerLabel(end.weeks)} data="banner" />
              {end.third && <EndRow label="3rd place" value={end.third.name} sub={end.third.players?.join(' + ')} data="third" />}
            </>
          ) : (
            <>
              <EndRow label="1st place" value={end.first.name} data="first" />
              <EndRow label="Medal and credit" value={end.championCents > 0 && end.noCredit !== end.first.name ? `Medal + ${formatPrice(end.championCents)}` : 'Medal'} data="medal" />
              <EndRow label="2nd place" value={end.second?.name ?? ''} data="second" />
              <EndRow label="Credit" value={end.noCredit && end.noCredit === end.second?.name ? 'None' : money(end.secondCents)} data="credit" />
              <EndRow label="Winners banner" value={bannerLabel(end.weeks)} data="banner" />
            </>
          )}
        </div>
        {end.blocked && (
          <p className="tm-end-blocked" role="status" data-tm-end-blocked>
            {end.blocked}
          </p>
        )}
        {/* Zip 88: no prize set yet: one red line right above the big button (a tap opens Edit awards; medals only still works). */}
        {!end.blocked && prizeWords(t) === null && (
          <button type="button" className="tm-end-noprize" onClick={() => setEditing(true)} data-tm-end-noprize>
            Set prizes first
          </button>
        )}
        <button
          type="button"
          className="btn block big tm-end-go"
          disabled={busy || !!end.blocked}
          onClick={() => void save(() => api('POST', `/api/admin/tournament/${t.id}/awards`, { action: 'end', seen: end.seen }), doubles ? `${t.name} ended` : 'Revealing on every phone')}
          data-tm-end-confirm
          data-tm-reveal={doubles ? undefined : true}
        >
          {/* Zip 77: Americano's same End (credit once, history, medals) also starts the reveal on every player's phone. */}
          {doubles ? 'Confirm winners and end' : 'Reveal standings'}
        </button>
      </section>
      <EditAwardsSheet ctx={ctx} t={t} end={end} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

function EndRow({ label, value, sub, data }: { label: string; value: string; sub?: string; data: string }) {
  return (
    <div className="tm-row tm-end-row" data-tm-end-row={data}>
      <span>{label}</span>
      <span className="tm-end-val">
        <b>{value}</b>
        {sub && <span>{sub}</span>}
      </span>
    </div>
  );
}

/** Edit awards (pictures 41 and 42): the winners (Change), the credit amounts, how long the banner stays up, Save. */
function EditAwardsSheet({ ctx, t, end, open, onClose }: { ctx: AdminCtx; t: AdminTournamentView; end: AdminEndView; open: boolean; onClose: () => void }) {
  return (
    <Sheet calmFocus open={open} title="Edit awards" onClose={onClose} className="tm-gd-sheet tm-awards-sheet">
      {open && <AwardsForm key={end.seen} ctx={ctx} t={t} end={end} onClose={onClose} />}
    </Sheet>
  );
}

function AwardsForm({ ctx, t, end, onClose }: { ctx: AdminCtx; t: AdminTournamentView; end: AdminEndView; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const doubles = end.format === 'doubles';
  const [first, setFirst] = useState(end.first.key);
  // Zip 87: Locked doubles has a 2nd place team again (only while its credit is above $0): the Final's runner-up unless changed.
  // Review fix: the Final's order (the standings), not the seat order: the team right below the winners.
  const below = end.standings.find((r, i) => i > 0 && r.name !== end.first.name && !r.out)?.name;
  const runnerUp = end.second?.key ?? end.choices.find((c) => c.name === below && c.key !== end.first.key)?.key ?? end.choices.find((c) => c.key !== end.first.key)?.key ?? null;
  const [second, setSecond] = useState<string | null>(runnerUp);
  // Zip 87 (picture 9): the same Prizes sheet as before the night, both styles (the style played on top, "Tonight"), the night's real money.
  const [draft, setDraft] = useState<BoxesDraft>(() => draftOf(prizesOf(t)));
  const [weeks, setWeeks] = useState(end.weeks);
  const [changing, setChanging] = useState<'first' | 'second' | null>(null);
  const pickOf = (k: string | null) => end.choices.find((c) => c.key === k) ?? null;
  const sendable = sendOf(draft);
  const box = draft[end.format];
  const hasSecond = !doubles || (box.second ?? 0) > 0;
  const ok = !!sendable && (!hasSecond || (second !== null && second !== first));
  return (
    <div className="stack tm-awards" data-tm-awards>
      <PickRow
        label={doubles ? 'Winners' : '1st place'}
        pick={pickOf(first)}
        open={changing === 'first'}
        onToggle={() => setChanging(changing === 'first' ? null : 'first')}
        choices={end.choices}
        onPick={(k) => {
          setFirst(k);
          if (k === second) setSecond(end.choices.find((c) => c.key !== k)?.key ?? null);
          setChanging(null);
        }}
        data="first"
      />
      {hasSecond && (
        <PickRow
          label={doubles ? '2nd place team' : '2nd place'}
          pick={pickOf(second)}
          open={changing === 'second'}
          onToggle={() => setChanging(changing === 'second' ? null : 'second')}
          choices={end.choices.filter((c) => c.key !== first)}
          onPick={(k) => {
            setSecond(k);
            setChanging(null);
          }}
          data="second"
        />
      )}
      {end.money && <PrizeBoxes tickets={end.money.ticketsCents} courts={end.money.courtCents} planned={end.format} tag="Tonight" value={draft} onChange={setDraft} />}
      <div className="tm-awards-banner">
        <span>Banner stays up</span>
        <div className="tm-awards-weeks" role="radiogroup" aria-label="Banner stays up">
          {BANNER_WEEKS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={weeks === w} className={weeks === w ? 'tm-awards-week tm-on' : 'tm-awards-week'} onClick={() => setWeeks(w)} data-tm-weeks={w}>
              {bannerLabel(w)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="btn block big tm-end-go"
        disabled={busy || !ok}
        onClick={async () => {
          if (!sendable) return;
          const p = sendable[end.format];
          const r = await save(
            () =>
              api('POST', `/api/admin/tournament/${t.id}/awards`, {
                action: 'save',
                first,
                ...(hasSecond && second ? { second } : {}),
                championCents: p.first,
                secondCents: p.second,
                prizes: sendable,
                weeks,
              }),
            'Awards saved',
          );
          if (r) onClose();
        }}
        data-tm-awards-save
      >
        Save
      </button>
    </div>
  );
}

function PickRow({
  label,
  pick,
  open,
  onToggle,
  choices,
  onPick,
  data,
}: {
  label: string;
  pick: AwardPick | null;
  open: boolean;
  onToggle: () => void;
  choices: AwardPick[];
  onPick: (key: string) => void;
  data: string;
}) {
  return (
    <div className="tm-awards-pick" data-tm-award-pick={data}>
      <div className="tm-awards-pick-row">
        <span className="tm-awards-pick-text">
          <span className="tm-awards-kicker">{label}</span>
          <b>{pick?.name ?? 'Pick one'}</b>
          {pick?.players && pick.players.length > 0 && <span className="tm-awards-players">{pick.players.join(' + ')}</span>}
        </span>
        <button type="button" className="tm-awards-change" aria-expanded={open} onClick={onToggle} data-tm-award-change={data}>
          Change
        </button>
      </div>
      {open && (
        <ul className="tm-awards-choices">
          {choices.map((c) => (
            <li key={c.key}>
              <button type="button" className="tm-awards-choice" aria-pressed={c.key === pick?.key} onClick={() => onPick(c.key)} data-tm-award-choice={c.name}>
                <span className="tm-awards-pick-text">
                  <b>{c.name}</b>
                  {c.players && c.players.length > 0 && <span className="tm-awards-players">{c.players.join(' + ')}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
