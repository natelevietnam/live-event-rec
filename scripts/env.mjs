import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env reader. No dependency, no install step before the first run.
export function loadEnv() {
  let text;
  try {
    text = readFileSync(join(ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireApiKey() {
  loadEnv();
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) {
    console.error(
      'Missing TICKETMASTER_API_KEY.\n' +
        'Copy .env.example to .env and paste a free key from https://developer.ticketmaster.com/',
    );
    process.exit(1);
  }
  return key;
}

export function readJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
}
