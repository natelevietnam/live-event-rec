// Match -> score -> shortlist -> cut. Pure: no network, no filesystem, no key.
//
// This runs in BOTH places. The build calls it in Node to produce data.json, and
// the page calls it in the browser every time you change an artist, a genre or a
// travel range. Same module, same numbers — the ranking you get after typing is
// computed by the identical code that produced the one you landed on.
//
// That is only possible because scoring never needed the API key. Only fetching
// did. So the candidate events ship to the browser and the verdict is recomputed
// locally, with no server round trip and nothing to leak.

import { normalizeName } from './normalize.mjs';
import { buildIndex, matchEventWithIndex, looksLikeTribute } from './match.mjs';
import { scoreEvent, WEIGHTS, distanceMiles, MAX_MILES, classifyArea } from './score.mjs';
import { buildReason, formatShowDate } from './reason.mjs';

export const TOP_N = 6;
const SKIPPED_STATUSES = new Set(['cancelled', 'postponed']);

// How far you are willing to go. Maps onto the same area buckets the effort
// component already scores, so the control and the score cannot disagree.
export const TRAVEL = {
  sf: { label: 'San Francisco only', areas: ['sf'] },
  near: { label: 'SF + East Bay', areas: ['sf', 'eastBay'] },
  all: { label: 'Anywhere in the Bay Area', areas: null },
};

function travelAllows(travel, area, miles) {
  const rule = TRAVEL[travel] ?? TRAVEL.all;
  if (miles !== null && miles > MAX_MILES) return false;
  if (rule.areas === null) return true;
  return rule.areas.includes(area);
}

/**
 * @param {object[]} events  extractEvent() shapes
 * @param {object} o
 * @param {string[]} o.artists
 * @param {object}   o.similar     seed -> adjacent names
 * @param {string[]} [o.genres]    selected genre names
 * @param {string}   [o.travel]    key of TRAVEL
 * @param {object}   o.prefs
 * @param {Date}     [o.now]
 * @returns {{shows: object[], cut: object[]}}
 */
export function rank(events, { artists, similar, genres = [], travel = 'all', prefs, now = new Date() }) {
  // Adjacency is defined relative to YOUR seeds. Once an artist is removed from
  // the list, "adjacent to that artist" stops being a reason to show anything —
  // otherwise clearing the list still returns its neighbours, labelled as
  // adjacent to someone you just deleted.
  const seedKeys = new Set((artists ?? []).map(normalizeName));
  const activeSimilar = {};
  for (const [seed, neighbours] of Object.entries(similar ?? {})) {
    if (seedKeys.has(normalizeName(seed))) activeSimilar[seed] = neighbours;
  }

  const index = buildIndex(artists ?? [], activeSimilar);
  const wanted = new Set(genres);
  const scored = [];
  const cut = [];
  // Seeds that appear on any bill in the window, recorded at the match step so
  // an artist filtered out later for travel still counts as "playing".
  const seedsOnSale = new Set();
  const drop = (event, reason) =>
    cut.push({
      id: event.id,
      artist: event.attractions?.[0] ?? event.name,
      date: formatShowDate(event),
      localDate: event.localDate,
      reason,
    });

  for (const event of events) {
    if (event.statusCode && SKIPPED_STATUSES.has(event.statusCode)) {
      drop(event, event.statusCode);
      continue;
    }

    let match = matchEventWithIndex(event, index);
    if (match) for (const s of match.seeds ?? [match.seed]) seedsOnSale.add(normalizeName(s));

    // Genre is the fallback tier, never an upgrade: it only applies when no
    // artist you named — or any artist adjacent to one — is on the bill.
    if (!match && wanted.size > 0 && event.genre && wanted.has(event.genre)) {
      match = { tier: 'genre', seed: event.genre, seeds: [event.genre], matchedOn: event.genre, exact: true };
    }

    if (!match) {
      drop(event, wanted.size > 0 ? 'no taste or genre match' : 'no taste match');
      continue;
    }

    const miles = distanceMiles(event.venue?.latitude, event.venue?.longitude);
    const area = classifyArea(event.venue?.city).area;
    if (!travelAllows(travel, area, miles)) {
      const where = event.venue?.city ?? 'venue';
      drop(
        event,
        miles !== null && miles > MAX_MILES
          ? `${where} is ${Math.round(miles)} miles out`
          : `${where} is outside your travel range`,
      );
      continue;
    }

    if (looksLikeTribute(event)) {
      drop(event, 'tribute or covers act, not the artist');
      continue;
    }

    const { total, raw, scoredOutOf, breakdown } = scoreEvent(event, match, prefs, now);
    scored.push({
      id: event.id,
      // The act actually playing, as the API names it. On an adjacent or genre
      // match this is NOT the seed — saying otherwise would put a show on the
      // page under a name that is not performing.
      artist: match.tier === 'genre' ? (event.attractions?.[0] ?? event.name) : match.matchedOn,
      seed: match.seed,
      seeds: match.seeds ?? [match.seed],
      tier: match.tier,
      eventName: event.name,
      url: event.url,
      genre: event.genre,
      date: formatShowDate(event),
      localDate: event.localDate,
      localTime: event.localTime,
      weekday: breakdown.effort.weekday,
      venue: event.venue?.name ?? null,
      city: event.venue?.city ?? null,
      score: total,
      raw,
      scoredOutOf,
      reason: buildReason(breakdown),
      urgent: breakdown.urgency.imminent,
      breakdown,
    });
  }

  // One card per artist per run: the same act playing three nights is one
  // decision, not three. The extra nights are cut with a stated reason.
  const byScoreThenDate = (a, b) =>
    b.score - a.score || (a.localDate ?? '').localeCompare(b.localDate ?? '');
  scored.sort(byScoreThenDate);

  const best = new Map();
  const duplicates = [];
  for (const s of scored) {
    const key = normalizeName(s.artist) || s.artist;
    if (best.has(key)) duplicates.push(s);
    else best.set(key, s);
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

  const ranked = [...best.values()].sort(byScoreThenDate);
  const shows = ranked.slice(0, TOP_N);
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

  // Naming an artist who simply is not touring here is not a failure, but it is
  // a fact the reader deserves — otherwise a typo looks identical to a quiet
  // three months.
  const notPlaying = (artists ?? []).filter((a) => !seedsOnSale.has(normalizeName(a)));

  return { shows, cut, notPlaying };
}

export { WEIGHTS };
