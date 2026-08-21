// Reason strings are assembled from the scoring breakdown and nothing else.
// There is no model call here and no adjectives. A component that did not fire
// contributes no clause, which is why the product structurally cannot invent
// a reason for a show.

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Discovery returns onsale timestamps in UTC. Render them in Pacific, since
// every venue in scope is Pacific and an onsale that "opens Tue" must not read
// as Wednesday.
const PACIFIC = 'America/Los_Angeles';

export function formatPacificDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('month')} ${get('day')}`;
}

export function formatShowDate(event) {
  const iso = event.localDate ?? (event.dateTime ? event.dateTime.slice(0, 10) : null);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const idx = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${SHORT_DAYS[idx]} ${SHORT_MONTHS[m - 1]} ${d}`;
}

function tasteClause(taste) {
  const seeds = taste.seeds ?? [taste.seed];
  if (taste.tier === 'direct') {
    // A bill hitting several of your artists says so rather than picking one.
    if (seeds.length > 1) return `Direct match: ${seeds.join(', ')}.`;
    return 'Direct match.';
  }
  return `Adjacent to ${taste.seed}.`;
}

function urgencyClause(urgency) {
  // Only the axis that actually set the score speaks, and only when it carries
  // a decision. "On sale now" fired on every event in the window, so it says
  // nothing about whether to go and earns no clause.
  if (urgency.driver === 'onsale' && urgency.state === 'opens') {
    const day = formatPacificDay(urgency.at);
    if (!day) return null;
    const label = urgency.kind === 'presale' ? 'Presale' : 'Onsale';
    return `${label} opens ${day}.`;
  }
  if (urgency.driver === 'proximity' && urgency.daysUntilShow !== null) {
    const d = urgency.daysUntilShow;
    if (d <= 0) return 'Tonight.';
    if (d === 1) return 'Tomorrow.';
    if (d <= 30) return `${d} days out.`;
  }
  return null;
}

function effortClause(effort) {
  const place = effort.areaLabel ? `${effort.areaLabel} venue` : null;
  if (place && effort.weekday) return `${place}, ${effort.weekday}.`;
  if (place) return `${place}.`;
  if (effort.weekday) return `${effort.weekday}.`;
  return null;
}

function priceClause(price) {
  if (!price.applicable || typeof price.min !== 'number') return 'No price published.';
  const amount = Number.isInteger(price.min) ? price.min : price.min.toFixed(2);
  return `From $${amount}.`;
}

/**
 * "Direct match. Presale opens Tue Aug 25. SF venue, Saturday. From $68."
 */
export function buildReason(breakdown) {
  return [
    tasteClause(breakdown.taste),
    urgencyClause(breakdown.urgency),
    effortClause(breakdown.effort),
    priceClause(breakdown.price),
  ]
    .filter(Boolean)
    .join(' ');
}
