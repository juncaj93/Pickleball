import { useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { smsHref } from '../../../shared/messages';
import { isIOS, useNow } from '../../lib';
import { MessageIcon, SmsDraft } from '../../ui';
import type { AdminCtx } from '../Admin';
import { fillTexts, sessionTexts, type TextItem } from './textMenu';

// Every text the site prepares for one session. Each opens Messages with the
// words and the numbers filled in; nothing here ever sends or says "sent".
// What is offered (and to whom) is worked out in textMenu.ts.

const OPEN_LABEL: Partial<Record<TextItem['id'], string>> = {
  checkin: 'Text the players who are in',
  need: 'Text the group: need more players',
  down5: 'Text the group: need 1 more or 1 out',
  share: 'Text the group',
};

/**
 * The texts on a "needs players" or check-in card: whichever of Down to 5,
 * Need players and Check-in fits this game (or Share the game). The first is
 * the card's one green button; any other is gray.
 */
export function DayBeforeTexts({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const now = useNow();
  const items = fillTexts(ctx.d, s, now);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.map((it, i) => (
        <SmsDraft
          key={it.id}
          quiet={i > 0}
          to={it.chat ? 'Group chat' : it.who.split(' · ')[0]}
          phone={null}
          phones={it.chat ? undefined : it.phones}
          missing={it.chat ? undefined : it.missing}
          openLabel={OPEN_LABEL[it.id] ?? 'Open in Messages'}
          body={it.body}
        />
      ))}
    </div>
  );
}

/** A card's text for a spot that just opened: the same choice as the cards that ask you to fill the game. */
export function SpotOpenTexts({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  return <DayBeforeTexts ctx={ctx} s={s} />;
}

/**
 * The gear panel's "Text" button. It opens a short list of only the texts that
 * fit this game right now. Each choice opens Messages with the words, and the
 * right people's numbers when it's for them; the gray line says who.
 */
export function TextButton({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const items = sessionTexts(ctx.d, s, now);
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
            const key = `${it.id}-${it.label}`;
            return (
              <li key={key} className="text-row" data-text={it.id}>
                <a className="text-choice" href={smsHref(it.phones.length ? it.phones : null, it.body, isIOS)} onClick={() => setOpened(key)}>
                  <span className="text-name">{it.label}</span>
                  <span className="text-who">{it.who}</span>
                </a>
                {it.missing.length > 0 && <div className="small missing-numbers">Missing numbers: {it.missing.join(', ')}</div>}
                {opened === key && <div className="small muted message-ready">Message ready</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
