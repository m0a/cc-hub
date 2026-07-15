import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getHookStatus, parseHookJson, parseHookToml } from '../../src/services/hook-status';

// Only Stop and PostToolUse/AskUserQuestion are tracked: herdr reports agent
// status itself, so the transition hooks (PreToolUse / UserPromptSubmit) are no
// longer installed and their absence must not be reported as missing (#390).
describe('hook status parsing', () => {
  test('detects cchub notify in Claude-style JSON hooks', () => {
    const parsed = parseHookJson(
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'cchub notify' }] }],
          PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'cchub notify' }] }],
        },
      }),
    );

    expect(parsed).toEqual({
      stop: true,
      askUserQuestion: true,
    });
  });

  test('ignores hooks that are no longer required', () => {
    const parsed = parseHookJson(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'cchub notify' }] }],
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'cchub notify' }] }],
        },
      }),
    );

    expect(parsed).toEqual({
      stop: false,
      askUserQuestion: false,
    });
  });

  test('detects cchub notify in Codex-style TOML hooks', () => {
    const parsed = parseHookToml(`
[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "cchub notify"

[[hooks.PostToolUse]]
matcher = "AskUserQuestion"
[[hooks.PostToolUse.hooks]]
type = "command"
command = "cchub notify"
`);

    expect(parsed).toEqual({
      stop: true,
      askUserQuestion: true,
    });
  });

  test('does not credit an untracked TOML section to the hook before it', () => {
    const parsed = parseHookToml(`
[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "smart-notify.py"

[[hooks.PreToolUse]]
[[hooks.PreToolUse.hooks]]
type = "command"
command = "cchub notify"
`);

    expect(parsed).toEqual({
      stop: false,
      askUserQuestion: false,
    });
  });

  test('ignores unrelated Codex PostToolUse matchers', () => {
    const parsed = parseHookToml(`
[[hooks.PostToolUse]]
matcher = "^Bash$"
[[hooks.PostToolUse.hooks]]
type = "command"
command = "cchub notify"
`);

    expect(parsed).toEqual({
      stop: false,
      askUserQuestion: false,
    });
  });

  test('accepts AskUserQuestion regex matchers', () => {
    const parsed = parseHookToml(`
[[hooks.PostToolUse]]
matcher = "^AskUserQuestion$"
[[hooks.PostToolUse.hooks]]
type = "command"
command = "cchub notify"
`);

    expect(parsed).toEqual({
      stop: false,
      askUserQuestion: true,
    });
  });

  test('reads repo-local codex hooks status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cchub-hook-status-'));
    const codexDir = join(dir, '.codex');
    const originalCwd = process.cwd();

    try {
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(
        join(codexDir, 'hooks.json'),
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: 'cchub notify' }] }],
            PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'cchub notify' }] }],
          },
        }),
      );

      process.chdir(dir);
      const status = await getHookStatus();

      expect(status.providers.codex.configured).toBe(true);
      expect(status.providers.codex.events).toEqual({
        stop: true,
        askUserQuestion: true,
      });
      expect(status.configured).toBe(true);
      expect(status.events).toEqual({
        stop: true,
        askUserQuestion: true,
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
