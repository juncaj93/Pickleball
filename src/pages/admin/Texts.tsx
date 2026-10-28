import { useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { smsHref } from '../../../shared/messages';
import { isIOS } from '../../lib';
import { MessageIcon } from '../../ui';
import type { AdminCtx } from '../Admin';
import { sessionTexts } from './textMenu';

// Every text the site prepares for one session. Each opens Messages with the
// words and the numbers filled in; nothing here ever sends or says "sent".
// What is offered (and to whom) is worked out in textMenu.ts.

/**
 * The gear panel's "Text" button. It opens a short list of only the texts that
 * fit this game right now. Each choice opens Messages with the words, and the
 * right people's numbers when it's for them; the gray line says who.
 */
export function TextButton({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const items = sessionTexts(ctx.d, s, Date.parse(ctx.d.now));
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
