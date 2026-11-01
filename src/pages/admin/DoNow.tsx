import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarkName, Task, TaskButton, TaskStep } from '../../../shared/tasks';
import { api, ApiError, isIOS, storageGet, storageSet, usePretend } from '../../lib';
import { MessageIcon, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { COURTRESERVE_BOOKING_URL } from '../../../shared/settings';
import { formatShortDate, formatTime } from '../../../shared/time';
import { courtCards, type CourtCard, textHref, visibleTasks } from './doNow';
import { type Dismissed, pruneDismissed, readDismissed, writeDismissed } from './dismiss';
import { DismissX } from './DismissX';
import '../../do-now.css';

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
function useServerNow(serverNow: string): number {
  const loadedAt = useMemo(() => Date.now(), [serverNow]);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return Date.parse(serverNow) + Math.max(0, tick - loadedAt);
}

export function DoNowCard({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useServerNow(ctx.d.now);
  const [more, setMore] = useState(false);
  const adminUrl = `${window.location.origin}/admin`;
  const all = visibleTasks(ctx.d, nowMs, adminUrl);
  // The night-before text card has an X: hidden on this phone until the count changes (see dismiss.tsx).
  const nights = all.filter((t) => t.kind === 'night').map((t) => ({ key: t.id, token: nightToken(ctx, t) }));
  const [dismissed, setDismissed] = useState<Dismissed>(() => readDismissed(storageGet));
  const pretending = usePretend() !== null;
  useEffect(() => {
    // While pretending it's another time the cards differ; keep the real dismissals.
    if (pretending) return;
    const next = pruneDismissed(nights, dismissed);
    if (Object.keys(next).length !== Object.keys(dismissed).length) {
      setDismissed(next);
      writeDismissed(next, storageSet);
    }
  }, [nights.map((n) => `${n.key}=${n.token}`).join('|'), dismissed, pretending]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = (t: Task) => {
    const next = { ...dismissed, [t.id]: nightToken(ctx, t) };
    setDismissed(next);
    writeDismissed(next, storageSet);
  };
  const tasks = all.filter((t) => !(t.kind === 'night' && dismissed[t.id] === nightToken(ctx, t)));
  // Games never marked Booked: one court card each ("Court still needs to be booked", or after the game day "Did you guys play?").
  const courts = courtCards(ctx.d, nowMs, adminUrl);
  if (tasks.length === 0 && courts.length === 0) return null;
  const [first, ...rest] = tasks;
  return (
    <section className="do-now" aria-labelledby="do-now-title">
      <h2 id="do-now-title" className="sr-only">
        Do this now
      </h2>
      {courts.map((c) => (
        <CourtCardView key={c.session.id} ctx={ctx} card={c} />
      ))}
      {first && <TaskCard ctx={ctx} task={first} nowMs={nowMs} lead={courts.length === 0} onDismiss={dismiss} />}
      {first && rest.length > 0 && (
        <button type="button" className="link-btn dn-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>
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
  const s = card.session;
  // Date and start time: two games on one day (an extra game) never look the same.
  const day = `${formatShortDate(s.startsAt, ctx.d.group.timezone)} · ${formatTime(s.startsAt, ctx.d.group.timezone)}`;
  if (card.kind === 'book') {
    return (
      <article className="card dn-card" data-task="court_book" data-session={s.id} aria-label={`${day}: court still needs to be booked`}>
        <div className="dn-eyebrow">{day}</div>
        <p className="dn-text">Court still needs to be booked</p>
        <div className="dn-btns">
          <a className="btn small external" href={COURTRESERVE_BOOKING_URL} target="_blank" rel="noopener noreferrer" data-action="book-link">
            Book on CourtReserve
            <span className="sr-only"> (opens CourtReserve)</span>
          </a>
        </div>
      </article>
    );
  }
  const played = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await markTask(s.id, 'played');
      await ctx.reload();
      toast('Saved');
      // The Finalize card for this game, if there is one, shows now: bring it into view once it is drawn.
      // (A fresh load can land a moment later, after the tap lets go: wait up to 3 seconds.)
      for (let i = 0; i < 60; i++) {
        const el = document.querySelector<HTMLElement>(`[data-finalize="${CSS.escape(s.id)}"]`);
        if (el) {
          el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
          // Focus its first button; the card is new on screen and a redraw right after can drop focus, so check twice.
          for (let k = 0; k < 3; k++) {
            const btn = document.querySelector<HTMLElement>(`[data-finalize="${CSS.escape(s.id)}"] button`);
            if (btn && document.activeElement !== btn) btn.focus({ preventScroll: true });
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
    }
  };
  return (
    <article className="card dn-card" data-task="court_played" data-session={s.id} aria-label={`${day}: did you guys play?`}>
      <div className="dn-eyebrow">{day}</div>
      <p className="dn-text">Did you guys play?</p>
      <div className="dn-btns">
        <button type="button" className="btn small" disabled={busy} data-action="played" onClick={() => void played()}>
          {busy ? 'Saving…' : 'Yes, we played'}
        </button>
        <button type="button" className="btn small danger" disabled={busy} data-action="cancel-game" onClick={() => ctx.open('cancel', s.id)}>
          Cancel game
        </button>
      </div>
    </article>
  );
}

/** What the night-before card is about: the number in and which text it offers. A change shows a dismissed card again. */
function nightToken(ctx: AdminCtx, t: Task): string {
  const s = ctx.d.sessions.find((x) => x.id === t.sessionId);
  return `${s?.confirmedCount ?? 0}:${t.buttons[0]?.label ?? ''}`;
}

function TaskCard({ ctx, task, nowMs, lead, onDismiss }: { ctx: AdminCtx; task: Task; nowMs: number; lead?: boolean; onDismiss?: (t: Task) => void }) {
  const s = ctx.d.sessions.find((x) => x.id === task.sessionId);
  if (!s) return null;
  // A checklist shows the buttons of its first open step only.
  const current = task.steps.find((st) => !st.done && st.enabled);
  // Only the night-before text is a notice; cancel checklists and finalize need an answer.
  const canDismiss = task.kind === 'night' && !!onDismiss;
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

function Action({ ctx, task, b, primary, nowMs }: { ctx: AdminCtx; task: Task; b: TaskButton; primary: boolean; nowMs: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const s = ctx.d.sessions.find((x) => x.id === task.sessionId)!;
  const cls = `btn small${primary ? '' : ' secondary'}`;
  async function run(fn: () => Promise<unknown>, msg: string | null) {
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
        <button type="button" className={cls} disabled>
          <MessageIcon />
          {b.label}
        </button>
      );
    }
    return (
      <a
        className={cls}
        href={href}
        data-action={b.id}
        onClick={() => {
          // Messages opens; the mark is saved quietly (Pretend and the demo can't save, which is fine).
          void markTask(s.id, a.mark).then(ctx.reload, () => {});
        }}
      >
        <MessageIcon />
        {b.label}
      </a>
    );
  }
  if (a.type === 'link') {
    return (
      <a className={`${cls} external`} href={a.href} target="_blank" rel="noopener noreferrer" data-action={b.id}>
        {b.label}
        <span className="sr-only"> (opens CourtReserve)</span>
      </a>
    );
  }
  const onClick = () => {
    if (a.type === 'mark') return run(() => markTask(s.id, a.mark), 'Saved');
    if (a.type === 'booked') return run(() => api('POST', `/api/admin/sessions/${s.id}/booked`, {}), 'Marked booked');
    if (a.type === 'cancel') return ctx.open('cancel', s.id);
    // Finalize: the Finalize card is on Home; bring it into view.
    const el = document.querySelector<HTMLElement>(`[data-finalize="${CSS.escape(s.id)}"]`);
    el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    el?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };
  return (
    <button type="button" className={cls} disabled={busy} data-action={b.id} onClick={() => void onClick()}>
      {busy ? 'Saving…' : b.label}
    </button>
  );
}
