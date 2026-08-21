// CLI wrapper: run the pipeline once and write public/data.json.
// The pipeline itself lives in src/pipeline.mjs so the dev server's refresh
// endpoint runs the identical logic.

import { requireApiKey, readJson } from './env.mjs';
import { buildPayload } from '../src/pipeline.mjs';
import { writePayload } from './emit.mjs';

const apiKey = requireApiKey();

let out;
try {
  out = await buildPayload({
    apiKey,
    prefs: readJson('config/prefs.json'),
    artists: readJson('config/artists.json'),
    similar: readJson('config/similar-artists.json'),
    locality: process.env.LOCALITY,
    log: (m) => console.log(m),
  });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const written = writePayload(out);

console.log(
  `\n${written.shows} shows shortlisted, ${written.cut} cut. Wrote public/data.json, public/events.json (${written.events} candidates) and public/lib/.`,
);
if (out.source.truncated) {
  console.log(
    `NOTE: API paging ceiling reached — ${out.source.eventsConsidered} of ${out.source.eventsReported} events seen. Stated in the footer.`,
  );
}
for (const s of out.shows) {
  console.log(`  ${String(s.score).padStart(3)}  ${s.artist} — ${s.date} — ${s.venue ?? '?'}`);
}
