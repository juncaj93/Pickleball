// Zip 55 "Tournaments", piece 1, the ORGANIZER side (server/tournament.ts): Settings > Schedule > Create tournament (mocks 03, 01, 02, 24),
// the tournament's own page (who can see it, the level list of mock 14, how many can make each date and picking it, Edit, Cancel), the card on
// Home, and the level and date sheets. Only drawn while the switch is on for this phone (ctx.d.tournaments). No money moves here: the ticket
// price and the champion credit are stored for pieces 2 and 3.
import { type ReactNode, useMemo, useState } from 'react';
import {
  type AdminTournamentView,
  CREATE_MONTHS,
  dateCounts,
  dayLong,
  DEFAULT_CREDIT_CENTS,
  DEFAULT_SIZE,
  DEFAULT_TICKET_CENTS,
  defaultPlan,
  levelOf,
  levelShort,
  MAX_DATES,
  MAX_PRICE_CENTS,
  monthsBetween,
  monthStartPlus,
  NAME_MAX,
  type Plan,
  planAllowed,
  planLine,
  PLANS,
  planTitle,
  prizeLine,
  type Size,
  SIZES,
  type Visibility,
  WINNERS,
} from '../../../shared/tournament';
import { formatPrice, parseDollars } from '../../../shared/money';
import { localParts } from '../../../shared/time';
import { api, ApiError, VIEW_ONLY_MESSAGE } from '../../lib';
import { ConfirmDialog, Sheet, useToast } from '../../ui';
import { type DayLook, LevelList, MonthCalendar } from '../../tournament/parts';
import type { AdminCtx } from '../Admin';
import './tournament-admin.css';

const todayKeyOf = (nowIso: string, tz: string) => {
  const p = localParts(Date.parse(nowIso), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 && /view only/i.test(err.message) ? VIEW_ONLY_MESSAGE : err.message;
  return 'That did not work. Try again.';
}

/** One tap that saves: the server, then a fresh dashboard, then a toast. */
function useSave(ctx: AdminCtx) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function save(fn: () => Promise<unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      await ctx.reload();
      toast(done);
      return true;
    } catch (err) {
      toast(errText(err), 'error');
      if (err instanceof ApiError && err.status === 409) void ctx.reload();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, save };
}

const statusLine = (t: AdminTournamentView) =>
  t.status === 'date_picked' && t.finalDate ? `${dayLong(t.finalDate)} · ${t.signups.length} signed up` : `Sign-up open · ${t.signups.length} signed up`;

// ---------------------------------------------------------------------------------------------------------------------
// Where the organizer finds it: Settings > Schedule, and a card on Home while one is open.
// ---------------------------------------------------------------------------------------------------------------------

/** Settings > Schedule: "Create tournament" (none open) or the open tournament's row. */
export function TournamentScheduleRow({ ctx }: { ctx: AdminCtx }) {
  const [open, setOpen] = useState<null | 'create' | 'page'>(null);
  if (ctx.d.tournaments !== true) return null;
  const t = ctx.d.tournament ?? null;
  return (
    <div className="set-row-wrap" data-row="tournament">
      <button type="button" className="set-row tm-set-row" onClick={() => setOpen(t ? 'page' : 'create')} data-tm-schedule-row>
        <span className="set-label">
          <span className="set-name">{t ? t.name : 'Create tournament'}</span>
          <span className="set-hint">{t ? statusLine(t) : 'Doubles, once a year'}</span>
        </span>
        <span className="tm-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <CreateSheet ctx={ctx} open={open === 'create'} onClose={() => setOpen(null)} />
      {t && <TournamentPage ctx={ctx} t={t} open={open === 'page'} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Home: the open tournament, with the two things to do now (the level list and picking the date). */
export function TournamentHomeCard({ ctx }: { ctx: AdminCtx }) {
  const [open, setOpen] = useState<null | 'levels' | 'dates'>(null);
  const t = ctx.d.tournaments === true ? (ctx.d.tournament ?? null) : null;
  if (!t) return null;
  const who = t.visibility === 'me' ? 'Only you can see it' : 'Everyone can see it';
  return (
    <section className="tm-home card" aria-label={`${t.name}, doubles tournament`} data-tm-home>
      <div className="tm-home-top">
        <span className="tm-home-ball" aria-hidden="true" />
        <div className="tm-home-text">
          <p className="tm-home-kicker">Doubles tournament</p>
          <h2 className="tm-home-title">{t.name}</h2>
          <p className="tm-home-sub">
            {statusLine(t)} · {who}
          </p>
        </div>
      </div>
      <div className="tm-home-actions">
        <button type="button" className="btn secondary" onClick={() => setOpen('levels')} data-tm-open-levels>
          Levels
        </button>
        <button type="button" className="btn" onClick={() => setOpen('dates')} data-tm-open-dates>
          {t.status === 'date_picked' ? 'Change the date' : 'Pick the date'}
        </button>
      </div>
      <TournamentPage ctx={ctx} t={t} open={open !== null} focus={open ?? undefined} onClose={() => setOpen(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Create tournament / Edit (mocks 03, 01, 02, 24)
// ---------------------------------------------------------------------------------------------------------------------

function MoneyBox({ id, cents, onChange, label }: { id: string; cents: number | null; onChange: (c: number | null) => void; label: string }) {
  const [text, setText] = useState(cents === null ? '' : formatPrice(cents).replace('$', ''));
  return (
    <span className="tm-money">
      <span aria-hidden="true">$</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseDollars(e.target.value);
          onChange(c === null || c > MAX_PRICE_CENTS ? null : c);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </span>
  );
}

function Card({ label, chip, children, className = '', data, line }: { label: string; chip?: ReactNode; children: ReactNode; className?: string; data?: string; line?: boolean }) {
  return (
    <section className={`tm-card ${className}`} aria-label={label} data-tm-card={data}>
      <div className={line ? 'tm-card-head tm-head-line' : 'tm-card-head'}>
        <h3 className="tm-label">{label}</h3>
        {chip}
      </div>
      {children}
    </section>
  );
}

function PlanRows({ size, plan, onPick, ticketCents, longGames }: { size: Size; plan: Plan; onPick: (p: Plan) => void; ticketCents: number | null; longGames: boolean }) {
  const blocked = PLANS[size].some((p) => !planAllowed(p, longGames));
  return (
    <>
      <div className="tm-plans" role="radiogroup" aria-label="Court plan">
        {PLANS[size].map((p) => {
          const ok = planAllowed(p, longGames);
          const on = p.key === plan.key;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!ok}
              className={`tm-plan${on ? ' tm-plan-on' : ''}`}
              onClick={() => onPick(p)}
              data-plan={p.key}
            >
              <span className="tm-plan-text">
                <span className="tm-plan-title">
                  {planTitle(p)}
                  {p.best && <span className="tm-best">Best</span>}
                </span>
                <span className="tm-plan-line">{planLine(p)}</span>
              </span>
              <span className="tm-plan-price">
                <b>{ticketCents === null ? '$?' : formatPrice(ticketCents)}</b>
                <small>each</small>
              </span>
            </button>
          );
        })}
      </div>
      {blocked && <p className="tm-foot">2.5 and 3 hour games need Booking hours turned on.</p>}
    </>
  );
}

export function CreateSheet({ ctx, open, onClose, editing }: { ctx: AdminCtx; open: boolean; onClose: () => void; editing?: AdminTournamentView }) {
  // A fresh form each time it opens (the key), so a Create after a Cancel starts clean.
  return (
    <Sheet open={open} title={editing ? `Edit ${editing.name}` : 'Create tournament'} onClose={onClose} className="tm-page">
      {open && <CreateForm key={editing?.id ?? 'new'} ctx={ctx} editing={editing} onDone={onClose} />}
    </Sheet>
  );
}

function CreateForm({ ctx, editing, onDone }: { ctx: AdminCtx; editing?: AdminTournamentView; onDone: () => void }) {
  const tz = ctx.d.group.timezone;
  const longGames = ctx.d.longGames === true;
  const today = todayKeyOf(ctx.d.now, tz);
  const [name, setName] = useState(editing?.name ?? '');
  const [dates, setDates] = useState<string[]>(editing?.offeredDates ?? []);
  const [size, setSize] = useState<Size>(((editing && (SIZES as readonly number[]).includes(editing.size) ? editing.size : DEFAULT_SIZE) as Size));
  const [plan, setPlan] = useState<Plan>(() => {
    const s = (editing && (SIZES as readonly number[]).includes(editing.size) ? editing.size : DEFAULT_SIZE) as Size;
    const found = editing ? PLANS[s].find((p) => p.courts === editing.courts && p.minutes === editing.minutes && p.start === editing.start) : null;
    return found ?? defaultPlan(s, longGames);
  });
  const [ticket, setTicket] = useState<number | null>(editing?.ticketCents ?? DEFAULT_TICKET_CENTS);
  const [credit, setCredit] = useState<number | null>(editing?.championCreditCents ?? DEFAULT_CREDIT_CENTS);
  const [visibility, setVisibility] = useState<Visibility>(editing?.visibility ?? 'me');
  const [error, setError] = useState<string | null>(null);
  const { busy, save } = useSave(ctx);
  // The Create calendar: this month and the next five (and any month an edited tournament already offers).
  const months = useMemo(() => {
    const last = [monthStartPlus(today, CREATE_MONTHS - 1), ...dates].sort().slice(-1)[0];
    return monthsBetween([today, ...dates].sort()[0], last);
  }, [today, dates]);
  const offered = new Set(editing?.offeredDates ?? []);
  const look = (d: string): DayLook => (dates.includes(d) ? 'on' : d < today && !offered.has(d) ? 'past' : 'off');
  const pickSize = (s: Size) => {
    setSize(s);
    // Each size has its own plans (mocks 01, 02): a new size starts on its own best one.
    setPlan(defaultPlan(s, longGames));
  };
  async function submit() {
    const n = name.trim();
    const problem = !n
      ? 'Type a name.'
      : Array.from(n).length > NAME_MAX
        ? `Keep the name to ${NAME_MAX} letters.`
        : dates.length === 0
          ? 'Pick at least one date.'
          : dates.length > MAX_DATES
            ? `Pick at most ${MAX_DATES} dates.`
            : ticket === null
              ? 'Type a ticket price.'
              : credit === null
                ? 'Type a credit amount ($0 to skip it).'
                : null;
    setError(problem);
    if (problem) return;
    const body = { name: n, dates, size, courts: plan.courts, minutes: plan.minutes, start: plan.start, ticketCents: ticket, creditCents: credit, visibility };
    const ok = editing
      ? await save(() => api('PUT', `/api/admin/tournament/${editing.id}`, body), 'Saved')
      : await save(() => api('POST', '/api/admin/tournament', body), visibility === 'me' ? 'Sign-up is open. Only you can see it.' : 'Sign-up is open for everyone');
    if (ok) onDone();
  }
  return (
    <div className="tm-form stack" data-tm-form={editing ? 'edit' : 'create'}>
      <Card label={editing ? 'Tournament' : 'New tournament'} data="name">
        <input
          className="tm-name"
          type="text"
          value={name}
          maxLength={NAME_MAX + 8}
          placeholder="Winter Classic"
          aria-label="Tournament name"
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setName(e.target.value)}
          data-tm-name
        />
        <div className="tm-card-head tm-sub-head">
          <h3 className="tm-label">Dates to offer</h3>
          <span className="tm-chip" data-tm-lit>
            {dates.length} lit
          </span>
        </div>
        <MonthCalendar
          months={months}
          variant="offer"
          label="Dates to offer"
          look={look}
          // Opens on the first lit date; with none, on next month once this month is half over (the mock opens on next month).
          scrollTo={dates[0] ?? (Number(today.slice(8)) >= 15 ? monthStartPlus(today, 1) : null)}
          onTap={(d) => setDates((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}
        />
        <div className="tm-facts">
          <div className="tm-fact">
            <span>Start time</span>
            <b>7 to 7:30 PM, by players</b>
          </div>
          <div className="tm-fact">
            <span>Ends</span>
            <b>10 PM close</b>
          </div>
        </div>
      </Card>

      <Card label="Players expected" data="size">
        <div className="segmented tm-seg" role="group" aria-label="Players expected">
          {SIZES.map((s) => (
            <button key={s} type="button" aria-pressed={size === s} onClick={() => pickSize(s)} data-size={s}>
              {s}
            </button>
          ))}
        </div>
        <PlanRows size={size} plan={plan} onPick={setPlan} ticketCents={ticket} longGames={longGames} />
      </Card>

      <Card label="Champion prize" data="prize" line>
        <div className="tm-rows">
          <label className="tm-row" htmlFor="tm-credit">
            <span>Game credit for each winner</span>
            <MoneyBox id="tm-credit" cents={credit} onChange={setCredit} label="Game credit for each winner" />
          </label>
          <div className="tm-row">
            <span>Winners</span>
            <b>{WINNERS} players</b>
          </div>
          <div className="tm-row">
            <span>Total credit</span>
            <b data-tm-total>{credit === null ? '$?' : formatPrice(credit * WINNERS)}</b>
          </div>
        </div>
        <p className="tm-card-note">Medal and banner are automatic. Set the credit to $0 to skip it.</p>
      </Card>

      <Card label="Ticket price" data="ticket" line>
        <div className="tm-rows">
          <label className="tm-row" htmlFor="tm-ticket">
            <span>Each player pays</span>
            <MoneyBox id="tm-ticket" cents={ticket} onChange={setTicket} label="Each player pays" />
          </label>
          <div className="tm-row">
            <span>Same for 6, 8, 10 and 12 players</span>
            <b>Fixed</b>
          </div>
        </div>
        <p className="tm-card-note">
          {editing ? 'You host and pay the court bill. Change the price any time before tickets open.' : 'You host and pay the court bill. Change the price any time before sign-up opens.'}
        </p>
      </Card>

      <Card label="What players see" data="players-see">
        <p className="tm-says">
          Sign-up says: <b>{prizeLine(credit ?? 0)}</b>
        </p>
      </Card>

      <Card label="Who can see it" data="who">
        <div className="segmented tm-seg tm-seg-who" role="group" aria-label="Who can see it">
          <button type="button" aria-pressed={visibility === 'me'} onClick={() => setVisibility('me')} data-vis="me">
            Only me
          </button>
          <button type="button" aria-pressed={visibility === 'all'} onClick={() => setVisibility('all')} data-vis="all">
            Everyone
          </button>
        </div>
        <p className="tm-card-note tm-who-note">Look at it on your own phone first, then switch to Everyone.</p>
      </Card>

      {error && (
        <p className="field-error" role="alert" data-tm-error>
          {error}
        </p>
      )}
      <button type="button" className="btn block tm-go" disabled={busy} onClick={() => void submit()} data-tm-open-signup>
        {busy ? 'Working…' : editing ? 'Save changes' : visibility === 'me' ? 'Open sign-up (only me)' : 'Open sign-up (everyone)'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The tournament's own page: who can see it, the level list (mock 14), the dates and picking one, the settings, Cancel.
// ---------------------------------------------------------------------------------------------------------------------

export function TournamentPage({ ctx, t, open, onClose, focus }: { ctx: AdminCtx; t: AdminTournamentView; open: boolean; onClose: () => void; focus?: 'levels' | 'dates' }) {
  return (
    <Sheet open={open} title={t.name} onClose={onClose} className="tm-page">
      {open && <PageBody ctx={ctx} t={t} focus={focus} onClosed={onClose} />}
    </Sheet>
  );
}

function PageBody({ ctx, t, focus, onClosed }: { ctx: AdminCtx; t: AdminTournamentView; focus?: 'levels' | 'dates'; onClosed: () => void }) {
  const { busy, save } = useSave(ctx);
  const [levelFor, setLevelFor] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const counts = useMemo(() => new Map(dateCounts(t.offeredDates, t.signups).map((c) => [c.day, c.names])), [t]);
  const best = Math.max(0, ...[...counts.values()].map((n) => n.length));
  const months = useMemo(() => (t.offeredDates.length ? monthsBetween(t.offeredDates[0], t.offeredDates[t.offeredDates.length - 1]) : []), [t.offeredDates]);
  const offered = new Set(t.offeredDates);
  const today = todayKeyOf(ctx.d.now, ctx.d.group.timezone);
  // A day that has passed can no longer be picked (its count still shows).
  const look = (d: string): DayLook => (d === t.finalDate ? 'on' : offered.has(d) ? (d < today ? 'past' : 'open') : 'off');
  const who = t.signups.find((s) => s.playerId === levelFor) ?? null;
  // Open on the part the Home card asked for.
  const scrollRef = (el: HTMLElement | null) => {
    if (el && focus) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  };
  return (
    <div className="tm-form stack" data-tm-page>
      <Card label="Who can see it" chip={<span className="tm-chip">{t.status === 'date_picked' ? 'Date picked' : 'Sign-up open'}</span>} data="page-who">
        <div className="segmented tm-seg tm-seg-who" role="group" aria-label="Who can see it">
          {(['me', 'all'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={t.visibility === v}
              disabled={busy}
              onClick={() => t.visibility !== v && void save(() => api('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility: v }), v === 'all' ? 'Everyone can see it now' : 'Only you can see it now')}
              data-vis={v}
            >
              {v === 'me' ? 'Only me' : 'Everyone'}
            </button>
          ))}
        </div>
        <p className="tm-card-note tm-who-note">{t.visibility === 'me' ? 'Players see nothing yet.' : 'Every player sees the card on Home.'}</p>
      </Card>

      <section className="tm-card tm-levels-card" aria-label="Levels" data-tm-card="levels" ref={focus === 'levels' ? scrollRef : undefined}>
        <div className="tm-card-head tm-head-line">
          <h3 className="tm-label">Levels</h3>
          <span className="tm-chip" data-tm-count>
            {t.signups.length} {t.signups.length === 1 ? 'player' : 'players'}
          </span>
        </div>
        {t.signups.length === 0 ? (
          <p className="tm-empty">Nobody has signed up yet.</p>
        ) : (
          <ul className="tm-lrows">
            {t.signups.map((s) => (
              <li key={s.playerId} className="tm-lrow" data-tm-level-row={s.name}>
                <span className="tm-lrow-text">
                  <b className="tm-lrow-name">{s.name}</b>
                  <span className="tm-lrow-picked">Picked {levelShort(s.pickedLevel)}</span>
                </span>
                <b className="tm-lrow-level" data-tm-level>
                  {levelShort(s.level)}
                </b>
                <button type="button" className="tm-pencil" aria-label={`Change ${s.name}'s level`} onClick={() => setLevelFor(s.playerId)} data-tm-pencil>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
                    <path d="M13.5 6.5l4 4" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tm-card" aria-label="Pick the date" data-tm-card="dates" ref={focus === 'dates' ? scrollRef : undefined}>
        <div className="tm-card-head">
          <h3 className="tm-label">Pick the date</h3>
          <span className="tm-chip">{t.finalDate ? dayLong(t.finalDate) : `${t.offeredDates.length} offered`}</span>
        </div>
        <p className="tm-card-note tm-dates-note" data-tm-dates-note>
          {!t.finalDate && !t.offeredDates.some((d) => d >= today)
            ? 'Every date you offered has passed. Tap Edit below to offer new ones.'
            : 'The number on each date is how many can play. Tap a date to pick it.'}
        </p>
        <MonthCalendar
          months={months}
          variant="counts"
          boxed={false}
          label="Offered dates, with how many can play"
          look={look}
          onTap={(d) => offered.has(d) && (d >= today || d === t.finalDate) && setDay(d)}
          badge={(d) => (offered.has(d) ? <span className={(counts.get(d)?.length ?? 0) === best && best > 0 ? 'tm-best-count' : undefined}>{counts.get(d)?.length ?? 0}</span> : null)}
        />
      </section>

      <Card label="Settings" data="settings" line>
        <div className="tm-rows">
          <div className="tm-row">
            <span>Players expected</span>
            <b>{t.size}</b>
          </div>
          <div className="tm-row">
            <span>Court plan</span>
            <b>{planTitle(t)}</b>
          </div>
          <div className="tm-row">
            <span>Ticket price</span>
            <b>{formatPrice(t.ticketCents)}</b>
          </div>
          <div className="tm-row">
            <span>Champion credit</span>
            <b>{formatPrice(t.championCreditCents)}</b>
          </div>
        </div>
        <button type="button" className="btn secondary block tm-edit" onClick={() => setEditing(true)} data-tm-edit-settings>
          Edit
        </button>
      </Card>

      {t.backedOut.length > 0 && <p className="tm-card-note tm-backed">Backed out: {t.backedOut.map((b) => b.name).join(', ')}</p>}

      <button type="button" className="tm-cancel-link" onClick={() => setAskCancel(true)} data-tm-cancel>
        Cancel tournament
      </button>

      <LevelSheet ctx={ctx} t={t} who={who} onClose={() => setLevelFor(null)} />
      <DateSheet ctx={ctx} t={t} day={day} names={day ? (counts.get(day) ?? []) : []} onClose={() => setDay(null)} />
      <CreateSheet ctx={ctx} open={editing} editing={t} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={askCancel}
        title="Cancel the tournament?"
        body={<p>Players stop seeing the {t.name}. The list stays saved. Nothing was paid, so nothing comes back.</p>}
        cancelLabel="Keep it"
        confirmLabel="Cancel tournament"
        danger
        busy={busy}
        onCancel={() => setAskCancel(false)}
        onConfirm={async () => {
          const ok = await save(() => api('POST', `/api/admin/tournament/${t.id}/cancel`, {}), 'Tournament canceled');
          setAskCancel(false);
          if (ok) onClosed();
        }}
      />
    </div>
  );
}

/** Mock 14: one player's level. Their own pick is tinted ("SAGE PICKED"), yours is boxed ("YOUR PICK"); Save sets it. */
function LevelSheet({ ctx, t, who, onClose }: { ctx: AdminCtx; t: AdminTournamentView; who: AdminTournamentView['signups'][number] | null; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const [pick, setPick] = useState<number | null>(null);
  const value = pick ?? who?.level ?? null;
  const first = (who?.name ?? '').split(' ')[0];
  return (
    <Sheet
      open={!!who}
      title={who ? `${first}’s level` : 'Level'}
      onClose={() => {
        setPick(null);
        onClose();
      }}
      className="tm-level-sheet"
    >
      {who && (
        <div className="stack" data-tm-level-sheet>
          <LevelList flat value={value} onPick={setPick} theirPick={who.pickedLevel} theirName={who.name} />
          <button
            type="button"
            className="btn block tm-go"
            disabled={busy || value === null}
            onClick={async () => {
              if (value === null) return;
              const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}/level`, { playerId: who.playerId, level: value }), `${first} is ${levelShort(value)}`);
              if (ok) {
                setPick(null);
                onClose();
              }
            }}
            data-tm-level-save
          >
            {busy ? 'Saving…' : `Save ${levelOf(value ?? 0)?.short ?? ''}`}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** One offered date: who can make it, and Pick (or, for the picked one, take it back). */
function DateSheet({ ctx, t, day, names, onClose }: { ctx: AdminCtx; t: AdminTournamentView; day: string | null; names: string[]; onClose: () => void }) {
  const { busy, save } = useSave(ctx);
  const cant = day ? t.signups.filter((s) => !s.dates.includes(day)).map((s) => s.name) : [];
  const isFinal = !!day && day === t.finalDate;
  return (
    <Sheet open={!!day} title={day ? dayLong(day) : 'Date'} onClose={onClose} className="tm-date-sheet">
      {day && (
        <div className="stack" data-tm-date-sheet={day}>
          <p className="tm-date-count">
            <b>{names.length}</b> of {t.signups.length} can play
          </p>
          {names.length > 0 && (
            <p className="tm-date-names">
              <span>Can play:</span> {names.join(', ')}
            </p>
          )}
          {cant.length > 0 && (
            <p className="tm-date-names tm-cant">
              <span>Can’t:</span> {cant.join(', ')}
            </p>
          )}
          {isFinal ? (
            <>
              <p className="tm-card-note">This is the date. Players see it on their card with “Tickets open soon”.</p>
              <button
                type="button"
                className="btn secondary block"
                disabled={busy}
                onClick={async () => {
                  const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}/date`, { date: null }), 'Date taken back');
                  if (ok) onClose();
                }}
                data-tm-date-clear
              >
                Take back the date
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn block tm-go"
              disabled={busy}
              onClick={async () => {
                const ok = await save(() => api('PUT', `/api/admin/tournament/${t.id}/date`, { date: day }), `${dayLong(day)} is the date`);
                if (ok) onClose();
              }}
              data-tm-date-pick
            >
              {busy ? 'Working…' : `Pick ${dayLong(day)}`}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
