import { type FormEvent, useState } from 'react';
import type { AdminPlayer } from '../../../shared/api';
import { api, ApiError } from '../../lib';
import { Chip, Notice, Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';

export function PlayersTab({ ctx }: { ctx: AdminCtx }) {
  const [editing, setEditing] = useState<AdminPlayer | 'new' | null>(null);
  return (
    <>
      <p className="small muted">
        Only save a phone number if that player agreed to get reminder texts. Numbers are only shown to you.
      </p>
      <ul className="list card" style={{ padding: '4px 16px' }}>
        {ctx.d.players.map((p) => (
          <li key={p.id} className="spread">
            <div>
              <strong>{p.name}</strong>
              <div className="small muted">{p.phone ?? 'No phone'}</div>
              <div className="row" style={{ marginTop: 4 }}>
                <Chip tone={p.isActive ? 'ok' : 'muted'}>{p.isActive ? 'Active' : 'Inactive'}</Chip>
                <Chip tone="info">{p.isRegular ? 'Regular' : 'Sub'}</Chip>
                {!p.canReceiveSubstituteInvites && <Chip tone="muted">No sub invites</Chip>}
              </div>
            </div>
            <button className="btn small secondary" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
              Edit
            </button>
          </li>
        ))}
      </ul>
      <button className="btn block" onClick={() => setEditing('new')}>
        Add a player
      </button>
      <Sheet open={!!editing} title={editing === 'new' ? 'Add a player' : `Edit ${editing?.name ?? ''}`} onClose={() => setEditing(null)}>
        {editing && <PlayerForm ctx={ctx} player={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  );
}

function PlayerForm({ ctx, player, onDone }: { ctx: AdminCtx; player: AdminPlayer | null; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(player?.name ?? '');
  const [phone, setPhone] = useState(player?.phone ?? '');
  const [isRegular, setRegular] = useState(player?.isRegular ?? true);
  const [isActive, setActive] = useState(player?.isActive ?? true);
  const [subs, setSubs] = useState(player?.canReceiveSubstituteInvites ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { name, phone: phone || null, isRegular, isActive, canReceiveSubstituteInvites: subs };
    try {
      if (player) await api('PUT', `/api/admin/players/${player.id}`, body);
      else await api('POST', '/api/admin/players', body);
      toast(player ? 'Player saved' : 'Player added');
      await ctx.reload();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
      </label>
      <label className="field">
        Phone (optional)
        <span className="hint">Only with their OK. Used to prefill texts you send.</span>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={25} />
      </label>
      <label className="check">
        <input type="checkbox" checked={isRegular} onChange={(e) => setRegular(e.target.checked)} />
        Regular player (unchecked = substitute)
      </label>
      <label className="check">
        <input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} />
        Can get substitute invitations
      </label>
      <label className="check">
        <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
        Active (inactive players disappear from the name list)
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
