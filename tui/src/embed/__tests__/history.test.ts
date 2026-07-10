import { describe, expect, test } from 'bun:test';
import { type HistoryEntry, resumeCommand } from '../history';

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  sessionId: '1069f617-3b44-4005-ade6-3f07b30aa4b7',
  projectPath: '/Users/me/repo/cc-hub',
  title: 'title',
  mtimeMs: 0,
  ...over,
});

describe('resumeCommand', () => {
  test('cd <path> && claude -r <id> を組み立てる', () => {
    expect(resumeCommand(entry())).toBe(
      "cd '/Users/me/repo/cc-hub' && claude -r '1069f617-3b44-4005-ade6-3f07b30aa4b7'",
    );
  });

  test('パスの単一引用符をエスケープする', () => {
    expect(resumeCommand(entry({ projectPath: "/tmp/it's here" }))).toBe(
      "cd '/tmp/it'\\''s here' && claude -r '1069f617-3b44-4005-ade6-3f07b30aa4b7'",
    );
  });
});
