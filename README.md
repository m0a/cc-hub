# CC Hub

Claude Codeセッションをリモート管理するWebベースのターミナルマネージャー。タブレットやスマートフォンからClaude Codeを操作できます。

## 機能

- **マルチセッション管理** - 複数のClaude Codeセッションを同時に実行・切り替え
- **タブレット最適化UI** - 分割レイアウト、カスタムソフトキーボード
- **ファイルビューア** - シンタックスハイライト付きコード表示、画像プレビュー
- **変更追跡** - Claude Codeによるファイル編集の差分表示
- **Tailscale連携** - Tailscale証明書による安全なHTTPS接続
- **自動更新** - GitHub Releasesからの自動アップデート
- **systemd連携** - サービス登録・自動再起動
- **ダッシュボード** - 使用量リミット表示、日別統計、コスト推定
- **セッション履歴** - 過去のClaude Codeセッション閲覧・再開
- **会話ビューア** - Markdownレンダリング、画像表示対応

## 必要環境

- [Tailscale](https://tailscale.com/) - 必須（HTTPS証明書に使用）
- [tmux](https://github.com/tmux/tmux) 3.0+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Bun](https://bun.sh/) 1.0+ - 開発時のみ

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

## コマンド

```bash
# サーバー起動
cchub                        # ポート5923で起動
cchub -p 8080                # ポート指定
cchub -P mypassword          # パスワード付きで起動

# systemdサービス登録（自動再起動・自動更新）
cchub setup -P mypassword

# 更新
cchub update                 # 最新版に更新
cchub update --check         # 更新確認のみ

# 状態確認
cchub status
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-p, --port` | ポート番号 | 5923 |
| `-H, --host` | バインドアドレス | 0.0.0.0 |
| `-P, --password` | 認証パスワード | なし |
| `-h, --help` | ヘルプ表示 | - |
| `-v, --version` | バージョン表示 | - |

### Tailscale設定

初回のみ証明書生成を許可する設定が必要です：

```bash
sudo tailscale set --operator=$USER
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

### ダッシュボード

「Dashboard」タブで以下の情報を確認できます：

- **使用量リミット** - 5時間/7日サイクルの使用率、リセットまでの時間
- **リミット到達予測** - 現在のペースでリミットに到達する時間の予測
- **日別統計** - メッセージ数・セッション数の推移グラフ
- **モデル使用量** - Opus/Sonnetのトークン使用量比較
- **コスト推定** - API使用料金の概算

### セッション履歴

「履歴」タブで過去のClaude Codeセッションを閲覧できます：

- プロジェクト別にグループ化
- 会話内容の表示（Markdown対応）
- セッションの再開（`claude -r`で続きから）

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
