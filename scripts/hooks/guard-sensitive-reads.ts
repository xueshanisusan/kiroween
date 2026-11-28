// PreToolUse hook: blocks tool calls that reference sensitive files.
// Exit 2 + stderr message blocks the call; exit 0 with no output allows it.
import { readFileSync } from 'node:fs';
import { findSensitiveReference } from './sensitive-paths.js';

export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      collectStrings(item, out);
    }
  }
  return out;
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function candidates(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const input = record['tool_input'] ?? record['toolArgs'];
      if (input !== undefined) return collectStrings(input);
    }
    return collectStrings(parsed);
  } catch {
    return [raw];
  }
}

function main(): void {
  const raw = readStdin();
  for (const text of candidates(raw)) {
    const hit = findSensitiveReference(text);
    if (hit !== null) {
      process.stderr.write(
        `Blocked: this tool call would read a sensitive file (${hit}). Secrets must not enter the agent context. Use .env.example for variable names.\n`,
      );
      process.exit(2);
    }
  }
  process.exit(0);
}

main();
