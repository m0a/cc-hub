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

/**
 * 入室中に表示する status-right 文字列（純粋関数）。
 * `#[range=user|sessions]` でクリック可能領域を定義する。CCHUB_TMUX_CONFIG 側の
 * `MouseDown1Status` バインドが mouse_status_range='sessions' を検知して popup を開く。
 * 反転表示でボタンであることを明示し、F12 ヒントも併記する。
 *
 * 先頭に `#{@cchub_state}` を出す。これは cc-hub のセッション一覧処理が
 * `tmux set-option -t <session> @cchub_state <dot>` で流し込むエージェント状態ドット
 * （🟡=作業中 / 🔴=入力待ち / 🔵=完了 / 🟢=アイドル）で、herdr 風に「状態が一目でわかる」。
 * 未設定なら何も出さない（`#{?...}` で条件付き）。
 */
export function attachStatusRight(returnKey: string = RETURN_KEY): string {
  return `#{?#{@cchub_state},#{@cchub_state} ,}#[range=user|sessions,reverse] ≡ cchub #[norange,default]  ${returnKey} で一覧へ戻る `;
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

/**
 * popup モード用に流す tmux コマンド列（純粋関数）:
 *   preAttachCommands（サイズ追従 + 戻りキー）+ `switch-client -t <name>`。
 * 順序が大事。switch-client が呼ばれた瞬間に popup は閉じる（= 呼出元プロセスが
 * 子の終了で消える）ので、事前 set-option は switch-client より前に出すこと。
 */
export function planSwitchClient(sessionName: string): string[][] {
  return [...preAttachCommands(sessionName), ['switch-client', '-t', sessionName]];
}

/**
 * popup モード用: 既存の tmux クライアントを `sessionName` に切替える。
 * `display-popup` の中から呼ばれる想定で、`switch-client` 完了と同時に popup は
 * 閉じる（呼出側プロセス＝popupコマンドが終了する）。
 *
 * 戻り値は最後の tmux コマンド（switch-client）の exit code（成功=0）。
 */
export function switchClient(sessionName: string): number {
  // 既定レイアウト一貫性: popup 経由の切替でも切替え先にサイドバーを生やす。
  if (sidebarAutoEnabled()) ensureSidebar(sessionName);
  const plan = planSwitchClient(sessionName);
  let lastCode = 0;
  for (const args of plan) {
    try {
      const proc = Bun.spawnSync(['tmux', ...args], { stdout: 'pipe', stderr: 'pipe' });
      lastCode = proc.exitCode ?? 1;
    } catch {
      lastCode = 1;
    }
  }
  return lastCode;
}

/** 常時表示サイドバーの既定幅（桁）。F10 バインドと provision で共有する。 */
export const SIDEBAR_WIDTH = 34;

/** サイドバーとして開くペインを起動するコマンド文字列（tmux split-window に渡す）。 */
export const SIDEBAR_SPAWN_CMD = 'cchub tui --sidebar';

/**
 * `switchClientWithSidebar` が発行する split-window 引数（純粋関数）。
 * `-h -b`（左に横分割）+ `-l <width>`（幅固定）+ `-d`（フォーカスは切替え先の作業ペインに残す）。
 */
export function sidebarSplitArgs(
  targetSession: string,
  width: number = SIDEBAR_WIDTH,
  cmd: string = SIDEBAR_SPAWN_CMD,
): string[] {
  return ['split-window', '-h', '-b', '-l', String(width), '-d', '-t', targetSession, cmd];
}

/** 対象セッションに既にサイドバーペイン（@cchub_sidebar=1）があるか。 */
export function sessionHasSidebar(targetSession: string): boolean {
  try {
    const proc = Bun.spawnSync(['tmux', 'list-panes', '-t', targetSession, '-F', '#{@cchub_sidebar}'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const text = proc.stdout ? new TextDecoder().decode(proc.stdout) : '';
    return text.split('\n').some((line) => line.trim() === '1');
  } catch {
    return false;
  }
}

/**
 * サイドバーモードの起動時に自ペインを整える（$TMUX_PANE 経由で現在ペインに適用）:
 * - `@cchub_sidebar 1`: 重複作成防止・provision 検出用のマーカー
 * - `remain-on-exit off`: グローバルは on だが、サイドバーは終了時にペインを消したい
 */
export function markSidebarPane(): void {
  runTmux(['set-option', '-p', '@cchub_sidebar', '1']);
  runTmux(['set-option', '-p', 'remain-on-exit', 'off']);
}

/** サイドバーの終了時に自ペインを閉じる（remain-on-exit を自ペインで off 済み）。 */
export function closeSidebarPane(): void {
  runTmux(['kill-pane']);
}

/**
 * サイドバーからのセッション切替え。切替え先にサイドバーが無ければ先に生やしてから
 * `switch-client` する（= どのセッションへ行っても左に一覧が居る＝常駐に見える）。
 * 自分のペインは残るので呼出元プロセスは終了しない（index.ts 側でループ継続）。
 */
export function switchClientWithSidebar(targetSession: string, width: number = SIDEBAR_WIDTH): void {
  if (!sessionHasSidebar(targetSession)) {
    runTmux(sidebarSplitArgs(targetSession, width));
  }
  runTmux(['switch-client', '-t', targetSession]);
}

/**
 * 入室時のサイドバー自動表示の有効/無効。既定は有効（herdr 風の「常に左に一覧」レイアウト）。
 * `CCHUB_TUI_SIDEBAR=0|off|false` で無効化できる。
 */
export function sidebarAutoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.CCHUB_TUI_SIDEBAR ?? '').trim().toLowerCase();
  return v !== '0' && v !== 'off' && v !== 'false';
}

/** 対象セッションにサイドバーが無ければ生やす（`-d` でフォーカスは作業ペインに残す）。 */
export function ensureSidebar(sessionName: string, width: number = SIDEBAR_WIDTH): void {
  if (sessionHasSidebar(sessionName)) return;
  runTmux(sidebarSplitArgs(sessionName, width));
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

  // 入室中は status バーに「≡ cchub」ボタン + 戻り方ヒントを表示（クリックで popup）。
  // 元の値は退避して detach 後に復帰する。
  const originalStatusRight = captureOption(sessionName, 'status-right');
  runTmux(['set-option', '-t', sessionName, 'status-right', attachStatusRight()]);

  // mouse を on にして、ホスト端末が alt-screen で wheel を ↑/↓ に変換して
  // Claude Code (Ink) の入力履歴ナビにすり替わるのを防ぐ。tmux がマウスを掴めば
  // wheel は tmux 自身の copy-mode スクロールに行き、ホスト端末も wheel→arrow
  // 変換をやめる。web UI (tmux -CC) 側は attach 時に mouse off を明示するので
  // ここでの設定は web 側に影響しない（detach 後は元の値へ復元する）。
  const originalMouse = captureOption(sessionName, 'mouse');
  runTmux(['set-option', '-t', sessionName, 'mouse', 'on']);

  // herdr 風の既定レイアウト: 入室時に左サイドバー（セッション一覧）を自動で開く。
  // 既にあれば二重に開かない。フォーカスは作業ペインに残る（-d）。CCHUB_TUI_SIDEBAR=0 で無効。
  if (sidebarAutoEnabled()) ensureSidebar(sessionName);

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
