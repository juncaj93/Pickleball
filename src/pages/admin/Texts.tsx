import { useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { courtStatus } from '../../../shared/court';
import {
  canceledMessage,
  dayBeforeMessage,
  dayBeforePlayersMessage,
  lastCallMessage,
  movedMessage,
  sessionLink,
  shareGameMessage,
  smsHref,
  spotOpenMessage,
} from '../../../shared/messages';
import { isIOS } from '../../lib';
import { MessageIcon, SmsDraft } from '../../ui';
import type { AdminCtx } from '../Admin';
import { type Audience, audienceLine, recipients, shortOfPlayers } from './todo';

// Every text the site prepares for one session. Each opens Messages with the
// words and the numbers filled in; nothing here ever sends or says "sent".

/** "Share the game": worded for where the court stands, linking straight to the session. */
export function shareGameText(ctx: AdminCtx, s: AdminSessionView): string {
  const tz = ctx.d.group.timezone;
  const kind = courtStatus({ ...s, canceled: s.state.flags.canceled, started: s.state.flags.started, past: s.state.flags.past }, tz).kind;
  return shareGameMessage(s, tz, kind === 'booked' ? 'booked' : kind === 'waitlist' ? 'waitlist' : 'open', sessionLink(ctx.d.group.playerLink, s.id));
}

/**
 * The day-before card: the main button texts the players who are in. When
 * we're short of 4 or 6, the "need more players" text (to everyone not in)
 * is the main one instead; the other is one tap away.
 */
export function DayBeforeTexts({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const site = ctx.d.group.playerLink;
  const [showOther, setShowOther] = useState(false);
  const inNow = recipients(ctx.d, s, 'in');
  const notIn = recipients(ctx.d, s, 'notIn');
  const toPlayers = (
    <SmsDraft to="Players who are in" phone={null} phones={inNow.phones} missing={inNow.missing} openLabel="Text the players who are in" body={dayBeforePlayersMessage(s, tz, site)} />
  );
  const needMore = (
    <SmsDraft to="Everyone not in yet" phone={null} phones={notIn.phones} missing={notIn.missing} openLabel="Text the group: need more players" body={dayBeforeMessage(s, tz, s.confirmedCount, site)} />
  );
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

export interface TextChoice {
  id: 'share' | 'daybefore' | 'lastcall' | 'spot' | 'canceled' | 'moved';
  label: string;
  body: string;
  who: Audience;
}

/** The choices under a card's "Text" button: only the ones that make sense for this session. */
export function sessionTexts(ctx: AdminCtx, s: AdminSessionView): TextChoice[] {
  const tz = ctx.d.group.timezone;
  const site = ctx.d.group.playerLink;
  const items: TextChoice[] = [];
  const live = !s.state.flags.canceled && !s.state.flags.started;
  if (s.state.flags.canceled) items.push({ id: 'canceled', label: 'Canceled', body: canceledMessage(s, tz), who: 'wereIn' });
  if (live) {
    if (s.moved) items.push({ id: 'moved', label: 'Moved', body: movedMessage(s, tz), who: 'in' });
    // Share the game and Spot open go to a group chat you pick, so no numbers.
    items.push({ id: 'share', label: 'Share the game', body: shareGameText(ctx, s), who: 'chat' });
    items.push({ id: 'daybefore', label: 'Day before', body: dayBeforePlayersMessage(s, tz, site), who: 'in' });
    items.push({ id: 'lastcall', label: 'Last call', body: lastCallMessage(s, tz, s.confirmedCount), who: 'in' });
    if (s.state.flags.openSpots > 0) items.push({ id: 'spot', label: 'Spot open', body: spotOpenMessage(s, tz, site), who: 'chat' });
  }
  return items;
}

/**
 * The gear panel's "Text" button. It opens a short list; each choice opens
 * Messages with the words, and the players' numbers when it's for them.
 * Share the game and Spot open open with just the words, to pick the chat.
 */
export function TextButton({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const items = sessionTexts(ctx, s);
  if (items.length === 0) return null;
  return (
    <div className="text-pick">
      <button className="btn text-btn" aria-expanded={open} aria-controls={`texts-${s.id}`} onClick={() => setOpen((v) => !v)}>
        <MessageIcon />
        Text
      </button>
      {open && (
        <ul className="text-menu" id={`texts-${s.id}`} aria-label="Texts">
          {items.map((it) => {
            const r = recipients(ctx.d, s, it.who);
            return (
              <li key={it.id} className="text-row" data-text={it.id}>
                <a className="text-choice" href={smsHref(r.phones.length ? r.phones : null, it.body, isIOS)} onClick={() => setOpened(it.id)}>
                  <span className="text-name">{it.label}</span>
                  <span className="text-who">{audienceLine(it.who, r.count)}</span>
                </a>
                {r.missing.length > 0 && <div className="small missing-numbers">Missing numbers: {r.missing.join(', ')}</div>}
                {opened === it.id && <div className="small muted message-ready">Message ready</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
