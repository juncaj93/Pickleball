import { useEffect, useMemo, useRef, useState } from 'react';
import { smsHref } from '../../../shared/messages';
import { isIOS, storageGet, storageSet, usePretend } from '../../lib';
import { MessageIcon } from '../../ui';
import type { AdminCtx } from '../Admin';
import { pruneTapped, readTapped, type Suggestion, suggestions, type SuggestionKind, type Tapped, visibleSuggestions, writeTapped } from './suggestions';
import { coveredByDoNow } from './doNow';
import { DISMISSIBLE } from './dismiss';
import { DismissX } from './DismissX';
import '../../suggestions.css';
import '../../do-now.css';
import { AlertCard } from '../../AlertCard';

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
  const pretending = usePretend() !== null;
  // Starting or ending Pretend: back to the phone's real list (demo taps were kept in memory only).
  // The data on screen when Pretend started or ended still belongs to the other time: no clean-up until fresh data lands.
  const staleData = useRef<unknown>(null);
  useEffect(() => {
    staleData.current = ctx.d;
    setTapped(readTapped(storageGet));
  }, [pretending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // While pretending it's another time the cards differ; keep the real taps and dismissals.
    if (pretending || staleData.current === ctx.d) return;
    const next = pruneTapped(all, tapped);
    if (Object.keys(next).length !== Object.keys(tapped).length) {
      setTapped(next);
      writeTapped(storageSet, next);
    }
  }, [all, tapped, pretending]);
  const shown = visibleSuggestions(all, tapped);
  if (shown.length === 0) return null;
  const list = more ? shown : shown.slice(0, SHOWN);
  const tap = (c: Suggestion) => {
    const next = { ...tapped, [c.key]: c.token };
    setTapped(next);
    // Pretend it's... is a demo: a tap or X there never changes the phone's real list.
    if (!pretending) writeTapped(storageSet, next);
  };
  // Zip 11, Alert cards: each text card as a purple (texting) card: the same words (the kind as the title, the game and who under
  // it, the text's first words), the same Text link, the same X. A payment reminder's button says Remind.
  if (ctx.d.alertCards === true) {
    return (
      <section className="ac-stack suggest-cards" aria-label="Texts to send">
        {list.map((c) => (
          <AlertCard
            key={c.key}
            tone="purple"
            label={`${KIND_LABEL[c.kind]}: ${c.when}`}
            data={{ 'data-suggest': c.kind, 'data-session': c.sessionId }}
            title={KIND_LABEL[c.kind]}
            sub={
              <>
                {c.when} · {c.who}
                <span className="ac-preview" title={c.body}>
                  {c.body}
                </span>
                {c.missing.length > 0 && <span className="ac-missing missing-numbers">Missing numbers: {c.missing.join(', ')}</span>}
              </>
            }
            action={
              <a className="ac-btn sg-text" href={smsHref(c.phones.length ? c.phones : null, c.body, isIOS)} onClick={() => tap(c)} aria-label={`${c.kind === 'pay' ? 'Remind' : 'Text'}: ${c.body}`}>
                {c.kind === 'pay' ? 'Remind' : 'Text'}
              </a>
            }
            onX={DISMISSIBLE.has(c.kind) ? () => tap(c) : undefined}
            xLabel={`${KIND_LABEL[c.kind]}, ${c.when}`}
          />
        ))}
        {shown.length > SHOWN && (
          <button className="ac-more-link sg-more" onClick={() => setMore((v) => !v)}>
            {more ? 'Show fewer' : `${shown.length - SHOWN} more`}
          </button>
        )}
      </section>
    );
  }
  return (
    <section className="stack suggest-cards" aria-label="Texts to send">
      {list.map((c) => (
        <article
          key={c.key}
          className={`card suggest-card${DISMISSIBLE.has(c.kind) ? ' dismissible' : ''}`}
          aria-label={`${KIND_LABEL[c.kind]}: ${c.when}`}
          data-suggest={c.kind}
          data-session={c.sessionId}
        >
          {/* Dismiss hides it like a Text tap does: on this phone, until the situation changes. */}
          {DISMISSIBLE.has(c.kind) && <DismissX label={`${KIND_LABEL[c.kind]}, ${c.when}`} onDismiss={() => tap(c)} />}
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
