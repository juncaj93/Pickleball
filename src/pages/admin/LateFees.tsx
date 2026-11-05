import { useState } from 'react';
import type { AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import { CLEAR_CHOICES, type LateFeeClearWhy, lateFeeAdminNote } from '../../../shared/lateFees';
import { formatPrice } from '../../../shared/money';
import { smsHref } from '../../../shared/messages';
import { api, isIOS } from '../../lib';
import type { AdminCtx } from '../Admin';
import { useAction } from './Sessions';
import { opTap } from './action';
import '../../credit-admin.css';
import { type BackOutText, backOutTexts, confirmedReach, sessionTexts } from './textMenu';

// "Late drops owe $14" (LATE_FEES, shared/lateFees.ts) on the organizer screens: Clear (Sub found / Venue waived /
// My choice) and Find a sub. Shown wherever a late drop or an open late fee is, in the existing styles.

/** A late-fee row's second line on Money: "late drop · owes $14", "canceled, fee not waived · paid $14". */
export function lateFeeLine(r: AdminRosterEntry): string | null {
  if (!r.lateFee) return null;
  const money = r.lateFee.paid ? `paid ${formatPrice(r.paymentAmountCents ?? 0)}${r.selfPaid ? ' · self-marked' : ''}` : `owes ${formatPrice(r.lateFee.oweCents)}`;
  return `${lateFeeAdminNote(r.lateFee.kind)}${r.isOrganizer ? ' (you)' : ''} · ${money}`;
}

/** "Clear": three small choices, each one tap. The money on the seat comes back to them as credit (History says why). */
export function ClearChoices({ ctx, s, r, onDone }: { ctx: AdminCtx; s: AdminSessionView; r: Pick<AdminRosterEntry, 'playerId' | 'name' | 'isOrganizer'>; onDone?: () => void }) {
  const { busy, run } = useAction(ctx);
  const [open, setOpen] = useState(false);
  const clear = async (why: LateFeeClearWhy) => {
    const ok = await run(() => api('POST', `/api/admin/sessions/${s.id}/late-fee`, { playerId: r.playerId, why }), `${r.name}: cleared`, opTap({ kind: 'clear', sessionId: s.id, playerId: r.playerId }, 'Clear'));
    if (ok) {
      setOpen(false);
      onDone?.();
    }
  };
  // Your own late drop: one tap, "My choice" (it never blocks you).
  if (r.isOrganizer) {
    return (
      <button type="button" className="btn small secondary" disabled={busy} data-clear-fee={r.name} data-clear-why="choice" onClick={() => void clear('choice')}>
        Clear
      </button>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn small secondary" disabled={busy} data-clear-fee={r.name} aria-expanded={false} onClick={() => setOpen(true)}>
        Clear
      </button>
    );
  }
  return (
    <span className="inline-links" role="group" aria-label={`Clear ${r.name}'s $14: why?`} data-clear-choices={r.name}>
      {CLEAR_CHOICES.map((c) => (
        <button key={c.why} type="button" className="btn small secondary" disabled={busy} data-clear-why={c.why} onClick={() => void clear(c.why)}>
          {c.label}
        </button>
      ))}
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => setOpen(false)}>
        Not now
      </button>
    </span>
  );
}

/** "Find a sub": opens Messages with the game's prepared text for the group (the site never sends it). */
export function FindSubLink({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const items = sessionTexts(ctx.d, s, Date.parse(ctx.d.now));
  const it = items.find((x) => x.id === 'need') ?? items.find((x) => x.id === 'share');
  if (!it) return null;
  return (
    <a className="btn small secondary" data-find-sub href={smsHref(it.phones.length ? it.phones : null, it.body, isIOS)} aria-label={`Find a sub: text the group. ${it.body}`}>
      Find a sub
    </a>
  );
}

/**
 * A prepared text you can edit before opening Messages: who it goes to, the words in a box, and the button. Opening
 * Messages never sends anything (you press send there). Same look as the other drafts.
 */
export function EditableDraft({
  to,
  who,
  initial,
  openLabel = 'Open in Messages',
  name,
  onOpen,
}: {
  onOpen?: () => void;
  to: string;
  who: { phones: string[]; missing: string[] };
  initial: string;
  openLabel?: string;
  /** data-draft attribute, for tests. */
  name: string;
}) {
  const [body, setBody] = useState(initial);
  const [opened, setOpened] = useState(false);
  // A different prepared text was picked: start from its words again.
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setBody(initial);
  }
  return (
    <div className="draft" data-draft={name}>
      <div className="draft-head">
        <span className="draft-to">
          <strong>{to}</strong>
          <span className="muted small">{' · '}{who.phones.length ? `${who.phones.length} number${who.phones.length === 1 ? '' : 's'}` : 'no numbers saved'}</span>
        </span>
        {opened && <span className="small muted">Message ready</span>}
      </div>
      {who.missing.length > 0 && <div className="small missing-numbers">Missing numbers: {who.missing.join(', ')}</div>}
      <label className="field">
        <span className="sr-only">Message</span>
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} data-draft-body />
      </label>
      <div className="btn-row">
        <a className="btn small" href={smsHref(who.phones.length ? who.phones : null, body, isIOS)} data-draft-open onClick={() => {
          setOpened(true);
          onOpen?.();
        }}>
          {openLabel}
        </a>
      </div>
    </div>
  );
}

/**
 * "Text the players" (LATE_FEES on): the organizer backs out of today's game. Two prepared texts, "Court canceled"
 * first (picked) and "Court still booked (backup)", addressed only to the players confirmed in this game (never you,
 * the waitlist, hidden players or the whole group).
 */
export function PlayersText({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const texts = backOutTexts(ctx.d.textsR2 === true);
  const [pick, setPick] = useState<BackOutText['id']>('court_canceled');
  const chosen = texts.find((t) => t.id === pick) ?? texts[0];
  const who = confirmedReach(ctx.d, s, false);
  return (
    <div className="stack" data-players-text>
      <div className="segmented" role="group" aria-label="Which text">
        {texts.map((t) => (
          <button key={t.id} type="button" aria-pressed={pick === t.id} data-pick={t.id} onClick={() => setPick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <EditableDraft to={`${s.state.flags.canceled ? 'The players who were in' : 'The players who are in'} · ${who.count}`} who={who} initial={chosen.body} name={chosen.id} openLabel="Text the players" />
    </div>
  );
}
