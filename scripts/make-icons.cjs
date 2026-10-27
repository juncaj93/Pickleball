/* Make every icon the site needs from one logo image.
 *
 *   node scripts/make-icons.cjs path/to/logo.png
 *
 * Writes into public/:
 *   apple-touch-icon.png  180x180  iPhone Home Screen (solid white, logo centered with padding
 *                                   so iOS's rounded corners never clip it)
 *   icon-192.png, icon-512.png     Android / manifest
 *   favicon-32.png                 browser tab
 *   logo-header.png       128x128  small logo next to the group name, on white (the page shows it
 *                                   on a light rounded square, so it looks intentional in dark mode)
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

// `logo` is how much of the square the (trimmed) logo may fill. iPhone icons
// keep it at about 76% so the rounded corners never clip the artwork.
const targets = [
  { file: 'apple-touch-icon.png', size: 180, bg: '#ffffff', logo: 0.76 },
  { file: 'icon-192.png', size: 192, bg: '#ffffff', logo: 0.76 },
  { file: 'icon-512.png', size: 512, bg: '#ffffff', logo: 0.76 },
  { file: 'favicon-32.png', size: 32, bg: '#ffffff', logo: 0.94 },
  { file: 'logo-header.png', size: 128, bg: '#ffffff', logo: 0.9 },
];

(async () => {
  const browser = await chromium.launch();
  // Trim the empty white margin around the artwork first, so every size is
  // padded the same way no matter how much border the source image had.
  const trimPage = await browser.newPage();
  const trimmed = await trimPage.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const imageData = x.getImageData(0, 0, c.width, c.height);
    const { data } = imageData;
    // Photos of white paper are rarely pure white (253-254 here). Snap
    // near-white to white so no faint square shows on the white icon.
    for (let k = 0; k < data.length; k += 4) {
      if (data[k] >= 246 && data[k + 1] >= 246 && data[k + 2] >= 246) data[k] = data[k + 1] = data[k + 2] = 255;
    }
    x.putImageData(imageData, 0, 0);
    let top = c.height, left = c.width, right = 0, bottom = 0;
    for (let y = 0; y < c.height; y++) {
      for (let i = 0; i < c.width; i++) {
        const k = (y * c.width + i) * 4;
        // Anything clearly darker than paper white (or not transparent) is artwork.
        const ink = data[k + 3] > 16 && Math.min(data[k], data[k + 1], data[k + 2]) < 235;
        if (ink) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (i < left) left = i;
          if (i > right) right = i;
        }
      }
    }
    const pad = Math.round(Math.max(right - left, bottom - top) * 0.02);
    left = Math.max(0, left - pad);
    top = Math.max(0, top - pad);
    right = Math.min(c.width - 1, right + pad);
    bottom = Math.min(c.height - 1, bottom + pad);
    const out = document.createElement('canvas');
    out.width = right - left + 1;
    out.height = bottom - top + 1;
    const o = out.getContext('2d');
    o.fillStyle = '#ffffff';
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(c, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return { url: out.toDataURL('image/png'), box: [left, top, right, bottom] };
  }, dataUrl);
  console.log(`  artwork found at ${trimmed.box.join(', ')} (left, top, right, bottom)`);

  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    const inner = Math.round(t.size * t.logo);
    await page.setContent(
      `<html><body style="margin:0;background:${t.bg}">
         <div style="width:${t.size}px;height:${t.size}px;display:grid;place-items:center">
           <img src="${trimmed.url}" style="max-width:${inner}px;max-height:${inner}px;object-fit:contain">
         </div></body></html>`,
    );
    await page.waitForFunction(() => document.images[0].complete);
    await page.screenshot({ path: path.join(out, t.file) });
    console.log(`  ${t.file} (${t.size}x${t.size})`);
  }
  await browser.close();
})();
