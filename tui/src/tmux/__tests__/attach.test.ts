import { describe, expect, test } from 'bun:test';
import { planAttach, preAttachCommands, RETURN_KEY } from '../attach';

describe('planAttach', () => {
  test('非ネスト（TMUX 未設定）: そのまま attach', () => {
    const plan = planAttach('my-session', undefined);
    expect(plan.command).toBe('tmux');
    expect(plan.args).toEqual(['attach', '-t', 'my-session']);
    expect(plan.unsetTmux).toBe(false);
  });

  test('ネスト（TMUX 設定済み）: 子 env から TMUX を外す', () => {
    const plan = planAttach('my-session', '/tmp/tmux-1000/default,1234,0');
    expect(plan.args).toEqual(['attach', '-t', 'my-session']);
    expect(plan.unsetTmux).toBe(true);
  });

  test('空文字の TMUX はネストとみなさない', () => {
    expect(planAttach('s', '').unsetTmux).toBe(false);
  });

  test('セッション名を引数に正しく載せる', () => {
    expect(planAttach('proj-2', undefined).args[2]).toBe('proj-2');
  });
});

describe('preAttachCommands', () => {
  test('window-size latest と prefix 不要の戻りキーを構築', () => {
    const cmds = preAttachCommands('my-session');
    expect(cmds).toContainEqual(['set-option', '-t', 'my-session', 'window-size', 'latest']);
    expect(cmds).toContainEqual(['bind-key', '-n', RETURN_KEY, 'detach-client']);
  });

  test('戻りキーは差し替え可能', () => {
    const cmds = preAttachCommands('s', 'F8');
    expect(cmds).toContainEqual(['bind-key', '-n', 'F8', 'detach-client']);
  });
});
