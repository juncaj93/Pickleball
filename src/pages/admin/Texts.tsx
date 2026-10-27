import { useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { courtStatus } from '../../../shared/court';
import {
  canceledMessage,
  courtWaitlistPollMessage,
  dayBeforeMessage,
  dayBeforePlayersMessage,
  lastCallMessage,
  movedMessage,
  pollMessage,
  sessionLink,
  shareGameMessage,
  smsHref,
  spotOpenMessage,
} from '../../../shared/messages';
import { DEFAULT_VENUE_NAME } from '../../../shared/settings';
import { copyText, isIOS } from '../../lib';
import { SmsDraft, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { playersIn, shortOfPlayers } from './todo';

// Every text the site prepares for one session. Each opens Messages with
// Copy as a backup; nothing here ever sends or says "sent".

const venueOf = (ctx: AdminCtx) => ctx.d.group.venueName || DEFAULT_VENUE_NAME;

/** "Share the game": worded for where the court stands, linking straight to the session. */
export function shareGameText(ctx: AdminCtx, s: AdminSessionView): string {
  const tz = ctx.d.group.timezone;
  const kind = courtStatus({ ...s, canceled: s.state.flags.canceled, started: s.state.flags.started, past: s.state.flags.past }, tz).kind;
  return shareGameMessage(s, tz, kind === 'booked' ? 'booked' : kind === 'waitlist' ? 'waitlist' : 'open', sessionLink(ctx.d.group.playerLink, s.id));
}


/**
 * The day-before card: the main button texts the players who are in and
 * gives them a link to back out. When we're short of 4 or 6, the "need more
 * players" group text is the main one instead; the other is one tap away.
 */
export function DayBeforeTexts({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const link = sessionLink(ctx.d.group.playerLink, s.id);
  const [showOther, setShowOther] = useState(false);
  const { phones, missing } = playersIn(s);
  const toPlayers = (
    <SmsDraft
      to="Players who are in"
      phone={null}
      phones={phones}
      missing={missing}
      openLabel="Text the players who are in"
      body={dayBeforePlayersMessage(s, tz, venueOf(ctx), link)}
    />
  );
  const needMore = <SmsDraft to="Group chat" phone={null} openLabel="Text the group: need more players" body={dayBeforeMessage(s, tz, s.confirmedCount, link)} />;
  const short = shortOfPlayers(s);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {short ? needMore : toPlayers}
      {showOther ? (
        short ? (
          toPlayers
        ) : (
          needMore
        )
      ) : (
        <button className="btn small secondary" onClick={() => setShowOther(true)}>
          {short ? 'Text the players who are in' : 'Text the group: need more players'}
        </button>
      )}
    </div>
  );
}

interface TextItem {
  id: string;
  label: string;
  body: string;
  phones?: string[];
  missing?: string[];
}

/** The texts for the phone icon, in the order they're usually needed. */
export function sessionTexts(ctx: AdminCtx, s: AdminSessionView): TextItem[] {
  const tz = ctx.d.group.timezone;
  const link = sessionLink(ctx.d.group.playerLink, s.id);
  const items: TextItem[] = [];
  const live = !s.state.flags.canceled && !s.state.flags.started;
  if (s.state.flags.canceled) items.push({ id: 'canceled', label: 'Canceled', body: canceledMessage(s, tz) });
  if (live && s.moved) items.push({ id: 'moved', label: 'Moved', body: movedMessage(s, tz) });
  if (live) {
    items.push({ id: 'share', label: 'Share the game', body: shareGameText(ctx, s) });
    items.push({
      id: 'poll',
      label: 'Poll',
      body: s.courtState === 'waitlist' ? courtWaitlistPollMessage(s, tz, link) : pollMessage(s, tz, venueOf(ctx), ctx.d.group.settings.pricePerPlayerCents),
    });
    const { phones, missing } = playersIn(s);
    items.push({ id: 'daybefore', label: 'Day before', body: dayBeforePlayersMessage(s, tz, venueOf(ctx), link), phones, missing });
    items.push({ id: 'lastcall', label: 'Last call', body: lastCallMessage(s, tz, s.confirmedCount, link) });
    if (s.state.flags.openSpots > 0) items.push({ id: 'spot', label: 'Spot open', body: spotOpenMessage(s, tz, ctx.d.group.playerLink) });
  }
  return items;
}

/** One compact row: the text's name, Open (Messages) and Copy. Tap the name to read it. */
function TextRow({ item }: { item: TextItem }) {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [opened, setOpened] = useState(false);
  return (
    <li className="text-row" data-text={item.id}>
      <div className="text-row-top">
        <button className="link-btn text-name" aria-expanded={show} onClick={() => setShow((v) => !v)}>
          {item.label}
        </button>
        <div className="text-row-btns">
          <a className="btn small" href={smsHref(item.phones && item.phones.length ? item.phones : null, item.body, isIOS)} onClick={() => setOpened(true)} aria-label={`Open ${item.label} in Messages`}>
            Open
          </a>
          <button
            className="btn small secondary copy-text"
            aria-label={`Copy text: ${item.label}`}
            onClick={async () => ((await copyText(item.body)) ? toast('Message copied') : toast("Couldn't copy. Select the text instead.", 'error'))}
          >
            Copy text
          </button>
        </div>
      </div>
      {item.missing && item.missing.length > 0 && <div className="small missing-numbers">Missing numbers: {item.missing.join(', ')}</div>}
      {opened && <div className="small muted">Message ready. Press send in Messages when it looks right.</div>}
      {show && <p className="bubble">{item.body}</p>}
    </li>
  );
}

/** "Other texts" in a card's gear panel: this session's prepared texts. */
export function TextsMenu({ ctx, s, skip = [] }: { ctx: AdminCtx; s: AdminSessionView; skip?: string[] }) {
  const items = sessionTexts(ctx, s).filter((it) => !skip.includes(it.id));
  if (items.length === 0) return <p className="muted small">No texts for a session that's already played.</p>;
  return (
    <ul className="text-menu" aria-label="Texts">
      {items.map((it) => (
        <TextRow key={it.id} item={it} />
      ))}
    </ul>
  );
}
