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
  // Zip 64 (🎾64.finalize): the short ticket, the style rules and late paying. These build "The Cold Open" (the format above does not apply).
  { stage: 'zip64_start', label: 'Start: short ticket and Finalize', line: 'The Cold Open, the vote open, 8 on the list (Plan: 10 players · 2 courts · 2.5 hours on your card). View as Vic: one wide Sign up (mock 00). View as Parker: See who’s signed up, Edit, Drop out (mock 01). As you: the tournament page, Pick the date (heat map), tap a date: Style, Plays, Pay by, Finalize date, then the venue reminder on Home.' },
  { stage: 'vote_open', label: 'Format vote open (3 on the list)', line: '3 on the list with mixed votes. View as Vic, Sign up: Step 2 of 2 · Your dates and the new line.' },
  { stage: 'vote_majority', label: 'Date finalized, style TBD', line: 'The date is set, Pay by not passed: every card says Tournament style TBD. View as Vic: Lock my spot · $16, Pay by on the right.' },
  { stage: 'style_even', label: 'Tickets closed: 10 locked in (even)', line: 'Pay by passed an hour ago, all 10 locked in: Locked doubles (the vote’s winner) stays.' },
  { stage: 'style_odd', label: 'Tickets closed: 9 locked in (odd)', line: 'Pay by passed, 9 locked in: it switches to Americano. Home: the switched card. View as Parker: Tournament style is now Americano. Vic can still pay (a spot is open).' },
  { stage: 'style_back', label: 'Odd, then a late payer makes 10', line: 'Switched to Americano at 9, then Vic paid late: 10. Home: Switch back to Locked doubles? Switch, or Not now. It never switches by itself.' },
  { stage: 'late_open', label: 'Late paying (Pay by passed, spots open)', line: '6 locked in, Pay by an hour ago. View as Vic: red Your payment is late, Pay now opens the Pay sheet. No fees.' },
  { stage: 'late_cut', label: '3 hours before the start', line: 'Today, starting in 2 hours: tickets are closed for Vic (no Pay now). Parker stays locked in.' },
  // Zip 63 (🎾63.tickets): the pay countdown at the top of Vic's Home. Each is Tickets open (6 paid) with Pay by set from now; the tournament is
  // the day after Pay by. View as Vic to see the alert; Pay opens the same sheet as Lock my spot.
  { stage: 'pay_3d', label: 'Countdown: 3 days left', line: 'Pay by is 7:00 PM three days from today. View as Vic: amber 3 days left to pay.' },
  { stage: 'pay_2d', label: 'Countdown: 2 days left', line: 'Pay by is 7:00 PM two days from today: amber 2 days left to pay.' },
  { stage: 'pay_1d', label: 'Countdown: due tomorrow', line: 'Pay by is 7:00 PM tomorrow: amber Payment due tomorrow.' },
  { stage: 'pay_today', label: 'Countdown: due today', line: 'Pay by is tonight, 6.5 hours or more from now: red Payment due today.' },
  { stage: 'pay_hours', label: 'Countdown: due in 5 hours', line: 'Pay by is 5 hours 20 minutes from now: red Due in 5 hours.' },
  { stage: 'pay_minutes', label: 'Countdown: due in 42 minutes', line: 'Pay by is 42 minutes from now: red Due in 42 minutes, counting down while Home is open.' },
  { stage: 'pay_late', label: 'Countdown: late', line: 'Pay by passed an hour ago and Wren backed out after it (a spot is free): red Your payment is late, Pay now.' },
  { stage: 'pay_closed', label: 'Countdown: late, spots open', line: 'Pay by passed an hour ago, no back out: since Zip 64 a spot is still open, so Vic sees Your payment is late with Pay now.' },
  // Zip 62 (🎾62.speed): The Cold Open as it is on live, to feel the speed (the format above does not apply).
  { stage: 'speed_check', label: 'Speed check (like live)', line: 'The Cold Open as on live: Everyone, the vote open, 9 on the list (everyone but you). Open Home and View as Vic: the card draws with the rest.' },
  // Zip 60 (🎾60.formatvote): the players vote the format. These build "The Cold Open" on Let players vote; the format above does not apply.
  { stage: 'vote_tie', label: 'Date locked, tie', line: 'Locked 1, Americano 1, Either 2: a tie, so the first tournament is Locked doubles. The alert says only the format.' },
  { stage: 'signup', label: 'Sign-up open (sign-up finish)', line: 'Everyone can see it. 6 on the list; Vic, Zoe, Reese and Alex are not. View as Vic, Sign up, watch the ticket punch. Pick the format above first.' },
  // Alex: picking the date opens tickets.
  { stage: 'date_picked', label: 'Date picked, tickets open', line: '8 on the list, Sage set to 3.4, the date most can play picked. Nobody has paid yet. Vic is not on the list.' },
  // Zip 56, piece 2. The spots follow the players locked in (6 to 16 since Zip 63); with the 10 names standby (after 16) cannot be shown.
  { stage: 'tickets_open', label: 'Tickets open, 6 paid', line: '6 locked in, 6 of 8. Vic, Zoe and Reese have no ticket yet: view as Vic to Lock my spot.' },
  { stage: 'all_locked', label: 'All locked in', line: 'All 10 names locked in (your own seat is free), 10 of 12.' },
  { stage: 'odd', label: '7 locked in after Pay by', line: 'Pay by has passed with 7 locked in: Home shows the evens warning.' },
  { stage: 'canceled', label: 'Canceled', line: '6 paid, then canceled: every paid ticket is credit now. Players who were on the list see Canceled.' },
  { stage: 'rescheduled', label: 'Rescheduled', line: '6 paid, then rescheduled: tickets stay held, players pick their dates again.' },
  // Zip 59: the polish piece. 
  { stage: 'closed', label: 'Pay by passed (6 paid)', line: 'Pay by passed an hour ago: no standby, but spots are open, so Vic can still pay late (Zip 64).' },
  { stage: 'hidden', label: 'Canceled and hidden', line: 'Out of Home. Settings, Advanced, Hidden tournaments lists it with Restore. Cancel above, then Hide, does the same.' },
  { stage: 'none', label: 'No tournament', line: 'Nothing open, to try Create tournament.' },
] as const;

/** Zip 63: the ball looks the 10 names cannot make (total, gold): the brief's 3, 8, 10, 12 and 16, and 14. */
const BALL_LOOKS: [number, number][] = [
  [3, 1],
  [8, 5],
  [10, 3],
  [12, 7],
  [14, 9],
  [16, 12],
];

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
    ? `${t.formatPending ? 'Players vote' : t.format === 'americano' ? 'Americano' : 'Locked doubles'} · ${nowWords[t.status] ?? 'Sign-up open'}${t.finalDate && (t.status === 'date_picked' || t.status === 'tickets') ? `: ${dayLong(t.finalDate)}` : ''}`
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
      {/* Zip 63: the preview has 10 names, so a real card never shows 12 to 16 balls. These links draw that many on Vic's card (look only, that
          page only); every other word and button is the real one. */}
      <section className="tm-card" aria-label="Ball look" data-tm-test-balls>
        <div className="tm-card-head">
          <h3 className="tm-label">Ball look</h3>
        </div>
        <div className="name-grid">
          {BALL_LOOKS.map(([n, g]) => (
            <a key={n} className="btn secondary" href={`/?as=Vic&balls=${n},${g}`} data-tm-test-ball={n}>
              {n} ({g} gold)
            </a>
          ))}
          <a className="btn secondary" href="/?as=Vic&balls=off" data-tm-test-ball="off">
            Real count
          </a>
        </div>
        <p className="tm-card-note">Look only, as Vic on that page: the card draws that many balls with that many gold. Start from a Tickets open stage. Any other link shows the real card.</p>
      </section>
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
