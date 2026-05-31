# Implementation Plan: CC Hub TUI

**Branch**: `002-cchub-tui` | **Date**: 2026-05-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-cchub-tui/spec.md`

## Summary

CC Hub のローカル専用 TUI を、既存 CLI の新サブコマンド `cchub tui` として追加する。同一マシンで稼働中の CC Hub サーバを**データ源とするクライアント**として動作し、セッション一覧(メイン)・履歴検索(サブ)・基本ライフサイクル操作を提供する。セッションへの「入室」は端末画面をネットワーク転送せず、ネイティブの `tmux attach` にハンドオフして完結させる(Web 版で複雑さの大半を占める viewport プロトコルを丸ごと不要化する)。描画は Ink(React for CLI)、型は `shared/types.ts` を再利用する。

## Technical Context

**Language/Version**: TypeScript（Bun runtime、既存ワークスペースと同一）

**Primary Dependencies**: Ink（React for CLI）、React。HTTP/SSE/WebSocket は Bun 標準 `fetch` / `WebSocket` を使用（追加依存なし）。型は `shared/types.ts` を直 import

**Storage**: 永続ストレージ無し。データは稼働中サーバから取得。認証トークンはローカルのデータディレクトリ `jwt-secret`（0600）を読んで自己発行（書き込みなし）

**Testing**: Bun test（純粋ロジックの単体: API クライアント、トークン発行、tmux コマンド構築、`$TMUX` 検知、整形/選択ロジック）。対話 TUI 部分は ink-testing-library によるレンダリング検証 + 手動確認

**Target Platform**: ローカル端末（Linux / macOS）で、CC Hub サーバが同一ホストに稼働している環境

**Project Type**: CLI/TUI（新規 `tui/` ワークスペース）が、ローカル web サービス（既存 backend）を消費するクライアント

**Performance Goals**: 一覧初期表示 < 3s（SC-001）、状態反映 < 5s（SC-002）、履歴検索の初回結果 < 2s（SC-004）

**Constraints**: ローカル限定（他ピア対象外）。端末画面のネットワーク転送をしない（ネイティブ attach で完結）。サーバ未起動時は分かりやすく案内。ゼロコンフィグ（ローカルは追加入力なし）

**Scale/Scope**: 単一ユーザ・ローカルのセッション（数個〜数十個）。v1 は一覧・入室・履歴検索・基本ライフサイクルに限定

## Constitution Check

*GATE: Phase 0 前に通過必須。Phase 1 後に再評価。*

| 原則 | 判定 | 補足 |
|------|------|------|
| **I. Test-First (TDD)【非交渉】** | ✅ 遵守 | 純粋ロジック（API クライアント / トークン発行 / tmux コマンド構築 / `$TMUX` 検知 / 整形）は Red-Green-Refactor で先にテスト。対話部は ink-testing-library。カバレッジ目標 80%。テストなしコードはマージ不可 |
| **II. Simplicity & YAGNI** | ✅ 強く整合 | 「サーバのクライアント」方式は最小解。集約・hook 状態・履歴検索ロジックを再実装せず再利用。端末も attach 委譲で viewport 再実装を回避。v1 スコープを一覧/入室/履歴/基本操作に限定（会話ビュー等は将来） |
| **III. Web-First Architecture** | ⚠️ 意図的逸脱 | 本機能はブラウザではなくローカル端末で動く。**Complexity Tracking で正当化**。Web UI は引き続き多デバイスの主経路であり、TUI は同一マシン向けの**補完的**インターフェース。原則III は【非交渉事項】ではない |
| **IV. Multi-Device Accessibility** | ◐ 部分整合 | TUI 自体は単一デバイス（ローカル）。ただしセッション永続化（tmux）と状態はサーバ側で共有され、Web の多デバイス性を損なわない（むしろ同じ実体を別フロントから見る） |
| **V. Incremental Delivery** | ✅ 強く整合 | P1/P2/P3 は独立してテスト・デプロイ可能。MVP（P1: 一覧+入室）を最優先 |

**Technology Stack 整合**: 既存スタックは React+TypeScript+Vite+Tailwind（ブラウザ）。TUI は **Ink**（React+TypeScript on Bun、ターミナル向け）を追加導入する。Bun ランタイム・React/TS 志向とは一貫しており、描画ターゲットがブラウザ→端末に変わるのみ。Complexity Tracking に記録。

**ゲート結果**: 逸脱（原則III・Ink 追加）はいずれも正当化可能 → **PASS（justified）**。未正当化の違反なし。

## Project Structure

### Documentation (this feature)

```text
specs/002-cchub-tui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output（消費するサーバ API + CLI 契約）
│   ├── server-api.md
│   └── cli.md
└── tasks.md             # /speckit-tasks で生成（本コマンドでは作らない）
```

### Source Code (repository root)

```text
tui/                              # 新規ワークスペース（backend/frontend/shared/glasses と並列）
├── package.json                  # deps: ink, react / "shared" を参照
├── tsconfig.json
└── src/
    ├── index.tsx                 # 入口: server URL + 認証解決 → <App/> を render
    ├── api/
    │   ├── client.ts             # fetch ラッパ（base http://127.0.0.1:<port>, Bearer）
    │   ├── auth.ts               # ゼロコンフィグ認証（jwt-secret からローカルトークン発行）
    │   ├── sessions.ts           # list / create / kill / resume
    │   ├── history.ts            # search(SSE) / projects / conversation / resume
    │   └── ws.ts                 # (Phase2) /ws/mux 購読: sessions-updated + hook-event
    ├── tmux/
    │   └── attach.ts             # 入室ハンドオフ（$TMUX 検知 → attach / switch-client）
    ├── components/
    │   ├── App.tsx               # view ルータ（list / search）+ キーバインド + 接続状態
    │   ├── SessionList.tsx       # ★P1: agent/state/cwd/title/pane 数
    │   ├── SessionRow.tsx
    │   ├── HistorySearch.tsx     # ★P2: クエリ入力 + ストリーミング結果
    │   ├── CreateSessionForm.tsx # P3: agent + workingDir
    │   └── StatusBar.tsx         # フッタ（キー操作・接続状態）
    ├── hooks/
    │   ├── useSessions.ts        # ポーリング（MVP）/ WS（Phase2）
    │   └── useHistorySearch.ts   # SSE 購読 + デバウンス
    └── __tests__/                # Bun test（純粋ロジック中心、TDD）

backend/src/
├── cli.ts                        # 変更: CliOptions.command に 'tui' 追加 + parse の分岐
└── commands/
    └── tui.ts                    # 新規: runTui()（cli.ts から動的 import）。tui ワークスペースの入口を起動
```

**Structure Decision**: 既存モノレポに新規 `tui/` ワークスペースを追加し、`shared/types.ts` を直 import して API レスポンス型を完全一致で再利用する。CLI 統合は `backend/src/cli.ts` の既存 lazy-import パターン（`case 'send' → import('./commands/send')` 等）に厳密に倣い、`case 'tui' → import('./commands/tui')` を1つ足す（他コマンドの起動性能に無影響）。これにより配布は単一 `cchub` バイナリの `cchub tui` サブコマンドとなり、`cchub update` で自動最新化される。

## Complexity Tracking

> Constitution Check の逸脱を正当化する。

| 逸脱 | なぜ必要か | 棄却した単純案とその理由 |
|------|-----------|------------------------|
| **原則III（Web-First）からの逸脱: 非ブラウザのローカル TUI** | ユーザ要件そのものが「cchub が動く環境で動くローカルな tmux ラッパー TUI」。端末転送が不要なローカル文脈では、ネイティブ attach により Web 版の viewport プロトコル（最大の複雑性）を完全に排除でき、忠実度も最高になる | 「Web UI のみ維持」: ローカルでブラウザを開かず素早く一覧→入室したいという本要件を満たせない。TUI は Web を**置換せず補完**するため、Web-First の核心価値（多デバイス）は維持される |
| **Ink（ターミナル React）の新規導入**（既存スタックは React+Vite+Tailwind=ブラウザ） | 端末描画には端末向けレンダラが必要。Ink は React+TS を Bun 上で使え、チームの React 知見をそのまま流用できる | 「blessed/低レベル ANSI」: React と別パラダイムで知見流用が効かず保守コスト増。「Web 技術の流用」: 端末では動作しない |
| **`tmux attach` への子プロセスハンドオフ** | 端末の完全な忠実度（マウス/コピー/TUI アプリ）をゼロ再実装で得るため | 「viewport プロトコルの TUI 再実装」: Web 版で最も重い部分の再発明であり、ローカルでは attach で代替できるため不要 |

## Testing Strategy（原則I 準拠）

- **単体（Bun test, TDD 先行）**: `api/auth.ts`（jwt-secret 読取→トークン発行）、`api/client.ts`（base URL/ヘッダ/エラー整形）、`tmux/attach.ts`（`$TMUX` 有無での `attach` vs `switch-client` / `env -u TMUX` コマンド構築）、整形・選択ロジック。
- **コンポーネント**: ink-testing-library で SessionList / HistorySearch のレンダリングとキー操作を検証。
- **手動/結合**: dev サーバ（backend=3456）に対して実セッションで一覧→入室→離脱往復、ネスト端末での入室、サーバ未起動時の案内を確認。
- カバレッジ目標 80%。対話 TUI は純粋ロジックを抽出してテスト可能性を高める。
