# Tasks: CC Hub

**Input**: Design documents from `/specs/001-cc-hub/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: TDD必須（Constitution原則I: Test-First Development）- テストタスクを含む

**Organization**: タスクはユーザーストーリー単位で整理され、独立した実装・テストが可能

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並列実行可能（異なるファイル、依存関係なし）
- **[Story]**: 所属ユーザーストーリー (US1, US2, US3, US4)
- ファイルパスは説明に含める

## Path Conventions

- **Backend**: `backend/src/`, `backend/tests/`
- **Frontend**: `frontend/src/`, `frontend/tests/`
- **Shared**: `shared/`

---

## Phase 1: Setup (プロジェクト初期化)

**Purpose**: プロジェクト構造の作成と基本的なセットアップ

- [x] T001 Create project directory structure per plan.md (backend/, frontend/, shared/)
- [x] T002 Initialize Bun workspace with package.json in root
- [x] T003 [P] Initialize backend with Hono, Zod dependencies in backend/package.json
- [x] T004 [P] Initialize frontend with React, Vite, ghostty-web dependencies in frontend/package.json
- [x] T005 [P] Create shared types package in shared/package.json
- [x] T006 [P] Configure TypeScript for backend in backend/tsconfig.json
- [x] T007 [P] Configure TypeScript for frontend in frontend/tsconfig.json
- [x] T008 [P] Configure TypeScript for shared in shared/tsconfig.json
- [x] T009 [P] Configure Tailwind CSS in frontend/tailwind.config.js and frontend/src/index.css
- [x] T010 [P] Setup Playwright for E2E tests in frontend/playwright.config.ts
- [x] T011 Create .env.example with JWT_SECRET, VAPID keys, PORT, HOST

---

## Phase 2: Foundational (基盤インフラ)

**Purpose**: 全ユーザーストーリーに必要なコアインフラ

**⚠️ CRITICAL**: このフェーズが完了するまでユーザーストーリーの実装は開始不可

### Shared Types

- [x] T012 Define User, Session, SessionState types in shared/types.ts
- [x] T013 [P] Define API response types (AuthResponse, SessionResponse, ErrorResponse) in shared/types.ts
- [x] T014 [P] Define validation schemas (LoginSchema, RegisterSchema, CreateSessionSchema) in shared/types.ts

### Backend Tests (TDD: テストを先に書く)

- [x] T015 [P] Write unit tests for auth service in backend/tests/unit/auth.test.ts
- [x] T016 [P] Write unit tests for tmux service in backend/tests/unit/tmux.test.ts

### Backend Implementation

- [x] T017 Implement auth service (password hash with bcrypt, JWT generation) in backend/src/services/auth.ts
- [x] T018 Implement tmux service (list-sessions, new-session, attach, kill) in backend/src/services/tmux.ts
- [x] T019 [P] Implement user storage utilities in backend/src/utils/storage.ts (~/.cc-hub/users.json)
- [x] T020 Implement auth middleware for JWT validation in backend/src/middleware/auth.ts
- [x] T021 Implement auth routes (POST /login, /register, /logout) in backend/src/routes/auth.ts
- [x] T022 Create Hono app entry point with routes in backend/src/index.ts
- [x] T023 Write integration tests for auth routes in backend/tests/integration/auth.test.ts

### Frontend Implementation

- [x] T024 [P] Create React app entry point in frontend/src/main.tsx
- [x] T025 [P] Create Hono RPC client in frontend/src/services/api.ts
- [x] T026 [P] Implement useAuth hook in frontend/src/hooks/useAuth.ts
- [x] T027 Implement LoginForm component in frontend/src/components/LoginForm.tsx
- [x] T028 Create App component with auth routing in frontend/src/App.tsx

**Checkpoint**: 認証基盤完了 - ログイン/ログアウトが動作する状態

---

## Phase 3: User Story 1 - ターミナルアクセス (Priority: P1) 🎯 MVP

**Goal**: Webブラウザからターミナルにアクセスしてコマンドを実行できる

**Independent Test**: ブラウザでCC Hubにアクセスし、`ls`コマンドを実行してディレクトリ一覧が表示される

### Tests for User Story 1

> **NOTE: これらのテストを先に書き、実装前に失敗することを確認**

- [x] T029 [P] [US1] Write integration test for WebSocket terminal connection in backend/tests/integration/terminal.test.ts
- [x] T030 [P] [US1] Write E2E test for terminal command execution in frontend/tests/e2e/terminal.spec.ts

### Implementation for User Story 1

- [x] T031 [US1] Implement WebSocket terminal route with Bun.spawn({ terminal }) in backend/src/routes/terminal.ts
- [x] T032 [US1] Add terminal WebSocket and websocket export to Hono app in backend/src/index.ts
- [x] T033 [US1] Implement useTerminal hook for WebSocket connection in frontend/src/hooks/useTerminal.ts
- [x] T034 [US1] Initialize ghostty-web (await init()) in frontend/src/main.tsx
- [x] T035 [US1] Implement Terminal component with ghostty-web in frontend/src/components/Terminal.tsx
- [x] T036 [US1] Create main terminal page layout in frontend/src/pages/TerminalPage.tsx
- [x] T037 [US1] Add terminal page route to App component in frontend/src/App.tsx
- [x] T038 [US1] Handle terminal resize events (ResizeObserver + WebSocket) in frontend/src/components/Terminal.tsx
- [x] T039 [US1] Implement reconnection on browser reload (tmux attach) in frontend/src/hooks/useTerminal.ts

**Checkpoint**: ターミナルアクセスが動作 - コマンド実行とClaude Code起動が可能 - MVP完成

---

## Phase 4: User Story 2 - セッション永続化 (Priority: P2)

**Goal**: ブラウザを閉じてもセッションが維持され、別デバイスから再接続できる

**Independent Test**: PCでセッション開始→ブラウザ閉じる→別デバイスで再接続→同じセッションに戻れる

### Tests for User Story 2

- [ ] T040 [P] [US2] Write unit tests for session routes in backend/tests/unit/sessions.test.ts
- [ ] T041 [P] [US2] Write E2E test for session reconnection in frontend/tests/e2e/session-reconnect.spec.ts

### Implementation for User Story 2

- [ ] T042 [US2] Implement sessions routes (GET/POST /sessions, GET/DELETE /:id) in backend/src/routes/sessions.ts
- [ ] T043 [US2] Add session metadata storage in backend/src/utils/storage.ts (~/.cc-hub/sessions/)
- [ ] T044 [US2] Add sessions routes to Hono app in backend/src/index.ts
- [ ] T045 [US2] Implement useSessions hook for session management in frontend/src/hooks/useSessions.ts
- [ ] T046 [US2] Create SessionList component for session selection in frontend/src/components/SessionList.tsx
- [ ] T047 [US2] Create session selection page in frontend/src/pages/SessionSelectPage.tsx
- [ ] T048 [US2] Update App routing for session selection flow in frontend/src/App.tsx
- [ ] T049 [US2] Store session ID in localStorage for auto-reconnection in frontend/src/hooks/useSessions.ts
- [ ] T050 [US2] Implement scrollback buffer recovery on reconnection in backend/src/routes/terminal.ts

**Checkpoint**: セッション永続化が動作 - マルチデバイス再接続が可能

---

## Phase 5: User Story 3 - マルチセッション管理 (Priority: P3)

**Goal**: 複数セッションをタブUIで切り替え、状態を色で表示

**Independent Test**: 3つのセッション作成→タブ切り替え→Claude Code状態に応じてタブ色が変わる

### Tests for User Story 3

- [ ] T051 [P] [US3] Write unit tests for state detector service in backend/tests/unit/state-detector.test.ts
- [ ] T052 [P] [US3] Write E2E test for multi-session tab switching in frontend/tests/e2e/multi-session.spec.ts

### Implementation for User Story 3

- [ ] T053 [US3] Implement state detector service (fs.watch on ~/.claude/projects/) in backend/src/services/state-detector.ts
- [ ] T054 [US3] Parse JSONL transcript and detect state (idle/working/waiting_input/waiting_permission) in backend/src/services/state-detector.ts
- [ ] T055 [US3] Add state endpoint (GET /sessions/:id/state) in backend/src/routes/sessions.ts
- [ ] T056 [US3] Add state WebSocket broadcast in backend/src/routes/terminal.ts
- [ ] T057 [P] [US3] Create SessionTab component with state color in frontend/src/components/SessionTab.tsx
- [ ] T058 [P] [US3] Create SessionTabs container component in frontend/src/components/SessionTabs.tsx
- [ ] T059 [US3] Implement useSessionState hook for state subscription in frontend/src/hooks/useSessionState.ts
- [ ] T060 [US3] Update TerminalPage to support multi-session tabs in frontend/src/pages/TerminalPage.tsx
- [ ] T061 [US3] Add "新規セッション" button to SessionTabs in frontend/src/components/SessionTabs.tsx
- [ ] T062 [US3] Add tab color CSS (idle=green, working=yellow, waiting=red, disconnected=gray) in frontend/src/styles/tabs.css

**Checkpoint**: マルチセッション管理が動作 - タブ切り替えと状態表示が機能

---

## Phase 6: User Story 4 - 通知 (Priority: P4)

**Goal**: Claude Codeの入力待ち時にプッシュ通知を受け取る（Android/Desktop）

**Independent Test**: Claude Codeで質問表示→ブラウザバックグラウンド→プッシュ通知が届く

### Tests for User Story 4

- [ ] T063 [P] [US4] Write unit tests for push notification service in backend/tests/unit/push.test.ts
- [ ] T064 [P] [US4] Write E2E test for notification permission and delivery in frontend/tests/e2e/notifications.spec.ts

### Implementation for User Story 4

- [ ] T065 [US4] Define PushSubscription type in shared/types.ts
- [ ] T066 [US4] Implement push notification service (web-push-browser, VAPID) in backend/src/services/push.ts
- [ ] T067 [US4] Implement push subscription storage in backend/src/utils/storage.ts (~/.cc-hub/subscriptions.json)
- [ ] T068 [US4] Implement push routes (POST /push/subscribe, DELETE /push/unsubscribe) in backend/src/routes/push.ts
- [ ] T069 [US4] Add push routes to Hono app in backend/src/index.ts
- [ ] T070 [US4] Integrate state detector with push service (trigger on waiting_input/waiting_permission) in backend/src/services/state-detector.ts
- [ ] T071 [US4] Create Service Worker for push notifications in frontend/public/sw.js
- [ ] T072 [US4] Implement useNotifications hook in frontend/src/hooks/useNotifications.ts
- [ ] T073 [US4] Add notification permission request UI in frontend/src/components/NotificationSettings.tsx
- [ ] T074 [US4] Create in-app notification toast component in frontend/src/components/NotificationToast.tsx
- [ ] T075 [US4] Integrate notification settings in TerminalPage in frontend/src/pages/TerminalPage.tsx

**Checkpoint**: 通知機能が動作（Android/Desktop）

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 複数ストーリーに影響する改善

- [ ] T076 [P] Create setup CLI script for initial user creation (bun run setup) in scripts/setup.ts
- [ ] T077 [P] Add environment variable validation in backend/src/config.ts
- [ ] T078 [P] Add error handling and logging infrastructure in backend/src/utils/logger.ts
- [ ] T079 [P] Implement graceful WebSocket reconnection with exponential backoff in frontend/src/hooks/useWebSocket.ts
- [ ] T080 [P] Add responsive design for mobile (360px+) in frontend/src/styles/responsive.css
- [ ] T081 [P] Add loading states and error handling UI in frontend/src/components/LoadingSpinner.tsx
- [ ] T082 Security review: rate limiting, input sanitization in backend/src/middleware/security.ts
- [ ] T083 Performance optimization: terminal rendering, lazy loading
- [ ] T084 Run quickstart.md validation - full setup and usage test
- [ ] T085 Final E2E test suite execution with Playwright

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 依存なし - 即時開始可能
- **Foundational (Phase 2)**: Setup完了に依存 - 全ユーザーストーリーをブロック
- **User Stories (Phase 3-6)**: Foundational完了に依存
  - US1 (P1): 基盤機能、他ストーリーの前提
  - US2 (P2): US1完了後に実装推奨（同じterminal機能を使用）
  - US3 (P3): US1, US2完了後に実装推奨（複数セッションが前提）
  - US4 (P4): US3完了後に実装推奨（状態検出機能を利用）
- **Polish (Phase 7)**: 必要なユーザーストーリー完了に依存

### User Story Dependencies

- **User Story 1 (P1)**: Foundational完了後に開始可能 - 他ストーリーの前提
- **User Story 2 (P2)**: US1完了後推奨 - セッション永続化はターミナル機能が前提
- **User Story 3 (P3)**: US2完了後推奨 - マルチセッションはセッション管理が前提
- **User Story 4 (P4)**: US3完了後推奨 - 通知は状態検出が前提

### Within Each User Story

- テストを先に書き、失敗することを確認（TDD）
- バックエンド → フロントエンド
- サービス → ルート → UI
- コア実装 → 統合

### Parallel Opportunities

- Phase 1: T003-T010は並列実行可能
- Phase 2: T013-T016（型・テスト）、T019/T024-T26（独立コンポーネント）は並列
- Phase 3-6: 各ストーリー内のテストは並列
- Phase 7: T076-T081は並列実行可能

---

## Parallel Example: User Story 1

```bash
# テストを先に並列で書く:
Task: T029 "Write integration test for WebSocket terminal connection"
Task: T030 "Write E2E test for terminal command execution"

# テストが失敗することを確認後、実装:
# バックエンド: T031 → T032
# フロントエンド: T033 → T034 → T035 → T036 → T037 → T038 → T039
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup完了
2. Phase 2: Foundational完了（認証基盤）
3. Phase 3: User Story 1完了
4. **STOP and VALIDATE**: ターミナルでコマンド実行、Claude Code起動を確認
5. デプロイ/デモ可能

### Incremental Delivery

1. Setup + Foundational → ログイン動作
2. User Story 1追加 → ターミナル動作 → **MVP!**
3. User Story 2追加 → セッション永続化 → マルチデバイス対応
4. User Story 3追加 → マルチセッション → 生産性向上
5. User Story 4追加 → 通知 → UX向上
6. Polish → 品質・パフォーマンス向上

---

## Notes

- [P]タスク = 異なるファイル、依存なし
- [Story]ラベルはタスクをユーザーストーリーにマッピング
- TDD必須: テストを先に書き、失敗を確認してから実装
- 各ユーザーストーリーは独立してテスト可能
- タスクまたは論理グループごとにコミット
- チェックポイントでストーリーを独立検証
