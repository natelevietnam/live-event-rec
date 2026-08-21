// Name normalization shared by the matcher.
// Deliberately conservative: this is the only place a false positive can enter
// the ranked list, so it strips noise and nothing else.

const LEADING_THE = /^the\s+/;

export function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining accents
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_THE, '');
}

export function tokensOf(raw) {
  const n = normalizeName(raw);
  return n ? n.split(' ') : [];
}
