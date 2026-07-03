import { describe, expect, test } from 'bun:test';
import {
  attachStatusRight,
  planAttach,
  planSwitchClient,
  preAttachCommands,
  RETURN_KEY,
  SIDEBAR_WIDTH,
  sidebarAutoEnabled,
  sidebarSplitArgs,
} from '../attach';

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

describe('attachStatusRight', () => {
  test('クリック可能ボタン (range=user|sessions) + 戻りキーヒントを含む', () => {
    const s = attachStatusRight();
    expect(s).toContain('#[range=user|sessions');
    expect(s).toContain('#[norange,default]');
    expect(s).toContain('≡ cchub');
    expect(s).toContain(`${RETURN_KEY} で一覧へ戻る`);
  });

  test('戻りキーは差し替え可能', () => {
    expect(attachStatusRight('F8')).toContain('F8 で一覧へ戻る');
  });
});

describe('sidebarSplitArgs', () => {
  test('左に幅固定の横分割 + フォーカス据え置き(-d) で sidebar を生やす', () => {
    const args = sidebarSplitArgs('proj-2');
    expect(args).toEqual([
      'split-window', '-h', '-b', '-l', String(SIDEBAR_WIDTH), '-d', '-t', 'proj-2', 'cchub tui --sidebar',
    ]);
  });

  test('幅・コマンドは差し替え可能', () => {
    const args = sidebarSplitArgs('s', 30, 'cchub tui --sidebar -p 3456');
    expect(args).toContain('30');
    expect(args[args.length - 1]).toBe('cchub tui --sidebar -p 3456');
  });
});

describe('sidebarAutoEnabled', () => {
  test('未設定は既定で有効', () => {
    expect(sidebarAutoEnabled({})).toBe(true);
  });

  test('0 / off / false（大文字小文字問わず）で無効', () => {
    expect(sidebarAutoEnabled({ CCHUB_TUI_SIDEBAR: '0' })).toBe(false);
    expect(sidebarAutoEnabled({ CCHUB_TUI_SIDEBAR: 'off' })).toBe(false);
    expect(sidebarAutoEnabled({ CCHUB_TUI_SIDEBAR: 'FALSE' })).toBe(false);
  });

  test('その他の値（1 / on 等）は有効', () => {
    expect(sidebarAutoEnabled({ CCHUB_TUI_SIDEBAR: '1' })).toBe(true);
    expect(sidebarAutoEnabled({ CCHUB_TUI_SIDEBAR: 'on' })).toBe(true);
  });
});

describe('planSwitchClient', () => {
  test('preAttachCommands → switch-client の順で発行する', () => {
    const cmds = planSwitchClient('proj-2');
    // 末尾が switch-client（popup が閉じる前に事前 set-option を流し終える必要がある）
    expect(cmds[cmds.length - 1]).toEqual(['switch-client', '-t', 'proj-2']);
    // 事前設定も同じ列に含まれている
    expect(cmds).toContainEqual(['set-option', '-t', 'proj-2', 'window-size', 'latest']);
    expect(cmds).toContainEqual(['bind-key', '-n', RETURN_KEY, 'detach-client']);
  });
});
