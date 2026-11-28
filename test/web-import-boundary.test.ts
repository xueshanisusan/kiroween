import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Requirements 11.1, 11.2, 11.3, 11.4, 14.4.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const WEB_DIR = join(SRC, 'web');
const PUBLISH_DIR = join(SRC, 'publish');

const FORBIDDEN_DIRS = ['ingest', 'summarize', 'tts', 'select', 'ground', 'length', 'pipeline'].map((d) =>
  join(SRC, d),
);

const ALLOWED_PUBLISH_CONSTANTS = new Set(['EPISODE_MP3_FILE', 'EPISODE_JSON_FILE']);

interface ImportRef {
  readonly file: string;
  readonly specifier: string;
  /** Text between `import`/`export` and `from`; empty for side-effect and dynamic imports. */
  readonly clause: string;
  readonly dynamic: boolean;
}

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function extractImports(file: string): ImportRef[] {
  const text = stripComments(readFileSync(file, 'utf8'));
  const refs: ImportRef[] = [];
  const fromRe = /\b(?:import|export)\s+([^;'"`]*?)\s*from\s*(['"])([^'"\n]+)\2/g;
  const sideRe = /(?:^|[;\n])\s*import\s*(['"])([^'"\n]+)\1/g;
  const dynRe = /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g;
  for (const m of text.matchAll(fromRe)) {
    refs.push({ file, specifier: m[3] as string, clause: m[1] as string, dynamic: false });
  }
  for (const m of text.matchAll(sideRe)) {
    refs.push({ file, specifier: m[2] as string, clause: '', dynamic: false });
  }
  for (const m of text.matchAll(dynRe)) {
    refs.push({ file, specifier: m[2] as string, clause: '', dynamic: true });
  }
  return refs;
}

/** Resolve a relative specifier to an extensionless absolute path; bare specifiers return null. */
function resolveTarget(ref: ImportRef): string | null {
  if (!ref.specifier.startsWith('.')) return null;
  return resolve(dirname(ref.file), ref.specifier).replace(/\.(?:js|ts)$/, '');
}

function isInside(target: string, dir: string): boolean {
  return target === dir || target.startsWith(dir + sep);
}

function rel(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

/** Names imported by a clause such as `{ A, type B as C }`; null if default or namespace import. */
function namedImports(clause: string): string[] | null {
  const m = /^(?:type\s+)?\{([\s\S]*)\}$/.exec(clause.trim());
  if (!m) return null;
  return (m[1] as string)
    .split(',')
    .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] as string)
    .filter((s) => s.length > 0);
}

describe('web import boundary', () => {
  const webFiles = listTsFiles(WEB_DIR);

  it('scans at least one file under src/web/', () => {
    expect(webFiles.length).toBeGreaterThan(0);
  });

  it('src/web/ never imports from ingest, summarize, tts, select, ground, length or pipeline', () => {
    const violations: string[] = [];
    for (const file of webFiles) {
      for (const ref of extractImports(file)) {
        const target = resolveTarget(ref);
        if (target === null) continue;
        if (FORBIDDEN_DIRS.some((d) => isInside(target, d))) {
          violations.push(`${rel(file)} -> ${ref.specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('src/web/ never imports the Kiro CLI adapter or the LLM mode selector (Requirements 8.1, 8.2)', () => {
    const banned = [join(SRC, 'summarize', 'kiro-cli-adapter'), join(SRC, 'summarize', 'select-llm')];
    const violations: string[] = [];
    for (const file of webFiles) {
      for (const ref of extractImports(file)) {
        const target = resolveTarget(ref);
        if (target !== null && banned.includes(target)) {
          violations.push(`${rel(file)} -> ${ref.specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
    // Scanner sanity: both specifier spellings resolve to the banned targets.
    const sample = join(WEB_DIR, '__sample__.ts');
    for (const [spec, expected] of [
      ['../summarize/kiro-cli-adapter.js', banned[0]],
      ['../summarize/select-llm', banned[1]],
    ] as const) {
      expect(resolveTarget({ file: sample, specifier: spec, clause: '', dynamic: false })).toBe(expected);
    }
  });

  it('src/web/ imports from src/publish/ only episode-json and the two file-name constants', () => {
    const violations: string[] = [];
    for (const file of webFiles) {
      for (const ref of extractImports(file)) {
        const target = resolveTarget(ref);
        if (target === null || !isInside(target, PUBLISH_DIR)) continue;
        if (target === join(PUBLISH_DIR, 'episode-json')) continue;
        if (target === join(PUBLISH_DIR, 'publish') && !ref.dynamic) {
          const names = namedImports(ref.clause);
          if (names !== null && names.length > 0 && names.every((n) => ALLOWED_PUBLISH_CONSTANTS.has(n))) {
            continue;
          }
        }
        violations.push(`${rel(file)} -> ${ref.specifier} (${ref.clause || 'no named imports'})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no module in the forbidden directories or src/publish/ imports from src/web/', () => {
    const violations: string[] = [];
    const dirs = [...FORBIDDEN_DIRS, PUBLISH_DIR];
    for (const dir of dirs) {
      for (const file of listTsFiles(dir)) {
        for (const ref of extractImports(file)) {
          const target = resolveTarget(ref);
          if (target !== null && isInside(target, WEB_DIR)) {
            violations.push(`${rel(file)} -> ${ref.specifier}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('package.json dependencies are exactly @openrouter/sdk and rss-parser', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@openrouter/sdk', 'rss-parser']);
  });

  it('extractor detects the import forms it is meant to police', () => {
    // Guards against the scanner silently matching nothing.
    const sample = join(WEB_DIR, '__sample__.ts');
    expect(namedImports('{ EPISODE_MP3_FILE, type X as Y }')).toEqual(['EPISODE_MP3_FILE', 'X']);
    expect(namedImports('* as p')).toBeNull();
    expect(isInside(join(SRC, 'tts', 'seed'), join(SRC, 'tts'))).toBe(true);
    expect(isInside(join(SRC, 'ttsx'), join(SRC, 'tts'))).toBe(false);
    expect(resolveTarget({ file: sample, specifier: '../tts/seed.js', clause: '', dynamic: false })).toBe(
      join(SRC, 'tts', 'seed'),
    );
  });
});
