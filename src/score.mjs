// Scoring. Every weight lives in WEIGHTS so the UI can render the breakdown
// from the same numbers the ranking used.

export const WEIGHTS = {
  // Direct beats adjacent. Within a tier, a name matched exactly beats one matched
  // as a phrase inside a longer title, because the second is a less certain read.
  taste: { max: 45, direct: 45, directLoose: 40, adjacent: 20, adjacentLoose: 17 },

  // Urgency runs on two axes and takes the higher.
  //
  // The original spec scored onsale timing alone. Measured against the live API,
  // that component is a constant: of 200 sampled events, zero had a future public
  // onsale and one had a future presale. Ninety days out, everything is already
  // on sale, so the clause fired identically for every show and contributed no
  // ranking information at all.
  //
  // The insight it was reaching for — scarcity forces a decision — is real, so it
  // is kept on the axis the data actually carries: how soon the show is. A show
  // in nine days is a decision you make now. One in eighty is not. The onsale
  // rule stays as an override for the case it was written for, a newly announced
  // tour, and still wins outright when it fires.
  urgency: {
    max: 20,
    onsaleWithin7: 20,
    onsaleWithin30: 12,
    onsaleLater: 5,
    onSaleNow: 4,
    unknown: 4,
    showWithin14: 18,
    showWithin30: 12,
    showWithin60: 7,
    showBeyond60: 3,
  },

  effort: {
    max: 20,
    sf: 20,
    eastBay: 14,
    peninsulaSouthBay: 8,
    unknownArea: 8,
    weeknightPenalty: 6,
  },

  // Price is deliberately absent as a scoring component.
  //
  // Ticketmaster publishes no price for 0 of the 31 events that match this
  // artist list — stadiums and arenas carry a priceRanges block roughly 1 time
  // in 58, and arena acts are what the list is made of. A component that is
  // never populated cannot rank anything; it can only add a row to the UI that
  // always reads "not scored" and a clause to every reason that says nothing.
  //
  // So the ceiling in config/prefs.json is currently inert. That is a statement
  // about the source, not about whether price matters, and it is recorded in
  // the roadmap rather than faked with an estimate or a flat default. If a
  // priced source is ever wired in, this is where the component comes back.
};

// Every event is scored out of the same 85 points and reported as a percentage.
export const MAX_POINTS = WEIGHTS.taste.max + WEIGHTS.urgency.max + WEIGHTS.effort.max;

const DAY_MS = 24 * 60 * 60 * 1000;

// SoMa, San Francisco — the "home" in config/prefs.json. Used only to measure
// how far a venue is, never to guess anything about an event.
export const HOME = { latitude: 37.7785, longitude: -122.4056 };

// Beyond this, it is not a night out from SoMa, it is a road trip. Events past
// the limit are cut with the distance stated, not scored as if they were local.
export const MAX_MILES = 60;

export function distanceMiles(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(a - HOME.latitude);
  const dLon = toRad(b - HOME.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(HOME.latitude)) * Math.cos(toRad(a)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

const SF = new Set(['san francisco']);
// Near East Bay reachable on a weeknight. Far East Bay (Livermore, Antioch,
// Fairfield) deliberately falls through to the 8-point bucket.
const EAST_BAY = new Set([
  'oakland',
  'berkeley',
  'emeryville',
  'alameda',
  'orinda',
  'richmond',
  'albany',
  'piedmont',
  'el cerrito',
]);
const PENINSULA_SOUTH_BAY = new Set([
  'mountain view',
  'san jose',
  'palo alto',
  'redwood city',
  'saratoga',
  'santa clara',
  'sunnyvale',
  'menlo park',
  'san mateo',
  'daly city',
  'cupertino',
  'milpitas',
  'burlingame',
  'south san francisco',
  'san carlos',
  'campbell',
  'los gatos',
  'fremont',
  'union city',
  'newark',
]);

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function classifyArea(city) {
  const c = (city ?? '').trim().toLowerCase();
  if (!c) return { area: 'unknown', label: null, points: WEIGHTS.effort.unknownArea };
  if (SF.has(c)) return { area: 'sf', label: 'SF', points: WEIGHTS.effort.sf };
  if (EAST_BAY.has(c)) {
    const label = c.charAt(0).toUpperCase() + c.slice(1);
    return { area: 'eastBay', label, points: WEIGHTS.effort.eastBay };
  }
  if (PENINSULA_SOUTH_BAY.has(c)) {
    return {
      area: 'peninsulaSouthBay',
      label: city,
      points: WEIGHTS.effort.peninsulaSouthBay,
    };
  }
  return { area: 'unknown', label: city, points: WEIGHTS.effort.unknownArea };
}

/**
 * Local weekday for the show. Uses localDate when present so a 9pm Pacific show
 * is never pushed to the next day by a UTC read.
 */
export function showWeekday(event) {
  const iso = event.localDate ?? (event.dateTime ? event.dateTime.slice(0, 10) : null);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const idx = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { index: idx, name: WEEKDAY_NAMES[idx] };
}

export function isWeeknight(event) {
  const wd = showWeekday(event);
  if (!wd) return false;
  return wd.index >= 1 && wd.index <= 4; // Mon–Thu
}

function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * The next moment tickets become buyable: earliest future presale or public onsale.
 * If public onsale has already opened, the show is on sale now.
 */
export function onsaleSignal(event, now) {
  const publicStart = parseDate(event.onsaleStart);
  const upcoming = [];

  if (publicStart && publicStart > now) {
    upcoming.push({ kind: 'onsale', at: publicStart, name: null });
  }
  for (const p of event.presales ?? []) {
    const start = parseDate(p.startDateTime);
    const end = parseDate(p.endDateTime);
    if (start && start > now) upcoming.push({ kind: 'presale', at: start, name: p.name });
    else if (start && start <= now && (!end || end > now)) {
      upcoming.push({ kind: 'presaleOpen', at: start, name: p.name });
    }
  }

  const future = upcoming.filter((u) => u.at > now).sort((a, b) => a.at - b.at);
  if (future.length > 0) {
    const next = future[0];
    const days = (next.at - now) / DAY_MS;
    return { state: 'opens', kind: next.kind, at: next.at, name: next.name, days };
  }

  const presaleOpen = upcoming.find((u) => u.kind === 'presaleOpen');
  if (presaleOpen) return { state: 'onSaleNow', kind: 'presale', at: presaleOpen.at, name: presaleOpen.name, days: 0 };
  if (publicStart && publicStart <= now) {
    return { state: 'onSaleNow', kind: 'onsale', at: publicStart, name: null, days: 0 };
  }
  return { state: 'unknown', kind: null, at: null, name: null, days: null };
}

function onsalePoints(signal) {
  const w = WEIGHTS.urgency;
  if (signal.state === 'opens') {
    if (signal.days <= 7) return w.onsaleWithin7;
    if (signal.days <= 30) return w.onsaleWithin30;
    return w.onsaleLater;
  }
  if (signal.state === 'onSaleNow') return w.onSaleNow;
  return w.unknown;
}

/** Days from now to doors. Null when the source published no usable date. */
export function daysUntilShow(event, now) {
  const w = event.dateTime
    ? Date.parse(event.dateTime)
    : event.localDate
      ? // No time published: assume a 20:00 Pacific door, which is the honest
        // read for a music event and never shifts the day across a boundary.
        Date.parse(`${event.localDate}T20:00:00-07:00`)
      : NaN;
  if (!Number.isFinite(w)) return null;
  return (w - now.getTime()) / DAY_MS;
}

function proximityPoints(days) {
  const w = WEIGHTS.urgency;
  if (days === null) return w.showBeyond60;
  if (days <= 14) return w.showWithin14;
  if (days <= 30) return w.showWithin30;
  if (days <= 60) return w.showWithin60;
  return w.showBeyond60;
}

/**
 * Score one matched event. Returns the total plus a per-component breakdown
 * carrying everything the reason sentence and the UI need.
 */
export function scoreEvent(event, match, prefs, now = new Date()) {
  const tasteKey =
    match.tier === 'direct'
      ? match.exact === false
        ? 'directLoose'
        : 'direct'
      : match.exact === false
        ? 'adjacentLoose'
        : 'adjacent';
  const taste = {
    points: WEIGHTS.taste[tasteKey],
    max: WEIGHTS.taste.max,
    tier: match.tier,
    exact: match.exact !== false,
    seed: match.seed,
    seeds: match.seeds ?? [match.seed],
    matchedOn: match.matchedOn,
  };

  const signal = onsaleSignal(event, now);
  const showDays = daysUntilShow(event, now);
  const fromOnsale = onsalePoints(signal);
  const fromProximity = proximityPoints(showDays);
  const urgency = {
    points: Math.min(WEIGHTS.urgency.max, Math.max(fromOnsale, fromProximity)),
    max: WEIGHTS.urgency.max,
    driver: fromOnsale >= fromProximity ? 'onsale' : 'proximity',
    state: signal.state,
    kind: signal.kind,
    at: signal.at ? signal.at.toISOString() : null,
    presaleName: signal.name,
    daysUntilOnsale: signal.days === null ? null : Math.round(signal.days),
    daysUntilShow: showDays === null ? null : Math.round(showDays),
    imminent: (signal.state === 'opens' && signal.days <= 7) || (showDays !== null && showDays <= 14),
  };

  const area = classifyArea(event.venue?.city);
  const weeknight = isWeeknight(event);
  const weekday = showWeekday(event);
  const effortRaw = area.points - (weeknight ? WEIGHTS.effort.weeknightPenalty : 0);
  const effort = {
    points: Math.max(0, effortRaw),
    max: WEIGHTS.effort.max,
    area: area.area,
    areaLabel: area.label,
    weeknight,
    weekday: weekday?.name ?? null,
    weeknightPenalty: weeknight ? WEIGHTS.effort.weeknightPenalty : 0,
  };

  const raw = taste.points + urgency.points + effort.points;

  // Reported as a percentage of the points on offer, so the headline number
  // reads on the familiar 0-100 scale while the breakdown still shows the raw
  // component totals it was computed from.
  const total = Math.round((raw / MAX_POINTS) * 100);

  return { total, raw, scoredOutOf: MAX_POINTS, breakdown: { taste, urgency, effort } };
}
