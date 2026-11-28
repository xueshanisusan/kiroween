import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Strong quoted sha1 ETag of the given bytes. */
export function etagOfBytes(bytes: Buffer | string): string {
  return `"${createHash('sha1').update(bytes).digest('hex')}"`;
}

const fileEtagCache = new Map<string, string>();

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(`"${hash.digest('hex')}"`));
  });
}

/**
 * Strong ETag of a file's bytes, streamed (never loaded whole) and cached by
 * (path, mtimeMs, size) so range requests do not re-hash the file.
 */
export async function fileEtag(path: string, mtimeMs: number, size: number): Promise<string> {
  const key = `${path}\0${mtimeMs}\0${size}`;
  const cached = fileEtagCache.get(key);
  if (cached !== undefined) return cached;
  const etag = await hashFile(path);
  // Drop stale entries for the same path so the cache stays bounded.
  const prefix = `${path}\0`;
  for (const existing of fileEtagCache.keys()) {
    if (existing.startsWith(prefix)) fileEtagCache.delete(existing);
  }
  fileEtagCache.set(key, etag);
  return etag;
}

function stripWeak(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/** True when an If-None-Match header matches the ETag (list, `*` and weak prefix handled). */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const value = header.trim();
  if (value === '') return false;
  if (value === '*') return true;
  const target = stripWeak(etag);
  return value.split(',').some((part) => {
    const candidate = part.trim();
    return candidate !== '' && stripWeak(candidate) === target;
  });
}
