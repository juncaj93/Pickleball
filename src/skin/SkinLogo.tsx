import { BUBBLE_BACK, BUBBLE_FIRST } from '../../shared/christmasSkin';
import { toggleSkin, useSkin } from './store';
import { THEME } from './theme';

/**
 * The header logo while the skin is available (inside the window, switch on). Same square tile and outline as the normal logo, with the
 * Christmas picture; the whole tile is the button that turns the theme on and off. The two small speech bubbles hang under it.
 * (Outside the window or with the switch off the header draws its usual logo and this is never mounted.)
 */
export function SkinLogo() {
  const skin = useSkin();
  const text = skin.bubble === 'first' ? BUBBLE_FIRST : skin.bubble === 'back' ? BUBBLE_BACK : null;
  return (
    <span className="skin-logo-wrap">
      <button type="button" className="brand-tile skin-logo" onClick={toggleSkin} aria-pressed={skin.on} aria-label="Christmas theme" data-skin-logo>
        <img className="brand-logo" src={THEME.logoSrc(true)} alt="" width="24" height="24" />
      </button>
      {text && (
        <span key={`${skin.bubble}-${skin.seq}`} className="skin-bubble" role="status" data-skin-bubble>
          {text}
        </span>
      )}
    </span>
  );
}
