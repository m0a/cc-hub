// セッション入室（tmux attach への子プロセスハンドオフ）。
// コマンド構築は純粋関数（planAttach / preAttachCommands）として切り出し単体テストする。
// alt-screen の退出/復帰は呼び出し側（startTui のループ）が担う。

/** prefix 不要で一覧へ戻るためのキー（tmux の detach-client を no-prefix で割当）。 */
export const RETURN_KEY = 'F12';

export interface AttachPlan {
  command: string;
  args: string[];
  /** ネスト（既存 tmux セッション内）からの attach 時に子の env から TMUX を外す。 */
  unsetTmux: boolean;
}

/**
 * tmux attach のコマンドを構築。
 * - 非ネスト（TMUX 未設定）: そのまま `tmux attach -t <name>`。
 * - ネスト（TMUX 設定済み）: 子の env から TMUX を外して attach を許可する
 *   （`env -u TMUX tmux attach` 相当。"sessions should be nested" 拒否の回避）。
 */
export function planAttach(sessionName: string, tmuxEnv: string | undefined): AttachPlan {
  return {
    command: 'tmux',
    args: ['attach', '-t', sessionName],
    unsetTmux: Boolean(tmuxEnv),
  };
}

/**
 * 入室前に流す tmux 設定（純粋に引数列を返す）:
 * - `window-size latest`: アクティブな端末（= 入室した TUI の端末）にサイズを追従させる
 * - `bind-key -n <RETURN_KEY> detach-client`: prefix 不要の「一覧へ戻る」キー
 */
export function preAttachCommands(sessionName: string, returnKey: string = RETURN_KEY): string[][] {
  return [
    ['set-option', '-t', sessionName, 'window-size', 'latest'],
    ['bind-key', '-n', returnKey, 'detach-client'],
  ];
}

function runTmux(args: string[]): void {
  try {
    Bun.spawnSync(['tmux', ...args], { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    // ベストエフォート（戻りキー/サイズ調整は失敗しても attach は続行）
  }
}

/** セッションのオプション値を取得（未設定なら null）。 */
function captureOption(sessionName: string, name: string): string | null {
  try {
    const proc = Bun.spawnSync(['tmux', 'show-options', '-t', sessionName, '-v', name], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const text = proc.stdout ? new TextDecoder().decode(proc.stdout).replace(/\n$/, '') : '';
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** 子プロセスを stdio 継承で起動し、detach（= RETURN_KEY 等）まで同期的に待つ。 */
export function attachSession(sessionName: string, tmuxEnv: string | undefined = process.env.TMUX): void {
  const plan = planAttach(sessionName, tmuxEnv);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (plan.unsetTmux) delete env.TMUX;

  // サイズ追従 + 戻りキーを準備。
  for (const args of preAttachCommands(sessionName)) runTmux(args);

  // 入室中は status バーに戻り方を常時表示（元の値を退避して復帰後に戻す）。
  const originalStatusRight = captureOption(sessionName, 'status-right');
  runTmux(['set-option', '-t', sessionName, 'status-right', ` ${RETURN_KEY} で cchub の一覧へ戻る `]);

  // mouse を on にして、ホスト端末が alt-screen で wheel を ↑/↓ に変換して
  // Claude Code (Ink) の入力履歴ナビにすり替わるのを防ぐ。tmux がマウスを掴めば
  // wheel は tmux 自身の copy-mode スクロールに行き、ホスト端末も wheel→arrow
  // 変換をやめる。web UI (tmux -CC) 側は attach 時に mouse off を明示するので
  // ここでの設定は web 側に影響しない（detach 後は元の値へ復元する）。
  const originalMouse = captureOption(sessionName, 'mouse');
  runTmux(['set-option', '-t', sessionName, 'mouse', 'on']);

  Bun.spawnSync([plan.command, ...plan.args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env,
  });

  // status-right を元へ戻す（未設定だったら継承に戻す）。
  if (originalStatusRight === null) runTmux(['set-option', '-t', sessionName, '-u', 'status-right']);
  else runTmux(['set-option', '-t', sessionName, 'status-right', originalStatusRight]);

  // mouse 設定を元へ戻す。
  if (originalMouse === null) runTmux(['set-option', '-t', sessionName, '-u', 'mouse']);
  else runTmux(['set-option', '-t', sessionName, 'mouse', originalMouse]);
}
