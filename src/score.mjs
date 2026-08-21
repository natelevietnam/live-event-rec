// Scoring. Every weight lives in WEIGHTS so the UI can render the breakdown
// from the same numbers the ranking used.

export const WEIGHTS = {
  taste: { max: 45, direct: 45, adjacent: 20 },
  urgency: { max: 20, within7: 20, within30: 12, onSaleNow: 8, unknown: 5 },
  effort: {
    max: 20,
    sf: 20,
    eastBay: 14,
    peninsulaSouthBay: 8,
    unknownArea: 8,
    weeknightPenalty: 6,
  },
  price: { max: 15, deep: 15, underCeiling: 10, overCeiling: 0, unknown: 7, deepFraction: 0.4 },
};

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

function urgencyPoints(signal) {
  const w = WEIGHTS.urgency;
  if (signal.state === 'opens') {
    if (signal.days <= 7) return w.within7;
    if (signal.days <= 30) return w.within30;
    return w.onSaleNow; // opens later than 30 days out — no urgency premium
  }
  if (signal.state === 'onSaleNow') return w.onSaleNow;
  return w.unknown;
}

function pricePoints(priceMin, ceiling) {
  const w = WEIGHTS.price;
  if (typeof priceMin !== 'number') return { points: w.unknown, band: 'unknown' };
  if (priceMin <= ceiling * w.deepFraction) return { points: w.deep, band: 'deep' };
  if (priceMin < ceiling) return { points: w.underCeiling, band: 'under' };
  return { points: w.overCeiling, band: 'over' };
}

/**
 * Score one matched event. Returns the total plus a per-component breakdown
 * carrying everything the reason sentence and the UI need.
 */
export function scoreEvent(event, match, prefs, now = new Date()) {
  const taste = {
    points: match.tier === 'direct' ? WEIGHTS.taste.direct : WEIGHTS.taste.adjacent,
    max: WEIGHTS.taste.max,
    tier: match.tier,
    seed: match.seed,
    matchedOn: match.matchedOn,
  };

  const signal = onsaleSignal(event, now);
  const urgency = {
    points: urgencyPoints(signal),
    max: WEIGHTS.urgency.max,
    state: signal.state,
    kind: signal.kind,
    at: signal.at ? signal.at.toISOString() : null,
    presaleName: signal.name,
    daysUntil: signal.days === null ? null : Math.round(signal.days),
    imminent: signal.state === 'opens' && signal.days <= 7,
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

  const p = pricePoints(event.priceMin, prefs.priceCeiling);
  const price = {
    points: p.points,
    max: WEIGHTS.price.max,
    band: p.band,
    min: event.priceMin,
    currency: event.priceCurrency,
  };

  const total = taste.points + urgency.points + effort.points + price.points;
  return { total, breakdown: { taste, urgency, effort, price } };
}
