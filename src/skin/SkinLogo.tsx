import { BUBBLE_BACK, BUBBLE_FIRST } from '../../shared/christmasSkin';
import { toggleSkin, useSkin } from './store';
import { THEME } from './theme';

/**
 * The header logo while the skin is available (Everyone, inside the window; or Just me, for the organizer's own player only). Same square tile and outline as the normal logo, with the
 * Christmas picture; the whole tile is the button that turns the theme on and off. The two small speech bubbles hang under it.
 * (Outside the window or with the switch off the header draws its usual logo and this is never mounted.)
 */
export function SkinLogo() {
  const skin = useSkin();
  // Everyone: the Christmas logo. Just me: the NORMAL logo (nobody else can tell it is a button).
  const christmasLogo = skin.mode === 'all';
  const text = skin.bubble === 'first' ? BUBBLE_FIRST : skin.bubble === 'back' ? BUBBLE_BACK : null;
  return (
    <span className="skin-logo-wrap">
      <button type="button" className={`brand-tile skin-logo ${christmasLogo ? 'skin-logo-all' : 'skin-logo-me'}`} onClick={toggleSkin} aria-pressed={skin.on} aria-label="Christmas theme" data-skin-logo={skin.mode}>
        <img className="brand-logo" src={christmasLogo ? THEME.logoSrc(true) : '/logo.png'} alt="" width="24" height="24" />
      </button>
      {text && (
        <span key={`${skin.bubble}-${skin.seq}`} className="skin-bubble" role="status" data-skin-bubble>
          {text}
        </span>
      )}
    </span>
  );
}
