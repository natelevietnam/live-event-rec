// The whole product in one function: fetch -> match -> score -> payload.
//
// Extracted from scripts/build-data.mjs so the CLI build and the dev server's
// refresh endpoint run byte-identical logic. A refresh that ranked differently
// from a build would make the score untrustworthy in exactly the way this
// product exists to avoid.
//
// The API key is a parameter here and never appears in the returned payload.

import {
  LOCALITY_STRATEGIES,
  fetchAllEvents,
  extractEvent,
  windowParams,
} from './ticketmaster.mjs';
import { rank, TOP_N } from './rank.mjs';
import { WEIGHTS } from './score.mjs';

export { TOP_N };

class PipelineError extends Error {}

/**
 * @param {object} o
 * @param {string} o.apiKey
 * @param {object} o.prefs
 * @param {string[]} o.artists
 * @param {object} o.similar
 * @param {Date}   [o.now]
 * @param {string} [o.locality]  restrict to one strategy label
 * @param {(msg: string) => void} [o.log]
 */
export async function buildPayload({
  apiKey,
  prefs,
  artists,
  similar,
  now = new Date(),
  genres = [],
  travel = 'all',
  locality,
  log = () => {},
}) {
  if (!Array.isArray(artists) || artists.length === 0) {
    throw new PipelineError('artists.json is empty. Add the artists you would actually go see.');
  }

  // --- fetch -----------------------------------------------------------------

  const strategies = locality
    ? LOCALITY_STRATEGIES.filter((s) => s.label === locality)
    : LOCALITY_STRATEGIES;

  let fetched = null;
  let usedStrategy = null;

  for (const strategy of strategies) {
    try {
      log(`Fetching with ${strategy.label} ...`);
      const result = await fetchAllEvents({
        apiKey,
        horizonDays: prefs.horizonDays,
        locality: strategy.params,
        now,
        onProgress: ({ page, fetched: n, total }) => log(`  page ${page}: ${n}/${total}`),
      });
      if (result.events.length > 0) {
        fetched = result;
        usedStrategy = strategy;
        break;
      }
      log('  returned 0 events, trying next strategy');
    } catch (err) {
      log(`  failed: ${err.message}`);
    }
  }

  if (!fetched) {
    throw new PipelineError(
      'No locality strategy returned events. Run `npm run verify` and fix the query.',
    );
  }

  log(`Using ${usedStrategy.label}: ${fetched.events.length} events fetched of ${fetched.total} reported.`);

  // --- match + score ---------------------------------------------------------

  const events = fetched.events.map(extractEvent);
  const { shows, cut } = rank(events, { artists, similar, genres, travel, prefs, now });

  // Genres the pool actually contains, so the UI offers only options that can
  // return something. Ordered by how many events carry them.
  // "Undefined" is a literal Ticketmaster label, not a genre anyone would pick.
  const genreCounts = new Map();
  for (const e of events) {
    if (e.genre && e.genre !== 'Undefined') {
      genreCounts.set(e.genre, (genreCounts.get(e.genre) ?? 0) + 1);
    }
  }
  const availableGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  return {
    built: true,
    generatedAt: now.toISOString(),
    horizonDays: prefs.horizonDays,
    // prefs.priceCeiling is intentionally not published here. Nothing scores on
    // it right now, and shipping it would imply the ranking honoured a ceiling
    // it never consulted. It stays in prefs.json for when a priced source lands.
    weights: WEIGHTS,
    source: {
      name: 'Ticketmaster Discovery API v2',
      locality: usedStrategy.label,
      window: windowParams(prefs.horizonDays, now),
      eventsConsidered: fetched.events.length,
      eventsReported: fetched.total,
      truncated: fetched.truncated,
    },
    genres: availableGenres,
    defaults: { artists, genres, travel },
    shows,
    cut,
    // The candidate pool, so the browser can re-rank against the same events
    // the build used when someone changes the inputs.
    events,
  };
}

export { PipelineError };
