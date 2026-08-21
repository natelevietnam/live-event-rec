// Writes the three things the page needs, and keeps the shared ranking modules
// in sync with public/ so the browser imports the same code Node just ran.

import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

// Pure, browser-safe modules. src/ is the source of truth; public/lib is a copy
// refreshed on every build so the two can never drift.
export const SHARED_MODULES = [
  'normalize.mjs',
  'match.mjs',
  'score.mjs',
  'reason.mjs',
  'rank.mjs',
];

export function syncSharedModules() {
  const dir = join(ROOT, 'public/lib');
  mkdirSync(dir, { recursive: true });
  for (const f of SHARED_MODULES) copyFileSync(join(ROOT, 'src', f), join(dir, f));
  return dir;
}

/**
 * data.json  — the default verdict plus everything the UI chrome needs.
 * events.json — the candidate pool, so the browser can re-rank on new input.
 *
 * They are split because data.json is read on every page load while the pool is
 * only needed once the visitor actually changes something.
 */
export function writePayload(payload) {
  const { events, ...meta } = payload;
  const data = { ...meta, eventCount: events.length };

  writeFileSync(join(ROOT, 'public/data.json'), `${JSON.stringify(data, null, 2)}\n`);
  // Minified: this one is ~380 KB pretty-printed and nobody reads it by hand.
  writeFileSync(join(ROOT, 'public/events.json'), JSON.stringify(events));
  // The adjacency map is an input to ranking, so the browser needs it too.
  copyFileSync(join(ROOT, 'config/similar-artists.json'), join(ROOT, 'public/similar-artists.json'));
  syncSharedModules();

  return { shows: payload.shows.length, cut: payload.cut.length, events: events.length };
}
