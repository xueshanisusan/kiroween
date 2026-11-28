// Pure sensitive-path matcher. No I/O, no clock.

// Characters that separate shell tokens or quote a path. Spaces inside a
// Windows path split it, but the final segment (the file name) survives.
const TOKEN_SPLIT = /[\s"'`,;|&()<>{}[\]=:]+/;

const KEY_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore'] as const;
const EXACT_NAMES = [
  'credentials',
  'credentials.json',
  '.npmrc',
  '.netrc',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
] as const;
const PRIVATE_KEY_NAMES = ['id_rsa', 'id_ed25519', 'id_ecdsa'] as const;

/** Normalize a token: backslashes to slashes, lowercase, collapse `.` and `a/..` segments. */
function collapse(token: string): string[] {
  const out: string[] = [];
  for (const part of token.replace(/\\/g, '/').toLowerCase().split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      const last = out[out.length - 1];
      if (last !== undefined && last !== '..') {
        out.pop();
        continue;
      }
    }
    out.push(part);
  }
  return out;
}

function matchSegment(segment: string): string | null {
  if (segment === '.env.example') return null;
  if (segment === '.env') return '.env';
  if (segment.startsWith('.env.') || segment === '.env*') return '.env.*';
  for (const suffix of KEY_SUFFIXES) {
    if (segment.endsWith(suffix)) return `*${suffix}`;
  }
  for (const name of PRIVATE_KEY_NAMES) {
    if (segment === name) return name;
  }
  for (const name of EXACT_NAMES) {
    if (segment === name) return name;
  }
  if (segment.startsWith('service-account') && segment.endsWith('.json')) {
    return 'service-account*.json';
  }
  return null;
}

/** Returns the name of the sensitive pattern referenced in `text`, or null. */
export function findSensitiveReference(text: string): string | null {
  for (const token of text.split(TOKEN_SPLIT)) {
    if (token === '') continue;
    for (const segment of collapse(token)) {
      const hit = matchSegment(segment);
      if (hit !== null) return hit;
    }
  }
  return null;
}
