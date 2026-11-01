/**
 * After one X, the next card slides up under the finger: taps on any X are ignored for this long, so a
 * double tap hides one card, not two.
 */
export const DISMISS_QUIET_MS = 700;
let lastDismiss = 0;

/** The X on a notice card (see dismiss.ts): a 44 px tap area in the top-right corner. */
export function DismissX({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      className="card-x"
      aria-label={`Dismiss: ${label}`}
      data-dismiss
      onClick={() => {
        const now = Date.now();
        if (now - lastDismiss < DISMISS_QUIET_MS) return;
        lastDismiss = now;
        onDismiss();
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}
