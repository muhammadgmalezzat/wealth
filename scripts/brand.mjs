// Renders every app icon / splash image from the SVG sources in assets/brand/.
//   npm run brand                  -> writes the PNGs into assets/images/
//   npm run brand -- <previewDir>  -> also writes 1024 / 192 / 48 px icon previews and a splash mock-up
// Edit assets/brand/mark.svg (the shape) or the constants below, then re-run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets', 'images');

// Brand colors (the same values as constants/theme.ts: primary, gold, background).
const EMERALD = '#28C59A';
const GOLD = '#D8AD62';
const GROUND = '#0A1014';

// Android crops adaptive icons (and the Android 12 splash) to a circle of 66/108 of the canvas.
const SAFE_RADIUS = (1024 * 66) / 108 / 2;

const markSource = readFileSync(join(root, 'assets', 'brand', 'mark.svg'), 'utf8');
const markInner = markSource.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// The mark scaled around the canvas center, optionally recolored (monochrome icon).
function mark({ scale = 1, color } = {}) {
  let inner = markInner;
  if (color) inner = inner.replaceAll(EMERALD, color).replaceAll(GOLD, color);
  return `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${inner}</g>`;
}

// A soft emerald glow at the top of the dark ground, like the app's own backdrop.
const ground = `
  <defs>
    <radialGradient id="glow" cx="512" cy="330" r="720" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${EMERALD}" stop-opacity="0.2" />
      <stop offset="1" stop-color="${EMERALD}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="${GROUND}" />
  <rect width="1024" height="1024" fill="url(#glow)" />`;

const svg = (body, size) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">${body}</svg>`);

async function png(body, size, file) {
  // density keeps the SVG crisp when it is rasterized at a size other than its own.
  await sharp(svg(body, size), { density: 72 }).png({ compressionLevel: 9 }).toFile(file);
  console.log(`  ${file.replace(root, '').replace(/\\/g, '/')}  ${size}x${size}`);
}

// Fails loudly if the mark would be cut by the adaptive-icon circle.
async function checkSafeZone() {
  const { data, info } = await sharp(svg(mark(), 1024)).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  let worst = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 16) worst = Math.max(worst, Math.hypot(x - 512, y - 512));
    }
  }
  const ok = worst <= SAFE_RADIUS;
  console.log(`safe zone: mark reaches ${worst.toFixed(0)}px of ${SAFE_RADIUS.toFixed(0)}px allowed -> ${ok ? 'ok' : 'TOO BIG'}`);
  if (!ok) throw new Error('mark.svg leaves the adaptive-icon safe zone; shrink or move it');
}

async function main() {
  mkdirSync(out, { recursive: true });
  await checkSafeZone();
  console.log('rendering:');
  // iOS / store icon: full-bleed square, the system rounds the corners. No transparency.
  const iconBody = ground + mark({ scale: 1.22 });
  await png(iconBody, 1024, join(out, 'icon.png'));
  // Android adaptive icon: transparent foreground inside the safe zone; the background is the
  // flat color in app.json (android.adaptiveIcon.backgroundColor).
  await png(mark(), 1024, join(out, 'android-icon-foreground.png'));
  // Android 13 themed icon: a single-color silhouette, the system tints it.
  await png(mark({ color: '#FFFFFF' }), 1024, join(out, 'android-icon-monochrome.png'));
  // Splash: the mark alone on transparent; the dark ground comes from the splash plugin config.
  await png(mark(), 1024, join(out, 'splash-icon.png'));
  // Web favicon: bigger mark, because it is read at 16-48px.
  await png(ground + mark({ scale: 1.4 }), 48, join(out, 'favicon.png'));

  const previewDir = process.argv[2];
  if (previewDir) {
    mkdirSync(previewDir, { recursive: true });
    console.log('previews:');
    for (const size of [1024, 192, 48]) await png(iconBody, size, join(previewDir, `icon-${size}.png`));
    // Splash mock-up: a phone-shaped screen with the mark centered at the configured width.
    const W = 1080;
    const H = 2340;
    const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
    const splashPlugin = config.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
    const markWidth = splashPlugin[1].imageWidth * (W / 412); // imageWidth is in dp; ~412dp-wide phone
    const splash = await sharp(svg(mark(), Math.round(markWidth))).png().toBuffer();
    await sharp({ create: { width: W, height: H, channels: 4, background: GROUND } })
      .composite([{ input: splash, gravity: 'center' }])
      .png()
      .toFile(join(previewDir, 'splash.png'));
    console.log(`  ${join(previewDir, 'splash.png')}  ${W}x${H}`);
    // The themed-icon silhouette on a mid-gray tile, roughly how Android 13 tints it.
    const mono = await sharp(svg(mark({ color: '#FFFFFF' }), 1024)).png().toBuffer();
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#3A4A52' } })
      .composite([{ input: mono }])
      .png()
      .toFile(join(previewDir, 'monochrome.png'));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
