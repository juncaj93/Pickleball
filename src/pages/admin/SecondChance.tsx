// Zip 15, "Second Chance" (SECOND_CHANCE, shared/secondChance.ts). Admin Home only, only while on (ctx.d.secondChance is there).
//  - SecondChanceHome: the cards at the top of Home, one per game, in the steps of the approved mock (mock11.html, p12_*.png): built with
//    the site's own alert card (AlertCard, the Zip 11 look), its buttons and colors, the purple Text button and the real CourtReserve link.
//  - RequestButton: the "Request" (Venmo, the Remind sheet's link builder) or "Text" button on an unpaid row (also on Mark paid tonight).
//  - UnpaidTextSheet: what Telegram 1's link opens (/admin?unpaid=<game>): Messages to ONLY the players who have not paid.
// Nothing here charges or sends anything: Book a court opens CourtReserve, Text opens Messages (you tap send), Request opens Venmo.
import { type ReactNode, useEffect, useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { smsHref } from '../../../shared/messages';
import { paymentTextR2 } from '../../../shared/textsR2';
import { siteAddress } from '../../../shared/messages';
import { COURTRESERVE_BOOKING_URL } from '../../../shared/settings';
import { dayTime, minutesLabel, pickTimes, type ScCard, type ScUnpaid, unpaidText } from '../../../shared/secondChance';
import { formatTime, localParts, zonedTimeToUtc } from '../../../shared/time';
import { venmoRequestLinks } from '../../../shared/venmoRequest';
import { MIN_PLAYERS } from '../../../shared/spots';
import { AlertCard } from '../../AlertCard';
import { api, isIOS, openVenmo } from '../../lib';
import { Sheet } from '../../ui';
import type { AdminCtx } from '../Admin';
import { useAction } from './action';
import '../../second-chance.css';

const ExtIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 17L17 7M9 7h8v8" />
  </svg>
);
const ChevIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const tap = (sessionId: string, body: Record<string, unknown>) => api('POST', `/api/admin/sessions/${sessionId}/second-chance`, body);

/** The cards at the top of Home (plus, on the preview, the Telegrams that would have been sent). Nothing while the switch is off. */
export function SecondChanceHome({ ctx }: { ctx: AdminCtx }) {
  const sc = ctx.d.secondChance;
  if (!sc) return null;
  const fake = sc.preview ? (sc.fakeTelegrams ?? []) : [];
  if (sc.cards.length === 0 && fake.length === 0 && !sc.pretendNoon) return null;
  return (
    <section className={`sc-cards${ctx.d.alertCards === true ? ' ac-stack' : ' stack'}`} aria-label="Same-day games" data-sc-cards>
      {sc.pretendNoon && (
        <p className="small muted sc-pretend" data-sc-pretend>
          Preview: pretending it's noon on game day for these cards. Open with ?noontest=off to stop.
        </p>
      )}
      {sc.cards.map((c) => (c.kind === 'chance' ? <ChanceCard key={c.sessionId} ctx={ctx} c={c} /> : <OpenCard key={c.sessionId} ctx={ctx} c={c} />))}
      {fake.length > 0 && <FakeTelegrams ctx={ctx} list={fake} />}
    </section>
  );
}

/** Steps 1 and 2: "Thu 7:30 PM was 1 short" -> "Court open tonight?". */
function ChanceCard({ ctx, c }: { ctx: AdminCtx; c: Extract<ScCard, { kind: 'chance' }> }) {
  const tz = ctx.d.group.timezone;
  const act = useAction(ctx);
  const nowMs = Date.parse(ctx.d.secondChance!.now);
  const own = localParts(Date.parse(c.startsAt), tz);
  // Times another game already has that day are left out (the server would refuse them).
  const taken = new Set(ctx.d.sessions.filter((x) => x.id !== c.sessionId).map((x) => x.startsAt));
  const isoAt = (m: number) => new Date(zonedTimeToUtc(own.year, own.month, own.day, Math.floor(m / 60), m % 60, tz)).toISOString();
  const times = pickTimes(c.startsAt, tz, nowMs).filter((m) => !taken.has(isoAt(m)));
  const [minutes, setMinutes] = useState(own.hour * 60 + own.minute);
  const dismiss = () => act.run(() => tap(c.sessionId, { action: 'dismiss' }), 'Hidden for today');
  const when = dayTime(c.startsAt, tz);
  if (c.step === 1) {
    return (
      <Card
        ctx={ctx}
        tone="blue"
        icon="clock"
        title={`${when} was 1 short`}
        sub="Check if a court is open tonight."
        onX={dismiss}
        xLabel={`${when} was 1 short`}
        data={{ 'data-sc-card': 'chance', 'data-sc-step': '1', 'data-session': c.sessionId }}
        actions={
          <a
            className="ac-btn ac-out sc-book"
            data-ac-tone="blue"
            href={COURTRESERVE_BOOKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-sc-book
            // Opens the booking site in another tab; the card moves to step 2 at the same moment.
            onClick={() => void act.run(() => tap(c.sessionId, { action: 'booking' }))}
          >
            Book a court <ExtIcon />
          </a>
        }
      />
    );
  }
  return (
    <Card
      ctx={ctx}
      tone="blue"
      icon="clock"
      title="Court open tonight?"
      sub={`Reopen ${when}, or pick a new time.`}
      onX={dismiss}
      xLabel="Court open tonight?"
      data={{ 'data-sc-card': 'chance', 'data-sc-step': '2', 'data-session': c.sessionId }}
      actions={
        <>
          <label className="ac-btn sc-time" data-sc-time>
            <span aria-hidden="true">{minutesLabel(minutes)}</span>
            <ChevIcon />
            <select aria-label="Start time" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {times.map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ac-btn"
            data-ac-tone="green"
            data-sc-reopen
            disabled={act.busy}
            onClick={() => act.run(() => tap(c.sessionId, { action: 'reopen', minutes }), `Reopened for ${minutesLabel(minutes)}`)}
          >
            Reopen game
          </button>
        </>
      }
    />
  );
}

/** Step 3 (and the same-day card), step 4, and the cutoff. */
function OpenCard({ ctx, c }: { ctx: AdminCtx; c: Extract<ScCard, { kind: 'open' }> }) {
  const tz = ctx.d.group.timezone;
  const act = useAction(ctx);
  const nowMs = Date.parse(ctx.d.secondChance!.now);
  const s = ctx.d.sessions.find((x) => x.id === c.sessionId);
  const at = formatTime(c.startsAt, tz);
  const short = c.inCount < MIN_PLAYERS;
  const textBtn = (out: boolean) => (
    <a className={`ac-btn${out ? ' ac-out' : ''} sc-text`} data-ac-tone="purple" href={smsHref(null, c.groupText, isIOS)} data-sc-text>
      Text the group
    </a>
  );
  const preview = (
    <p className="sc-preview" data-sc-preview>
      {c.groupText}
    </p>
  );
  const rows = s && c.unpaid.length > 0 ? <UnpaidRows ctx={ctx} s={s} unpaid={c.unpaid} nowMs={nowMs} /> : null;
  if (c.step === 4) {
    return (
      <Card
        ctx={ctx}
        tone="green"
        icon="ok"
        title={`${c.paidCount} signed up and paid`}
        sub={`Book a court for ${dayTime(c.startsAt, tz)}.`}
        data={{ 'data-sc-card': c.origin, 'data-sc-step': '4', 'data-session': c.sessionId }}
        actions={
          <a className="ac-btn ac-out sc-book" data-ac-tone="blue" href={COURTRESERVE_BOOKING_URL} target="_blank" rel="noopener noreferrer" data-sc-book>
            Book a court <ExtIcon />
          </a>
        }
      >
        {rows}
      </Card>
    );
  }
  if (c.step === 'cutoff') {
    return (
      <Card
        ctx={ctx}
        tone="red"
        icon="stop"
        title="Still short, cancel it?"
        sub={`${dayTime(c.startsAt, tz)}: ${c.inCount} of ${MIN_PLAYERS} in. It was never booked, so no fee.`}
        data={{ 'data-sc-card': c.origin, 'data-sc-step': 'cutoff', 'data-session': c.sessionId }}
        actions={
          <>
            {textBtn(true)}
            <button
              type="button"
              className="ac-btn"
              data-ac-tone="red"
              data-sc-cancel
              disabled={act.busy}
              onClick={() => act.run(() => tap(c.sessionId, { action: 'cancel' }), 'Game canceled. Money back as credit.')}
            >
              Cancel game
            </button>
          </>
        }
      />
    );
  }
  const title =
    c.origin === 'reopened'
      ? `Reopened for ${at}`
      : short
        ? `${dayWord(c.startsAt, tz, nowMs)} ${at}, ${c.inCount} of ${MIN_PLAYERS} in`
        : `${dayWord(c.startsAt, tz, nowMs)} ${at}, ${c.inCount} in`;
  const sub = short
    ? c.origin === 'reopened'
      ? `${c.inCount} of ${MIN_PLAYERS} signed up. Text the group.`
      : 'If 4 sign up and pay, book a court.'
    : `${c.inCount} signed up, ${c.paidCount} of ${c.inCount} paid.`;
  return (
    <Card ctx={ctx} tone="purple" icon="text" title={title} sub={sub} data={{ 'data-sc-card': c.origin, 'data-sc-step': '3', 'data-session': c.sessionId }} actions={textBtn(false)}>
      {preview}
      {rows}
    </Card>
  );
}

/** "Tonight" (an evening game) or "Today". */
function dayWord(iso: string, tz: string, _nowMs: number): string {
  return localParts(Date.parse(iso), tz).hour >= 17 ? 'Tonight' : 'Today';
}

/** The unpaid players on a card: name, amount, and Request (Venmo) or Text. */
function UnpaidRows({ ctx, s, unpaid, nowMs }: { ctx: AdminCtx; s: AdminSessionView; unpaid: ScUnpaid[]; nowMs: number }) {
  return (
    <ul className="sc-rows" aria-label={`Not paid yet for ${dayTime(s.startsAt, ctx.d.group.timezone)}`} data-sc-unpaid>
      {unpaid.map((u) => (
        <li key={u.playerId} data-sc-row={u.name}>
          <span className="sc-name">
            <strong>{u.name}</strong>
            {u.owesCents > 0 && <span className="sc-owes"> {formatPrice(u.owesCents)}</span>}
          </span>
          <RequestButton ctx={ctx} s={s} playerId={u.playerId} name={u.name} owesCents={u.owesCents} nowMs={nowMs} />
        </li>
      ))}
    </ul>
  );
}

/**
 * "Request" for one person (Second Chance on): opens Venmo with their @name, what they owe and "Pickleball Tue Nov 3" (the Remind sheet's
 * own link builder, venmoRequestLinks: the app link with a web fallback, %20 spaces). No Venmo saved: "Text" (Messages to them with the
 * usual payment text). Neither: nothing. Nothing is charged; you still tap Mark paid.
 */
export function RequestButton({ ctx, s, playerId, name, owesCents, nowMs }: { ctx: AdminCtx; s: Pick<AdminSessionView, 'startsAt'>; playerId: string; name: string; owesCents: number; nowMs?: number }) {
  if (!ctx.d.secondChance || owesCents <= 0) return null;
  const tz = ctx.d.group.timezone;
  const p = ctx.d.players.find((x) => x.id === playerId);
  const link = venmoRequestLinks(p?.venmo ?? null, owesCents, s.startsAt, tz);
  if (link) {
    return (
      <a
        className="sc-req"
        href={link.url}
        data-app-href={link.appUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => openVenmo(e, link)}
        data-sc-request={name}
        aria-label={`Venmo request ${formatPrice(owesCents)} from ${name}`}
      >
        Request
      </a>
    );
  }
  if (!p?.phone) return null;
  const first = name.trim().split(/\s+/)[0] || name;
  const body = paymentTextR2(first, owesCents, [s], tz, nowMs ?? Date.parse(ctx.d.now), siteAddress(ctx.d.group.playerLink));
  return (
    <a className="sc-req sc-req-text" href={smsHref(p.phone, body, isIOS)} data-sc-textone={name} aria-label={`Text ${name} about the ${formatPrice(owesCents)}`}>
      Text
    </a>
  );
}

/** The card: the site's alert card while Alert cards is on (as on live); a plain card with the same words and buttons otherwise. */
function Card(props: {
  ctx: AdminCtx;
  tone: 'blue' | 'green' | 'purple' | 'red';
  icon: 'clock' | 'ok' | 'text' | 'stop';
  title: string;
  sub: string;
  onX?: () => void;
  xLabel?: string;
  actions: ReactNode;
  data: Record<string, string>;
  children?: ReactNode;
}) {
  if (props.ctx.d.alertCards === true) {
    return (
      <AlertCard tone={props.tone} icon={props.icon} title={props.title} titleAs="h3" sub={props.sub} onX={props.onX} xLabel={props.xLabel} actions={props.actions} className="sc-card" data={props.data}>
        {props.children}
      </AlertCard>
    );
  }
  return (
    <article className="card stack sc-card sc-plain" data-sc-tone={props.tone} {...props.data}>
      <div className="sc-plain-head">
        <div>
          <h3>{props.title}</h3>
          <p className="small muted">{props.sub}</p>
        </div>
        {props.onX && (
          <button type="button" className="link-btn" aria-label={`Dismiss: ${props.xLabel ?? props.title}`} data-dismiss onClick={props.onX}>
            ✕
          </button>
        )}
      </div>
      <div className="sc-plain-actions">{props.actions}</div>
      {props.children}
    </article>
  );
}

/** Preview only: the Telegrams that would have gone to you, newest first (never sent from a preview). */
function FakeTelegrams({ ctx, list }: { ctx: AdminCtx; list: { at: string; text: string }[] }) {
  const tz = ctx.d.group.timezone;
  return (
    <article className="card stack sc-fake" aria-label="Preview Telegrams" data-sc-fake>
      <h3 className="sc-fake-title">Telegram (preview, not sent)</h3>
      {list.map((t) => (
        <div key={t.at + t.text} className="sc-fake-msg" data-sc-fake-msg>
          <span className="small muted">{formatTime(t.at, tz)}</span>
          <p>{linkify(t.text)}</p>
        </div>
      ))}
    </article>
  );
}

/** "words: https://..." drawn the way Telegram shows it: the words are the link. */
function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /([^\n:]+): (https?:\/\/\S+)/g;
  let from = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(from, m.index));
    const words = m[1].replace(/^.*[.?!]\s/, '');
    out.push(m[1].slice(0, m[1].length - words.length));
    const url = m[2];
    const local = url.replace(/^https?:\/\/[^/]+/, '');
    out.push(
      <a key={m.index} href={local.startsWith('/admin') ? local : url} target={local.startsWith('/admin') ? undefined : '_blank'} rel="noopener noreferrer" data-sc-fake-link>
        {words}
      </a>,
    );
    from = m.index + m[0].length;
  }
  out.push(text.slice(from));
  return out;
}

/** The game id in /admin?unpaid=<id> (Telegram 1's link), or null. */
export function unpaidParam(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('unpaid');
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

/**
 * What Telegram 1's link opens: Messages to ONLY the players in this game who have not paid, with "Hey, we have 4 in for tonight at 7:30.
 * Please pay on the site and I'll book the court." It tries to open Messages at once (like the night-before link) and always shows the
 * button. Players with no phone saved are named, not texted. On a preview: shown, never opened by itself.
 */
export function UnpaidTextSheet({ ctx }: { ctx: AdminCtx }) {
  const [id, setId] = useState(unpaidParam);
  const sc = ctx.d.secondChance;
  const s = id ? ctx.d.sessions.find((x) => x.id === id) : undefined;
  const tz = ctx.d.group.timezone;
  const nowMs = sc ? Date.parse(sc.now) : Date.parse(ctx.d.now);
  const unpaid = s ? s.roster.filter((r) => r.status === 'confirmed' && !r.isOrganizer && r.paymentStatus !== 'paid') : [];
  const reach = unpaid.filter((r) => !!r.phone);
  const none = unpaid.filter((r) => !r.phone);
  const body = s ? unpaidText(s.startsAt, s.confirmedCount, tz, nowMs, siteAddress(ctx.d.group.playerLink)) : '';
  const href = reach.length ? smsHref(reach.map((r) => r.phone!), body, isIOS) : null;
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!sc || !href || tried || sc.preview) return;
    setTried(true);
    window.location.href = href;
  }, [sc, href, tried]);
  const close = () => {
    setId(null);
    const u = new URL(window.location.href);
    u.searchParams.delete('unpaid');
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
  };
  if (!sc || !id) return null;
  return (
    <Sheet open title="Text who hasn't paid" onClose={close}>
      <div className="stack" data-sc-unpaid-sheet>
        {!s ? (
          <p className="small muted">That game is not on the list any more.</p>
        ) : unpaid.length === 0 ? (
          <p className="small muted">Everyone in has paid.</p>
        ) : (
          <>
            <p className="small muted">
              {dayTime(s.startsAt, tz)}: {reach.map((r) => r.name).join(', ') || 'nobody with a phone'}
              {none.length > 0 && ` (no phone saved for ${none.map((r) => r.name).join(', ')})`}
            </p>
            <p className="sc-preview" data-sc-unpaid-body>
              {body}
            </p>
            {href && (
              <a className="btn block big" href={href} data-sc-unpaid-open>
                Open Messages
              </a>
            )}
            {sc.preview && <p className="small muted">Preview: fake players. Nothing is sent unless you tap send in Messages.</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
