# Implementation Plan: CC Hub

**Branch**: `001-cc-hub` | **Date**: 2026-01-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-cc-hub/spec.md`

## Summary

CC HubはWebブラウザからClaude Codeのマルチセッションを管理するハブ。tmuxによるセッション永続化、ghostty-webによるターミナル表示、transcript.json監視による状態検出を組み合わせ、あらゆるデバイスからの開発作業を可能にする。

## Technical Context

**Language/Version**: TypeScript 5.x (Bun runtime)
**Primary Dependencies**: Hono, Hono RPC, React, ghostty-web, Tailwind CSS
**Storage**: ファイルシステム（ユーザー認証情報）+ tmux（セッション管理）
**Testing**: Bun test（単体・結合）、Playwright（E2E）
**Target Platform**: Linux server (Bun), Web browsers (Chrome/Firefox/Safari)
**Project Type**: Web application (frontend + backend)
**Performance Goals**: ページロード3秒以内、状態更新2秒以内
**Constraints**: Tailscale VPN内運用、1-3ユーザー、常時接続前提
**Scale/Scope**: 10セッション同時管理、個人利用

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | ステータス | 対応方針 |
|-----|----------|---------|
| I. TDD（非交渉事項） | ✅ Pass | 各フェーズでテストファースト、E2Eテスト重視 |
| II. Simplicity & YAGNI | ✅ Pass | 内部DB不要（tmux list-sessions使用）、認証はシンプルなパスワード方式 |
| III. Web-First Architecture | ✅ Pass | WebSocket通信、レスポンシブデザイン、常時接続前提 |
| IV. Multi-Device Accessibility | ✅ Pass | tmuxでセッション永続化、タブUIで複数セッション管理 |
| V. Incremental Delivery | ✅ Pass | P1→P2→P3→P4の順で独立デプロイ可能 |

## Project Structure

### Documentation (this feature)

```text
specs/001-cc-hub/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── index.ts           # Honoアプリエントリポイント
│   ├── routes/
│   │   ├── auth.ts        # 認証API
│   │   ├── sessions.ts    # セッション管理API
│   │   └── terminal.ts    # WebSocket接続
│   ├── services/
│   │   ├── tmux.ts        # tmux操作
│   │   ├── auth.ts        # 認証ロジック
│   │   └── state-detector.ts  # Claude Code状態検出
│   └── types/
│       └── index.ts       # 共有型定義
└── tests/
    ├── unit/
    └── integration/

frontend/
├── src/
│   ├── main.tsx           # Reactエントリポイント
│   ├── App.tsx
│   ├── components/
│   │   ├── Terminal.tsx   # ghostty-web wrapper
│   │   ├── SessionTabs.tsx
│   │   ├── SessionTab.tsx
│   │   └── LoginForm.tsx
│   ├── hooks/
│   │   ├── useTerminal.ts
│   │   ├── useSessions.ts
│   │   └── useAuth.ts
│   ├── services/
│   │   └── api.ts         # Hono RPC client
│   └── types/
│       └── index.ts
└── tests/
    ├── unit/
    └── e2e/

shared/
└── types.ts               # フロントエンド・バックエンド共有型
```

**Structure Decision**: Web application構成を採用。Hono RPCで型安全な通信を実現するため、shared/に共有型を配置。

## Complexity Tracking

> 憲章違反なし - このセクションは空

