// Zip 55 "Tournaments", piece 1, the PLAYER side: the pinned ticket card at the top of Home (mocks 04, 07, 08), the "Only you can see this"
// strip (mock 04), the 2-step sign-up sheet (05, 06), "See who's signed up" (names only), Edit my sign-up (13) and the Back out confirm (13b).
// Built only for states 1 (before you sign up) and 2 (signed up, date not picked yet) and the "Date picked" look; Lock my spot, Join waitlist
// and Pay are piece 2. No money moves anywhere here.
//
// This file is its own download (src/TournamentSlot.tsx loads it): a phone fetches it only when the server sends a tournament for it, so with
// the switch off (or a tournament on Only me) a player's download is exactly main's.
import { useMemo, useState } from 'react';
import type { PlayerTournamentView } from '../../shared/tournament';
import { dayShort, levelLabel, LEVEL_NOTE, monthsBetween, monthSpan, startLabel, stubParts } from '../../shared/tournament';
import { api, ApiError, VIEW_ONLY_MESSAGE } from '../lib';
import { ConfirmDialog, Pickleball, Sheet, useToast } from '../ui';
import { type DayLook, LevelList, MonthCalendar } from './parts';

const STEPS = ['Vote', 'Tickets', 'Teams', 'Games', 'Final'];

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 && /view only/i.test(err.message) ? VIEW_ONLY_MESSAGE : err.message;
  return 'That did not work. Try again.';
}

export default function TournamentHome({ t, onChanged }: { t: PlayerTournamentView; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<null | 'signup' | 'edit' | 'who'>(null);
  const [askOut, setAskOut] = useState(false);
  const [askShow, setAskShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const signed = t.me !== null;

  async function run(fn: () => Promise<unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      await onChanged();
      toast(done);
      return true;
    } catch (err) {
      toast(errorText(err), 'error');
      // Something changed under the sheet (the date was picked, the tournament closed): show what is true now.
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) void onChanged();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tc-wrap stack" data-tournament={t.status}>
      {t.onlyMe && (
        <div className="tc-strip" role="note" data-tc-strip>
          <div className="tc-strip-text">
            <p className="tc-strip-title">Only you can see this</p>
            <p className="tc-strip-sub">Players don't see the {t.name} yet.</p>
          </div>
          <button type="button" className="btn" onClick={() => setAskShow(true)} data-tc-show>
            Show to everyone
          </button>
        </div>
      )}
      <TicketCard
        t={t}
        onSignUp={() => setSheet('signup')}
        onWho={() => setSheet('who')}
        onEdit={() => setSheet('edit')}
        onDropOut={() => setAskOut(true)}
      />
      <SignUpSheet
        key={`signup-${sheet === 'signup'}`}
        t={t}
        open={sheet === 'signup'}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={async (level, dates) => {
          const ok = await run(() => api('POST', '/api/tournament/signup', { tournamentId: t.id, level, dates }), "You're on the list");
          if (ok) setSheet(null);
        }}
      />
      {signed && (
        <EditSheet
          key={`edit-${sheet === 'edit'}`}
          t={t}
          open={sheet === 'edit'}
          busy={busy}
          onClose={() => setSheet(null)}
          onBackOut={() => {
            setSheet(null);
            setAskOut(true);
          }}
          onSubmit={async (level, dates) => {
            const ok = await run(() => api('PUT', '/api/tournament/signup', { tournamentId: t.id, level, ...(dates ? { dates } : {}) }), 'Saved');
            if (ok) setSheet(null);
          }}
        />
      )}
      <WhoSheet t={t} open={sheet === 'who'} onClose={() => setSheet(null)} />
      <ConfirmDialog
        open={askOut}
        title="Back out?"
        body={<p className="tm-confirm-text">Are you sure you want to back out of the {t.name}? You come off the list. You can sign up again if you change your mind.</p>}
        cancelLabel="Stay signed up"
        confirmLabel="Yes, back out"
        danger
        busy={busy}
        onCancel={() => setAskOut(false)}
        onConfirm={async () => {
          const ok = await run(() => api('POST', '/api/tournament/back-out', { tournamentId: t.id }), "You're off the list");
          if (ok) setAskOut(false);
        }}
      />
      {t.onlyMe && (
        <ConfirmDialog
          open={askShow}
          title="Show to everyone?"
          body={<p className="tm-confirm-text">Every player sees the {t.name} on Home and can sign up.</p>}
          confirmLabel="Show to everyone"
          busy={busy}
          onCancel={() => setAskShow(false)}
          onConfirm={async () => {
            const ok = await run(() => api('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility: 'all' }), 'Everyone can see it now');
            if (ok) setAskShow(false);
          }}
        />
      )}
    </div>
  );
}

/** The faint court drawn in the card's top right corner (mock 04), anchored to the right edge so it sits the same on every width. */
function Court() {
  return (
    <svg className="tc-court" viewBox="0 0 224 176" aria-hidden="true" focusable="false">
      <line x1="1" y1="14" x2="224" y2="14" />
      <line x1="1" y1="87" x2="224" y2="87" />
      <line x1="1" y1="160" x2="224" y2="160" />
      <line x1="1" y1="14" x2="1" y2="176" />
      <line x1="83" y1="14" x2="83" y2="160" />
      <line x1="122" y1="14" x2="122" y2="160" />
      <line x1="160" y1="14" x2="160" y2="160" />
    </svg>
  );
}

export function TicketCard({
  t,
  onSignUp,
  onWho,
  onEdit,
  onDropOut,
}: {
  t: PlayerTournamentView;
  onSignUp: () => void;
  onWho: () => void;
  onEdit: () => void;
  onDropOut: () => void;
}) {
  const signed = t.me !== null;
  const picked = t.status === 'date_picked' && !!t.finalDate;
  const stub = picked ? stubParts(t.finalDate!) : null;
  const n = t.names.length;
  // Every date on offer (or the picked one) has passed: nothing to pick, so no Sign up (the list, Edit and Drop out stay for those on it).
  const noDates = t.openDates.length === 0;
  const kicker = picked ? 'Date picked' : signed ? 'You’re on the list' : 'Doubles tournament';
  const sub = noDates
    ? picked
      ? 'That date has passed.'
      : 'The dates offered have passed.'
    : picked
      ? 'Tickets open soon'
      : signed
        ? 'We’re picking the date. Tickets open after that.'
        : n > 0
          ? `${n} signed up · pick the dates you can play`
          : 'Pick the dates you can play';
  // Piece 1: VOTE while the date is being picked; once it is picked, VOTE is done and TICKETS is next (as state 3's track).
  const now = picked ? 1 : 0;
  const state = picked ? 'date' : signed ? 'listed' : 'open';
  return (
    <section className="tc" aria-label={`${t.name}, doubles tournament`} data-tc={state}>
      <Court />
      <div className="tc-top">
        <div className="tc-stub" aria-label={picked ? `On ${stub!.weekday} ${stub!.month} ${stub!.day} at ${startLabel(t.start)}` : `Date not picked yet, around ${startLabel(t.start)}`}>
          <span className="tc-wd" aria-hidden="true">
            {stub ? stub.weekday : 'Date'}
          </span>
          <span className="tc-day" aria-hidden="true">
            {stub ? stub.day : '?'}
          </span>
          <span className="tc-mon" aria-hidden="true">
            {stub ? stub.month : monthSpan(t.openDates) || '\u00a0'}
          </span>
          <span className="tc-time" aria-hidden="true">
            {startLabel(t.start)}
          </span>
        </div>
        <div className="tc-main">
          <p className="tc-kicker">
            <span className="tc-kdot" aria-hidden="true" />
            {kicker}
          </p>
          <h2 className={Array.from(t.name).length >= 17 ? 'tc-title tc-title-long' : 'tc-title'}>{t.name}</h2>
          <p className="tc-sub" data-tc-sub>
            {sub}
          </p>
        </div>
      </div>
      {(signed || !noDates) && (
        <div className="tc-actions">
          {signed ? (
            <button type="button" className="tc-btn tc-gray" onClick={onWho} data-tc-who>
              See who’s signed up
            </button>
          ) : (
            <button type="button" className="tc-btn tc-lime" onClick={onSignUp} data-tc-signup>
              Sign up
            </button>
          )}
        </div>
      )}
      {signed && (
        <div className="tc-links">
          <button type="button" className="tc-link" onClick={onEdit} data-tc-edit>
            Edit sign-up
          </button>
          <button type="button" className="tc-link" onClick={onDropOut} data-tc-drop>
            Drop out
          </button>
        </div>
      )}
      <ol className="tc-track" aria-label="Tournament steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < now ? 'tc-step-done' : i === now ? 'tc-step-now' : undefined} aria-current={i === now ? 'step' : undefined}>
            <span className="tc-step-dot" aria-hidden="true" />
            <span className="tc-step-label">{s.toUpperCase()}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The months a player's calendar shows: from the first open date's month to the last's. */
function useMonths(days: readonly string[]) {
  return useMemo(() => (days.length ? monthsBetween([...days].sort()[0], [...days].sort()[days.length - 1]) : []), [days]);
}

function DatesPicker({ t, picked, setPicked, summary = true }: { t: PlayerTournamentView; picked: string[]; setPicked: (d: string[]) => void; summary?: boolean }) {
  const months = useMonths(t.openDates);
  const open = new Set(t.openDates);
  const look = (d: string): DayLook => (picked.includes(d) ? 'on' : open.has(d) ? 'open' : 'off');
  return (
    <>
      {summary && (
        <div className="tm-picked" data-tm-picked aria-live="polite">
          <b>{picked.length} picked</b>
          {picked.length > 0 && <span>{picked.map(dayShort).join(' · ')}</span>}
        </div>
      )}
      <MonthCalendar
        months={months}
        variant="pick"
        boxed={false}
        label="Dates that work"
        look={look}
        onTap={(d) => {
          if (!open.has(d)) return;
          setPicked(picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort());
        }}
      />
    </>
  );
}

function SignUpSheet({
  t,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  t: PlayerTournamentView;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (level: number, dates: string[]) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [level, setLevel] = useState<number | null>(null);
  // Once the date is picked there is one date to pick: it starts picked.
  const [pickedRaw, setPicked] = useState<string[]>(t.openDates.length === 1 ? [...t.openDates] : []);
  // Only the dates still open count: one that closed while the sheet was open (the date was picked, midnight passed) drops out, never sent.
  const picked = pickedRaw.filter((d) => t.openDates.includes(d));
  return (
    <Sheet open={open} title="Sign up" onClose={onClose} className="tm-sheet">
      <div className="tm-steps" aria-hidden="true">
        <span className="on" />
        <span className={step === 2 ? 'on' : undefined} />
      </div>
      {step === 1 ? (
        <div data-tm-step="1">
          <p className="tm-eyebrow">Step 1 of 2 · Your level</p>
          <LevelList value={level} onPick={setLevel} />
          <p className="tm-note">{LEVEL_NOTE}</p>
          <p className="tm-prize" data-tm-prize>
            {t.prize}
          </p>
          <div className="tm-bottom">
            <button type="button" className="btn" disabled={level === null} onClick={() => setStep(2)} data-tm-next>
              Next
            </button>
          </div>
        </div>
      ) : (
        <div data-tm-step="2">
          <p className="tm-eyebrow">Step 2 of 2 · Pick every date that works</p>
          <p className="tm-help">Green dates are open. Games start around {startLabel(t.start)}.</p>
          <DatesPicker t={t} picked={picked} setPicked={setPicked} />
          <div className="tm-bottom">
            <button type="button" className="btn secondary" onClick={() => setStep(1)} data-tm-back>
              Back
            </button>
            <button type="button" className="btn" disabled={busy || picked.length === 0 || level === null} onClick={() => level !== null && onSubmit(level, picked)} data-tm-submit>
              {busy ? 'Signing up…' : 'Sign up'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function EditSheet({
  t,
  open,
  busy,
  onClose,
  onBackOut,
  onSubmit,
}: {
  t: PlayerTournamentView;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onBackOut: () => void;
  /** `dates` null: the dates were not touched (only the level is sent). */
  onSubmit: (level: number, dates: string[] | null) => void;
}) {
  const me = t.me!;
  const [level, setLevel] = useState<number>(me.level);
  const [changing, setChanging] = useState(false);
  // Only the dates still open count (once the date is picked, that one date). Untouched dates are not sent: a level-only change never makes
  // anyone tick a date they cannot make (the server keeps their dates as they are).
  const [pickedRaw, setPickedRaw] = useState<string[]>(me.dates);
  // Only the dates still open count, also after a reload under the open sheet (a date that closed drops out and is never sent).
  const picked = pickedRaw.filter((d) => t.openDates.includes(d));
  const [touched, setTouched] = useState(false);
  const setPicked = (d: string[]) => {
    setTouched(true);
    setPickedRaw(d);
  };
  return (
    <Sheet open={open} title="Edit my sign-up" onClose={onClose} className="tm-sheet">
      {changing ? (
        <div className="tm-change-level" data-tm-change-level>
          <p className="tm-eyebrow">Your level</p>
          <LevelList
            value={level}
            onPick={(v) => {
              setLevel(v);
              setChanging(false);
            }}
          />
          <p className="tm-note">{LEVEL_NOTE}</p>
        </div>
      ) : (
        <div className="tm-mylevel" data-tm-mylevel>
          <div>
            <small>YOUR LEVEL</small>
            <b>{levelLabel(level)}</b>
          </div>
          <button type="button" className="btn" onClick={() => setChanging(true)} data-tm-change>
            Change
          </button>
        </div>
      )}
      {t.openDates.length > 0 && (
        <>
          <p className="tm-eyebrow">Dates that work</p>
          <DatesPicker t={t} picked={picked} setPicked={setPicked} summary={false} />
        </>
      )}
      <div className="tm-bottom tm-bottom-stack">
        <button type="button" className="btn" disabled={busy || (touched && picked.length === 0)} onClick={() => onSubmit(level, touched ? picked : null)} data-tm-save>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="tm-quiet-link" onClick={onBackOut} data-tm-backout>
          Back out of tournament
        </button>
      </div>
    </Sheet>
  );
}

function WhoSheet({ t, open, onClose }: { t: PlayerTournamentView; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Who's signed up" onClose={onClose} className="tm-sheet">
      <ol className="tm-who" aria-label="Signed up">
        <li className="tm-who-head" aria-hidden="true">
          <span className="tm-head-label">Signed up</span>
          <span className="tm-chip">{t.names.length}</span>
        </li>
        {t.names.length === 0 && (
          <li>
            <span />
            <span />
            <span className="tm-who-name">Nobody yet</span>
          </li>
        )}
        {t.names.map((name, i) => (
          <li key={`${name}-${i}`} data-tm-who-row>
            <span className="tm-who-n">{i + 1}</span>
            <span className="tm-who-ball" aria-hidden="true">
              <Pickleball />
            </span>
            <span className="tm-who-name">{name}</span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
