// Ticketmaster Discovery API v2 client.
// The key lives here and only here. It never reaches public/data.json or the browser.

const BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';

// Discovery API refuses deep paging: (page + 1) * size must stay <= 1000.
const MAX_ITEMS = 1000;

export function isoZ(date) {
  // Discovery rejects fractional seconds.
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function windowParams(horizonDays, now = new Date()) {
  const end = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  return { startDateTime: isoZ(now), endDateTime: isoZ(end) };
}

function buildUrl({ apiKey, page, size, startDateTime, endDateTime, locality }) {
  const url = new URL(BASE);
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('classificationName', 'music');
  url.searchParams.set('startDateTime', startDateTime);
  url.searchParams.set('endDateTime', endDateTime);
  url.searchParams.set('size', String(size));
  url.searchParams.set('page', String(page));
  url.searchParams.set('sort', 'date,asc');
  for (const [k, v] of Object.entries(locality)) url.searchParams.set(k, String(v));
  return url;
}

// Primary locality strategy plus the fallbacks named in the spec, in order.
export const LOCALITY_STRATEGIES = [
  { label: 'dmaId=382', params: { dmaId: 382 } },
  { label: 'geoPoint=9q8y r=50mi', params: { geoPoint: '9q8y', radius: 50, unit: 'miles' } },
  { label: 'city=San Francisco', params: { city: 'San Francisco' } },
];

async function fetchPage(opts) {
  const url = buildUrl(opts);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Ticketmaster ${res.status} ${res.statusText}: ${body.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Fetch one page of a locality strategy. Used by the Step 0 verification probe.
 */
export async function probe({ apiKey, horizonDays, locality, size = 5, now }) {
  const { startDateTime, endDateTime } = windowParams(horizonDays, now);
  const json = await fetchPage({ apiKey, page: 0, size, startDateTime, endDateTime, locality });
  return {
    total: json?.page?.totalElements ?? 0,
    events: json?._embedded?.events ?? [],
  };
}

/**
 * Paginate a locality strategy until exhausted or until the API's paging ceiling.
 * Returns { events, total, truncated } — `truncated` is surfaced in the UI footer
 * rather than silently swallowed.
 */
export async function fetchAllEvents({ apiKey, horizonDays, locality, size = 200, now, onProgress }) {
  const { startDateTime, endDateTime } = windowParams(horizonDays, now);
  const events = [];
  const seen = new Set();
  let page = 0;
  let total = 0;
  let totalPages = 1;

  while (page < totalPages) {
    if ((page + 1) * size > MAX_ITEMS) break;
    const json = await fetchPage({ apiKey, page, size, startDateTime, endDateTime, locality });
    total = json?.page?.totalElements ?? total;
    totalPages = json?.page?.totalPages ?? 1;
    const batch = json?._embedded?.events ?? [];
    for (const ev of batch) {
      if (ev?.id && seen.has(ev.id)) continue;
      if (ev?.id) seen.add(ev.id);
      events.push(ev);
    }
    onProgress?.({ page, fetched: events.length, total });
    if (batch.length === 0) break;
    page += 1;
  }

  return { events, total, truncated: events.length < total };
}

/**
 * Flatten a Discovery event into only the fields the spec names.
 * Anything absent stays null. Nothing is inferred.
 */
export function extractEvent(ev) {
  const venue = ev?._embedded?.venues?.[0] ?? null;
  const price = Array.isArray(ev?.priceRanges) ? ev.priceRanges[0] : null;
  const presales = Array.isArray(ev?.sales?.presales) ? ev.sales.presales : [];

  return {
    id: ev?.id ?? null,
    name: ev?.name ?? null,
    url: ev?.url ?? null,
    dateTime: ev?.dates?.start?.dateTime ?? null,
    localDate: ev?.dates?.start?.localDate ?? null,
    localTime: ev?.dates?.start?.localTime ?? null,
    statusCode: ev?.dates?.status?.code ?? null,
    onsaleStart: ev?.sales?.public?.startDateTime ?? null,
    onsaleEnd: ev?.sales?.public?.endDateTime ?? null,
    presales: presales.map((p) => ({
      name: p?.name ?? null,
      startDateTime: p?.startDateTime ?? null,
      endDateTime: p?.endDateTime ?? null,
    })),
    venue: venue
      ? {
          name: venue?.name ?? null,
          city: venue?.city?.name ?? null,
          state: venue?.state?.stateCode ?? null,
          latitude: venue?.location?.latitude ?? null,
          longitude: venue?.location?.longitude ?? null,
        }
      : null,
    priceMin: typeof price?.min === 'number' ? price.min : null,
    priceMax: typeof price?.max === 'number' ? price.max : null,
    priceCurrency: price?.currency ?? null,
    attractions: (ev?._embedded?.attractions ?? [])
      .map((a) => a?.name)
      .filter((n) => typeof n === 'string' && n.length > 0),
  };
}
