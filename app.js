// Renders the verdict, and recomputes it when you change the inputs.
//
// The scoring never needed the API key — only the fetching did. So the candidate
// events ship to the browser and lib/rank.mjs, the same module the build ran in
// Node, re-ranks locally. Typing an artist rebuilds the list with no server round
// trip, and still with no model in the request path.

import { rank, TRAVEL } from './lib/rank.mjs';

// Price is not here: the source publishes none for the events this list matches,
// so it was removed as a scoring component rather than shown as a permanently
// empty row. See the roadmap.
const COMPONENT_LABELS = {
  taste: 'Taste',
  urgency: 'Urgency',
  effort: 'Effort',
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

function formatTimestamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

function componentNote(key, part) {
  if (key === 'taste') {
    if (part.tier === 'genre') {
      return `Tagged ${part.seed}. Scored below a named artist, because a genre is a much weaker claim.`;
    }
    const confidence = part.exact ? '' : ' Matched inside a longer billing, so scored lower.';
    return part.tier === 'direct'
      ? `Direct match on ${part.matchedOn}.${confidence}`
      : `${part.matchedOn} is adjacent to ${part.seed}.${confidence}`;
  }
  if (key === 'urgency') {
    if (part.driver === 'onsale' && part.state === 'opens') {
      const label = part.kind === 'presale' ? 'Presale' : 'Onsale';
      return `${label} opens in ${part.daysUntilOnsale} day${part.daysUntilOnsale === 1 ? '' : 's'}.`;
    }
    if (part.daysUntilShow !== null) {
      const sale =
        part.state === 'onSaleNow' ? 'already on sale' : 'onsale date not published';
      const d = part.daysUntilShow;
      const when = d <= 0 ? 'Show is today' : d === 1 ? '1 day until the show' : `${d} days until the show`;
      return `${when}, ${sale}.`;
    }
    return 'No usable date published by the source.';
  }
  if (key === 'effort') {
    const place = part.areaLabel ? `${part.areaLabel}.` : 'Venue city not published.';
    return part.weeknight ? `${place} Weeknight, −${part.weeknightPenalty}.` : place;
  }
  return '';
}

function renderBreakdown(breakdown, show) {
  const details = el('details', 'breakdown');
  // Names the raw total so the bars below visibly add up to it, and so the
  // headline percentage is traceable rather than asserted.
  const label = show.scoredOutOf
    ? `Score breakdown — ${show.raw} of ${show.scoredOutOf} points`
    : 'Score breakdown';
  details.append(el('summary', null, label));

  const bars = el('div', 'bars');
  for (const [key, label] of Object.entries(COMPONENT_LABELS)) {
    const part = breakdown[key];
    if (!part) continue;

    const row = el('div', 'bar-row');
    row.append(el('span', 'bar-label', label));

    const track = el('div', 'bar-track');
    const fill = el('span', 'bar-fill');
    const pct = part.max > 0 ? Math.round((part.points / part.max) * 100) : 0;
    fill.style.width = `${pct}%`;
    track.append(fill);
    row.append(track);

    row.append(el('span', 'bar-value', part.max > 0 ? `${part.points}/${part.max}` : 'n/a'));
    row.append(el('p', 'bar-note', componentNote(key, part)));
    bars.append(row);
  }

  details.append(bars);
  return details;
}

function renderCard(show) {
  const li = el('li');
  const card = el('article', 'card');

  const head = el('div', 'card-head');
  const title = el('h3', 'card-artist');
  if (show.url) {
    const link = el('a', null, show.artist);
    link.href = show.url;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    title.append(link);
  } else {
    title.textContent = show.artist;
  }
  if (show.tier === 'adjacent') {
    title.append(el('span', 'adjacent-tag', `Adjacent to ${show.seed}`));
  } else if (show.tier === 'genre') {
    title.append(el('span', 'adjacent-tag', `${show.seed} — genre match, not an artist you named`));
  }
  head.append(title);

  const score = el('div', 'score', String(show.score));
  score.append(el('span', null, '/100'));
  head.append(score);
  card.append(head);

  const metaParts = [
    // show.date already carries the weekday ("Fri Nov 13"), so show.weekday is
    // not repeated here.
    show.date ?? '',
    [show.venue, show.city].filter(Boolean).join(', '),
  ].filter((p) => p.length > 0);

  const meta = el('p', 'card-meta');
  metaParts.forEach((part, i) => {
    if (i > 0) meta.append(el('span', 'sep', '/'));
    meta.append(document.createTextNode(part));
  });
  card.append(meta);

  card.append(el('p', 'card-reason', show.reason));

  // "Closing" only makes sense for an onsale window. When the urgency comes from
  // the show itself being near, the badge says so instead.
  if (show.urgent) {
    const u = show.breakdown.urgency;
    const d = u.daysUntilShow;
    const label =
      u.driver === 'onsale' && u.state === 'opens'
        ? 'Onsale closing'
        : d !== null && d <= 7
          ? 'This week'
          : 'Within two weeks';
    card.append(el('span', 'badge', label));
  }

  card.append(renderBreakdown(show.breakdown, show));

  // The official Ticketmaster listing. It ships in the Discovery payload, so no
  // reseller scrape is involved and the destination is the primary seller.
  if (show.url) {
    const actions = el('div', 'actions');
    const buy = el('a', 'buy', 'Get tickets');
    buy.href = show.url;
    buy.rel = 'noopener noreferrer';
    buy.target = '_blank';
    actions.append(buy);
    actions.append(el('span', 'actions-note', 'Ticketmaster'));
    card.append(actions);
  }
  li.append(card);
  return li;
}

function renderCutRow(row) {
  const li = el('li');
  li.append(el('span', 'cut-artist', row.artist ?? 'Unnamed event'));
  li.append(el('span', 'cut-date', row.date ?? '—'));
  li.append(el('span', 'cut-reason', row.reason));
  return li;
}

// Written for a reader deciding where to go, not for someone auditing the query.
// The exact locality parameters and the API's paging ceiling are still recorded
// in data.json and the README for anyone who does want to check.
function renderSource(source, horizonDays) {
  const n = source.eventsConsidered;
  const about = source.truncated ? 'About ' : '';
  const count = `${about}${n.toLocaleString()} Bay Area show${n === 1 ? '' : 's'}`;
  return `Listings come from Ticketmaster. ${count} in the next ${horizonDays} days were considered.`;
}

// --- rendering the whole payload ------------------------------------------

function render(data) {
  const headline = document.getElementById('headline');
  const n = data.shows.length;
  headline.textContent =
    n === 0
      ? `Nothing worth your time in the next ${data.horizonDays} days.`
      : `${n} show${n === 1 ? '' : 's'} worth your time in the next ${data.horizonDays} days.`;

  const stamp = document.getElementById('generatedAt');
  stamp.textContent = formatTimestamp(data.generatedAt);
  stamp.setAttribute('datetime', data.generatedAt);

  const list = document.getElementById('showList');
  list.replaceChildren();
  const empty = document.getElementById('emptyState');
  empty.hidden = n !== 0;
  for (const show of data.shows) list.append(renderCard(show));

  const cutList = document.getElementById('cutList');
  cutList.replaceChildren();
  for (const row of data.cut) cutList.append(renderCutRow(row));
  document.getElementById('cutCount').textContent = `(${data.cut.length})`;

  document.getElementById('sourceLine').textContent = renderSource(data.source, data.horizonDays);
}

async function fetchData(bustCache) {
  const url = bustCache ? `./data.json?t=${Date.now()}` : './data.json';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

// --- refresh ---------------------------------------------------------------
//
// Two modes, because the API key must never reach the browser.
//
// Running locally under `npm run dev`, the server holds the key and exposes
// POST /api/refresh, which re-queries Ticketmaster and re-ranks for real.
//
// On the deployed static page there is no server and therefore no key, so the
// button re-fetches data.json instead. That file is rebuilt by a scheduled
// GitHub Action which does hold the key. The button says which one it is doing
// rather than implying a live query it cannot perform.

async function setupRefresh(initial) {
  const btn = document.getElementById('refreshBtn');
  const note = document.getElementById('refreshNote');

  let live = false;
  try {
    const res = await fetch('./api/capabilities', { cache: 'no-store' });
    live = res.ok && (await res.json()).liveRefresh === true;
  } catch {
    live = false;
  }

  btn.hidden = false;
  // Only the local dev mode explains itself. On the deployed page the button
  // needs no caption — the timestamp next to it already says what it does.
  note.hidden = !live;
  if (live) note.textContent = 'Refresh queries Ticketmaster live and re-ranks.';

  let lastStamp = initial.generatedAt;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = live ? 'Querying Ticketmaster…' : 'Refreshing…';
    try {
      const data = live
        ? await fetch('./api/refresh', { method: 'POST' }).then(async (r) => {
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
            return r.json();
          })
        : await fetchData(true);

      render(data);
      const changed = data.generatedAt !== lastStamp;
      lastStamp = data.generatedAt;
      btn.textContent = changed ? 'Updated' : 'No change yet';
    } catch (err) {
      btn.textContent = 'Refresh failed';
      note.textContent = `Refresh failed: ${err.message}`;
    } finally {
      btn.disabled = false;
      setTimeout(() => {
        btn.textContent = 'Refresh';
      }, 2500);
    }
  });
}

// --- live inputs -----------------------------------------------------------

const state = { artists: [], genres: [], travel: 'all' };
let pool = null; // candidate events, loaded lazily
let baseline = null; // the payload as built, for Reset and for chrome
let similar = {};

function readStateFromUrl(defaults) {
  const q = new URLSearchParams(location.search);
  const list = (k) =>
    (q.get(k) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const artists = q.has('artists') ? list('artists') : [...defaults.artists];
  const genres = q.has('genres') ? list('genres') : [...(defaults.genres ?? [])];
  const travel = q.get('travel') && TRAVEL[q.get('travel')] ? q.get('travel') : defaults.travel ?? 'all';
  return { artists, genres, travel };
}

function writeStateToUrl() {
  const q = new URLSearchParams();
  // Only record what differs from the build's defaults, so the plain URL stays
  // clean until someone actually changes something.
  const same =
    state.artists.join('|') === baseline.defaults.artists.join('|') &&
    state.genres.join('|') === (baseline.defaults.genres ?? []).join('|') &&
    state.travel === (baseline.defaults.travel ?? 'all');
  if (!same) {
    q.set('artists', state.artists.join(','));
    if (state.genres.length) q.set('genres', state.genres.join(','));
    if (state.travel !== 'all') q.set('travel', state.travel);
  }
  const url = q.toString() ? `${location.pathname}?${q}` : location.pathname;
  history.replaceState(null, '', url);
}

async function ensurePool() {
  if (pool) return pool;
  const inlined = document.getElementById('bundled-events');
  if (inlined) {
    pool = JSON.parse(inlined.textContent);
    return pool;
  }
  const res = await fetch('./events.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`events.json ${res.status}`);
  pool = await res.json();
  return pool;
}

function rerank() {
  const { shows, cut, notPlaying } = rank(pool, {
    artists: state.artists,
    similar,
    genres: state.genres,
    travel: state.travel,
    prefs: { horizonDays: baseline.horizonDays },
    now: new Date(),
  });
  render({ ...baseline, shows, cut });

  const note = document.getElementById('notPlaying');
  if (notPlaying.length === 0) {
    note.hidden = true;
  } else {
    note.hidden = false;
    const shown = notPlaying.slice(0, 6).join(', ');
    const more = notPlaying.length > 6 ? ` and ${notPlaying.length - 6} more` : '';
    note.textContent = `No Bay Area dates in this window: ${shown}${more}.`;
  }

  writeStateToUrl();
}

function renderChips() {
  const box = document.getElementById('artistChips');
  box.replaceChildren();
  if (state.artists.length === 0) {
    box.append(el('span', 'chips-empty', 'No artists — genre alone will rank the list.'));
  }
  for (const name of state.artists) {
    const chip = el('span', 'chip', name);
    const x = el('button', 'chip-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', `Remove ${name}`);
    x.addEventListener('click', () => {
      state.artists = state.artists.filter((a) => a !== name);
      renderChips();
      rerank();
    });
    chip.append(x);
    box.append(chip);
  }
  document.getElementById('artistCount')?.remove();
}

function addArtist(raw) {
  const name = raw.trim();
  if (!name) return;
  const seen = new Set(state.artists.map((a) => a.toLowerCase()));
  if (seen.has(name.toLowerCase())) return;
  state.artists = [...state.artists, name];
  renderChips();
  rerank();
}

function setupControls() {
  const controls = document.getElementById('controls');
  controls.hidden = false;

  // Artists
  renderChips();
  const input = document.getElementById('artistInput');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addArtist(input.value);
      input.value = '';
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      addArtist(input.value);
      input.value = '';
    }
  });

  // Suggestions come from the acts actually on sale in the window, so a typo
  // does not silently return nothing.
  const dl = document.getElementById('artistSuggestions');
  const names = new Set();
  for (const e of pool) for (const a of e.attractions ?? []) names.add(a);
  for (const n of [...names].sort().slice(0, 900)) {
    const o = document.createElement('option');
    o.value = n;
    dl.append(o);
  }

  document.getElementById('clearArtists').addEventListener('click', () => {
    state.artists = [];
    renderChips();
    rerank();
  });

  // Genres
  const grid = document.getElementById('genreGrid');
  for (const { name, count } of baseline.genres ?? []) {
    const id = `genre-${name.replace(/\W+/g, '-')}`;
    const wrap = el('label', 'genre-pill');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = state.genres.includes(name);
    cb.addEventListener('change', () => {
      state.genres = cb.checked
        ? [...state.genres, name]
        : state.genres.filter((g) => g !== name);
      rerank();
    });
    wrap.append(cb, el('span', null, name), el('span', 'genre-count', String(count)));
    grid.append(wrap);
  }

  // Travel
  const sel = document.getElementById('travelSelect');
  for (const [key, { label }] of Object.entries(TRAVEL)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = label;
    o.selected = key === state.travel;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    state.travel = sel.value;
    rerank();
  });

  document.getElementById('resetAll').addEventListener('click', () => {
    state.artists = [...baseline.defaults.artists];
    state.genres = [...(baseline.defaults.genres ?? [])];
    state.travel = baseline.defaults.travel ?? 'all';
    renderChips();
    grid.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.checked = state.genres.includes(cb.nextSibling.textContent);
    });
    sel.value = state.travel;
    rerank();
  });
}

async function main() {
  const headline = document.getElementById('headline');
  let data;
  // The single-file build inlines the payload, because fetch() is blocked under
  // file:// and that build exists precisely to be opened by double-click. That
  // build is a frozen snapshot, so it gets no refresh button.
  const inlined = document.getElementById('bundled-data');
  const isBundled = Boolean(inlined);
  if (isBundled) {
    data = JSON.parse(inlined.textContent);
  } else {
    try {
      data = await fetchData(false);
    } catch {
      headline.textContent = 'Could not load the results.';
      return;
    }
  }

  // Placeholder payload shipped before the first real run. Say so rather than
  // rendering "0 shows worth your time", which would read as a verdict.
  if (data.built === false) {
    headline.textContent = 'Not built yet.';
    document.getElementById('generatedAt').textContent = 'never — run npm run build:data';
    document.getElementById('emptyState').hidden = false;
    document.getElementById('emptyState').textContent =
      'No data has been generated yet. Add a Ticketmaster key and an artist list, then run npm run build:data.';
    document.getElementById('cutDetails').hidden = true;
    return;
  }

  render(data);
  baseline = data;
  if (!isBundled) await setupRefresh(data);

  // Interactivity is additive: the verdict above is already on screen and stays
  // correct if any of this fails.
  try {
    similar = await loadSimilar();
    await ensurePool();
    Object.assign(state, readStateFromUrl(data.defaults ?? { artists: [], genres: [], travel: 'all' }));
    setupControls();
    // Always recompute, even on the default inputs. It populates the "not
    // playing" note, and it is a standing check that the browser and the build
    // agree: if this produced a different list from the one already painted,
    // the two would visibly disagree on load.
    rerank();
  } catch (err) {
    console.warn('Live inputs unavailable:', err);
  }
}

async function loadSimilar() {
  const inlined = document.getElementById('bundled-similar');
  if (inlined) return JSON.parse(inlined.textContent);
  const res = await fetch('./similar-artists.json', { cache: 'no-store' });
  return res.ok ? res.json() : {};
}

main();
