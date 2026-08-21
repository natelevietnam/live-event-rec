// Inlines the page, its stylesheet, its script, and the generated data into a
// single self-contained HTML file at dist/worth-it.html.
//
// Why this exists: fetch() is blocked under file://, so the normal page cannot
// read data.json when opened by double-click. This build embeds the payload in
// a <script type="application/json"> tag instead, which means the result is one
// file that works offline, can be emailed, and needs no host at all.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const html = read('public/index.html');
const css = read('public/styles.css');
const js = read('public/app.js');
const dataRaw = read('public/data.json');

const data = JSON.parse(dataRaw);
if (data.built === false) {
  console.error('public/data.json is still the placeholder. Run `npm run build:data` first.');
  process.exit(1);
}

// </script> inside embedded JSON would close the tag early. Nothing else in a
// JSON payload can terminate it.
const safeJson = dataRaw.replace(/<\/script>/gi, '<\\/script>');

const bundled = html
  .replace('<link rel="stylesheet" href="./styles.css" />', `<style>\n${css}\n</style>`)
  .replace(
    '<script src="./app.js" type="module"></script>',
    `<script id="bundled-data" type="application/json">\n${safeJson}\n</script>\n<script type="module">\n${js}\n</script>`,
  );

for (const marker of ['<style>', 'bundled-data']) {
  if (!bundled.includes(marker)) {
    console.error(`Inlining failed: ${marker} not present. index.html markup must have changed.`);
    process.exit(1);
  }
}
if (bundled.includes('href="./styles.css"') || bundled.includes('src="./app.js"')) {
  console.error('Inlining failed: an external reference survived.');
  process.exit(1);
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const target = join(ROOT, 'dist/worth-it.html');
writeFileSync(target, bundled);

const kb = (bundled.length / 1024).toFixed(0);
console.log(`Wrote dist/worth-it.html — ${kb} KB, ${data.shows.length} shows, ${data.cut.length} cut.`);
console.log('Self-contained: no network, no host, opens by double-click.');
