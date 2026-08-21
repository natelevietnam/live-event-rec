// Fetch -> match -> score -> public/data.json
// The API key is used here and never written into the output.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, requireApiKey, readJson } from './env.mjs';
import {
  LOCALITY_STRATEGIES,
  fetchAllEvents,
  extractEvent,
  windowParams,
} from '../src/ticketmaster.mjs';
import { buildIndex, matchEventWithIndex, looksLikeTribute } from '../src/match.mjs';
import { normalizeName } from '../src/normalize.mjs';
import { scoreEvent, WEIGHTS, distanceMiles, MAX_MILES } from '../src/score.mjs';
import { buildReason, formatShowDate } from '../src/reason.mjs';

const TOP_N = 6;
const SKIPPED_STATUSES = new Set(['cancelled', 'postponed']);

const apiKey = requireApiKey();
const prefs = readJson('config/prefs.json');
const artists = readJson('config/artists.json');
const similar = readJson('config/similar-artists.json');
const now = new Date();

if (!Array.isArray(artists) || artists.length === 0) {
  console.error('config/artists.json is empty. Add the artists you would actually go see.');
  process.exit(1);
}

// --- fetch -------------------------------------------------------------------

const wanted = process.env.LOCALITY;
const strategies = wanted
  ? LOCALITY_STRATEGIES.filter((s) => s.label === wanted)
  : LOCALITY_STRATEGIES;

let fetched = null;
let usedStrategy = null;

for (const strategy of strategies) {
  try {
    console.log(`Fetching with ${strategy.label} ...`);
    const result = await fetchAllEvents({
      apiKey,
      horizonDays: prefs.horizonDays,
      locality: strategy.params,
      onProgress: ({ page, fetched: n, total }) =>
        console.log(`  page ${page}: ${n}/${total}`),
    });
    if (result.events.length > 0) {
      fetched = result;
      usedStrategy = strategy;
      break;
    }
    console.log('  returned 0 events, trying next strategy');
  } catch (err) {
    console.log(`  failed: ${err.message}`);
  }
}

if (!fetched) {
  console.error('No locality strategy returned events. Run `npm run verify` and fix the query.');
  process.exit(1);
}

console.log(
  `Using ${usedStrategy.label}: ${fetched.events.length} events fetched of ${fetched.total} reported.`,
);

// --- match + score -----------------------------------------------------------

const index = buildIndex(artists, similar);
const scored = [];
const cut = [];

for (const raw of fetched.events) {
  const event = extractEvent(raw);

  if (event.statusCode && SKIPPED_STATUSES.has(event.statusCode)) {
    cut.push({
      id: event.id,
      artist: event.attractions[0] ?? event.name,
      date: formatShowDate(event),
      localDate: event.localDate,
      reason: `${event.statusCode}`,
    });
    continue;
  }

  const match = matchEventWithIndex(event, index);
  if (!match) {
    cut.push({
      id: event.id,
      artist: event.attractions[0] ?? event.name,
      date: formatShowDate(event),
      localDate: event.localDate,
      reason: 'no taste match',
    });
    continue;
  }

  const miles = distanceMiles(event.venue?.latitude, event.venue?.longitude);
  if (miles !== null && miles > MAX_MILES) {
    cut.push({
      id: event.id,
      artist: event.attractions[0] ?? event.name,
      date: formatShowDate(event),
      localDate: event.localDate,
      reason: `${event.venue?.city ?? 'venue'} is ${Math.round(miles)} miles out`,
    });
    continue;
  }

  if (looksLikeTribute(event)) {
    cut.push({
      id: event.id,
      artist: event.attractions[0] ?? event.name,
      date: formatShowDate(event),
      localDate: event.localDate,
      reason: 'tribute or covers act, not the artist',
    });
    continue;
  }

  const { total, breakdown } = scoreEvent(event, match, prefs, now);
  scored.push({
    id: event.id,
    // The act actually playing, as the API names it. On an adjacent match this is
    // NOT the seed artist — saying otherwise would put a show on the page under a
    // name that is not performing.
    artist: match.matchedOn,
    seed: match.seed,
    tier: match.tier,
    eventName: event.name,
    url: event.url,
    date: formatShowDate(event),
    localDate: event.localDate,
    localTime: event.localTime,
    weekday: breakdown.effort.weekday,
    venue: event.venue?.name ?? null,
    city: event.venue?.city ?? null,
    priceMin: event.priceMin,
    priceCurrency: event.priceCurrency,
    score: total,
    reason: buildReason(breakdown),
    urgent: breakdown.urgency.imminent,
    breakdown,
  });
}

// One card per artist per run: the same act playing three nights is one decision,
// not three. The extra nights are cut with a stated reason rather than dropped.
scored.sort((a, b) => b.score - a.score || (a.localDate ?? '').localeCompare(b.localDate ?? ''));

const bestPerArtist = new Map();
const duplicates = [];
for (const s of scored) {
  const key = normalizeName(s.artist) || s.artist;
  if (bestPerArtist.has(key)) duplicates.push(s);
  else bestPerArtist.set(key, s);
}
for (const d of duplicates) {
  cut.push({
    id: d.id,
    artist: d.artist,
    date: d.date,
    localDate: d.localDate,
    reason: `later date for ${d.artist}, higher-scoring night already listed`,
  });
}

const ranked = [...bestPerArtist.values()].sort(
  (a, b) => b.score - a.score || (a.localDate ?? '').localeCompare(b.localDate ?? ''),
);

const shortlist = ranked.slice(0, TOP_N);
for (const s of ranked.slice(TOP_N)) {
  cut.push({
    id: s.id,
    artist: s.artist,
    date: s.date,
    localDate: s.localDate,
    reason: `scored ${s.score}, below the top ${TOP_N}`,
  });
}

cut.sort((a, b) => (a.localDate ?? '').localeCompare(b.localDate ?? ''));

// --- write -------------------------------------------------------------------

const out = {
  generatedAt: now.toISOString(),
  horizonDays: prefs.horizonDays,
  priceCeiling: prefs.priceCeiling,
  weights: WEIGHTS,
  source: {
    name: 'Ticketmaster Discovery API v2',
    locality: usedStrategy.label,
    window: windowParams(prefs.horizonDays, now),
    eventsConsidered: fetched.events.length,
    eventsReported: fetched.total,
    truncated: fetched.truncated,
  },
  shows: shortlist,
  cut,
};

const target = join(ROOT, 'public/data.json');
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);

console.log(
  `\n${shortlist.length} shows shortlisted, ${cut.length} cut. Wrote ${target.replace(ROOT, '.')}`,
);
if (fetched.truncated) {
  console.log(
    `NOTE: API paging ceiling reached — ${fetched.events.length} of ${fetched.total} events seen. Stated in the footer.`,
  );
}
for (const s of shortlist) {
  console.log(`  ${String(s.score).padStart(3)}  ${s.artist} — ${s.date} — ${s.venue ?? '?'}`);
}
