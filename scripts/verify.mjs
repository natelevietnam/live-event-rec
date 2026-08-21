// Step 0. Run this before trusting anything downstream.
// Prints the raw count and five event names per locality strategy, so we know
// the Bay Area query actually returns Bay Area music events.

import { requireApiKey, readJson } from './env.mjs';
import { LOCALITY_STRATEGIES, probe, extractEvent, windowParams } from '../src/ticketmaster.mjs';

const apiKey = requireApiKey();
const prefs = readJson('config/prefs.json');
const now = new Date();
const { startDateTime, endDateTime } = windowParams(prefs.horizonDays, now);

console.log(`Window: ${startDateTime} -> ${endDateTime} (${prefs.horizonDays} days)\n`);

let anySucceeded = false;

for (const strategy of LOCALITY_STRATEGIES) {
  process.stdout.write(`${strategy.label}\n`);
  try {
    const { total, events } = await probe({
      apiKey,
      horizonDays: prefs.horizonDays,
      locality: strategy.params,
      size: 5,
      now,
    });
    console.log(`  totalElements: ${total}`);
    if (events.length === 0) {
      console.log('  no events returned');
    } else {
      anySucceeded = true;
      for (const raw of events) {
        const e = extractEvent(raw);
        const city = e.venue?.city ?? 'city unknown';
        console.log(`  - ${e.name} — ${e.venue?.name ?? 'venue unknown'}, ${city} — ${e.localDate ?? '?'}`);
      }
    }
  } catch (err) {
    console.log(`  FAILED: ${err.message}`);
  }
  console.log('');
}

if (!anySucceeded) {
  console.error('No locality strategy returned events. Do not build on this. Fix the query first.');
  process.exit(1);
}
