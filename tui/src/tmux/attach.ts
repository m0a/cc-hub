// セッション入室（tmux attach への子プロセスハンドオフ）。
// コマンド構築は純粋関数（planAttach）として切り出し単体テストする。
// alt-screen の退出/復帰は呼び出し側（startTui のループ）が担う。

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

/** 子プロセスを stdio 継承で起動し、detach（終了）まで同期的に待つ。 */
export function attachSession(sessionName: string, tmuxEnv: string | undefined = process.env.TMUX): void {
  const plan = planAttach(sessionName, tmuxEnv);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (plan.unsetTmux) delete env.TMUX;

  Bun.spawnSync([plan.command, ...plan.args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env,
  });
}
