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
import { buildIndex, matchEventWithIndex, looksLikeTribute } from './match.mjs';
import { normalizeName } from './normalize.mjs';
import { scoreEvent, WEIGHTS, distanceMiles, MAX_MILES } from './score.mjs';
import { buildReason, formatShowDate } from './reason.mjs';

export const TOP_N = 6;
const SKIPPED_STATUSES = new Set(['cancelled', 'postponed']);

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

  const index = buildIndex(artists, similar);
  const scored = [];
  const cut = [];
  const drop = (event, reason) =>
    cut.push({
      id: event.id,
      artist: event.attractions[0] ?? event.name,
      date: formatShowDate(event),
      localDate: event.localDate,
      reason,
    });

  for (const rawEvent of fetched.events) {
    const event = extractEvent(rawEvent);

    if (event.statusCode && SKIPPED_STATUSES.has(event.statusCode)) {
      drop(event, event.statusCode);
      continue;
    }

    const match = matchEventWithIndex(event, index);
    if (!match) {
      drop(event, 'no taste match');
      continue;
    }

    const miles = distanceMiles(event.venue?.latitude, event.venue?.longitude);
    if (miles !== null && miles > MAX_MILES) {
      drop(event, `${event.venue?.city ?? 'venue'} is ${Math.round(miles)} miles out`);
      continue;
    }

    if (looksLikeTribute(event)) {
      drop(event, 'tribute or covers act, not the artist');
      continue;
    }

    const { total, raw: rawScore, scoredOutOf, breakdown } = scoreEvent(event, match, prefs, now);
    scored.push({
      id: event.id,
      // The act actually playing, as the API names it. On an adjacent match this is
      // NOT the seed artist — saying otherwise would put a show on the page under a
      // name that is not performing.
      artist: match.matchedOn,
      seed: match.seed,
      seeds: match.seeds ?? [match.seed],
      tier: match.tier,
      eventName: event.name,
      url: event.url,
      date: formatShowDate(event),
      localDate: event.localDate,
      localTime: event.localTime,
      weekday: breakdown.effort.weekday,
      venue: event.venue?.name ?? null,
      city: event.venue?.city ?? null,
      score: total,
      raw: rawScore,
      scoredOutOf,
      reason: buildReason(breakdown),
      urgent: breakdown.urgency.imminent,
      breakdown,
    });
  }

  // One card per artist per run: the same act playing three nights is one decision,
  // not three. The extra nights are cut with a stated reason rather than dropped.
  const byScoreThenDate = (a, b) =>
    b.score - a.score || (a.localDate ?? '').localeCompare(b.localDate ?? '');
  scored.sort(byScoreThenDate);

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

  const ranked = [...bestPerArtist.values()].sort(byScoreThenDate);
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
    shows: shortlist,
    cut,
  };
}

export { PipelineError };
