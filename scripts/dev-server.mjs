// Local dev server. Serves public/ and exposes POST /api/refresh, which runs the
// real pipeline against the live Ticketmaster API, rewrites public/data.json,
// and returns the new payload.
//
// This is the only place a refresh can genuinely re-query Ticketmaster, because
// the API key lives here in the server process. The deployed page is static and
// must never hold the key — see the note in public/app.js and the README.

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { ROOT, requireApiKey, readJson } from './env.mjs';
import { buildPayload } from '../src/pipeline.mjs';

const PORT = Number(process.env.PORT ?? 4173);
const PUBLIC = join(ROOT, 'public');
const apiKey = requireApiKey();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let refreshing = false;

async function refresh() {
  const started = Date.now();
  const out = await buildPayload({
    apiKey,
    prefs: readJson('config/prefs.json'),
    artists: readJson('config/artists.json'),
    similar: readJson('config/similar-artists.json'),
    log: (m) => console.log(`  ${m}`),
  });
  await writeFile(join(PUBLIC, 'data.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    `  refreshed in ${((Date.now() - started) / 1000).toFixed(1)}s — ${out.shows.length} shows, ${out.cut.length} cut`,
  );
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/refresh') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end('POST only');
      return;
    }
    // One at a time: a double click must not fire two full paginated crawls.
    if (refreshing) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'A refresh is already running.' }));
      return;
    }
    refreshing = true;
    console.log('POST /api/refresh — querying Ticketmaster');
    try {
      const out = await refresh();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    } catch (err) {
      console.error(`  refresh failed: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } finally {
      refreshing = false;
    }
    return;
  }

  // Advertises that a live refresh is available. The static build has no such
  // endpoint, which is how the page knows which refresh it can offer.
  if (url.pathname === '/api/capabilities') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ liveRefresh: true }));
    return;
  }

  // Static files, path-traversal guarded.
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = join(PUBLIC, normalize(rel));
  if (!target.startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Live Event Rec dev server — http://localhost:${PORT}`);
  console.log('Refresh on the page will query Ticketmaster live and re-rank.');
});
