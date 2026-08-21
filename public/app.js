// Renders public/data.json. All judgement already happened at build time —
// this file only formats numbers and strings that are already in the payload.

const COMPONENT_LABELS = {
  taste: 'Taste',
  urgency: 'Urgency',
  effort: 'Effort',
  price: 'Price',
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
    return part.tier === 'direct'
      ? `Direct match on ${part.matchedOn}.`
      : `${part.matchedOn} is adjacent to ${part.seed}.`;
  }
  if (key === 'urgency') {
    if (part.state === 'opens') {
      const label = part.kind === 'presale' ? 'Presale' : 'Onsale';
      return `${label} opens in ${part.daysUntil} day${part.daysUntil === 1 ? '' : 's'}.`;
    }
    if (part.state === 'onSaleNow') return 'Already on sale.';
    return 'Onsale date not published by the source.';
  }
  if (key === 'effort') {
    const place = part.areaLabel ? `${part.areaLabel}.` : 'Venue city not published.';
    return part.weeknight ? `${place} Weeknight, −${part.weeknightPenalty}.` : place;
  }
  if (key === 'price') {
    if (part.band === 'unknown') return 'Price not published by the source. Not estimated.';
    if (part.band === 'over') return 'Above your ceiling.';
    if (part.band === 'deep') return 'Well under your ceiling.';
    return 'Under your ceiling.';
  }
  return '';
}

function renderBreakdown(breakdown) {
  const details = el('details', 'breakdown');
  details.append(el('summary', null, 'Score breakdown'));

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

    row.append(el('span', 'bar-value', `${part.points}/${part.max}`));
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
  }
  head.append(title);

  const score = el('div', 'score', String(show.score));
  score.append(el('span', null, '/100'));
  head.append(score);
  card.append(head);

  const metaParts = [
    [show.weekday, show.date].filter(Boolean).join(' · '),
    [show.venue, show.city].filter(Boolean).join(', '),
    typeof show.priceMin === 'number' ? `From $${show.priceMin}` : 'Price TBD',
  ].filter((p) => p.length > 0);

  const meta = el('p', 'card-meta');
  metaParts.forEach((part, i) => {
    if (i > 0) meta.append(el('span', 'sep', '/'));
    meta.append(document.createTextNode(part));
  });
  card.append(meta);

  card.append(el('p', 'card-reason', show.reason));

  if (show.urgent) card.append(el('span', 'badge', 'Closing soon'));

  card.append(renderBreakdown(show.breakdown));
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

function renderSource(source, horizonDays) {
  const bits = [
    `Source: ${source.name}${source.locality ? `, ${source.locality}` : ''}, next ${horizonDays} days.`,
    `${source.eventsConsidered.toLocaleString()} events considered.`,
  ];
  if (source.truncated) {
    bits.push(
      `The API caps paging, so ${source.eventsConsidered.toLocaleString()} of ${source.eventsReported.toLocaleString()} reported events were read.`,
    );
  }
  return bits.join(' ');
}

async function main() {
  const headline = document.getElementById('headline');
  let data;
  try {
    const res = await fetch('./data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    headline.textContent = 'Could not load the results.';
    return;
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

  const n = data.shows.length;
  headline.textContent =
    n === 0
      ? `Nothing worth your time in the next ${data.horizonDays} days.`
      : `${n} show${n === 1 ? '' : 's'} worth your time in the next ${data.horizonDays} days.`;

  const stamp = document.getElementById('generatedAt');
  stamp.textContent = formatTimestamp(data.generatedAt);
  stamp.setAttribute('datetime', data.generatedAt);

  const list = document.getElementById('showList');
  if (n === 0) {
    document.getElementById('emptyState').hidden = false;
  } else {
    for (const show of data.shows) list.append(renderCard(show));
  }

  const cutList = document.getElementById('cutList');
  for (const row of data.cut) cutList.append(renderCutRow(row));
  document.getElementById('cutCount').textContent = `(${data.cut.length})`;

  document.getElementById('sourceLine').textContent = renderSource(data.source, data.horizonDays);
}

main();
