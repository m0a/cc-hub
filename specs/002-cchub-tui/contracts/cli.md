# Contract: `cchub tui` CLI / 操作

## コマンド

```
cchub tui [options]
```

ローカルで稼働中の CC Hub サーバに接続し、TUI を起動する。

| オプション | 説明 | 既定 |
|-----------|------|------|
| `-p, --port <port>` | 接続先サーバのポート | 5923（dev: 3456） |
| `-H, --host <host>` | 接続先ホスト | 127.0.0.1 |
| `-h, --help` | ヘルプ | — |

- `backend/src/cli.ts` の `CliOptions.command` に `'tui'` を追加し、`parseArgs` に `case 'tui'`、`runCli` に `case 'tui': const { runTui } = await import('./commands/tui'); ...` を追加（既存 `send`/`peek` と同パターン）。
- `backend/src/commands/tui.ts#runTui(options)` が `tui/` ワークスペースの入口を起動する。

## 起動時挙動

1. サーバへ疎通確認（`GET /api/auth/me` 等）。
2. 認証要なら `jwt-secret` からローカルトークン発行（`research.md` R6）。
3. 疎通不可なら `server-down` 画面（起動手順を案内）して終了コード非ゼロ。
4. 接続成功 → セッション一覧（list ビュー）を alt-screen に描画。

## キーバインド（v1 想定・確定は実装時に最終調整）

| キー | コンテキスト | 動作 |
|------|-------------|------|
| `↑/↓` or `j/k` | list / search | 選択移動 |
| `Enter` | list | 選択セッションへ入室（attach ハンドオフ） |
| `Enter` | search | 選択履歴を resume → 入室 |
| `/` | list | 履歴検索ビューへ |
| `Esc` | search | list へ戻る |
| `n` | list | 新規セッション作成（agent + workingDir） |
| `x` or `d` | list | 選択セッションを終了（確認あり） |
| `r` | list | 選択セッションを resume |
| `q` or `Ctrl+C` | list | 終了 |
| `?` | 任意 | キーヘルプ |

## 入室ハンドオフ契約（`tmux/attach.ts`）

- 非ネスト（`!process.env.TMUX`）: `tmux attach -t <name>` を stdio 継承で spawn。
- ネスト（`process.env.TMUX` あり）: `tmux switch-client -t <name>`（既存クライアント時）または `env -u TMUX tmux attach -t <name>`。
- 子プロセス起動前に Ink の raw-mode/alt-screen を解除し、終了後に再取得・再描画する。
- コマンド構築（attach vs switch-client vs env -u）は純粋関数として単体テストする。

## 終了コード

- `0`: 正常終了。
- 非ゼロ: サーバ未起動 / 認証失敗 / tmux 不在 等（メッセージ付き）。
