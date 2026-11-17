/** Set at build time (vite.config.ts `define`): changes on every build, so a saved copy from an older build is thrown away (src/lastScreen.ts). */
declare const __APP_BUILD__: string;

/** Zip 55: true only in a preview build (`npm run deploy:preview` sets PB_PREVIEW_BUILD=1; vite.config.ts). False in every live build. */
declare const __PREVIEW_BUILD__: boolean;
