// セッションへコマンド送信（`/compact` 等）。
// Claude Code / Codex の TUI は bracketed paste でないと確実に submit されないことがあるため、
// `cchub send --submit` と同じく ESC[200~ ... ESC[201~ + Enter で送る。

/**
 * tmux send-keys 引数列を構築（純粋関数 / テスト対象）。
 * - `-H 1b 5b 32 30 30 7e` = ESC [ 2 0 0 ~（bracketed paste 開始）
 * - `-l <text>`            = リテラル文字列
 * - `-H 1b 5b 32 30 31 7e` = ESC [ 2 0 1 ~（bracketed paste 終了）
 * - `Enter`                = 送信
 */
export function sendSubmitKeys(sessionName: string, text: string): string[][] {
  return [
    ['send-keys', '-t', sessionName, '-H', '1b', '5b', '32', '30', '30', '7e'],
    ['send-keys', '-t', sessionName, '-l', text],
    ['send-keys', '-t', sessionName, '-H', '1b', '5b', '32', '30', '31', '7e'],
    ['send-keys', '-t', sessionName, 'Enter'],
  ];
}

/** セッションのアクティブペインへ text を submit（bracketed paste + Enter）。 */
export function sendSubmit(sessionName: string, text: string): void {
  for (const args of sendSubmitKeys(sessionName, text)) {
    try {
      Bun.spawnSync(['tmux', ...args], { stdout: 'ignore', stderr: 'ignore' });
    } catch {
      // ベストエフォート
    }
  }
}
