// Zip 55, PREVIEW BUILDS ONLY: Settings > Schedule > "Tournament test". This file is built only into a preview (SettingsTab.tsx loads it behind
// `__PREVIEW_BUILD__`, which is false in every live build), and its server half (POST /api/admin/tournament-test, server/tournamentTest.ts)
// answers Not found anywhere but a preview. One button per stage puts the fake tournament back to that stage with the preview's fixed names;
// "View as" opens the player page as one of them (the preview's ?as=Name link: real taps on the fake database) or goes back to Admin.
import { useState } from 'react';
import { api } from '../../lib';
import { Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { dayLong } from '../../../shared/tournament';
import './tournament-admin.css';

const STAGES = [
  { stage: 'signup', label: 'Sign-up open', line: 'Everyone can see it. 6 on the list; Vic, Zoe, Reese and Alex are not. Pick the format above first.' },
  { stage: 'date_picked', label: 'Date picked', line: '8 on the list, Sage set to 3.4, the date most can play picked. Vic is not on the list. Open tickets is on Home.' },
  // Zip 56, piece 2.
  { stage: 'tickets_open', label: 'Tickets open', line: '6 of 8 locked in. Vic, Zoe and Reese have no ticket yet: view as Vic to Lock my spot.' },
  { stage: 'spots_full', label: 'Spots full with waitlist', line: '8 of 8 (your own seat is free). Reese paid and is first in line; Vic sees Join waitlist. Back out as Zoe and Reese moves in.' },
  { stage: 'all_locked', label: 'All locked in', line: '8 of 8, Vic among them. Nobody is waiting.' },
  { stage: 'odd', label: '7 locked in after Pay by', line: 'Pay by has passed with 7 locked in: Home shows the evens warning.' },
  { stage: 'canceled', label: 'Canceled', line: 'Spots full, then canceled: every paid ticket is credit now. Players who were on the list see Canceled.' },
  { stage: 'rescheduled', label: 'Rescheduled', line: 'Tickets open, then rescheduled: tickets stay held, players pick their dates again.' },
  { stage: 'none', label: 'No tournament', line: 'Nothing open, to try Create tournament.' },
] as const;

/** What the tournament is at now, in a few words. */
const nowWords: Record<string, string> = {
  signup: 'Sign-up open',
  date_picked: 'Date picked',
  tickets: 'Tickets open',
  rescheduled: 'Rescheduled',
  canceled: 'Canceled',
};

export default function TournamentTestRow({ ctx, home }: { ctx: AdminCtx; home?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={home ? 'set-row-wrap tm-test-home' : 'set-row-wrap'} data-row="tournament-test">
      <button type="button" className="set-row tm-set-row" onClick={() => setOpen(true)} data-tm-test-row={home ? 'home' : 'settings'}>
        <span className="set-label">
          <span className="set-name">Tournament test</span>
          <span className="set-hint">Preview only</span>
        </span>
        <span className="tm-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <Sheet calmFocus open={open} title="Tournament test" onClose={() => setOpen(false)} className="tm-page">
        {open && <TestBody ctx={ctx} />}
      </Sheet>
    </div>
  );
}

function TestBody({ ctx }: { ctx: AdminCtx }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const t = ctx.d.tournament ?? null;
  // Which format the stage buttons build (starts on the open tournament's).
  const [format, setFormat] = useState<'doubles' | 'americano'>(t?.format ?? 'doubles');
  const now = t
    ? `${t.format === 'americano' ? 'Americano' : 'Locked doubles'} · ${nowWords[t.status] ?? 'Sign-up open'}${t.finalDate && (t.status === 'date_picked' || t.status === 'tickets') ? `: ${dayLong(t.finalDate)}` : ''}`
    : 'No tournament';
  async function go(stage: string, label: string) {
    if (busy) return;
    setBusy(stage);
    try {
      await api('POST', '/api/admin/tournament-test', { stage, format });
      await ctx.reload();
      toast(`${label}: ready`);
    } catch {
      toast("That didn't work. Try again.", 'error');
    } finally {
      setBusy(null);
    }
  }
  async function who(visibility: 'me' | 'all') {
    if (!t || busy) return;
    setBusy(visibility);
    try {
      await api('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility });
      await ctx.reload();
      toast(visibility === 'all' ? 'Everyone can see it' : 'Only you can see it');
    } catch {
      toast("That didn't work. Try again.", 'error');
    } finally {
      setBusy(null);
    }
  }
  const names = ctx.d.players.filter((p) => p.isActive).map((p) => p.name);
  return (
    <div className="tm-form stack" data-tm-test>
      <section className="tm-card" aria-label="Stage">
        <div className="tm-card-head">
          <h3 className="tm-label">Stage</h3>
          <span className="tm-chip" data-tm-test-now>
            {now}
          </span>
        </div>
        <div className="segmented tm-seg" role="group" aria-label="Format" data-tm-test-format>
          <button type="button" aria-pressed={format === 'doubles'} disabled={!!busy} onClick={() => setFormat('doubles')} data-tm-test-fmt="doubles">
            Locked doubles
          </button>
          <button type="button" aria-pressed={format === 'americano'} disabled={!!busy} onClick={() => setFormat('americano')} data-tm-test-fmt="americano">
            Americano
          </button>
        </div>
        <div className="stack">
          {STAGES.map((s) => (
            <div key={s.stage} className="tm-test-stage">
              <button type="button" className={`btn block${s.stage === 'none' ? ' secondary' : ''}`} disabled={!!busy} onClick={() => void go(s.stage, s.label)} data-tm-stage={s.stage}>
                {busy === s.stage ? 'Working…' : s.label}
              </button>
              <p className="tm-card-note">{s.line}</p>
            </div>
          ))}
        </div>
      </section>
      {t && (
        <section className="tm-card" aria-label="Who can see it">
          <div className="tm-card-head">
            <h3 className="tm-label">Who can see it</h3>
          </div>
          <div className="segmented tm-seg" role="group" aria-label="Who can see it">
            <button type="button" aria-pressed={t.visibility === 'me'} disabled={!!busy} onClick={() => void who('me')} data-tm-test-vis="me">
              Only me
            </button>
            <button type="button" aria-pressed={t.visibility === 'all'} disabled={!!busy} onClick={() => void who('all')} data-tm-test-vis="all">
              Everyone
            </button>
          </div>
        </section>
      )}
      <section className="tm-card" aria-label="View as">
        <div className="tm-card-head">
          <h3 className="tm-label">View as</h3>
        </div>
        <div className="name-grid">
          {names.map((n) => (
            <a key={n} className="btn secondary" href={`/?as=${encodeURIComponent(n.split(' ')[0])}`} data-tm-view-as={n}>
              {n}
            </a>
          ))}
          <a className="btn" href="/admin" data-tm-view-as="admin">
            Admin
          </a>
        </div>
        <p className="tm-card-note">A name opens the player page as that player on this phone (real taps, fake data). Alex sees Only me.</p>
      </section>
    </div>
  );
}
