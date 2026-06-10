import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAllowedTranscriptPath } from '../notify';

const claudeDir = join(homedir(), '.claude');
const realFile = join(claudeDir, '.cchub-test-transcript.jsonl');
const linkFile = join(claudeDir, '.cchub-test-escape-link.jsonl');

describe('isAllowedTranscriptPath', () => {
  beforeAll(async () => {
    await mkdir(claudeDir, { recursive: true });
    await writeFile(realFile, '{}\n');
    await rm(linkFile, { force: true });
    await symlink('/etc/hosts', linkFile);
  });

  afterAll(async () => {
    await rm(realFile, { force: true });
    await rm(linkFile, { force: true });
  });

  test('allows a transcript under ~/.claude', async () => {
    expect(await isAllowedTranscriptPath(realFile)).toBe(true);
  });

  test('rejects files outside the allowed dirs', async () => {
    expect(await isAllowedTranscriptPath('/etc/passwd')).toBe(false);
  });

  test('rejects nonexistent paths', async () => {
    expect(await isAllowedTranscriptPath(join(claudeDir, 'no-such-file.jsonl'))).toBe(false);
  });

  test('rejects traversal that resolves outside the allowed dirs', async () => {
    expect(await isAllowedTranscriptPath(join(claudeDir, '..', '..', 'etc', 'passwd'))).toBe(false);
  });

  test('rejects symlinks escaping the allowed dirs', async () => {
    expect(await isAllowedTranscriptPath(linkFile)).toBe(false);
  });
});
