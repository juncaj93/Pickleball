import { useInstant } from '../../InstantTaps';
import { useAction } from './action';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarkName, Task, TaskButton, TaskStep } from '../../../shared/tasks';
import { api, ApiError, isIOS, storageGet, storageSet, usePretend } from '../../lib';
import { CourtReserveLink, MessageIcon, useToast } from '../../ui';
import { SETTLE_MS, settleTaps, tapsHeld, useTapsHeld } from './tapGuard';
import type { AdminCtx } from '../Admin';
import { COURTRESERVE_BOOKING_URL } from '../../../shared/settings';
import { formatShortDate, formatTime } from '../../../shared/time';
import { courtCards, type CourtCard, textHref, visibleTasks } from './doNow';
import { type Dismissed, pruneDismissed, readDismissed, writeDismissed } from './dismiss';
import { DismissX } from './DismissX';
import '../../do-now.css';
import { AlertCard, type AcIconName, type AcTone } from '../../AlertCard';
import { splitFirst } from '../../../shared/zip11';

/** Save a card tap on the server. */
export function markTask(sessionId: string, mark: MarkName) {
  return api('POST', `/api/admin/sessions/${sessionId}/task-mark`, { mark });
}

const KIND_LABEL: Record<Task['kind'], string> = {
  cancel: 'Cancel',
  night: 'Night before',
  book: 'Book the court',
  nocourt: 'No court yet',
  nocourt_later: 'No court yet',
  finalize: 'After the game',
};

/**
 * "Do this now": the one most urgent task at the top of Home, in the same
 * words as its Telegram alert, with "+N more" for the rest. Every button
 * saves a mark on the server, so the alert for a task already done stays
 * silent. With nothing to do, nothing shows.
 */
/**
 * The time the card works from: the server's "now" from the last load (so
 * Pretend it's... and test clocks agree with the server), moving forward
 * each minute while the page stays open.
 */
export function useServerNow(serverNow: string): number {
  const loadedAt = useMemo(() => Date.now(), [serverNow]);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return Date.parse(serverNow) + Math.max(0, tick - loadedAt);
}

export function DoNowCard({ ctx, hideBook }: { ctx: AdminCtx; hideBook?: boolean }) {
  const nowMs = useServerNow(ctx.d.now);
  const [more, setMore] = useState(false);
  const adminUrl = `${window.location.origin}/admin`;
  const all = visibleTasks(ctx.d, nowMs, adminUrl);
  // The night-before text card has an X: hidden on this phone until the count changes (see dismiss.tsx).
  const nights = all.filter((t) => t.kind === 'night').map((t) => ({ key: t.id, token: nightToken(ctx, t) }));
  const [dismissed, setDismissed] = useState<Dismissed>(() => readDismissed(storageGet));
  const pretending = usePretend() !== null;
  // Starting or ending Pretend: back to the phone's real list (demo dismissals were kept in memory only).
  // The data on screen when Pretend started or ended still belongs to the other time: no clean-up until fresh data lands.
  const staleData = useRef<unknown>(null);
  useEffect(() => {
    staleData.current = ctx.d;
    setDismissed(readDismissed(storageGet));
  }, [pretending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // While pretending it's another time the cards differ; keep the real dismissals.
    if (pretending || staleData.current === ctx.d) return;
    const next = pruneDismissed(nights, dismissed);
    if (Object.keys(next).length !== Object.keys(dismissed).length) {
      setDismissed(next);
      writeDismissed(next, storageSet);
    }
  }, [nights.map((n) => `${n.key}=${n.token}`).join('|'), dismissed, pretending]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = (t: Task) => {
    const next = { ...dismissed, [t.id]: nightToken(ctx, t) };
    setDismissed(next);
    // Pretend it's... is a demo: an X there hides the card for the demo only, never the phone's real list.
    if (!pretending) writeDismissed(next, storageSet);
  };
  const tasks = all.filter((t) => !(t.kind === 'night' && dismissed[t.id] === nightToken(ctx, t)));
  // Games never marked Booked: one court card each ("Court still needs to be booked", or after the game day "Did you guys play?").
  // hideBook (new layout): "Court still needs to be booked" lives on its game's own card instead of up here.
  const courts = courtCards(ctx.d, nowMs, adminUrl).filter((c) => !(hideBook && c.kind === 'book'));
  if (tasks.length === 0 && courts.length === 0) return null;
  const [first, ...rest] = tasks;
  const cards = ctx.d.alertCards === true;
  return (
    <section className={`do-now${cards ? ' ac-stack' : ''}`} aria-labelledby="do-now-title">
      <h2 id="do-now-title" className="sr-only">
        Do this now
      </h2>
      {courts.map((c) => (
        <CourtCardView key={c.session.id} ctx={ctx} card={c} />
      ))}
      {first && <TaskCard ctx={ctx} task={first} nowMs={nowMs} lead={courts.length === 0} onDismiss={dismiss} />}
      {first && rest.length > 0 && (
        <button type="button" className={cards ? 'ac-more-link dn-more' : 'link-btn dn-more'} aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? 'Show less' : `+${rest.length} more`}
        </button>
      )}
      {more && rest.map((t) => <TaskCard key={t.id} ctx={ctx} task={t} nowMs={nowMs} onDismiss={dismiss} />)}
    </section>
  );
}

/**
 * The court card for a game never marked Booked. Before it is over: the plain "Court still needs to be
 * booked" with the CourtReserve booking link (the one "Book a court" uses), nothing else. After the game
 * day: "Did you guys play?" with "Yes, we played" (no money moves; it brings the Finalize card into view
 * when there is one) and "Cancel game" (the usual Cancel session dialog: credit back to everyone paid).
 */
function CourtCardView({ ctx, card }: { ctx: AdminCtx; card: CourtCard }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const held = useTapsHeld();
  const s = card.session;
  // Date and start time: two games on one day (an extra game) never look the same.
  const day = `${formatShortDate(s.startsAt, ctx.d.group.timezone)} · ${formatTime(s.startsAt, ctx.d.group.timezone)}`;
  const cards = ctx.d.alertCards === true;
  if (card.kind === 'book' && cards) {
    // Zip 11, Alert cards: the same card and the same CourtReserve link, as a blue (booking) card with Book on the right.
    return (
      <AlertCard
        tone="blue"
        icon="court"
        label={`${day}: court still needs to be booked`}
        data={{ 'data-task': 'court_book', 'data-session': s.id }}
        title="Court still needs to be booked"
        sub={day}
        action={
          <a className="ac-btn" href={COURTRESERVE_BOOKING_URL} target="_blank" rel="noopener noreferrer">
            Book
            <span className="sr-only"> (opens CourtReserve)</span>
          </a>
        }
      />
    );
  }
  if (card.kind === 'book') {
    return (
      <article className="card dn-card" data-task="court_book" data-session={s.id} aria-label={`${day}: court still needs to be booked`}>
        <div className="dn-eyebrow">{day}</div>
        <p className="dn-text">Court still needs to be booked</p>
        <div className="dn-btns">
          {/* The same link, words and look as the "Book a court" pill above the games. */}
          <CourtReserveLink href={COURTRESERVE_BOOKING_URL} small>
            {ctx.d.adminR2 === true ? 'Book' : 'Book a court'}
          </CourtReserveLink>
        </div>
      </article>
    );
  }
  const played = async () => {
    if (working.current || tapsHeld()) return;
    working.current = true;
    const tappedFrom = document.activeElement;
    let saved = false;
    // Until the cards stop moving, no guarded button (next game's Yes, Everyone played) takes a tap.
    settleTaps(60_000);
    setBusy(true);
    try {
      await markTask(s.id, 'played');
      saved = true;
      await ctx.reload();
      toast('Saved');
      // The Finalize card for this game, if there is one, shows now: bring it into view once it is drawn.
      // (A fresh load can land a moment later, after the tap lets go: wait up to 3 seconds.)
      // The organizer moved on (opened a sheet, or focus went somewhere on purpose): leave the screen alone.
      const movedOn = () => {
        const a = document.activeElement;
        return !!document.querySelector('dialog[open]') || (!!a && a !== document.body && a !== tappedFrom && !a.closest('[data-finalize]'));
      };
      for (let i = 0; i < 60; i++) {
        if (movedOn()) break;
        const el = document.querySelector<HTMLElement>(`[data-finalize="${CSS.escape(s.id)}"]`);
        if (el) {
          el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
          // Focus the card itself, never a money button (a stray Enter or tap must not finalize). A redraw right
          // after can drop focus, so check a few times.
          for (let k = 0; k < 3; k++) {
            if (movedOn()) break;
            const card = document.querySelector<HTMLElement>(`[data-finalize="${CSS.escape(s.id)}"]`);
            if (card && document.activeElement !== card) card.focus({ preventScroll: true });
            await new Promise((r) => setTimeout(r, 250));
          }
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      working.current = false;
      setBusy(false);
      // Cards moved only when it saved; after a failure nothing moved, so a retry works at once.
      // Cards moved only when it saved; after a failure nothing moved, so a retry works at once.
      settleTaps(saved ? SETTLE_MS : 0);
    }
  };
  if (cards) {
    // Zip 11, Alert cards: green (after the game), both answers under the text.
    return (
      <AlertCard
        tone="green"
        icon="ok"
        label={`${day}: did you guys play?`}
        data={{ 'data-task': 'court_played', 'data-session': s.id }}
        title="Did you guys play?"
        sub={day}
        actions={
          <>
            <button type="button" className="ac-btn" disabled={busy || held} data-action="played" onClick={() => void played()}>
              {busy ? 'Saving…' : 'Yes, we played'}
            </button>
            <button type="button" className="ac-btn ac-out" data-ac-tone="red" disabled={busy || held} data-action="cancel-game" onClick={() => !tapsHeld() && ctx.open('cancel', s.id)}>
              Cancel game
            </button>
          </>
        }
      />
    );
  }
  return (
    <article className="card dn-card" data-task="court_played" data-session={s.id} aria-label={`${day}: did you guys play?`}>
      <div className="dn-eyebrow">{day}</div>
      <p className="dn-text">Did you guys play?</p>
      <div className="dn-btns">
        <button type="button" className="btn small" disabled={busy || held} data-action="played" onClick={() => void played()}>
          {busy ? 'Saving…' : 'Yes, we played'}
        </button>
        <button type="button" className="btn small danger" disabled={busy || held} data-action="cancel-game" onClick={() => !tapsHeld() && ctx.open('cancel', s.id)}>
          Cancel game
        </button>
      </div>
    </article>
  );
}

/** What the night-before card is about: the game's time, the number in and which text it offers. A change shows a dismissed card again. */
function nightToken(ctx: AdminCtx, t: Task): string {
  const s = ctx.d.sessions.find((x) => x.id === t.sessionId);
  return `${s?.startsAt ?? ''}:${s?.confirmedCount ?? 0}:${t.buttons[0]?.label ?? ''}`;
}

function TaskCard({ ctx, task, nowMs, lead, onDismiss }: { ctx: AdminCtx; task: Task; nowMs: number; lead?: boolean; onDismiss?: (t: Task) => void }) {
  const s = ctx.d.sessions.find((x) => x.id === task.sessionId);
  if (!s) return null;
  // A checklist shows the buttons of its first open step only.
  const current = task.steps.find((st) => !st.done && st.enabled);
  // Only the night-before text is a notice; cancel checklists and finalize need an answer.
  const canDismiss = task.kind === 'night' && !!onDismiss;
  if (ctx.d.alertCards === true) return <TaskAlertCard ctx={ctx} task={task} nowMs={nowMs} current={current} onDismiss={canDismiss ? () => onDismiss!(task) : undefined} />;
  return (
    <article className={`card dn-card${lead ? ' lead' : ''}${canDismiss ? ' dismissible' : ''}`} data-task={task.kind} data-session={task.sessionId} aria-label={`Do this now: ${task.text}`}>
      {canDismiss && <DismissX label={task.text} onDismiss={() => onDismiss!(task)} />}
      <div className="dn-eyebrow">{lead ? 'Do this now' : KIND_LABEL[task.kind]}</div>
      <p className="dn-text">{task.text}</p>
      {task.steps.length > 0 ? (
        <ol className="dn-steps">
          {task.steps.map((st, i) => (
            <Step key={st.id} ctx={ctx} task={task} step={st} n={i + 1} current={st === current} nowMs={nowMs} />
          ))}
        </ol>
      ) : (
        <div className="dn-btns">
          {task.buttons.map((b, i) => (
            <Action key={b.id} ctx={ctx} task={task} b={b} primary={i === 0} nowMs={nowMs} />
          ))}
        </div>
      )}
    </article>
  );
}


/** Zip 11, Alert cards: each button's short label and color (the same action; the old label stays as the button's spoken name). */
const AC_BUTTON: Record<string, { label: string; tone: AcTone; out?: boolean }> = {
  text: { label: 'Text', tone: 'purple' },
  'court-link': { label: 'Cancel court', tone: 'blue' },
  'court-done': { label: 'Court canceled', tone: 'blue', out: true },
  cancel: { label: 'Cancel session', tone: 'red', out: true },
  'canceled-text': { label: 'Text everyone', tone: 'red', out: true },
  finalize: { label: 'Finalize', tone: 'green' },
};

const TASK_ICON: Record<Task['kind'], AcIconName> = { cancel: 'stop', night: 'text', book: 'court', nocourt: 'court', nocourt_later: 'court', finalize: 'ok' };

const TASK_TONE: Record<Task['kind'], AcTone> = { cancel: 'red', night: 'purple', book: 'blue', nocourt: 'blue', nocourt_later: 'blue', finalize: 'green' };

/**
 * Zip 11, Alert cards: one task as one action card. The words are the task's own (the same as its Telegram alert), split into a bold
 * title and a sub line; the buttons are the same buttons (a checklist shows its current step's, as before, under the text).
 */
function TaskAlertCard({ ctx, task, nowMs, current, onDismiss }: { ctx: AdminCtx; task: Task; nowMs: number; current: TaskStep | undefined; onDismiss?: () => void }) {
  const { title, rest } = splitFirst(task.text);
  const steps = task.steps.length > 0;
  const buttons = steps ? (current?.buttons ?? []) : task.buttons;
  // The night-before card: its button's long label ("Text the group to confirm") becomes the sub line, the button says "Text".
  const sub = rest || (task.kind === 'night' && task.buttons[0] ? task.buttons[0].label : '');
  const stepLine = steps && current ? `Step ${task.steps.indexOf(current) + 1} of ${task.steps.length}: ${current.label}` : '';
  const btns = buttons.map((b, i) => <Action key={b.id} ctx={ctx} task={task} b={b} primary={i === 0} nowMs={nowMs} card />);
  const many = btns.length > 1 || steps;
  return (
    <AlertCard
      tone={TASK_TONE[task.kind]}
      icon={TASK_ICON[task.kind]}
      label={`Do this now: ${task.text}`}
      data={{ 'data-task': task.kind, 'data-session': task.sessionId }}
      title={title}
      sub={
        sub || stepLine ? (
          <>
            {sub && <span className={task.kind === 'cancel' ? 'ac-sub-red' : undefined}>{sub}</span>}
            {sub && stepLine && <br />}
            {stepLine && <span data-step-line>{stepLine}</span>}
          </>
        ) : undefined
      }
      action={!many && btns.length === 1 ? btns[0] : undefined}
      actions={many && btns.length > 0 ? <>{btns}</> : undefined}
      onX={onDismiss}
      xLabel={task.text}
    />
  );
}

function Step({ ctx, task, step, n, current, nowMs }: { ctx: AdminCtx; task: Task; step: TaskStep; n: number; current: boolean; nowMs: number }) {
  const state = step.done ? 'done' : current ? 'now' : 'later';
  return (
    <li className={`dn-step ${state}`} data-step={step.id} aria-current={current ? 'step' : undefined}>
      <span className="dn-num" aria-hidden="true">
        {step.done ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 10 17 19 7.5" />
          </svg>
        ) : (
          n
        )}
      </span>
      <span className="dn-step-body">
        <span className="dn-step-label">
          {step.label}
          {step.done && <span className="sr-only"> (done)</span>}
        </span>
        {current && (
          <span className="dn-btns">
            {step.buttons.map((b, i) => (
              <Action key={b.id} ctx={ctx} task={task} b={b} primary={i === 0} nowMs={nowMs} />
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

function Action({ ctx, task, b, primary, nowMs, card }: { ctx: AdminCtx; task: Task; b: TaskButton; primary: boolean; nowMs: number; card?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const s = ctx.d.sessions.find((x) => x.id === task.sessionId)!;
  // Zip 11, Alert cards: the short label and the color of the color system; the same action below.
  const look = card ? (AC_BUTTON[b.id] ?? { label: b.label, tone: TASK_TONE[task.kind], out: !primary }) : null;
  const cls = look ? `ac-btn${look.out ? ' ac-out' : ''}` : `btn small${primary ? '' : ' secondary'}`;
  const tone = look ? { 'data-ac-tone': look.tone } : {};
  const label = look ? look.label : b.label;
  // The spoken name starts with the visible words (voice control), then the old full label: "Text: Text the group to confirm".
  const spoken = look && look.label !== b.label ? { 'aria-label': `${look.label}: ${b.label}` } : {};
  // Instant taps (INSTANT_TAPS): the shared helper (action.ts) shows this button working and keeps a second tap out. Off: as before.
  const instantOn = useInstant() !== null;
  const instantAct = useAction(ctx);
  async function run(fn: () => Promise<unknown>, msg: string | null) {
    if (instantOn) return void (await instantAct.run(fn, msg ?? undefined, { key: `donow:${task.sessionId}:${b.id}`, what: b.label }));
    setBusy(true);
    try {
      await fn();
      await ctx.reload();
      if (msg) toast(msg);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }
  const a = b.action;
  if (a.type === 'text') {
    const href = textHref(ctx.d, s, nowMs, a, isIOS);
    if (!href) {
      return (
        <button type="button" className={cls} disabled {...tone} {...spoken}>
          {!look && <MessageIcon />}
          {label}
        </button>
      );
    }
    return (
      <a
        className={cls}
        href={href}
        data-action={b.id}
        {...tone}
        {...spoken}
        onClick={() => {
          // Messages opens; the mark is saved quietly (Pretend and the demo can't save, which is fine).
          void markTask(s.id, a.mark).then(ctx.reload, () => {});
        }}
      >
        {!look && <MessageIcon />}
        {label}
      </a>
    );
  }
  if (a.type === 'link') {
    return (
      <a className={`${cls} external`} href={a.href} target="_blank" rel="noopener noreferrer" data-action={b.id} {...tone}>
        {label}
        <span className="sr-only">{look && look.label !== b.label ? ` (${b.label}, opens CourtReserve)` : ' (opens CourtReserve)'}</span>
      </a>
    );
  }
  const onClick = () => {
    if (a.type === 'mark') return run(() => markTask(s.id, a.mark), 'Saved');
    if (a.type === 'cancel') return ctx.open('cancel', s.id);
    // Finalize: the Finalize card is on Home; bring it into view.
    const el = document.querySelector<HTMLElement>(`[data-finalize="${CSS.escape(s.id)}"]`);
    el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    el?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };
  return (
    <button type="button" className={cls} disabled={busy} data-action={b.id} {...tone} {...(busy ? {} : spoken)} onClick={() => void onClick()}>
      {busy ? 'Saving…' : label}
    </button>
  );
}
