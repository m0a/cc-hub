# Phase 1 Data Model: CC Hub TUI

TUI は永続ストレージを持たず、サーバ応答と少数のローカル UI 状態のみを扱う。データ型は可能な限り `shared/types.ts` を再利用し、新規型は最小限に留める。

## 再利用するサーバ由来エンティティ（`shared/types.ts`）

### Session（`SessionResponse` + `PaneInfo`）
一覧の各行。
- `id: string` / `name: string`
- `agent?: AgentProvider`（`'claude' | 'codex' | ...`）— 一覧のエージェントバッジ
- `state: SessionState`
- `currentPath?: string` — 作業ディレクトリ
- `customTitle?: string` — 付与タイトル
- `theme?: SessionTheme`
- `panes: PaneInfo[]` — ペイン数 = `panes.length`
  - `PaneInfo.indicatorState?: IndicatorState` — 状態インジケータ（ペイン単位）
  - `PaneInfo.isActive` / `isDead` / `title` / `currentCommand`

### IndicatorState（`shared/types.ts`）
- `'processing' | 'waiting_input' | 'idle' | 'completed'`
- 表示マッピング: processing=◐ / waiting_input=● / idle=○ / completed=✓（色は theme と整合）
- セッション行の代表状態は、アクティブペインまたは最も注意を要するペイン（waiting_input > processing > idle）から導出する。

### SessionHistoryEntry（履歴検索応答）
履歴検索の各結果。サーバの `/history/search` 応答形に従う（実フィールドは contracts/server-api.md で確定）。
- `sessionId: string` — `POST /history/resume` の再開キー
- `projectPath` / `dirName: string` — プロジェクト（作業ディレクトリ）
- `summary` / `preview?: string` — 会話の手がかり
- `lastAccessedAt: string`
- `agent?: AgentProvider`

## TUI ローカル状態（新規・非永続）

### AppView
現在の画面。
- `'list' | 'search'`（v1）。将来 `'create'` フォームをモーダルとして重畳。

### ConnectionState
サーバ接続状態。
- `'connecting' | 'connected' | 'unauthorized' | 'server-down'`
- `server-down` 時は FR-012 の案内（起動手順）を表示。

### ListState
- `sessions: Session[]`（ポーリング結果）
- `selectedIndex: number`
- `lastUpdatedAt: number`

### SearchState
- `query: string`（デバウンス対象）
- `results: SessionHistoryEntry[]`（SSE で逐次追加）
- `streaming: boolean`
- `selectedIndex: number`

### AttachRequest（入室の内部表現、`tmux/attach.ts`）
- `sessionName: string`
- `nested: boolean`（`!!process.env.TMUX`）
- → 構築コマンド: `nested` が false なら `tmux attach -t <name>`、true なら `tmux switch-client -t <name>`（既存クライアント時）または `env -u TMUX tmux attach -t <name>`。

## 状態遷移

```text
[connecting] ──接続成功──▶ [connected:list] ──"/"──▶ [connected:search]
     │                          │  ▲                        │
     │ 認証必要&トークン発行失敗  │  └────── Esc ─────────────┘
     ▼                          │ Enter（入室）
[unauthorized]                  ▼
     ▲          ┌─ alt-screen 退出 → tmux attach/switch-client ─┐
[server-down]   └────────── detach（子プロセス終了）────────────┘ → list 再描画
```

## バリデーション/不変条件

- セッション作成名・id は既存 `SessionIdSchema` / `CreateSessionSchema`（`shared/types.ts`）に準拠（英数・`.`・`_`・`-`）。
- 入室対象はローカルセッションのみ（ピア由来は一覧に含めない／含まれても入室不可）。
- `panes.length === 0` の異常セッションは行表示するが入室不可とする。
