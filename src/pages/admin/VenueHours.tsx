// Zip 81 (🎾81.venue hours): Settings > Schedule > Special venue hours (pictures 1 to 4). Only while Booking hours is on (the dashboard sends
// `group.venueHours` only then).
//  - The row: "Special venue hours" and a short hint (the range running now or next, how many single days), Change.
//  - Change opens one sheet with three faces: the list (the normal line on top, the entries soonest first, a tap opens one in place with Edit
//    and Remove, a second tap closes it; "Add special hours"; the quiet "Change normal hours" link), the entry form (Name; Dates or One day;
//    From and To with a start and end per weekday, or the date with Open (start and end) or Closed; Save), and the normal week.
//  - Every save goes to the server (server/venueHours.ts), which runs the same checks as this screen (shared/venueHours.ts).
import '../../venue-hours.css';
import { type FormEvent, useState } from 'react';
import { activeSpecials, dateKeyOf, type DayHours, MIDNIGHT, type SpecialHours, type VenueHoursConfig } from '../../../shared/bookingHours';
import { normalLine, readSpecial, readWeek, specialHint, specialLines, venueConflicts } from '../../../shared/venueHours';
import { AlertCard } from '../../AlertCard';
import { hhmmToMinutes, minutesToHHMM } from '../../../shared/settings';
import { api, ApiError } from '../../lib';
import { Notice, Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';

const DAYS: { wd: number; short: string }[] = [
  { wd: 1, short: 'Mon' },
  { wd: 2, short: 'Tue' },
  { wd: 3, short: 'Wed' },
  { wd: 4, short: 'Thu' },
  { wd: 5, short: 'Fri' },
  { wd: 6, short: 'Sat' },
  { wd: 0, short: 'Sun' },
];

/** A time box's value: midnight as a closing time shows as 12:00 AM. */
const boxValue = (m: number) => (m >= MIDNIGHT ? '00:00' : minutesToHHMM(m));
/** A time box back to minutes (12:00 AM as an end means midnight; the save turns 0 into midnight). Empty: -1, which no check accepts. */
const fromBox = (v: string) => hhmmToMinutes(v) ?? -1;

type Face = { kind: 'list' } | { kind: 'form'; entry: SpecialHours | null } | { kind: 'normal' };

export function SpecialHoursRow({ ctx }: { ctx: AdminCtx }) {
  const config = ctx.d.group.venueHours;
  const [open, setOpen] = useState(false);
  const [face, setFace] = useState<Face>({ kind: 'list' });
  if (ctx.d.bookingHours !== true || !config) return null;
  const today = dateKeyOf(Date.parse(ctx.d.now), ctx.d.group.timezone);
  const title = face.kind === 'list' ? 'Special venue hours' : face.kind === 'normal' ? 'Normal hours' : 'Special hours';
  // The X on the form or the normal week goes back to the list; on the list it closes the sheet.
  const close = () => (face.kind === 'list' ? setOpen(false) : setFace({ kind: 'list' }));
  return (
    <div className="set-row-wrap" data-row="specialHours">
      <div className="set-row">
        <span className="set-label">
          <span className="set-name">Special venue hours</span> <span className="set-hint" data-special-hint>
            {specialHint(config, today)}
          </span>
        </span>
        <button
          type="button"
          className="btn small secondary set-input"
          data-special-change
          onClick={() => {
            setFace({ kind: 'list' });
            setOpen(true);
          }}
        >
          Change
        </button>
      </div>
      <Sheet open={open} title={title} onClose={close} className="vh-sheet">
        {open && face.kind === 'list' && <ListFace ctx={ctx} config={config} today={today} onAdd={() => setFace({ kind: 'form', entry: null })} onEdit={(e) => setFace({ kind: 'form', entry: e })} onNormal={() => setFace({ kind: 'normal' })} />}
        {open && face.kind === 'form' && <EntryForm key={face.entry?.id ?? 'new'} ctx={ctx} config={config} today={today} entry={face.entry} onDone={() => setFace({ kind: 'list' })} />}
        {open && face.kind === 'normal' && <NormalForm ctx={ctx} config={config} onDone={() => setFace({ kind: 'list' })} />}
      </Sheet>
    </div>
  );
}

function ListFace({ ctx, config, today, onAdd, onEdit, onNormal }: { ctx: AdminCtx; config: VenueHoursConfig; today: string; onAdd: () => void; onEdit: (e: SpecialHours) => void; onNormal: () => void }) {
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = activeSpecials(config, today);
  async function remove(e: SpecialHours) {
    setBusy(true);
    try {
      await api('POST', '/api/admin/venue-hours/remove', { id: e.id });
      await ctx.reload();
      setOpenId(null);
      toast(`${e.name} removed`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That didn’t save. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack vh-list-face">
      <p className="vh-normal" data-vh-normal>
        {normalLine(config)}
      </p>
      {list.length === 0 ? (
        <p className="vh-empty" data-vh-empty>
          No special hours. The normal hours apply every day.
        </p>
      ) : (
        <ul className="vh-list" data-vh-list>
          {list.map((e) => {
            const l = specialLines(e);
            const isOpen = openId === e.id;
            return (
              <li key={e.id} className={isOpen ? 'vh-item vh-open' : 'vh-item'} data-vh-item={e.name}>
                <button type="button" className="vh-row" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : e.id)} data-vh-toggle>
                  <b className="vh-name">{e.name}</b>
                  {e.oneDay ? (
                    <span className="vh-sub">
                      {l.dates} ·{' '}
                      {l.closed ? (
                        <span className="vh-closed" data-vh-closed>
                          Closed
                        </span>
                      ) : (
                        l.hours
                      )}
                    </span>
                  ) : (
                    <>
                      <span className="vh-sub">{l.dates}</span>
                      <span className="vh-sub">{l.hours}</span>
                    </>
                  )}
                </button>
                {isOpen && (
                  <div className="vh-actions">
                    <button type="button" className="btn secondary" disabled={busy} onClick={() => onEdit(e)} data-vh-edit>
                      Edit
                    </button>
                    <button type="button" className="btn secondary" disabled={busy} onClick={() => void remove(e)} data-vh-remove>
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn block" onClick={onAdd} data-vh-add>
        Add special hours
      </button>
      <button type="button" className="link-btn vh-normal-link" onClick={onNormal} data-vh-normal-link>
        Change normal hours
      </button>
    </div>
  );
}

/** Seven rows, Monday first: the day, a start box, "to", an end box. */
function WeekRows({ week, onChange, busy }: { week: DayHours[]; onChange: (wd: number, h: DayHours) => void; busy: boolean }) {
  return (
    <div className="vh-week" role="group" aria-label="Hours for each day">
      {DAYS.map(({ wd, short }) => (
        <div className="vh-day" key={wd} data-vh-day={short}>
          <span className="vh-day-name" id={`vh-day-${wd}`}>
            {short}
          </span>
          <input type="time" step={300} className="vh-time" aria-label={`${short} start`} disabled={busy} value={boxValue(week[wd].open)} onChange={(ev) => onChange(wd, { ...week[wd], open: fromBox(ev.target.value) })} data-vh-open={short} />
          <span className="vh-to" aria-hidden="true">
            to
          </span>
          <input type="time" step={300} className="vh-time" aria-label={`${short} end`} disabled={busy} value={boxValue(week[wd].close)} onChange={(ev) => onChange(wd, { ...week[wd], close: fromBox(ev.target.value) })} data-vh-close={short} />
        </div>
      ))}
    </div>
  );
}

function EntryForm({ ctx, config, today, entry, onDone }: { ctx: AdminCtx; config: VenueHoursConfig; today: string; entry: SpecialHours | null; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(entry?.name ?? '');
  const [oneDay, setOneDay] = useState(entry?.oneDay ?? false);
  const [from, setFrom] = useState(entry?.from ?? '');
  const [to, setTo] = useState(entry && !entry.oneDay ? entry.to : '');
  const [date, setDate] = useState(entry && entry.oneDay ? entry.from : '');
  const [week, setWeek] = useState<DayHours[]>(() => (entry?.week ?? config.normal).map((h) => ({ ...h })));
  const [closed, setClosed] = useState(entry ? entry.oneDay && !entry.day : false);
  const [day, setDay] = useState<DayHours>(() => ({ ...(entry?.day ?? config.normal[1]) }));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(ev: FormEvent) {
    ev.preventDefault();
    const body = oneDay ? { name, oneDay: true, from: date, day: closed ? null : day } : { name, oneDay: false, from, to, week };
    // The same check the server runs, so most mistakes show at once.
    const others = config.specials.filter((e) => e.id !== entry?.id);
    const r = readSpecial(body, others, today, entry?.id ?? 'new');
    if (!r.ok) return setProblem(r.message);
    setProblem(null);
    setBusy(true);
    try {
      await api('POST', '/api/admin/venue-hours/special', { ...body, ...(entry ? { id: entry.id } : {}) });
      await ctx.reload();
      toast(`${r.value.name} saved`);
      onDone();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    // noValidate: the checks are ours (readSpecial, the server's too); the browser's own `min` check would refuse editing a range that started.
    <form className="stack vh-form" onSubmit={save} noValidate data-vh-form={entry ? 'edit' : 'add'}>
      <label className="field">
        Name
        <input type="text" value={name} maxLength={60} disabled={busy} onChange={(e) => setName(e.target.value)} autoComplete="off" data-vh-name />
      </label>
      <div className="segmented" role="group" aria-label="Dates or one day">
        <button type="button" aria-pressed={!oneDay} disabled={busy} onClick={() => setOneDay(false)} data-vh-kind="dates">
          Dates
        </button>
        <button type="button" aria-pressed={oneDay} disabled={busy} onClick={() => setOneDay(true)} data-vh-kind="day">
          One day
        </button>
      </div>
      {!oneDay ? (
        <>
          <div className="time-pair">
            <label className="field">
              From
              <input type="date" value={from} min={entry && entry.from < today ? entry.from : today} disabled={busy} onChange={(e) => setFrom(e.target.value)} data-vh-from />
            </label>
            <label className="field">
              To
              <input type="date" value={to} min={from || today} disabled={busy} onChange={(e) => setTo(e.target.value)} data-vh-to />
            </label>
          </div>
          <WeekRows week={week} busy={busy} onChange={(wd, h) => setWeek((w) => w.map((x, i) => (i === wd ? h : x)))} />
        </>
      ) : (
        <>
          <label className="field">
            Date
            <input type="date" value={date} min={today} disabled={busy} onChange={(e) => setDate(e.target.value)} data-vh-date />
          </label>
          <div className="segmented" role="group" aria-label="Open or closed">
            <button type="button" aria-pressed={!closed} disabled={busy} onClick={() => setClosed(false)} data-vh-open-day>
              Open
            </button>
            <button type="button" aria-pressed={closed} disabled={busy} onClick={() => setClosed(true)} data-vh-closed-day>
              Closed
            </button>
          </div>
          {!closed && (
            <div className="time-pair">
              <label className="field">
                Start
                <input type="time" step={300} value={boxValue(day.open)} disabled={busy} onChange={(e) => setDay((d) => ({ ...d, open: fromBox(e.target.value) }))} data-vh-day-open />
              </label>
              <label className="field">
                End
                <input type="time" step={300} value={boxValue(day.close)} disabled={busy} onChange={(e) => setDay((d) => ({ ...d, close: fromBox(e.target.value) }))} data-vh-day-close />
              </label>
            </div>
          )}
        </>
      )}
      {problem && (
        <div role="alert" data-vh-problem>
          <Notice tone="danger">{problem}</Notice>
        </div>
      )}
      <button className="btn block" type="submit" disabled={busy} data-vh-save>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function NormalForm({ ctx, config, onDone }: { ctx: AdminCtx; config: VenueHoursConfig; onDone: () => void }) {
  const toast = useToast();
  const [week, setWeek] = useState<DayHours[]>(() => config.normal.map((h) => ({ ...h })));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(ev: FormEvent) {
    ev.preventDefault();
    const r = readWeek(week);
    if (!r.ok) return setProblem(r.message);
    setProblem(null);
    setBusy(true);
    try {
      await api('PUT', '/api/admin/venue-hours/normal', { week });
      await ctx.reload();
      toast('Normal hours saved');
      onDone();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack vh-form" onSubmit={save} data-vh-normal-form>
      <p className="vh-normal">The hours on every day without special hours.</p>
      <WeekRows week={week} busy={busy} onChange={(wd, h) => setWeek((w) => w.map((x, i) => (i === wd ? h : x)))} />
      {problem && (
        <div role="alert" data-vh-problem>
          <Notice tone="danger">{problem}</Notice>
        </div>
      )}
      <button className="btn block" type="submit" disabled={busy} data-vh-save>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

/** Zip 81: the event the Home conflict card sends to open the tournament's Time row (src/pages/admin/Tournament.tsx HomeCard listens). */
export const OPEN_TOURNAMENT_TIME = 'pb:open-tournament-time';

/**
 * Zip 81 (picture 5): an amber card at the top of organizer Home for every game still to come (not canceled) and the finalized tournament whose
 * time is outside that date's venue hours. "Thu Nov 26: the venue closes at noon." / "Your 8 PM game is after that." with Cancel game (the usual
 * Cancel flow) or, for the tournament, Change time (its Time row). Nothing happens on its own; the card leaves when the game is canceled or moved,
 * or the hours change. Worked out here from what Home already has: no server call, no database trip.
 */
export function VenueConflictCards({ ctx }: { ctx: AdminCtx }) {
  const config = ctx.d.group.venueHours;
  if (ctx.d.bookingHours !== true || !config) return null;
  const tz = ctx.d.group.timezone;
  const t = ctx.d.tournaments === true ? (ctx.d.tournament ?? null) : null;
  const tour = t && t.status === 'tickets' && t.startSet && t.finalDate ? { id: t.id, date: t.finalDate, start: t.start, minutes: t.minutes } : null;
  const games = ctx.d.sessions.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, canceled: s.status === 'canceled', finalized: s.finalized !== null }));
  const list = venueConflicts(config, games, tour, tz, Date.parse(ctx.d.now));
  if (list.length === 0) return null;
  const cards = ctx.d.alertCards === true;
  return (
    <section className="stack" aria-label="Venue hours" data-venue-conflicts>
      {list.map((c) => {
        const button =
          c.kind === 'game' ? (
            <button type="button" className={cards ? 'ac-btn ac-out' : 'btn secondary danger'} data-ac-tone="red" data-vh-cancel={c.id} onClick={() => ctx.open('cancel', c.id)}>
              Cancel game
            </button>
          ) : t?.timeOpen ? (
            <button type="button" className={cards ? 'ac-btn ac-out' : 'btn secondary'} data-vh-change-time onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TOURNAMENT_TIME))}>
              Change time
            </button>
          ) : null;
        if (cards) {
          return <AlertCard key={c.key} tone="amber" icon="clock" titleAs="h3" title={c.title} sub={c.sub} label={`${c.title} ${c.sub}`} data={{ 'data-venue-conflict': c.kind }} actions={button ?? undefined} />;
        }
        return (
          <article key={c.key} className="card stack" aria-label={`${c.title} ${c.sub}`} data-venue-conflict={c.kind}>
            <h3>{c.title}</h3>
            <p className="small muted">{c.sub}</p>
            {button}
          </article>
        );
      })}
    </section>
  );
}
