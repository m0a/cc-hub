---
description: "Task list for CC Hub TUI implementation"
---

# Tasks: CC Hub TUI

**Input**: Design documents from `/specs/002-cchub-tui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED — 憲章 原則I（Test-First / TDD）は【非交渉事項】。各実装ユニットはテスト先行（Red-Green-Refactor）、カバレッジ目標 80%。

**Organization**: タスクはユーザーストーリー単位（US1=P1, US2=P2, US3=P3）。各ストーリーは独立してテスト・デリバリ可能。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並列実行可（別ファイル・未完了依存なし）
- **[Story]**: 所属ユーザーストーリー（US1/US2/US3）。Setup/Foundational/Polish は無印
- ファイルパスを明記

## Path Conventions

新規 `tui/` ワークスペース（リポジトリ直下、`backend/frontend/shared/glasses` と並列）。`shared/types.ts` を直 import。CLI 統合は `backend/src/cli.ts` + `backend/src/commands/tui.ts`。

---

## Phase 1: Setup（プロジェクト初期化）

- [ ] T001 `tui/` ワークスペースを作成（`tui/package.json`: deps `ink`,`react` / `"shared"` 参照、`tui/tsconfig.json`）
- [ ] T002 ルート `package.json` の `workspaces` に `tui` を追加し、`dev`/`test`/`lint`/`build` のフィルタ済みスクリプトを追加（`package.json`）
- [ ] T003 [P] `tui/` の Bun test + Biome 設定を整備（`tui/` 配下、`biome.json` 継承確認）
- [ ] T004 `cchub tui` サブコマンドの骨組み: `CliOptions.command` union に `'tui'` 追加、`parseArgs` に `case 'tui'`、`runCli` に `case 'tui' → import('./commands/tui')`（`backend/src/cli.ts`）+ `runTui()` スタブ（`backend/src/commands/tui.ts`、`tui/` 入口を起動）

---

## Phase 2: Foundational（全ストーリーの前提・ブロッキング）

**⚠️ 完了まで US1〜US3 に進めない**

- [ ] T005 Ink × Bun スパイク: raw-mode 入力 → alt-screen 退出 → 子プロセス stdio 継承起動 → 復帰・再描画 を1本で検証（`tui/src/spike.tsx`）。**ゲート**: 失敗時は描画方式を再検討（research.md R3）
- [ ] T006 [P] [test] API クライアントの単体テスト（base URL 組立・Bearer ヘッダ・エラー整形）（`tui/src/api/__tests__/client.test.ts`）
- [ ] T007 API クライアント基盤を実装（`tui/src/api/client.ts`、Bun `fetch` ラッパ、host/port 既定 127.0.0.1:5923）
- [ ] T008 [P] [test] 認証解決の単体テスト（パスワード無し=素通り / `jwt-secret`→ローカルトークン発行）（`tui/src/api/__tests__/auth.test.ts`）
- [ ] T009 ゼロコンフィグ認証を実装（`tui/src/api/auth.ts`、`/api/auth/me` で要否判定、要時 `getDataDir()/jwt-secret` を読み `AuthService` でトークン自己発行）（research.md R6）
- [ ] T010 Ink App シェル（view ルータ list/search、`ConnectionState`、グローバルキーバインド）+ StatusBar（`tui/src/components/App.tsx`, `tui/src/components/StatusBar.tsx`）
- [ ] T011 入口: server URL + 認証解決 → `<App/>` render、`server-down` 画面で起動案内（FR-012）（`tui/src/index.tsx`）

---

## Phase 3: User Story 1 — セッション一覧 + 入室（P1）🎯 MVP

**Goal**: ローカルの稼働セッションを状態付きで一覧し、選択して入室・離脱で一覧復帰できる。

**Independent Test**: サーバ稼働下で起動 → 一覧に agent/state/cwd/title/pane 数が出る → `Enter` で入室 → detach で一覧復帰（内容保持）。ネスト端末でも入室成功。

- [ ] T012 [P] [US1] [test] 行導出ロジックの単体テスト（代表 `indicatorState` 選択、pane 数、agent バッジ）+ `SessionList` の render/空状態テスト（ink-testing-library）（`tui/src/components/__tests__/sessionRow.test.ts`, `tui/src/components/__tests__/SessionList.test.tsx`）
- [ ] T013 [P] [US1] [test] attach コマンド構築の単体テスト（`$TMUX` 無→`attach` / 有→`switch-client` or `env -u TMUX attach`）（`tui/src/tmux/__tests__/attach.test.ts`）
- [ ] T014 [US1] セッション一覧 API（`getSessions()` → `SessionResponse[]`）（`tui/src/api/sessions.ts`）
- [ ] T015 [US1] `useSessions` フック（`GET /api/sessions` を 2–3s ポーリング、選択 index 保持）（`tui/src/hooks/useSessions.ts`）
- [ ] T016 [US1] 行導出ロジック + `SessionRow`（`tui/src/components/SessionRow.tsx`）
- [ ] T017 [US1] `SessionList`（描画・選択移動・空状態 FR-015）（`tui/src/components/SessionList.tsx`）
- [ ] T018 [US1] 入室ハンドオフ（alt-screen 退出 → `tmux attach` 子プロセス、`$TMUX` フォールバック、復帰・再描画。コマンド構築は純粋関数）（`tui/src/tmux/attach.ts`）
- [ ] T019 [US1] list ビューを App へ結線（`Enter`→入室、復帰時に一覧再取得）（`tui/src/components/App.tsx`）
- [ ] T020 [US1] 手動受け入れ確認: SC-001/002/003/005/007・ネスト入室（`specs/002-cchub-tui/quickstart.md` 手順）

**Checkpoint**: ここまでで MVP として単体デリバリ可能。

---

## Phase 4: User Story 2 — 履歴検索 + 再開（P2）

**Goal**: 過去セッションを横断検索し、結果から resume して入室できる。

**Independent Test**: `/` で検索 → キーワードで逐次結果 → `Enter` で resume → 入室。該当なしは空状態。

- [ ] T021 [P] [US2] [test] SSE 結果パース/重複排除 + 入力デバウンスの単体テスト + `HistorySearch` の render/空状態テスト（ink-testing-library）（`tui/src/hooks/__tests__/historySearch.test.ts`, `tui/src/components/__tests__/HistorySearch.test.tsx`）
- [ ] T022 [US2] 履歴 API（`searchStream()` SSE / `resume()`）（`tui/src/api/history.ts`）。**着手前に M1**: `backend/src/routes/sessions.ts` の `history/search` 応答スキーマを確認し `data-model.md` の `SessionHistoryEntry` を確定値に更新
- [ ] T023 [US2] `useHistorySearch` フック（デバウンス + SSE 購読・逐次追加）（`tui/src/hooks/useHistorySearch.ts`）
- [ ] T024 [US2] `HistorySearch` コンポーネント（入力 + ストリーミング結果 + 空状態）（`tui/src/components/HistorySearch.tsx`）
- [ ] T025 [US2] search ビューを App へ結線（`/`遷移・`Esc`戻る・`Enter`→resume→入室）（`tui/src/components/App.tsx`）
- [ ] T026 [US2] 手動受け入れ確認: SC-004・該当なし（`specs/002-cchub-tui/quickstart.md` 手順）

**Checkpoint**: US1 と独立して検証可能。

---

## Phase 5: User Story 3 — ライフサイクル操作（P3）

**Goal**: 一覧から新規作成（agent+workingDir）・終了・resume を行える。

**Independent Test**: `n` で作成 → 一覧に出現。`x` で終了 → 消える。`r` で resume。

- [ ] T027 [P] [US3] [test] 作成ペイロードの単体テスト（`CreateSessionSchema` 準拠: name/workingDir/agent）（`tui/src/api/__tests__/sessions.create.test.ts`）
- [ ] T028 [US3] セッション操作 API（`createSession()`/`killSession()`/`resumeSession()`）（`tui/src/api/sessions.ts` を拡張）
- [ ] T029 [US3] `CreateSessionForm`（agent 選択 + workingDir 入力）（`tui/src/components/CreateSessionForm.tsx`）
- [ ] T030 [US3] list アクションを結線（`n`=作成・`x`=終了(確認)・`r`=resume）（`tui/src/components/SessionList.tsx` / `App.tsx`）
- [ ] T031 [US3] 手動受け入れ確認: 作成/終了/resume が一覧へ反映（`specs/002-cchub-tui/quickstart.md` 手順）

---

## Phase 6: Polish & Cross-Cutting

- [ ] T032 [P] キーヘルプ overlay（`?`）（`tui/src/components/Help.tsx`）
- [ ] T033 [P] エラー整形/接続状態 UX の一貫性（4xx/5xx メッセージ化・再接続・`unauthorized` 表示）（`tui/src/api/client.ts`）
- [ ] T034 [P] `tui/README.md` 作成 + `cchub tui` を CLAUDE.md の CLI Commands 節に追記（`tui/README.md`, `CLAUDE.md`）
- [ ] T035 カバレッジ確認 ≥80%（純粋ロジック + 各コンポーネントの最低1 render テスト: SessionList/HistorySearch/App）（`bun run --filter tui test --coverage`、憲章 原則I）
- [ ] T036 `build:binary` に `cchub tui` が含まれ起動することを確認（`scripts/build.sh`）

---

## Deferred（v1 スコープ外・将来）

- WS 購読（`/ws/mux` `sessions-updated` + `hook-event`）による状態即時反映（`tui/src/api/ws.ts`、Phase2）
- 会話ビュー / ファイル変更表示 / ダッシュボード
- セッション作成の高度オプション（initialPrompt 送信 等）

---

## Dependencies（ストーリー完了順）

```text
Setup(T001-T004) → Foundational(T005-T011) → US1(T012-T020) → US2(T021-T026) → US3(T027-T031) → Polish(T032-T036)
```

- **US1/US2/US3 は Foundational 完了後は概ね独立**。ただし各ストーリーの結線タスク（T019/T025/T030）は `App.tsx`/`SessionList.tsx` を共有するため、その3つは逐次。
- 各ストーリー内の API/hook/component は別ファイルなら [P] 並列可。
- テストタスク（T006/T008/T012/T013/T021/T027）は対応実装の直前に [P] で先行（TDD）。

## Parallel Execution 例

- Foundational: `T006`(client test) と `T008`(auth test) を並列 → それぞれ実装 `T007`/`T009`。
- US1: `T012`(row test) と `T013`(attach test) を並列着手 → 実装 `T016`/`T018` へ。
- Polish: `T032`/`T033`/`T034` は別ファイルで並列。

## Implementation Strategy

1. **MVP = Phase 1 + 2 + 3（US1）**。これだけで「ローカルのセッションを見て・入る」が成立し、単体でデリバリ可能。
2. 以降 US2 → US3 を増分追加（各 Checkpoint で動作するソフトウェアを維持、憲章 原則V）。
3. Phase 6 で仕上げ。WS 即時反映等は v1 後の拡張。

## Summary

- **総タスク数**: 36（+ Deferred）
- **内訳**: Setup 4 / Foundational 7 / US1 9 / US2 6 / US3 5 / Polish 5
- **テストタスク**: 6（TDD 先行、憲章 原則I。UI は SessionList/HistorySearch/App の render テストを含む）
- **MVP スコープ**: Phase 1–3（T001–T020）
- **並列機会**: 各フェーズのテスト/別ファイル実装、Polish の独立タスク
