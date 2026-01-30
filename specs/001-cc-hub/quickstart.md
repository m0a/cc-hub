# Quickstart: CC Hub

## 前提条件

- Bun v1.3.5以上
- tmux
- Claude Code（インストール・認証済み）
- Tailscale VPN内のネットワーク

## セットアップ

### 1. リポジトリクローン

```bash
git clone <repository-url>
cd cc-hub
```

### 2. 依存関係インストール

```bash
bun install
```

### 3. 環境変数設定

```bash
cp .env.example .env
```

`.env` を編集：

```env
# 認証
JWT_SECRET=your-secret-key-here

# VAPID Keys (生成: bunx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=your@email.com

# サーバー
PORT=3000
HOST=0.0.0.0
```

### 4. 初期ユーザー作成

```bash
bun run setup
```

プロンプトに従ってユーザー名とパスワードを入力。

## 開発

### 開発サーバー起動

```bash
# バックエンド
bun run dev:backend

# フロントエンド（別ターミナル）
bun run dev:frontend

# または両方同時に
bun run dev
```

### テスト実行

```bash
# 単体テスト
bun test

# E2Eテスト
bun run test:e2e

# カバレッジ
bun test --coverage
```

## 本番デプロイ

### ビルド

```bash
bun run build
```

### 起動

```bash
bun run start
```

### Tailscale HTTPS設定

```bash
# Tailscale Serveでポート公開
tailscale serve https / http://localhost:3000

# 確認
tailscale serve status
```

## 使い方

### 1. ログイン

ブラウザで `https://<your-machine>.ts.net/` にアクセスし、ログイン。

### 2. セッション作成

「+」ボタンをクリックして新規セッション作成。

### 3. ターミナル操作

ターミナルでコマンドを入力。Claude Codeを起動するには：

```bash
claude
```

### 4. セッション切り替え

タブをクリックしてセッション間を移動。

### 5. 通知設定（Android/Desktop）

ブラウザの通知許可を有効にすると、Claude Codeの入力待ちをプッシュ通知で受け取れる。

## トラブルシューティング

### tmuxセッションが見つからない

```bash
# tmuxサーバーが起動しているか確認
tmux list-sessions

# 起動していない場合
tmux new-session -d -s default
```

### WebSocket接続エラー

- Tailscale VPN内にいることを確認
- ファイアウォール設定を確認

### 状態が更新されない

- Claude Codeのtranscriptファイルのパーミッションを確認
- `~/.claude/projects/` ディレクトリが存在することを確認
