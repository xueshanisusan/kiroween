import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSensitiveReference } from '../../scripts/hooks/sensitive-paths.js';

// Path strings only. The real .env file is never opened.
const SENSITIVE = [
  '.env',
  '.\\.env',
  'D:\\Programs\\kiroween\\.env',
  '.ENV',
  './src/../.env',
  '.env.local',
  '.env.production',
  'certs/server.pem',
  'deploy.key',
  'id_rsa',
  '.aws/credentials',
  'credentials.json',
  'service-account-prod.json',
  'cat .env',
  'Get-Content .\\.env',
];

const ALLOWED = [
  '.env.example',
  'src/config/environment.ts',
  'src/web/server.ts',
  'README.md',
  'package.json',
  'keyboard.ts',
  'id_rsa.pub',
];

describe('findSensitiveReference', () => {
  it.each(SENSITIVE)('matches %s', (text) => {
    expect(findSensitiveReference(text)).not.toBeNull();
  });

  it.each(ALLOWED)('allows %s', (text) => {
    expect(findSensitiveReference(text)).toBeNull();
  });
});

const GUARD = resolve(__dirname, '../../scripts/hooks/guard-sensitive-reads.ts');
const ROOT = resolve(__dirname, '../..');

function runGuard(stdin: string): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', GUARD], {
    input: stdin,
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, stderr: result.stderr };
}

describe('guard-sensitive-reads script', () => {
  it('blocks a read_file payload naming .env', () => {
    const r = runGuard('{"tool_name":"read_file","tool_input":{"path":".env"}}');
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).not.toBe('');
  });

  it('allows .env.example', () => {
    const r = runGuard('{"tool_input":{"path":".env.example"}}');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('blocks a grep payload that includes **/.env', () => {
    const r = runGuard('{"tool_input":{"query":"KEY","includePattern":"**/.env"}}');
    expect(r.status).toBe(2);
  });

  it('allows empty stdin', () => {
    const r = runGuard('');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('allows a malformed payload with no sensitive text', () => {
    const r = runGuard('{not json at all');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});
