import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force the data directory before the module loads so session-metadata.json
// lands in our scratch dir. ensureDataDir reads CC_HUB_DATA_DIR. #333
let tempDir: string;
let originalDataDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cchub-meta-'));
  originalDataDir = process.env.CC_HUB_DATA_DIR;
  process.env.CC_HUB_DATA_DIR = tempDir;
});

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.CC_HUB_DATA_DIR;
  else process.env.CC_HUB_DATA_DIR = originalDataDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe('session-metadata mutation lock', () => {
  test('concurrent theme/title/order updates do not overwrite each other', async () => {
    const meta = await import('../session-metadata');

    // Interleave updates that all do load→mutate→save on the same file.
    // Without the mutation lock, overlapping sequences drop each other's
    // writes (lost update).
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < 20; i++) {
      ops.push(meta.setSessionTheme('ses-a', 'blue'));
      ops.push(meta.setSessionTitle('ses-b', `title ${i}`));
      ops.push(meta.setSessionOrder([`ses-a`, `ses-b`, `ses-${i}`]));
    }
    await Promise.all(ops);

    const sessions = await meta.getAllSessionMetadata();
    expect(sessions['ses-a']?.theme).toBe('blue');
    expect(sessions['ses-b']?.title).toBe('title 19');
    expect(await meta.getSessionOrder()).toEqual(['ses-a', 'ses-b', 'ses-19']);

    // The file on disk must always be complete JSON (atomic temp+rename).
    const text = await readFile(join(tempDir, 'session-metadata.json'), 'utf-8');
    const parsed = JSON.parse(text);
    expect(parsed.sessions['ses-a'].theme).toBe('blue');
  });

  test('concurrent last-known-session updates are serialised', async () => {
    const meta = await import('../session-metadata');

    await meta.saveLastKnownSessions([
      { id: 's1', name: 'one' },
      { id: 's2', name: 'two' },
      { id: 's3', name: 'three' },
    ]);
    await Promise.all([
      meta.removeLastKnownSession('s1'),
      meta.removeLastKnownSession('s3'),
    ]);

    const remaining = await meta.getLastKnownSessions();
    expect(remaining.map(s => s.id)).toEqual(['s2']);
  });
});
