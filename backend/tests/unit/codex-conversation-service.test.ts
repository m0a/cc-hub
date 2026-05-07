import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexConversationService } from '../../src/services/codex-conversation';

let scratch: string;
let rolloutPath: string;

function writeRollout(lines: object[]): void {
  const text = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  writeFileSync(rolloutPath, text);
}

describe('CodexConversationService', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'cchub-codex-conv-'));
    rolloutPath = join(scratch, 'rollout.jsonl');
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test('parses user/agent messages in order', () => {
    writeRollout([
      { timestamp: '2026-05-07T09:47:05Z', type: 'session_meta', payload: {} },
      { timestamp: '2026-05-07T09:47:30Z', type: 'event_msg', payload: { type: 'user_message', message: 'こんにちは' } },
      { timestamp: '2026-05-07T09:47:35Z', type: 'event_msg', payload: { type: 'agent_message', message: 'やぁ', phase: 'commentary' } },
      { timestamp: '2026-05-07T09:48:00Z', type: 'event_msg', payload: { type: 'user_message', message: '今日の予定は？' } },
      { timestamp: '2026-05-07T09:48:05Z', type: 'event_msg', payload: { type: 'agent_message', message: '会議が二件です' } },
    ]);

    const svc = new CodexConversationService();
    const messages = svc.parseRollout(rolloutPath);
    expect(messages).toEqual([
      { role: 'user', content: 'こんにちは', timestamp: '2026-05-07T09:47:30Z' },
      { role: 'assistant', content: 'やぁ', timestamp: '2026-05-07T09:47:35Z' },
      { role: 'user', content: '今日の予定は？', timestamp: '2026-05-07T09:48:00Z' },
      { role: 'assistant', content: '会議が二件です', timestamp: '2026-05-07T09:48:05Z' },
    ]);
  });

  test('skips tool calls and other events', () => {
    writeRollout([
      { timestamp: '2026-05-07T09:47:30Z', type: 'event_msg', payload: { type: 'user_message', message: 'lsして' } },
      { timestamp: '2026-05-07T09:47:31Z', type: 'event_msg', payload: { type: 'task_started' } },
      { timestamp: '2026-05-07T09:47:32Z', type: 'response_item', payload: { type: 'function_call' } },
      { timestamp: '2026-05-07T09:47:33Z', type: 'event_msg', payload: { type: 'exec_command_end', stdout: 'a b c' } },
      { timestamp: '2026-05-07T09:47:34Z', type: 'event_msg', payload: { type: 'token_count' } },
      { timestamp: '2026-05-07T09:47:40Z', type: 'event_msg', payload: { type: 'agent_message', message: 'a, b, c が見えました' } },
    ]);

    const svc = new CodexConversationService();
    const messages = svc.parseRollout(rolloutPath);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('lsして');
    expect(messages[1].content).toBe('a, b, c が見えました');
  });

  test('returns empty array on missing file', () => {
    const svc = new CodexConversationService();
    expect(svc.parseRollout(join(scratch, 'does-not-exist.jsonl'))).toEqual([]);
  });

  test('tolerates malformed lines', () => {
    writeFileSync(rolloutPath, [
      '{not json}',
      '',
      JSON.stringify({ timestamp: '2026-05-07T09:47:30Z', type: 'event_msg', payload: { type: 'user_message', message: 'ok' } }),
    ].join('\n'));

    const svc = new CodexConversationService();
    const messages = svc.parseRollout(rolloutPath);
    expect(messages).toEqual([
      { role: 'user', content: 'ok', timestamp: '2026-05-07T09:47:30Z' },
    ]);
  });

  test('returns [] when threadId is unknown (no DB)', async () => {
    const svc = new CodexConversationService(join(scratch, 'no-db.sqlite'));
    expect(await svc.getConversation('whatever')).toEqual([]);
  });
});
