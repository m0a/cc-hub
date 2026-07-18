import { describe, expect, test } from 'bun:test';
import { normalizeHookBody } from '../../src/routes/notify';

describe('normalizeHookBody', () => {
  test('maps Grok camelCase hook fields onto Claude names', () => {
    // Verbatim shape of a grok 0.2.103 Stop hook stdin payload.
    const normalized = normalizeHookBody({
      hookEventName: 'stop',
      sessionId: '019f759e-35bb-7d72-8a9e-17f1601318a3',
      cwd: '/home/user/project',
      workspaceRoot: '/home/user/project',
      timestamp: '2026-07-18T14:25:47.529937971+00:00',
      transcriptPath: '/home/user/.grok/sessions/%2Fhome%2Fuser%2Fproject/019f759e/updates.jsonl',
      promptId: '21289f19-f3be-44fb-acdb-44b3094c8f21',
      reason: 'end_turn',
    });

    expect(normalized.hook_event_name).toBe('Stop');
    expect(normalized.session_id).toBe('019f759e-35bb-7d72-8a9e-17f1601318a3');
    expect(normalized.transcript_path).toBe(
      '/home/user/.grok/sessions/%2Fhome%2Fuser%2Fproject/019f759e/updates.jsonl',
    );
    expect(normalized.cwd).toBe('/home/user/project');
    // camelCase originals are consumed, not duplicated
    expect(normalized.hookEventName).toBeUndefined();
    expect(normalized.sessionId).toBeUndefined();
  });

  test('maps grok tool events and tool names', () => {
    const normalized = normalizeHookBody({
      hookEventName: 'post_tool_use',
      sessionId: 'abc-123',
      toolName: 'run_terminal_command',
    });
    expect(normalized.hook_event_name).toBe('PostToolUse');
    expect(normalized.tool_name).toBe('run_terminal_command');
  });

  test('passes Claude-shaped bodies through untouched', () => {
    const body = {
      hook_event_name: 'Stop',
      session_id: 'abc-123',
      cwd: '/home/user/project',
      transcript_path: '/home/user/.claude/projects/x/abc.jsonl',
    };
    expect(normalizeHookBody(body)).toBe(body);
  });

  test('leaves unknown event names as-is after normalization', () => {
    const normalized = normalizeHookBody({ hookEventName: 'something_new', sessionId: 's1' });
    expect(normalized.hook_event_name).toBe('something_new');
    expect(normalized.session_id).toBe('s1');
  });
});
