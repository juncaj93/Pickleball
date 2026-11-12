import { useEffect, useState } from 'react';
import { smsGroupHref } from '../../shared/gameDayText';
import { api, ApiError, isIOS, useLoad } from '../lib';
import { TopBar } from '../Shell';
import { MessageIcon, Notice, Spinner } from '../ui';
import '../do-now.css';

/**
 * Zip 37, "Game day text": the private link in the hour-before Telegram (/gt/<token>). It asks the server for the words and the numbers
 * of the players in that one game (the numbers are looked up there; the link itself holds none), tries to open Messages addressed to
 * ONLY those players, and always shows one big "Open Messages" button in case the phone blocks the automatic open. Nothing is sent from
 * here: the organizer taps send in Messages. No players with a number: a short calm message instead, and Messages is never opened.
 */
export function GameDayTextPage({ token }: { token: string }) {
  const load = useLoad(() => api<{ ok: true; numbers: string[]; withoutNumber: number; body: string; preview?: true }>('POST', '/api/gdt', { token }), [token]);
  const numbers = load.data?.numbers ?? [];
  const href = load.data && numbers.length > 0 ? smsGroupHref(numbers, load.data.body, isIOS) : null;
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!href || tried) return;
    setTried(true);
    window.location.href = href;
  }, [href, tried]);
  return (
    <>
      <TopBar eyebrow="Organizer" title="Text the players" />
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
        {load.data && numbers.length === 0 && (
          <div className="stack" data-gdt-none>
            <Notice tone="warn">No one in this game has a phone number saved, so there is no one to text.</Notice>
            <a className="btn block big" href="/admin">
              Open the organizer page
            </a>
          </div>
        )}
        {load.data && href && (
          <div className="card stack go-card">
            <p className="dn-eyebrow">
              {load.data.preview ? 'Preview, fake players' : 'Game day'} · {numbers.length} {numbers.length === 1 ? 'player' : 'players'}
            </p>
            <p className="bubble" data-gdt-body style={{ whiteSpace: 'pre-line' }}>
              {load.data.body}
            </p>
            <a className="btn block big" href={href} data-gdt-open>
              <MessageIcon />
              Open Messages
            </a>
            <p className="small muted">Only the players in this game. Nothing sends until you tap send in Messages.</p>
          </div>
        )}
      </main>
    </>
  );
}
