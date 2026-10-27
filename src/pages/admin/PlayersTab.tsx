import { type FormEvent, useState } from 'react';
import type { AdminPlayer } from '../../../shared/api';
import { formatPhone } from '../../../shared/messages';
import { api, ApiError } from '../../lib';
import { Chip, ConfirmDialog, Notice, Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';

const DAYS = [
  { day: 2, label: 'Tue' },
  { day: 4, label: 'Thu' },
];

function daysText(days: number[]): string {
  if (days.length === 2) return 'Tue & Thu';
  if (days.length === 1) return days[0] === 2 ? 'Tuesdays' : 'Thursdays';
  return 'No usual day';
}

export function PlayersTab({ ctx }: { ctx: AdminCtx }) {
  const [editing, setEditing] = useState<AdminPlayer | 'new' | null>(null);
  return (
    <>
      <ul className="list card" style={{ padding: '4px 16px' }}>
        {ctx.d.players.map((p) => (
          <li key={p.id} className="spread">
            <div>
              <strong>{p.name}</strong>
              {p.isNew && <span className="new-tag">New</span>}
              <div className="small muted">{p.phone ? formatPhone(p.phone) : 'No phone'}</div>
              {p.lateDrops > 0 && <div className="small late-count">Late drops: {p.lateDrops}</div>}
              <div className="row" style={{ marginTop: 4 }}>
                <Chip tone={p.isRegular ? 'ok' : 'info'}>{p.isRegular ? 'Regular' : 'Occasional'}</Chip>
                <Chip tone="muted">{daysText(p.usualDays)}</Chip>
                {!p.isActive && <Chip tone="muted">Hidden</Chip>}
              </div>
            </div>
            <button className="btn small secondary" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
              Edit
            </button>
          </li>
        ))}
      </ul>
      <button className="btn block" onClick={() => setEditing('new')}>
        Add a person
      </button>
      <Sheet open={!!editing} title={editing === 'new' ? 'Add a person' : `Edit ${editing?.name ?? ''}`} onClose={() => setEditing(null)}>
        {editing && <PlayerForm ctx={ctx} player={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  );
}

function PlayerForm({ ctx, player, onDone }: { ctx: AdminCtx; player: AdminPlayer | null; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(player?.name ?? '');
  const [phone, setPhone] = useState(player?.phone ? formatPhone(player.phone) : '');
  const [isRegular, setRegular] = useState(player?.isRegular ?? true);
  const [days, setDays] = useState<number[]>(player?.usualDays ?? []);
  const [isActive, setActive] = useState(player?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askRemove, setAskRemove] = useState(false);

  async function remove() {
    if (!player) return;
    setBusy(true);
    try {
      const res = await api<{ result: 'deleted' | 'hidden' }>('DELETE', `/api/admin/players/${player.id}`);
      toast(res.result === 'deleted' ? `${player.name} removed` : `${player.name} hidden`);
      await ctx.reload();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove.');
    } finally {
      setBusy(false);
      setAskRemove(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name,
      phone: phone || null,
      isRegular,
      isActive,
      canReceiveSubstituteInvites: player?.canReceiveSubstituteInvites ?? true,
      usualDays: days,
    };
    try {
      if (player) await api('PUT', `/api/admin/players/${player.id}`, body);
      else await api('POST', '/api/admin/players', body);
      toast(player ? 'Saved' : 'Added');
      await ctx.reload();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <form className="stack" onSubmit={submit}>
      <label className="field">
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
      </label>
      <label className="field">
        Phone (optional)
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={25} placeholder="(248) 555-1234" />
      </label>
      <div className="stack" style={{ gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Plays
        </span>
        <div className="segmented" role="group" aria-label="Regular or occasional">
          <button type="button" aria-pressed={isRegular} onClick={() => setRegular(true)}>
            Regular
          </button>
          <button type="button" aria-pressed={!isRegular} onClick={() => setRegular(false)}>
            Occasional
          </button>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Usual days
        </span>
        <div className="segmented" role="group" aria-label="Usual days">
          {DAYS.map(({ day, label }) => (
            <button
              type="button"
              key={day}
              aria-pressed={days.includes(day)}
              onClick={() => setDays((cur) => (cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort()))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={!isActive} onChange={(e) => setActive(!e.target.checked)} />
        Hide from the name list
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      {player && (
        <button type="button" className="btn danger" disabled={busy} onClick={() => setAskRemove(true)}>
          Remove from list
        </button>
      )}
    </form>
      <ConfirmDialog
        open={askRemove}
        title={`Remove ${player?.name ?? ''}?`}
        body="If they never signed up or paid, the name is deleted. If they have any history, it's hidden instead so old sessions and payments stay correct."
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setAskRemove(false)}
      />
    </>
  );
}
