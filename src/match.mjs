import { normalizeName, tokensOf } from './normalize.mjs';

// Tier 1 = direct hit on a seed artist. Tier 2 = hit on an adjacent artist.
// Anything else is cut with "no taste match".

// Containment matching is only allowed above these thresholds. "XG" or "Future"
// appearing inside an unrelated event title is exactly the false positive that
// would make the ranked list untrustworthy. The character floor matters as much
// as the token floor: "T.I." normalizes to the two tokens "t i", which would
// otherwise be allowed to match inside any title containing those two letters
// as adjacent words. Names below either floor still match, but only exactly.
const MIN_TOKENS_FOR_CONTAINMENT = 2;
const MIN_CHARS_FOR_CONTAINMENT = 6;

// Tribute and covers acts carry the real artist's name in the attraction name,
// so they match cleanly and would be presented as the artist themselves. Putting
// "Michael Jackson, direct match" on a card for a tribute band is precisely the
// invented fact the product exists to avoid. They go to the cut list with a
// stated reason instead of being silently dropped.
const TRIBUTE_MARKERS = [
  /\btributes?\b/i,
  /\bcover band\b/i,
  /\bkaraoke\b/i,
  /\bthe music of\b/i,
  /\bsalute to\b/i,
  /\bcelebrat(?:ing|ion of) the (?:music|songs)\b/i,
  /\bas performed by\b/i,
  /\bimpersonat/i,
];

/**
 * True if the event names itself as a tribute or covers act.
 * Only catches acts that say so in the name — "MJ Live" style tributes that
 * never spell it out will still slip through. Noted as a known limitation.
 */
export function looksLikeTribute(event) {
  const haystacks = [event.name, ...(event.attractions ?? [])].filter(Boolean);
  return haystacks.some((h) => TRIBUTE_MARKERS.some((re) => re.test(h)));
}

function buildIndex(artists, similar) {
  const direct = new Map(); // normalized -> canonical seed name
  const adjacent = new Map(); // normalized -> canonical seed name it is adjacent to

  for (const seed of artists) {
    const key = normalizeName(seed);
    if (key) direct.set(key, seed);
  }

  for (const [seed, neighbours] of Object.entries(similar ?? {})) {
    for (const neighbour of neighbours ?? []) {
      const key = normalizeName(neighbour);
      if (!key || direct.has(key)) continue; // a seed is never demoted to adjacent
      if (!adjacent.has(key)) adjacent.set(key, seed);
    }
  }

  return { direct, adjacent };
}

function containedIn(needleNorm, haystackNorm) {
  const needleTokens = needleNorm.split(' ');
  if (needleTokens.length < MIN_TOKENS_FOR_CONTAINMENT) return false;
  if (needleNorm.replace(/\s/g, '').length < MIN_CHARS_FOR_CONTAINMENT) return false;
  return ` ${haystackNorm} `.includes(` ${needleNorm} `);
}

function lookup(candidate, index) {
  const norm = normalizeName(candidate);
  if (!norm) return null;

  if (index.direct.has(norm)) {
    return { tier: 'direct', seed: index.direct.get(norm), matchedOn: candidate };
  }
  if (index.adjacent.has(norm)) {
    return { tier: 'adjacent', seed: index.adjacent.get(norm), matchedOn: candidate };
  }

  // Fuzzier pass: seed name appearing as a whole phrase inside the candidate,
  // e.g. attraction "Japanese Breakfast (Solo)" against seed "Japanese Breakfast".
  for (const [key, seed] of index.direct) {
    if (containedIn(key, norm)) return { tier: 'direct', seed, matchedOn: candidate };
  }
  for (const [key, seed] of index.adjacent) {
    if (containedIn(key, norm)) return { tier: 'adjacent', seed, matchedOn: candidate };
  }
  return null;
}

/**
 * Match one extracted event. Attractions are authoritative; the event title is
 * only consulted when the API gave us no attractions at all.
 */
export function matchEvent(event, artists, similar) {
  const index = buildIndex(artists, similar);
  return matchEventWithIndex(event, index);
}

export function matchEventWithIndex(event, index) {
  const candidates = event.attractions.length > 0 ? event.attractions : [event.name].filter(Boolean);

  let best = null;
  for (const candidate of candidates) {
    const hit = lookup(candidate, index);
    if (!hit) continue;
    if (hit.tier === 'direct') return hit; // direct always wins, stop looking
    if (!best) best = hit;
  }
  return best;
}

export { buildIndex, tokensOf };
