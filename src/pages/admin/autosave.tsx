// Settings save themselves: number and dollar boxes when you leave the box
// or press Enter, text boxes also after a one-second pause, toggles and the
// date right away. A bad value
// shows its error under the row and is never sent; a failed save keeps what
// was typed and offers a retry.
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { api, ApiError, isDemo } from '../../lib';
import type { AdminCtx } from '../Admin';

export type Parsed = { value: unknown } | { error: string };
type RowState = { status: 'saving' | 'saved' } | { status: 'invalid'; message: string } | { status: 'failed'; retry: () => void };

const PAUSE_MS = 1000;
const SAVED_SHOW_MS = 2000;

/** One saver for the whole Settings page: each row reports its own state. */
export function useAutosave(ctx: AdminCtx) {
  const [rows, setRows] = useState<Record<string, RowState | undefined>>({});
  const fades = useRef<Record<string, number>>({});
  const set = (id: string, st: RowState | undefined) => setRows((r) => ({ ...r, [id]: st }));

  async function save(id: string, body: Record<string, unknown>, path = '/api/admin/group'): Promise<boolean> {
    window.clearTimeout(fades.current[id]);
    set(id, { status: 'saving' });
    try {
      await api('PUT', path, body);
      set(id, { status: 'saved' });
      fades.current[id] = window.setTimeout(() => setRows((r) => (r[id]?.status === 'saved' ? { ...r, [id]: undefined } : r)), SAVED_SHOW_MS);
      void ctx.reload();
      return true;
    } catch (err) {
      // The server said the value itself is wrong: show why, don't offer a retry.
      if (err instanceof ApiError && (err.status === 400 || isDemo(err))) set(id, { status: 'invalid', message: err.message });
      else set(id, { status: 'failed', retry: () => void save(id, body, path) });
      return false;
    }
  }
  return { rows, save, invalid: (id: string, message: string) => set(id, { status: 'invalid', message }), clear: (id: string) => set(id, undefined) };
}

export type Autosave = ReturnType<typeof useAutosave>;

/** The tiny "✓ Saved" (fades after 2 seconds) or "Saving…" next to a row's name. */
export function SaveMark({ state }: { state: RowState | undefined }) {
  if (state?.status === 'saved')
    return (
      <span className="save-mark saved" role="status">
        ✓ Saved
      </span>
    );
  if (state?.status === 'saving') return <span className="save-mark">Saving…</span>;
  return null;
}

/** The line under a row: the short error, or the retry after a failed save. */
export function SaveProblem({ state }: { state: RowState | undefined }) {
  if (state?.status === 'invalid') return <span className="field-error">{state.message}</span>;
  if (state?.status === 'failed')
    return (
      <button type="button" className="save-retry" onClick={state.retry}>
        Couldn't save. Tap to retry.
      </button>
    );
  return null;
}

/**
 * A text or number box that saves itself. `parse` turns the typed text into
 * the value to save, or an error; `body` makes the request from that value.
 */
export function AutoInput({
  auto,
  id,
  label,
  hint,
  initial,
  parse,
  body,
  layout,
  input,
  saveOnPause = true,
}: {
  auto: Autosave;
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  initial: string;
  parse: (text: string) => Parsed;
  body: (value: unknown) => Record<string, unknown>;
  /** 'row': name on the left, small box on the right. 'field': name above a full-width box. */
  layout: 'row' | 'field';
  /** Text boxes also save after a one-second pause. Number and dollar boxes don't, so "1" on the way to "14" is never saved. */
  saveOnPause?: boolean;
  input: (p: { id: string; value: string; onChange: (v: string) => void; onBlur: () => void; invalid: boolean }) => ReactNode;
}) {
  const inputId = useId();
  const [text, setText] = useState(initial);
  const saved = useRef(initial);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(text);
  latest.current = text;
  const state = auto.rows[id];

  async function commit() {
    window.clearTimeout(timer.current);
    const now = latest.current;
    if (now === saved.current) {
      if (state?.status === 'invalid') auto.clear(id);
      return;
    }
    const r = parse(now);
    if ('error' in r) return auto.invalid(id, r.error);
    if (await auto.save(id, body(r.value))) saved.current = now;
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const box = input({
    id: inputId,
    value: text,
    invalid: state?.status === 'invalid',
    onChange: (v) => {
      setText(v);
      window.clearTimeout(timer.current);
      if (saveOnPause) timer.current = window.setTimeout(() => void commit(), PAUSE_MS);
    },
    onBlur: () => void commit(),
  });
  return (
    <div className={layout === 'row' ? 'set-row-wrap' : 'field auto-field'} data-row={id}>
      {layout === 'row' ? (
        <div className="set-row">
          <label className="set-label" htmlFor={inputId}>
            <span className="set-name">
              {label} <SaveMark state={state} />
            </span>
            {hint && <span className="set-hint">{hint}</span>}
          </label>
          {box}
        </div>
      ) : (
        <>
          <label className="field-label" htmlFor={inputId}>
            {label} <SaveMark state={state} />
          </label>
          {hint && <span className="hint">{hint}</span>}
          {box}
        </>
      )}
      <SaveProblem state={state} />
    </div>
  );
}
