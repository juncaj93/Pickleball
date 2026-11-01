import { useEffect, useMemo, useState } from 'react';
import type { MarkName, Task, TaskButton, TaskStep } from '../../../shared/tasks';
import { api, ApiError, isIOS } from '../../lib';
import { MessageIcon, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { CourtWaitButtons } from './Sessions';
import { courtSwitchOf } from '../../../shared/court';
import { formatShortDate } from '../../../shared/time';
import { textHref, visibleTasks } from './doNow';
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
  const tasks = visibleTasks(ctx.d, nowMs, `${window.location.origin}/admin`);
  // Games waiting on the venue's court list: "Court opened" or "Didn't open?" lives here, not on the game card.
  const waiting = ctx.d.sessions.filter((s) => !s.state.flags.canceled && !s.state.flags.started && courtSwitchOf(s) === 'waitlist');
  if (tasks.length === 0 && waiting.length === 0) return null;
  const [first, ...rest] = tasks;
  return (
    <section className="do-now" aria-labelledby="do-now-title">
      <h2 id="do-now-title" className="sr-only">
        Do this now
      </h2>
      {waiting.map((s) => (
        <article key={s.id} className="card dn-card" data-task="court_waitlist" data-session={s.id} aria-label={`Court waitlist: ${formatShortDate(s.startsAt, ctx.d.group.timezone)}`}>
          <div className="dn-eyebrow">Waitlist</div>
          <p className="dn-text">{formatShortDate(s.startsAt, ctx.d.group.timezone)}: did the court open?</p>
          <CourtWaitButtons ctx={ctx} s={s} />
        </article>
      ))}
      {first && <TaskCard ctx={ctx} task={first} nowMs={nowMs} lead={waiting.length === 0} />}
      {first && rest.length > 0 && (
        <button type="button" className="link-btn dn-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? 'Show less' : `+${rest.length} more`}
        </button>
      )}
      {more && rest.map((t) => <TaskCard key={t.id} ctx={ctx} task={t} nowMs={nowMs} />)}
    </section>
  );
}

function TaskCard({ ctx, task, nowMs, lead }: { ctx: AdminCtx; task: Task; nowMs: number; lead?: boolean }) {
  const s = ctx.d.sessions.find((x) => x.id === task.sessionId);
  if (!s) return null;
  // A checklist shows the buttons of its first open step only.
  const current = task.steps.find((st) => !st.done && st.enabled);
  return (
    <article className={`card dn-card${lead ? ' lead' : ''}`} data-task={task.kind} data-session={task.sessionId} aria-label={`Do this now: ${task.text}`}>
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
