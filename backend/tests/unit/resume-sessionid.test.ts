import { describe, expect, test } from 'bun:test';
import { SessionIdSchema, agentResumeCommand } from '../../../shared/types';

// Regression for #234: resume sessionId is typed into an interactive shell via
// `claude -r <id>` / `codex resume <id>`. An unconstrained id like
// "x; rm -rf ~ #" executed arbitrary commands on the host.

describe('SessionIdSchema', () => {
  test('accepts UUID-like ids', () => {
    expect(SessionIdSchema.safeParse('038c282f-3b3f-43c4-9f60-0c3a9e503b7d').success).toBe(true);
    expect(SessionIdSchema.safeParse('thread_abc.123-XYZ').success).toBe(true);
  });

  test('rejects shell-injection / whitespace / quote payloads', () => {
    for (const bad of ['x; rm -rf ~ #', 'a b', 'a\nkill', "a'b", 'a$(id)', 'a|b', '../etc', '', 'a/b']) {
      expect(SessionIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('agentResumeCommand quoting (defense-in-depth)', () => {
  test('single-quotes the session id', () => {
    expect(agentResumeCommand('claude', 'abc-123')).toBe("claude -r 'abc-123'");
    expect(agentResumeCommand('codex', 'thread-xyz')).toBe("codex resume 'thread-xyz'");
  });

  test('escapes embedded single quotes so a value cannot break out', () => {
    // Even if validation were bypassed, the value stays inside the quoted arg.
    expect(agentResumeCommand('claude', "a'b")).toBe("claude -r 'a'\\''b'");
  });

  test('no id yields the bare resume command', () => {
    expect(agentResumeCommand('claude')).toBe('claude -r');
  });
});
