# CC Hub

Claude Codeセッションをリモート管理するWebベースのターミナルマネージャー。タブレットやスマートフォンからClaude Codeを操作できます。

## 機能

- **マルチセッション管理** - 複数のClaude Codeセッションを同時に実行・切り替え
- **タブレット最適化UI** - 分割レイアウト、カスタムソフトキーボード
- **ファイルビューア** - シンタックスハイライト付きコード表示、画像プレビュー
- **変更追跡** - Claude Codeによるファイル編集の差分表示
- **TLS対応** - 自己署名証明書、Tailscale証明書のサポート

## 必要環境

- [Bun](https://bun.sh/) 1.0+
- [tmux](https://github.com/tmux/tmux) 3.0+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

## セットアップ

```bash
# 依存関係のインストール
bun install

# 開発サーバー起動
bun run dev
```

ブラウザで http://localhost:5173 を開きます（開発モード）。

## 本番ビルド

```bash
# ビルド
bun run build

# サーバー起動（フロントエンドを同梱）
cd backend && bun run start
```

シングルバイナリとしてビルドする場合：

```bash
bun run build:binary
./dist/cchub
```

## 設定

環境変数で設定を変更できます：

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `PORT` | 3000 | サーバーポート |
| `HOST` | 0.0.0.0 | バインドアドレス |
| `TLS` | - | `1`で自己署名証明書、`tailscale`でTailscale証明書 |
| `TLS_CERT` | - | カスタム証明書パス |
| `TLS_KEY` | - | カスタム秘密鍵パス |

### Tailscale HTTPS

Tailscaleネットワーク内でHTTPSを使用する場合：

```bash
# 証明書生成を許可（初回のみ）
sudo tailscale set --operator=$USER

# Tailscale証明書で起動
TLS=tailscale bun run dev:backend
```

## 使い方

1. ブラウザでCC Hubを開く
2. 「新規セッション」でClaude Codeセッションを作成
3. ターミナルでClaude Codeを操作
4. ファイルアイコンでファイルビューアを開く

### タブレットモード

画面幅640px以上、高さ500px以上で自動的にタブレットレイアウトに切り替わります：
- 左: ターミナル
- 右上: セッション一覧
- 右下: カスタムキーボード

### キーボード機能

- **長押し** - 数字キーで記号入力（1→!, 2→@など）
- **あ** - 日本語入力モードに切り替え
- **📁** - 画像アップロード（パスをターミナルに挿入）
- **🔗** - ターミナル内のURL一覧を表示

## 開発

```bash
# フロントエンドのみ
bun run dev:frontend

# バックエンドのみ
bun run dev:backend

# テスト
bun run test

# リント
bun run lint
```

## 技術スタック

- **Backend**: Bun, Hono, WebSocket
- **Frontend**: React 19, Vite, Tailwind CSS v4, xterm.js
- **Terminal**: tmux, PTY

## ライセンス

MIT
