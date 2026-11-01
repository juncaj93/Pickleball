/** The X on a notice card (see dismiss.ts): a 44 px tap area in the top-right corner. */
export function DismissX({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button type="button" className="card-x" aria-label={`Dismiss: ${label}`} data-dismiss onClick={onDismiss}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}
