# Contract: 消費するサーバ API

TUI が依存する既存 CC Hub サーバのエンドポイント契約。すべて既存・実装済み。新規エンドポイントは追加しない（このフェーズではサーバ無改修が原則）。base は `http://<host>:<port>`（既定 `127.0.0.1:5923`、dev は `3456`）。認証は `research.md` R6（パスワード設定時のみ Bearer）。

## 認証

| メソッド | パス | 用途 | 備考 |
|---------|------|------|------|
| GET | `/api/auth/me` | 認証要否/トークン有効性の確認 | 401 → トークン発行を試行 |
| POST | `/api/auth` | （フォールバック）パスワードログイン | 通常は jwt-secret 自己発行で不要 |

## P1: 一覧 + 入室

| メソッド | パス | 用途 | 応答型 |
|---------|------|------|--------|
| GET | `/api/sessions` | アクティブセッション一覧（集約済み） | `SessionResponse[]`（agent/state/indicatorState/currentPath/customTitle/panes 含む） |

- 入室自体は API ではなくローカル `tmux attach -t <session.name>`（`tmux/attach.ts`）。
- 状態は `panes[].indicatorState` から行代表状態を導出。

## P2: 履歴検索 + 再開

| メソッド | パス | 用途 | 備考 |
|---------|------|------|------|
| GET | `/api/sessions/history/search?q=...` | 履歴横断検索（同期） | フォールバック |
| GET | `/api/sessions/history/search/stream?q=...` | 履歴検索（SSE 逐次） | 主経路。クエリ追従の逐次表示 |
| GET | `/api/sessions/history/projects` | プロジェクト一覧 | 任意（絞り込み用） |
| GET | `/api/sessions/history/:sessionId/conversation` | 会話取得 | 将来の詳細表示用（v1 任意） |
| POST | `/api/sessions/history/resume` | 履歴から再開（tmux セッション生成） | 再開後 attach |

## P3: ライフサイクル

| メソッド | パス | 用途 | リクエスト |
|---------|------|------|-----------|
| POST | `/api/sessions` | 新規作成 | `CreateSessionSchema`: `{ name?, workingDir?, agent?, initialPrompt? }`（v1 は agent+workingDir） |
| DELETE | `/api/sessions/:id` | 終了 | — |
| POST | `/api/sessions/:id/resume` | resume | — |

## Phase2: 状態の即時反映（WebSocket）

| 接続 | メッセージ | 用途 |
|------|-----------|------|
| `/ws/mux` | `subscribe`（client→） | 多重化購読の確立 |
| `/ws/mux` | `sessions-updated`（→client, 5s push） | 一覧の即時更新 |
| `/ws/mux` | `hook-event`（→client） | 状態フリップの即時反映 |

> v1（P1）はポーリング（`GET /api/sessions` を 2–3s）で代替し、WS は Phase2 で追加。型は `MuxClientMessage` / `MuxServerMessage`（`shared/types.ts`）。

## エラー契約

- 接続不可（ECONNREFUSED 等）→ `ConnectionState='server-down'` にし FR-012 の起動案内。
- 401 → トークン自己発行を試行、失敗で `unauthorized` 表示。
- 4xx/5xx → ユーザ向けメッセージに整形（生スタックを出さない）。
