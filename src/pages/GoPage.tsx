import { useEffect, useState } from 'react';
import { smsHref } from '../../shared/messages';
import { api, ApiError, isIOS, useLoad } from '../lib';
import { TopBar } from '../Shell';
import { MessageIcon, Notice, Spinner } from '../ui';
import '../do-now.css';

/**
 * The direct text link from a night-before Telegram alert. It gets the words
 * for that game, tries to open Messages with them (no recipients: you pick
 * the group chat), and always shows one big "Open Messages" button in case
 * the phone blocks the automatic open.
 */
export function GoPage({ token }: { token: string }) {
  const load = useLoad(() => api<{ ok: true; kind: 'need' | 'checkin'; body: string }>('POST', '/api/go', { token }), [token]);
  const href = load.data ? smsHref(null, load.data.body, isIOS) : null;
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!href || tried) return;
    setTried(true);
    window.location.href = href;
  }, [href, tried]);
  return (
    <>
      <TopBar eyebrow="Organizer" title="Text the group" />
      <main className="page stack go-page">
        {load.loading && !load.data && <Spinner />}
        {load.error && (
          <div className="stack">
            <Notice tone="warn">{load.error instanceof ApiError ? load.error.message : 'This link does not work.'}</Notice>
            <a className="btn block big" href="/admin">
              Open the organizer page
            </a>
          </div>
        )}
        {load.data && href && (
          <div className="card stack go-card">
            <p className="dn-eyebrow">{load.data.kind === 'need' ? 'Need players' : 'Check-in'}</p>
            <p className="bubble" data-go-body>
              {load.data.body}
            </p>
            <a className="btn block big" href={href} data-go-open>
              <MessageIcon />
              Open Messages
            </a>
            <p className="small muted">Pick the group chat in Messages, then send.</p>
          </div>
        )}
      </main>
    </>
  );
}
