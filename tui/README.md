# CC Hub TUI

CC Hub のローカル専用ターミナル UI（`cchub tui`）。稼働中の CC Hub サーバに接続し、
セッション一覧・入室・履歴検索・基本ライフサイクル操作をターミナルから行う。

## 特徴

- アクティブな tmux セッションを状態（処理中 / 入力待ち / アイドル / 完了）・エージェント・
  作業ディレクトリ・ペイン数付きで一覧
- 選択して Enter で**ネイティブ `tmux attach`** に入室（端末転送なし、detach で一覧復帰）
- 履歴検索（SSE 逐次表示）→ resume → 入室
- 新規作成 / 終了（確認あり）/ 再開
- ローカルのみ（他ピアは対象外）。HTTPS（Tailscale 証明書）の localhost は TLS 検証をスキップ
- 認証はゼロコンフィグ（パスワード設定時は data-dir の `jwt-secret` からローカルトークンを自己発行）

## 前提

実ターミナル（raw mode 対応）+ 同一ホストで稼働中の CC Hub サーバ + tmux。
パイプ／ラッパ（RTK 等）経由では raw mode が無く起動できない。

## 起動

```bash
cchub tui            # 本番サーバ (5923) に接続
cchub tui -p 3456    # dev サーバに接続
cchub tui --popup    # tmux display-popup 用ワンショットモード（下記）
bun run dev:tui      # 開発（ソースを直接実行、既定 5923）
```

## popup モード（attach 中のセッション切替）

`--popup` は tmux の `display-popup` から呼ばれる前提の単発モード。alt-screen を使わず、
Enter で `tmux switch-client` してそのまま終了する（popup も自動で閉じる）。

- **F11**（prefix 不要）: 左端 50col × 全高の popup サイドバーとしてセッション一覧を表示。
  バインドは `CCHUB_TMUX_CONFIG` に同梱され、サーバ起動時に自動 source される
  （`backend/src/services/tmux.ts`）
- **F12**（prefix 不要）: detach して cchub TUI の一覧へ戻る
- **status-bar ボタン**: cchub TUI 経由で attach 中、status-right に `≡ cchub` の
  クリック可能ボタンを表示。クリックで F11 と同じ popup が開く（`src/tmux/attach.ts`）

popup バインドは `cchub` バイナリを PATH 経由で呼び出すため、`cchub update` 適用済みの
ホストでのみ有効。

## キーバインド

| キー | 動作 |
|------|------|
| ↑↓ / j k | 選択移動 |
| Enter | 入室（tmux attach） |
| n | 新規作成（agent を Tab で切替 + 作業ディレクトリ） |
| x / d | 終了（y / n 確認） |
| r | 再開 |
| / | 履歴検索 |
| ? | ヘルプ |
| q / Ctrl-C | 終了 |
| F11（入室中） | popup サイドバーでセッション切替（prefix 不要） |
| F12（入室中） | 一覧へ戻る（prefix 不要） |

## 構成

- `src/api/` — サーバ API クライアント（`client` / `auth` / `sessions` / `history`）
- `src/components/` — Ink コンポーネント（`Root` / `App` / `SessionList` / `HistorySearch` / `CreateSessionForm` 等）
- `src/hooks/` — `useSessions` / `useHistorySearch`
- `src/tmux/attach.ts` — 入室ハンドオフ（`$TMUX` ネスト対応）

型は `shared/types.ts` を再利用。CLI 統合は `backend/src/cli.ts` + `backend/src/commands/tui.ts`
（`bun build --compile` で単一バイナリ `cchub` に同梱）。
