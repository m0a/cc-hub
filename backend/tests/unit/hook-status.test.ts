import { describe, expect, test } from 'bun:test';
import { parseHookJson, parseHookToml } from '../../src/services/hook-status';

describe('hook status parsing', () => {
  test('detects cchub notify in Claude-style JSON hooks', () => {
    const parsed = parseHookJson(
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'cchub notify' }] }],
          PreToolUse: [{ hooks: [{ type: 'command', command: 'cchub notify' }] }],
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'cchub notify' }] }],
          PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'cchub notify' }] }],
        },
      }),
    );

    expect(parsed).toEqual({
      stop: true,
      preToolUse: true,
      userPromptSubmit: true,
      askUserQuestion: true,
    });
  });

  test('detects cchub notify in Codex-style TOML hooks', () => {
    const parsed = parseHookToml(`
[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "cchub notify"

[[hooks.PreToolUse]]
[[hooks.PreToolUse.hooks]]
type = "command"
command = "cchub notify"

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
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
      preToolUse: true,
      userPromptSubmit: true,
      askUserQuestion: true,
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
      preToolUse: false,
      userPromptSubmit: false,
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
      preToolUse: false,
      userPromptSubmit: false,
      askUserQuestion: true,
    });
  });
});
