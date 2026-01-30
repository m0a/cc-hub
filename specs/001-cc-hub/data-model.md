# Data Model: CC Hub

**Date**: 2026-01-24
**Branch**: `001-cc-hub`

## Entities

### User

ユーザー認証情報を管理するエンティティ。ファイルシステムに保存。

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | string | ユーザー識別子 | UUID v4 |
| username | string | ログイン名 | 一意、3-32文字、英数字 |
| passwordHash | string | パスワードハッシュ | bcrypt |
| createdAt | string | 作成日時 | ISO 8601 |

### Session

ターミナルセッションを管理するエンティティ。tmuxから動的に取得。

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | string | セッション識別子 | tmuxセッション名 |
| name | string | 表示名 | 任意 |
| createdAt | string | 作成日時 | tmux session_created |
| lastAccessedAt | string | 最終アクセス日時 | アプリ側で管理 |
| state | SessionState | Claude Code状態 | enum |
| ownerId | string | 所有者ユーザーID | User.idへの参照 |

### SessionState (Enum)

| Value | Description | Tab Color |
|-------|-------------|-----------|
| idle | プロンプト表示中（入力可能） | 緑 |
| working | 処理中 | 黄 |
| waiting_input | ユーザー入力待ち | 赤 |
| waiting_permission | ツール実行許可待ち | 赤 |
| disconnected | 切断中 | グレー |

### PushSubscription

Web Push通知のサブスクリプション情報。ファイルシステムに保存。

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| id | string | サブスクリプションID | UUID v4 |
| userId | string | ユーザーID | User.idへの参照 |
| endpoint | string | Push エンドポイント | URL |
| keys | object | 暗号化キー | { p256dh, auth } |
| createdAt | string | 登録日時 | ISO 8601 |

## Relationships

```
User (1) ──────< (N) Session
  └──────< (N) PushSubscription
```

- 1人のユーザーは複数のセッションを持てる
- 1人のユーザーは複数のデバイスでPush通知を登録できる

## State Transitions

### Session State Machine

```
                    ┌─────────────┐
                    │ disconnected│
                    └──────┬──────┘
                           │ connect
                           ▼
┌─────────┐  execute   ┌─────────┐  complete   ┌─────────┐
│  idle   │ ──────────>│ working │ ───────────>│  idle   │
└─────────┘            └────┬────┘             └─────────┘
     ▲                      │
     │                      │ ask question / need permission
     │                      ▼
     │              ┌───────────────────┐
     │              │ waiting_input /   │
     └──────────────│ waiting_permission│
         respond    └───────────────────┘
```

## Storage Strategy

### ファイルシステム構造

```
~/.cc-hub/
├── users.json           # ユーザー情報（暗号化推奨）
├── subscriptions.json   # Push通知サブスクリプション
└── sessions/            # セッションメタデータ（将来拡張用）
    └── {userId}/
        └── {sessionId}.json
```

### tmuxから取得する情報

```bash
# セッション一覧
tmux list-sessions -F "#{session_name}:#{session_created}:#{session_attached}"

# セッション情報
tmux display-message -p -t {sessionName} "#{session_name}"
```

## TypeScript Types

```typescript
// shared/types.ts

export type SessionState =
  | 'idle'
  | 'working'
  | 'waiting_input'
  | 'waiting_permission'
  | 'disconnected';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
  state: SessionState;
  ownerId: string;
}

export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: string;
}

// API Response types
export interface SessionListResponse {
  sessions: Session[];
}

export interface SessionDetailResponse {
  session: Session;
}

export interface AuthResponse {
  token: string;
  user: Omit<User, 'passwordHash'>;
}
```
