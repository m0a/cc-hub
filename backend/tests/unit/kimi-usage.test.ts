import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KimiSessionStore } from '../../src/services/kimi';
import { KimiUsageService } from '../../src/services/kimi-usage';

const TEST_DIR = join(tmpdir(), `cchub-kimi-usage-${Date.now()}`);
const SESSIONS_DIR = join(TEST_DIR, 'sessions');
const CWD = '/home/user/proj';
const WD_DIR = 'wd_proj_58f1d424d923';
const SESSION_ID = 'session_019f0000-0000-7000-8000-000000000001';

function usageRecord(timeMs: number, model: string, usage: Record<string, number>): string {
  return JSON.stringify({ type: 'usage.record', model, usage, usageScope: 'turn', time: timeMs });
}

function stateJson(): string {
  const nowIso = new Date().toISOString();
  return JSON.stringify({
    createdAt: nowIso,
    updatedAt: nowIso,
    title: 'test',
    workDir: CWD,
  });
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
let latestMs = 0;

beforeEach(async () => {
  const now = Date.now();
  latestMs = now - 30 * 60_000;

  const sessionDir = join(SESSIONS_DIR, WD_DIR, SESSION_ID);
  await mkdir(join(sessionDir, 'agents', 'main'), { recursive: true });
  await mkdir(join(sessionDir, 'agents', 'agent-0'), { recursive: true });
  await writeFile(join(sessionDir, 'state.json'), stateJson());
  await writeFile(join(sessionDir, 'agents', 'main', 'wire.jsonl'), [
    JSON.stringify({ type: 'metadata', protocol_version: '1.4', created_at: now - 2 * DAY_MS }),
    // 2 days ago → 7d only. input = 1000 + 2000 + 0 = 3000, total = 3100
    usageRecord(now - 2 * DAY_MS, 'k2', { inputOther: 1000, output: 100, inputCacheRead: 2000, inputCacheCreation: 0 }),
    // 1h ago → both windows. input = 500 + 0 + 250 = 750, total = 800
    usageRecord(now - HOUR_MS, 'k3', { inputOther: 500, output: 50, inputCacheRead: 0, inputCacheCreation: 250 }),
    // 10 days ago → excluded from the 7d window
    usageRecord(now - 10 * DAY_MS, 'k2', { inputOther: 99_999, output: 1, inputCacheRead: 0, inputCacheCreation: 0 }),
  ].join('\n'));
  // Sub-agent wire: real consumption, must be summed in. input = 100 + 375 + 0 = 475, total = 500
  await writeFile(join(sessionDir, 'agents', 'agent-0', 'wire.jsonl'), [
    usageRecord(latestMs, 'k3', { inputOther: 100, output: 25, inputCacheRead: 375, inputCacheCreation: 0 }),
  ].join('\n'));

  // A second session with no usage records must not count towards sessions7d.
  const idleDir = join(SESSIONS_DIR, WD_DIR, 'session_019f0000-0000-7000-8000-000000000002');
  await mkdir(join(idleDir, 'agents', 'main'), { recursive: true });
  await writeFile(join(idleDir, 'state.json'), stateJson());
  await writeFile(join(idleDir, 'agents', 'main', 'wire.jsonl'), `${JSON.stringify({ type: 'metadata' })}\n`);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('KimiUsageService', () => {
  test('aggregates 24h / 7d windows from usage.record records, sub-agents included', async () => {
    const service = new KimiUsageService(new KimiSessionStore(SESSIONS_DIR));
    const summary = await service.getUsageSummary();
    expect(summary).not.toBeNull();
    expect(summary?.last7d).toEqual({
      turns: 3,
      totalTokens: 4400,
      inputTokens: 4225,
      cacheReadTokens: 2375,
      outputTokens: 175,
    });
    expect(summary?.last24h).toEqual({
      turns: 2,
      totalTokens: 1300,
      inputTokens: 1225,
      cacheReadTokens: 375,
      outputTokens: 75,
    });
    expect(summary?.models).toEqual([
      { model: 'k2', totalTokens: 3100 },
      { model: 'k3', totalTokens: 1300 },
    ]);
    expect(summary?.sessions7d).toBe(1);
    expect(summary?.lastTurnAt).toBe(new Date(latestMs).toISOString());
  });

  test('returns null when there are no sessions', async () => {
    const service = new KimiUsageService(new KimiSessionStore(join(TEST_DIR, 'missing')));
    expect(await service.getUsageSummary()).toBeNull();
  });
});
