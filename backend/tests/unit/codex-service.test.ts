import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { CodexService } from '../../src/services/codex';

const TEST_DIR = join(tmpdir(), `cchub-codex-service-${Date.now()}`);
const DB_PATH = join(TEST_DIR, 'state_5.sqlite');

function createThreadsTable(db: Database): void {
  db.run(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      first_user_message TEXT,
      tokens_used INTEGER,
      git_branch TEXT,
      cwd TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      archived INTEGER NOT NULL DEFAULT 0
    )
  `);
}

function insertThread(db: Database, row: {
  id: string;
  cwd: string;
  title: string;
  firstUserMessage: string;
  tokensUsed: number;
  gitBranch?: string;
  updatedAtMs: number;
  archived?: number;
}): void {
  db.run(
    `INSERT INTO threads (
      id,
      cwd,
      title,
      first_user_message,
      tokens_used,
      git_branch,
      created_at,
      updated_at,
      created_at_ms,
      updated_at_ms,
      archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.cwd,
      row.title,
      row.firstUserMessage,
      row.tokensUsed,
      row.gitBranch ?? null,
      Math.floor(row.updatedAtMs / 1000),
      Math.floor(row.updatedAtMs / 1000),
      row.updatedAtMs,
      row.updatedAtMs,
      row.archived ?? 0,
    ],
  );
}

describe('CodexService', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test('returns an empty map when the state database does not exist', async () => {
    const service = new CodexService(join(TEST_DIR, 'missing.sqlite'));

    const threads = await service.getThreadsForPaths(['/repo']);

    expect(threads.size).toBe(0);
  });

  test('returns the latest unarchived thread for each cwd', async () => {
    const db = new Database(DB_PATH);
    createThreadsTable(db);
    insertThread(db, {
      id: 'older',
      cwd: '/repo',
      title: 'Older title',
      firstUserMessage: 'older prompt',
      tokensUsed: 100,
      updatedAtMs: 1000,
    });
    insertThread(db, {
      id: 'newer',
      cwd: '/repo',
      title: 'Newer title',
      firstUserMessage: 'newer prompt',
      tokensUsed: 250,
      gitBranch: 'feat/codex',
      updatedAtMs: 2000,
    });
    insertThread(db, {
      id: 'other',
      cwd: '/other',
      title: 'Other title',
      firstUserMessage: 'other prompt',
      tokensUsed: 300,
      updatedAtMs: 1500,
    });
    db.close();

    const service = new CodexService(DB_PATH);
    const threads = await service.getThreadsForPaths(['/repo', '/other', '/missing']);

    expect(threads.get('/repo')?.sessionId).toBe('newer');
    expect(threads.get('/repo')?.title).toBe('Newer title');
    expect(threads.get('/repo')?.firstPrompt).toBe('newer prompt');
    expect(threads.get('/repo')?.tokensUsed).toBe(250);
    expect(threads.get('/repo')?.gitBranch).toBe('feat/codex');
    expect(threads.get('/other')?.sessionId).toBe('other');
    expect(threads.has('/missing')).toBe(false);
  });

  test('ignores archived threads', async () => {
    const db = new Database(DB_PATH);
    createThreadsTable(db);
    insertThread(db, {
      id: 'archived',
      cwd: '/repo',
      title: 'Archived',
      firstUserMessage: 'archived prompt',
      tokensUsed: 1000,
      updatedAtMs: 3000,
      archived: 1,
    });
    db.close();

    const service = new CodexService(DB_PATH);
    const threads = await service.getThreadsForPaths(['/repo']);

    expect(threads.size).toBe(0);
  });
});
