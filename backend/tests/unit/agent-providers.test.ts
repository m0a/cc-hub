import { describe, expect, test } from 'bun:test';
import {
  AGENT_PROVIDER_IDS,
  AGENT_PROVIDERS,
  CreateSessionSchema,
  agentResumeCommand,
  agentSupportsConversationMetadata,
  detectAgentProviderFromArgs,
} from '../../../shared/types';
import { homedir } from 'node:os';
import { agentStartCommand, expandHome, findDuplicateAgentWorkingDirSession, shellQuote } from '../../src/routes/sessions';

describe('Agent provider registry', () => {
  test('derives provider IDs from the registry', () => {
    expect(AGENT_PROVIDER_IDS).toContain('claude');
    expect(AGENT_PROVIDER_IDS).toContain('codex');
    expect([...AGENT_PROVIDER_IDS].join(',')).toBe(Object.keys(AGENT_PROVIDERS).join(','));
  });

  test('defaults create-session agent to Claude', () => {
    const parsed = CreateSessionSchema.parse({ name: 'example' });

    expect(parsed.agent).toBe('claude');
  });

  test('accepts Codex as a create-session agent', () => {
    const parsed = CreateSessionSchema.parse({ name: 'example', agent: 'codex' });

    expect(parsed.agent).toBe('codex');
  });

  test('rejects unsupported create-session agents', () => {
    const parsed = CreateSessionSchema.safeParse({ name: 'example', agent: 'gemini' });

    expect(parsed.success).toBe(false);
  });

  test('detects supported providers from process args', () => {
    expect(detectAgentProviderFromArgs('claude')).toBe('claude');
    expect(detectAgentProviderFromArgs('/usr/local/bin/claude --resume')).toBe('claude');
    expect(detectAgentProviderFromArgs('/home/user/.local/share/claude/versions/2.1.123/claude')).toBe('claude');
    expect(detectAgentProviderFromArgs('codex')).toBe('codex');
    expect(detectAgentProviderFromArgs('/home/user/.bun/install/global/node_modules/@openai/codex/bin/codex.js')).toBe('codex');
  });

  test('does not detect provider names inside unrelated paths', () => {
    expect(detectAgentProviderFromArgs('/tmp/.claude/shell-snapshots/claude-foo-cwd')).toBeUndefined();
    expect(detectAgentProviderFromArgs('/tmp/codex-project/run.sh')).toBeUndefined();
  });

  test('exposes provider capabilities', () => {
    expect(agentSupportsConversationMetadata('claude')).toBe(true);
    expect(agentSupportsConversationMetadata('codex')).toBe(false);
    expect(agentSupportsConversationMetadata('unknown')).toBe(false);
  });

  test('quotes working directories for agent start commands', () => {
    expect(shellQuote('/tmp/plain path')).toBe("'/tmp/plain path'");
    expect(shellQuote("/tmp/it's-here")).toBe("'/tmp/it'\\''s-here'");
    expect(agentStartCommand('codex', "/tmp/it's-here")).toBe("cd '/tmp/it'\\''s-here' && codex");
  });

  test('expands ~ to the home directory before quoting', () => {
    expect(expandHome('~')).toBe(homedir());
    expect(expandHome('~/foo')).toBe(`${homedir()}/foo`);
    expect(expandHome('/abs/path')).toBe('/abs/path');
    expect(expandHome('~user/foo')).toBe('~user/foo');
    expect(agentStartCommand('claude', '~')).toBe(`cd '${homedir()}' && claude`);
  });

  test('detects duplicate working directories only for the same agent', () => {
    const sessions = [
      { name: 'claude-repo', agent: 'claude', currentCommand: 'claude', currentPath: '/repo' },
      { name: 'codex-other', agent: 'codex', currentCommand: 'codex', currentPath: '/other' },
    ];

    expect(findDuplicateAgentWorkingDirSession(sessions, 'claude', '/repo')?.name).toBe('claude-repo');
    expect(findDuplicateAgentWorkingDirSession(sessions, 'codex', '/repo')).toBeUndefined();
  });

  test('uses currentCommand for duplicate detection when agent is missing', () => {
    const sessions = [
      { name: 'legacy-codex', currentCommand: 'codex', currentPath: '/repo' },
    ];

    expect(findDuplicateAgentWorkingDirSession(sessions, 'codex', '/repo')?.name).toBe('legacy-codex');
  });

  test('builds resume commands per agent', () => {
    expect(agentResumeCommand('claude')).toBe('claude -r');
    // session id is single-quoted (typed into an interactive shell) — #234
    expect(agentResumeCommand('claude', 'abc-123')).toBe("claude -r 'abc-123'");
    expect(agentResumeCommand('codex')).toBe('codex resume');
    expect(agentResumeCommand('codex', 'thread-xyz')).toBe("codex resume 'thread-xyz'");
  });
});
