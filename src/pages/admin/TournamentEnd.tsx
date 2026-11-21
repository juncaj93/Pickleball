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
import type { AdminCtx } from '../Admin';
import './tournament-end.css';

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
        <div className="tm-rows tm-end-rows">
          {doubles ? (
            <>
              <EndRow label="Winners" value={end.first.name} sub={end.first.players?.join(' + ')} data="winners" />
              <EndRow label="Medal for each" value="Yes" data="medal" />
              <EndRow label="Game credit for each" value={money(end.championCents)} sub={end.noCredit ? `${end.noCredit}: medal only` : undefined} data="credit" />
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

/** A whole-dollar box ($14); null while it does not read as whole dollars. */
function Dollars({ cents, onChange, label, data }: { cents: number | null; onChange: (c: number | null) => void; label: string; data: string }) {
  const [text, setText] = useState(cents === null ? '' : String(cents / 100));
  return (
    <span className="tm-money tm-end-money">
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
          onChange(/^\d{1,3}$/.test(v) ? Number(v) * 100 : null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        data-tm-award-money={data}
      />
    </span>
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
  const [second, setSecond] = useState(end.second?.key ?? null);
  const [champion, setChampion] = useState<number | null>(end.championCents);
  const [secondCents, setSecondCents] = useState<number | null>(end.secondCents);
  const [weeks, setWeeks] = useState(end.weeks);
  const [changing, setChanging] = useState<'first' | 'second' | null>(null);
  const pickOf = (k: string | null) => end.choices.find((c) => c.key === k) ?? null;
  const ok = champion !== null && (doubles || (secondCents !== null && second !== null && second !== first));
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
      {!doubles && (
        <PickRow
          label="2nd place"
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
      <div className="tm-row tm-awards-row">
        <span>{doubles ? 'Credit for each winner' : '1st place credit'}</span>
        <Dollars cents={champion} onChange={setChampion} label={doubles ? 'Credit for each winner' : '1st place credit'} data="champion" />
      </div>
      {!doubles && (
        <div className="tm-row tm-awards-row">
          <span>2nd place credit</span>
          <Dollars cents={secondCents} onChange={setSecondCents} label="2nd place credit" data="second" />
        </div>
      )}
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
          const r = await save(
            () => api('POST', `/api/admin/tournament/${t.id}/awards`, { action: 'save', first, ...(doubles ? {} : { second, secondCents }), championCents: champion, weeks }),
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
