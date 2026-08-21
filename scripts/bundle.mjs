// Inlines the page, its stylesheet, its script, and the generated data into a
// single self-contained HTML file at dist/live-event-rec.html.
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
const dataRaw = read('public/data.json');
const eventsRaw = read('public/events.json');
const similarRaw = read('public/similar-artists.json');

// app.js imports lib/rank.mjs, which imports its siblings. Bare ES imports do
// not resolve under file://, so the graph is flattened here in dependency order
// and the import statements removed. Assertions below prove nothing survived.
const LIB_ORDER = ['normalize.mjs', 'score.mjs', 'reason.mjs', 'match.mjs', 'rank.mjs'];
const stripModuleSyntax = (src) =>
  src
    .replace(/^\s*import\s[^;]*?;\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\}\s*;\s*$/gm, '')
    .replace(/^export\s+(const|function|class|let)\b/gm, '$1');

const lib = LIB_ORDER.map((f) => stripModuleSyntax(read(`public/lib/${f}`))).join('\n');
const js = `${lib}\n${stripModuleSyntax(read('public/app.js'))}`;

const data = JSON.parse(dataRaw);
if (data.built === false) {
  console.error('public/data.json is still the placeholder. Run `npm run build:data` first.');
  process.exit(1);
}

// </script> inside embedded JSON would close the tag early. Nothing else in a
// JSON payload can terminate it.
const escapeJson = (s) => s.replace(/<\/script>/gi, '<\\/script>');
const safeJson = escapeJson(dataRaw);

const bundled = html
  .replace('<link rel="stylesheet" href="./styles.css" />', `<style>\n${css}\n</style>`)
  .replace(
    '<script src="./app.js" type="module"></script>',
    [
      `<script id="bundled-data" type="application/json">\n${safeJson}\n</script>`,
      `<script id="bundled-events" type="application/json">\n${escapeJson(eventsRaw)}\n</script>`,
      `<script id="bundled-similar" type="application/json">\n${escapeJson(similarRaw)}\n</script>`,
      `<script type="module">\n${js}\n</script>`,
    ].join('\n'),
  );

for (const marker of ['<style>', 'bundled-data', 'bundled-events', 'bundled-similar']) {
  if (!bundled.includes(marker)) {
    console.error(`Inlining failed: ${marker} not present. index.html markup must have changed.`);
    process.exit(1);
  }
}
if (bundled.includes('href="./styles.css"') || bundled.includes('src="./app.js"')) {
  console.error('Inlining failed: an external reference survived.');
  process.exit(1);
}
// A surviving import or export would throw at load and leave a blank page.
for (const bad of [/^\s*import\s/m, /^\s*export\s/m, /from '\.\/lib\//]) {
  if (bad.test(js)) {
    console.error(`Inlining failed: module syntax survived (${bad}).`);
    process.exit(1);
  }
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const target = join(ROOT, 'dist/live-event-rec.html');
writeFileSync(target, bundled);

const kb = (bundled.length / 1024).toFixed(0);
console.log(`Wrote dist/live-event-rec.html — ${kb} KB, ${data.shows.length} shows, ${data.cut.length} cut.`);
console.log('Self-contained: no network, no host, opens by double-click.');
