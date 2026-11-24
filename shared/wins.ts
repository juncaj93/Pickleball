// Zip 82 (🎾82.night admin): the wins sheet's words (src/WinsSheet.tsx), pure so the tests share them.
import { formatName, type WinsView } from './tournament';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue Dec 1, 2026" from '2026-12-01'. */
export function winDate(d: string | null): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const [y, m, day] = d.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${DAYS[w]} ${MONTHS[m - 1]} ${day}, ${y}`;
}

/** "Tue Dec 1, 2026 · Locked doubles with Wren" / "Sat Aug 15, 2026 · Americano". */
export const winLine = (w: WinsView['wins'][number]): string =>
  [winDate(w.date), `${formatName(w.format)}${w.format === 'doubles' && w.partner ? ` with ${w.partner}` : ''}`].filter(Boolean).join(' · ');

/** "Your wins" or "Vic’s wins". */
export const winsTitle = (name: string, me: string | null | undefined): string => (me && name === me ? 'Your wins' : `${name}’s wins`);

