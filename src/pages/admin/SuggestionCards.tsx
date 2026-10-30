import { useEffect, useMemo, useState } from 'react';
import { smsHref } from '../../../shared/messages';
import { isIOS, storageGet, storageSet } from '../../lib';
import { MessageIcon } from '../../ui';
import type { AdminCtx } from '../Admin';
import { pruneTapped, readTapped, type Suggestion, suggestions, type SuggestionKind, type Tapped, visibleSuggestions, writeTapped } from './suggestions';
import { coveredByDoNow } from './doNow';
import '../../suggestions.css';

const KIND_LABEL: Record<SuggestionKind, string> = {
  promoted: 'Spot opened',
  need: 'Need players',
  checkin: 'Check-in',
  final: 'Final price',
  pay: 'Payment reminder',
};

const SHOWN = 2;

/**
 * At the top of Home: a card for each game that needs a text, with one green
 * Text button that opens Messages with the words and the numbers ready. The
 * site never sends anything and never says it did. After a tap the card hides
 * on this device only (nothing is saved on the server) until the situation
 * changes. With nothing to suggest, nothing shows at all.
 */
export function SuggestionCards({ ctx }: { ctx: AdminCtx }) {
  const all = useMemo(() => suggestions(ctx.d, Date.parse(ctx.d.now)).filter((c) => !coveredByDoNow(c, ctx.d, Date.parse(ctx.d.now))), [ctx.d]);
  const [tapped, setTapped] = useState<Tapped>(() => readTapped(storageGet));
  const [more, setMore] = useState(false);
  // A situation that goes away and comes back is suggested again.
  useEffect(() => {
    const next = pruneTapped(all, tapped);
    if (Object.keys(next).length !== Object.keys(tapped).length) {
      setTapped(next);
      writeTapped(storageSet, next);
    }
  }, [all, tapped]);
  const shown = visibleSuggestions(all, tapped);
  if (shown.length === 0) return null;
  const list = more ? shown : shown.slice(0, SHOWN);
  const tap = (c: Suggestion) => {
    const next = { ...tapped, [c.key]: c.token };
    setTapped(next);
    writeTapped(storageSet, next);
  };
  return (
    <section className="stack suggest-cards" aria-label="Texts to send">
      {list.map((c) => (
        <article key={c.key} className="card suggest-card" aria-label={`${KIND_LABEL[c.kind]}: ${c.when}`} data-suggest={c.kind} data-session={c.sessionId}>
          <div className="sg-head">
            <span className="sg-kind">{KIND_LABEL[c.kind]}</span>
            <span className="sg-who small muted">{c.who}</span>
          </div>
          <div className="sg-when">{c.when}</div>
          <p className="sg-preview" title={c.body}>
            {c.body}
          </p>
          {c.missing.length > 0 && <div className="small missing-numbers">Missing numbers: {c.missing.join(', ')}</div>}
          <a className="btn block sg-text" href={smsHref(c.phones.length ? c.phones : null, c.body, isIOS)} onClick={() => tap(c)} aria-label={`Text: ${c.body}`}>
            <MessageIcon />
            Text
          </a>
        </article>
      ))}
      {shown.length > SHOWN && (
        <button className="link-btn sg-more" onClick={() => setMore((v) => !v)}>
          {more ? 'Show fewer' : `${shown.length - SHOWN} more`}
        </button>
      )}
    </section>
  );
}
