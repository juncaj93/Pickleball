/* Make every icon the site needs from one logo image.
 *
 *   node scripts/make-icons.cjs path/to/logo.png
 *
 * Writes into public/:
 *   apple-touch-icon.png  180x180  iPhone Home Screen (solid white, logo centered with padding
 *                                   so iOS's rounded corners never clip it)
 *   icon-192.png, icon-512.png     Android / manifest
 *   favicon-32.png                 browser tab
 *   logo-header.png       128x128  small logo next to the group name (transparent around the logo;
 *                                   the page puts it on a light rounded backing)
 * Uses the Chromium that Playwright already has, so nothing extra to install.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Usage: node scripts/make-icons.cjs path/to/logo.(png|jpg|svg|webp)');
  process.exit(1);
}
const ext = path.extname(src).slice(1).toLowerCase();
const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp' }[ext];
if (!mime) {
  console.error(`Unsupported image type: .${ext}`);
  process.exit(1);
}
const dataUrl = `data:${mime};base64,${fs.readFileSync(src).toString('base64')}`;
const out = path.join(__dirname, '..', 'public');

const targets = [
  { file: 'apple-touch-icon.png', size: 180, bg: '#ffffff', logo: 0.78 },
  { file: 'icon-192.png', size: 192, bg: '#ffffff', logo: 0.78 },
  { file: 'icon-512.png', size: 512, bg: '#ffffff', logo: 0.78 },
  { file: 'favicon-32.png', size: 32, bg: '#ffffff', logo: 0.9 },
  { file: 'logo-header.png', size: 128, bg: 'transparent', logo: 1 },
];

(async () => {
  const browser = await chromium.launch();
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    const inner = Math.round(t.size * t.logo);
    await page.setContent(
      `<html><body style="margin:0;background:${t.bg}">
         <div style="width:${t.size}px;height:${t.size}px;display:grid;place-items:center">
           <img src="${dataUrl}" style="max-width:${inner}px;max-height:${inner}px;object-fit:contain">
         </div></body></html>`,
    );
    await page.waitForFunction(() => document.images[0].complete);
    await page.screenshot({ path: path.join(out, t.file), omitBackground: t.bg === 'transparent' });
    console.log(`  ${t.file} (${t.size}x${t.size})`);
  }
  await browser.close();
})();
