<!--
  Sync Impact Report
  ===================
  Version change: 1.6.0 → 1.7.0 (Terminal backend: tmux → herdr; local TUI client withdrawn)

  Modified sections:
  - Technology Stack: ローカルTUIクライアント(Ink + ネイティブ tmux attach ハンドオフ)の
    記述を撤回 — TUI は実装ごと削除済み(commit 8464657、specs/002-cchub-tui も不存在)。
    原則III の補完インターフェース許容そのものは維持
  - Backend Architecture: 端末多重化層を tmux から herdr(~/.config/herdr/herdr.sock 上の
    Unix socket NDJSON RPC)へ更新。セッション永続化の根拠を herdr ワークスペースの
    detach/attach に改訂
  - Session Management UI: セッション一覧の取得元を herdr `workspace.list`、
    タブ切り替えを herdr タブ(tab.focus)に更新

  Added principles: None
  Removed principles: None

  Templates requiring updates:
  - .specify/templates/plan-template.md: ✅ No changes needed (Constitution Check は原則名参照のみ)
  - .specify/templates/spec-template.md: ✅ No changes needed
  - .specify/templates/tasks-template.md: ✅ No changes needed

  Follow-up TODOs: None
  (旧 TODO「specs/002-cchub-tui/plan.md の Constitution Check 更新」は TUI 削除により不要化)
-->

# CC Hub Constitution

## Core Principles

### I. Test-First Development (TDD) 【非交渉事項】

すべての機能実装において、テスト駆動開発を厳守する。

- テストを先に書き、ユーザー承認後、テストが失敗することを確認してから実装に進む（Red-Green-Refactor）
- 単体テスト、結合テスト、E2Eテストの適切な組み合わせを維持する
- テストなしのコードはマージ不可とする
- テストカバレッジは最低80%を目標とする

**根拠**: TDDにより設計品質が向上し、リグレッションを防止できる。WebベースのターミナルアプリケーションはE2Eテストが特に重要。

### II. Simplicity & YAGNI

シンプルさを最優先し、必要になるまで機能を追加しない。

- 現在の要件を満たす最もシンプルな解決策を選択する
- 「将来必要になるかもしれない」機能は実装しない
- 抽象化は3回以上の重複が発生してから検討する
- 依存関係は最小限に保つ

**根拠**: 過度な抽象化やover-engineeringは保守性を低下させる。

### III. Web-First Architecture（補完的ローカルインターフェース許容）

Webブラウザ経由のアクセスを主たる多デバイス体験とし、すべての中核機能はWebで到達可能であり続ける。

- ターミナルエミュレーションはWebSocketベースで実装する（Web 経路）
- オフライン時の動作は考慮しない（常時接続前提）
- レスポンシブデザインで多様な画面サイズに対応する
- プログレッシブエンハンスメントよりも機能完全性を優先する

ただし、Webを置換せず補完する**ローカル/非Webインターフェース（TUI/CLI 等）を許容する**。許容条件:

- (a) Web-First の中核価値（多デバイス到達性）を損なわない（中核機能を Web から外さない）
- (b) サーバの既存データ/状態を再利用し、独自に再集約しない
- (c) 同一ホストでサーバを共有する補完手段に限る（Web の代替となる必須経路にしない）

**根拠**: 「あらゆる端末でWebアクセスさえできれば作業できる」という核心要件を主軸に維持しつつ、サーバが稼働する同一ホストでは、ネイティブ端末の忠実度や即時性を活かすローカルUIを補助的に提供できる方が実用価値が高い。補完インターフェースはWebの中核性を弱めない範囲でのみ許される。

### IV. Multi-Device Accessibility

複数デバイス・マルチセッション対応をコア機能として位置づける。

- セッション状態はサーバーサイドで永続化する
- デバイス間でのセッション引き継ぎをシームレスに行う
- 同時に複数セッションを管理・切り替え可能にする
- 認証状態は適切なトークン管理で維持する

**根拠**: PC、タブレット、スマートフォンなど異なるデバイスから同一セッションへアクセスするユースケースを実現するため。

### V. Incremental Delivery

機能は小さな単位で段階的にリリースする。

- 各ユーザーストーリーは独立してテスト・デプロイ可能であること
- MVP（Minimum Viable Product）を最優先でリリースする
- 大きな変更は機能フラグで段階的に展開する
- 各イテレーションで動作するソフトウェアを提供する

**根拠**: 早期フィードバックを得て方向修正を可能にするため。

## Technology Stack

本プロジェクトの技術選定方針を定める。

- **ランタイム**: Bun
- **フロントエンド**: React + TypeScript + Vite
- **バックエンド**: Hono (Bun runtime)
- **API通信**: Hono RPC（型安全なクライアント-サーバー通信）
- **ターミナル**: ghostty-web + WebSocket（xterm.js API互換）
- **テスティング**: Bun test（単体・結合）、Playwright（E2E）
- **スタイリング**: Tailwind CSS
- **状態管理**: React組み込み機能（useState/useContext）を優先し、必要に応じてZustand

**選定理由**: Bunによる高速な開発体験、Hono RPCによるエンドツーエンドの型安全性を重視。

### Platform Support Tiers

| Tier | プラットフォーム | サポート範囲 |
|------|-----------------|-------------|
| Tier 1 | Android (Chrome) | フル機能: ターミナル + PWA + Web Push通知 |
| Tier 1 | Desktop (Chrome/Firefox) | フル機能: ターミナル + 通知 |
| Tier 2 | iOS (Safari) | 最低限: ターミナル操作のみ、通知なし |

**理由**: iOSのWeb Push制限（PWA必須、信頼性問題）を回避し、Android/Desktopでの体験を優先。

### Notification Strategy

- **Android/Desktop**: Web Push Notification (VAPID) + Service Worker
- **iOS**: フォアグラウンド時のみWebSocket経由でアプリ内通知
- **共通**: 長時間タスク完了、エラー、セッション切断を通知対象とする

### Backend Architecture

```
Browser ◄──WebSocket──► Hono/Bun ◄──► herdr ◄──► shell/cc
```

- **ランタイム**: Bun（24時間稼働）
- **端末多重化**: herdr（`~/.config/herdr/herdr.sock` 上の Unix socket NDJSON RPC）
  - 1 CC Hub セッション = 1 herdr ワークスペース（ワークスペース > タブ > ペイン階層）
  - PTY は herdr 側が管理し、CC Hub サーバは直接保持しない
- **セッション永続化**: herdr ワークスペース
  - フロントエンド切断時も herdr 側でワークスペースを維持
  - 再接続時に既存ワークスペースにアタッチ
  - 複数セッションの同時管理に対応
- **通信**: WebSocket（リアルタイム双方向）

**理由**: herdr のワークスペース/タブ/ペイン階層と detach/attach 機構により、セッション永続化を確実に実現。多重化層を外部プロセスに分離し、CC Hub サーバ自身は PTY を直接管理しない。

### Session Management UI

```
┌─ CC Hub ──────────────────────────────────────────────┐
│ [●Session A] [○Session B] [◐Session C] [+]            │ ← タブUI
├───────────────────────────────────────────────────────┤
│                                                       │
│  ターミナル表示                                        │
│                                                       │
└───────────────────────────────────────────────────────┘
```

- **セッション一覧**: herdr `workspace.list` RPC から取得（内部DB不要）
- **タブ切り替え**: herdr タブのフォーカス切り替え（`tab.focus`）
- **状態表示**: タブの色/アイコンでセッション状態を可視化

### Claude Code State Detection

**方式**: transcript.json監視

Claude Codeのstatus lineから取得できる `transcript_path` を定期監視し、会話履歴をパースして状態を判定する。

| 状態 | 検出方法 | タブ表示 |
|-----|---------|---------|
| **working** | 最後のメッセージがassistant発話中 | ◐ 黄色 |
| **waiting_input** | AskUserQuestion等でユーザー入力待ち | ● 赤色 |
| **waiting_permission** | ツール実行の許可待ち | ● 赤色 |
| **idle** | プロンプト表示中（入力可能） | ○ 緑色 |

```typescript
// 状態検出の概念コード
const detectState = (transcript: Message[]) => {
  const last = transcript.at(-1);
  if (last?.type === 'tool_use' && last.name === 'AskUserQuestion') {
    return 'waiting_input';
  }
  if (last?.type === 'tool_use' && !last.approved) {
    return 'waiting_permission';
  }
  if (last?.type === 'assistant' && last.streaming) {
    return 'working';
  }
  return 'idle';
};
```

**制約**: Claude Code公式APIに即時状態検出がないため、ポーリング間隔（1-2秒）による遅延が発生する。将来的にWebSocket通知APIが追加されれば置き換える。

## Development Workflow

開発フローにおける必須事項を定める。

### コードレビュー
- すべてのPRはレビュー必須（セルフレビューも可）
- 憲章の原則に違反していないか確認する
- テストが含まれていることを確認する

### ブランチ戦略
- `main`ブランチは常にデプロイ可能な状態を維持
- 機能ブランチは`feature/`プレフィックスを使用
- マージ前にCIが通ることを必須とする

### コミット
- コミットメッセージは変更内容を明確に記述する
- 1コミット1機能の原則を守る

## Governance

この憲章は、他のすべての開発プラクティスに優先する。

### 改訂手順
1. 改訂提案をドキュメント化する
2. 影響を受けるテンプレート・ドキュメントを特定する
3. 改訂と依存ドキュメントの更新を同時に行う
4. バージョン番号を適切に更新する

### バージョニングポリシー
- **MAJOR**: 原則の削除・再定義など、後方互換性のない変更
- **MINOR**: 新原則の追加、既存ガイダンスの実質的拡張
- **PATCH**: 文言の明確化、誤字修正、意味を変えない改善

### コンプライアンス確認
- すべてのPR/レビューで憲章への準拠を確認する
- 複雑さの導入には正当化が必要

**Version**: 1.7.0 | **Ratified**: 2026-01-24 | **Last Amended**: 2026-07-19
