// Zip 38: a skin is a set of SLOTS. The Christmas theme fills them; another theme later fills the same ones with its own pieces and its own
// CSS block (html[data-skin='<id>'] in its own .css file). Nothing in the screens knows about Christmas, only about slots:
//   logoSrc        the header logo image (shown inside the window, theme on or off)
//   Seat           a seat marker: a filled seat (index = seat order, `me` = my own seat) or an empty one
//   Badge          the small badge in the "Game on" toast and the pieces of the burst
//   (CSS slots)    section divider line, top game card cap, tonight/tomorrow tile band, page color: christmas.css
import { useId, type CSSProperties, type ReactElement } from 'react';
import { logoFor } from '../../shared/christmasSkin';

export interface SeatProps {
  index: number;
  empty?: boolean;
  me?: boolean;
  className?: string;
  style?: CSSProperties;
}

export interface SkinTheme {
  id: 'christmas';
  logoSrc: (inWindow: boolean) => string;
  Seat: (p: SeatProps) => ReactElement;
  Badge: (p: { index: number; className?: string; style?: CSSProperties }) => ReactElement;
}

/** Ornament colors by seat: red, green, gold, blue (light, dark). */
const COLS: [string, string][] = [['#e5483f', '#b3261e'], ['#37b873', '#1f7a4a'], ['#f2b33d', '#c28a14'], ['#4f7be0', '#2f55b0']];

/**
 * One Christmas ornament, 22 x 26: a gold cap and a glossy ball (a filled seat), or a dashed outline of the same shape (an empty seat).
 * My own seat has no ring: it has a very faint gold glow and a tiny slow sway instead (CSS, `.xorn.me`, src/skin/christmas.css).
 */
export function Ornament({ index, empty, me, className = '', style }: SeatProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [c, d] = COLS[index % 4];
  if (empty) {
    return (
      <svg className={`xorn xempty ${className}`.trim()} style={style} viewBox="0 0 22 26" aria-hidden="true">
        <rect x="8.5" y="1" width="5" height="4.5" rx="1" fill="none" stroke="var(--xo-ring)" strokeWidth="1.4" />
        <circle cx="11" cy="16" r="8.4" fill="none" stroke="var(--xo-ring)" strokeWidth="1.7" strokeDasharray="3.2 2.6" />
      </svg>
    );
  }
  return (
    <svg className={`xorn${me ? ' me' : ''} ${className}`.trim()} style={style} viewBox="0 0 22 26" aria-hidden="true">
      <defs>
        <radialGradient id={`xg${uid}`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".9" />
          <stop offset=".25" stopColor={c} />
          <stop offset="1" stopColor={d} />
        </radialGradient>
      </defs>
      <rect x="8.5" y="1" width="5" height="4.5" rx="1" fill="#d9a53a" />
      <rect x="9.7" y="4.6" width="2.6" height="2" fill="#b98424" />
      <circle cx="11" cy="16" r="9" fill={`url(#xg${uid})`} />
      <ellipse cx="7.8" cy="12.3" rx="2.4" ry="1.5" fill="#fff" opacity=".6" transform="rotate(-30 7.8 12.3)" />
    </svg>
  );
}

export const CHRISTMAS: SkinTheme = {
  id: 'christmas',
  logoSrc: logoFor,
  Seat: Ornament,
  Badge: ({ index, className, style }) => <Ornament index={index} className={className} style={style} />,
};

/** The theme in use. One for now; the slots above are what a second theme would fill. */
export const THEME: SkinTheme = CHRISTMAS;
