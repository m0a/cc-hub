# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CC Hub is a web-based terminal session manager for Claude Code. It runs Claude Code instances in tmux sessions and provides a web UI for remote access from tablets/mobile devices.

## Commands

```bash
# Development (starts both backend and frontend)
bun run dev

# Individual services
bun run dev:backend   # Backend only (port 3456)
bun run dev:frontend  # Frontend only (port 5173)

# Testing and linting
bun run test          # Run all tests
bun run test:e2e      # E2E tests (frontend only)
bun run lint          # Lint all packages

# Build
bun run build         # Build all packages
bun run build:binary  # Build single executable

# Stop dev servers
bun run stop
```

## Architecture

### Monorepo Structure

```
backend/     # Hono API server (Bun runtime)
frontend/    # React SPA (Vite + Tailwind v4)
shared/      # Shared types and Zod schemas (types.ts)
```

### Backend Services

- **TmuxControlSession** (`services/tmux-control.ts`) - Core service for tmux `-CC` control mode. Manages subprocess lifecycle, processes structured protocol messages (`%output`, `%layout-change`, `%begin`/`%end`/`%error`, `%exit`), handles raw byte streams for UTF-8 preservation, command queuing with FIFO correlation, per-pane output routing, client lifecycle with 30s grace period
- **TmuxService** (`services/tmux.ts`) - Manages tmux sessions, spawns Claude Code processes, collects all pane info per session, batch agent info extraction
- **TmuxLayoutParser** (`services/tmux-layout-parser.ts`) - Parses tmux layout strings into `TmuxLayoutNode` tree for frontend rendering
- **TmuxOctalDecoder** (`services/tmux-octal-decoder.ts`) - Decodes tmux octal-encoded output, raw byte processing for split UTF-8 sequences, hex encoding for `send-keys -H`
- **ClaudeCodeService** (`services/claude-code.ts`) - Monitors Claude Code state from `.jsonl` files, PTY-based session matching
- **SessionHistoryService** (`services/session-history.ts`) - Reads past Claude Code session history and conversations
- **SessionMetadataService** (`services/session-metadata.ts`) - Persists session metadata (theme, title, session order, last known sessions for recovery after reboot)
- **SessionsService** (`services/sessions.ts`) - Session CRUD operations with file-based persistence
- **PromptHistoryService** (`services/prompt-history.ts`) - Searches prompt history across sessions
- **FileService** (`services/file-service.ts`) - Secure file operations with path traversal prevention
- **FileChangeTracker** (`services/file-change-tracker.ts`) - Parses Claude Code `.jsonl` logs to track file changes
- **AnthropicUsageService** (`services/anthropic-usage.ts`) - Fetches usage limits from Anthropic API with 60s cache, 5min backoff on 429, in-flight request coalescing
- **StatsService** (`services/stats-service.ts`) - Reads cached statistics from `~/.claude/stats-cache.json`
- **UsageTrackerService** (`services/usage-tracker.ts`) - Reads limit tracker data
- **UsageHistoryService** (`services/usage-history.ts`) - Records usage snapshots to `/tmp/cchub-usage-history.json` with 30s throttling
- **SystemMetricsService** (`services/system-metrics.ts`) - Collects CPU, memory, swap, and load metrics with history tracking (60 snapshots max)
- **AuthService** (`services/auth.ts`) - Password-based authentication with session tokens

### Key API Routes

**Sessions** (`/api/sessions`):
- `GET /` - List all tmux sessions with Claude Code state and pane info
- `POST /` - Create new Claude Code session
- `GET /:id` - Get session details
- `DELETE /:id` - Close session
- `POST /:id/resume` - Resume Claude Code session with `claude -r`
- `POST /:id/panes/focus` - Focus a pane (`{ paneId }`)
- `POST /:id/panes/close` - Close a pane (`{ paneId }`, rejects last pane)
- `POST /:id/panes/split` - Split a pane (`{ paneId, direction: 'h'|'v' }`)
- `POST /:id/panes/respawn` - Respawn a dead pane
- `GET /:id/copy-mode` - Get tmux copy mode selection
- `PUT /:id/theme` - Set session color theme
- `PUT /:id/title` - Set session custom title
- `PUT /order` - Set session display order
- `GET /clipboard` - Get clipboard content
- `GET /prompts/search` - Search prompt history

**Session History** (`/api/sessions/history`):
- `GET /` - Get past Claude Code session history
- `GET /projects` - List projects with sessions
- `GET /projects/:dirName` - Get sessions for a project
- `GET /search` - Search sessions across all projects
- `GET /search/stream` - Stream search results (SSE)
- `GET /:sessionId/conversation` - Get conversation for a session
- `POST /resume` - Resume session from history
- `POST /metadata` - Update session metadata

**Files** (`/api/files`):
- `GET /list` - Directory listing
- `GET /read` - File content (with size limits, images/media return metadata only)
- `GET /raw` - Stream file inline for `<img>`/`<video>`/`<audio>` (Range request / 206 supported)
- `GET /download` - Download file as attachment (streamed via `Bun.file()`)
- `POST /upload` - Upload file(s) via multipart/form-data (streamed via `Bun.write()`)
- `GET /browse` - Browse directory tree
- `GET /changes/:sessionWorkingDir` - Claude Code changes from `.jsonl`
- `GET /git-changes/:workingDir` - Git-tracked changed files (`git status --porcelain`)
- `GET /git-diff/:workingDir?path=...` - Unified diff for a specific file (`git diff`)
- `GET /images/:filename` - Serve conversation images
- `GET /language` - Detect file language
- `POST /mkdir` - Create directory

**Terminal WebSocket** (`/ws/mux`):
- Multiplexed WebSocket — single connection serves all sessions
- Client subscribes/unsubscribes per session via JSON messages
- Client messages (`MuxClientMessage`): `subscribe`, `unsubscribe`, then per-session: `input`, `resize`, `split`, `close-pane`, `resize-pane`, `select-pane`, `scroll`, `adjust-pane`, `equalize-panes`, `zoom-pane`, `request-content`, `ping`, `client-info`
- Server messages (`MuxServerMessage`): `subscribed`, `unsubscribed`, `sessions-updated`, then per-session: `output`, `layout`, `initial-content`, `ready`, `pong`, `error`, `new-session`
- Server periodically pushes `sessions-updated` (5s interval) with full session list

**Other**:
- `GET /api/dashboard` - Dashboard data (usage limits, statistics, cost estimates, system metrics, usage history)
- `POST /api/upload/image` - Upload image file
- `POST /api/notify` - Receive hook events from Claude Code
- `POST /api/auth` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user
- `POST /api/logs` - Frontend log submission

### Frontend Components

**Layout**:
- **DesktopLayout.tsx** - Main layout with tmux control mode integration, pane tree management, keyboard shortcuts. Supports desktop and tablet modes
- **PaneContainer.tsx** - Tree-based pane renderer with `ControlModeContext` for tmux pane operations (split, close, zoom, resize)
- **SessionModal.tsx** - Session picker modal (Ctrl+B) with pane count badges and expandable pane list

**Terminal**:
- **Terminal.tsx** - xterm.js terminal with WebGL rendering, `ControlModeConfig` for tmux size sync (`proposeDimensions()` instead of `fit()`, `setExactSize()` from tmux layout). Supports font size adjustment, desktop text selection with auto-copy, touch selection mode for mobile/tablet

**Session Management**:
- **SessionTabs.tsx** / **SessionTab.tsx** - Tab bar for active sessions
- **SessionList.tsx** - Full session list with tabs (Active/History/Dashboard), pane list with focus/close/split actions, pinch-to-zoom support
- **SessionListMini.tsx** - Compact session list view
- **SessionHistory.tsx** - Past session browser with project grouping
- **ConversationViewer.tsx** - Markdown-rendered conversation display with image support

**Keyboard**:
- **FloatingKeyboard.tsx** - Draggable floating keyboard for tablets, minimizable, saves position per input mode
- **Keyboard.tsx** - Virtual keyboard for mobile with long-press for symbols

**Files** (`components/files/`):
- **FileViewer.tsx** - Container with file browser and content viewer, Claude/Git change toggle, browser history navigation, file upload/download, video/audio playback
- **FileBrowser.tsx** - Directory tree navigation
- **CodeViewer.tsx** - Syntax highlighted code display
- **DiffViewer.tsx** - Side-by-side diff view for file changes
- **ImageViewer.tsx** - Image preview with zoom (uses `/files/raw` streaming for large images)
- **MarkdownViewer.tsx** - Markdown rendering
- **HtmlViewer.tsx** - HTML file rendering via iframe
- **PromptComposer.tsx** - Prompt text composition interface

**Dashboard** (`components/dashboard/`):
- **Dashboard.tsx** - Main dashboard container
- **DashboardPanel.tsx** - Dashboard side panel wrapper (Ctrl+Shift+B)
- **UsageLimits.tsx** - 5-hour/7-day usage cycle display with progress bars
- **DailyUsageChart.tsx** - Message and session count bar charts
- **ModelUsageChart.tsx** - Opus/Sonnet token usage comparison
- **CostEstimate.tsx** - API cost calculation
- **HourlyHeatmap.tsx** - Activity heatmap by hour
- **LimitWarning.tsx** - Usage limit warnings
- **UsageChart.tsx** - Usage history line chart with real-time snapshots
- **NetworkLatency.tsx** - WebSocket latency display
- **ServerInfo.tsx** - Server information and system details

**Other**:
- **LoginForm.tsx** - Password authentication form
- **LanguageSwitcher.tsx** - EN/JA language toggle
- **Onboarding.tsx** - Spotlight-style walkthrough for new users
- **PromptSearch.tsx** - Prompt history search interface

### Frontend Hooks

- **useMultiplexedTerminal.ts** - WebSocket connection to `/ws/mux` for multiplexed terminal I/O. Handles auto-reconnect, keepalive pings, session subscribe/unsubscribe, base64 I/O encoding. Returns `sendInput`, `resize`, `splitPane`, `closePane`, `zoomPane`, `scrollPane`, `adjustPane`, `equalizePanes` etc.
- **useSessions.ts** - Active sessions state management
- **useSessionHistory.ts** - Session history browsing
- **useDashboard.ts** - Dashboard data fetching
- **useFileViewer.ts** - File viewing state
- **useAuth.ts** - Authentication state management
- **useTheme.ts** - Dark/light theme management
- **useNetworkLatency.ts** - WebSocket latency tracking
- **useLineSelection.ts** - Text line selection utilities

### Keyboard Shortcuts (Desktop)

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Open session modal |
| `Ctrl+Shift+B` | Toggle dashboard panel |
| `Ctrl+D` | Split pane vertically |
| `Shift+D` (in session modal) | Split pane horizontally |
| `Ctrl+W` | Close current pane |
| `Ctrl+Shift+Arrow` | Resize pane |
| `Ctrl+Shift+=` | Equalize pane sizes |
| `Ctrl/Cmd+=` or `+` | Increase font size |
| `Ctrl/Cmd+-` | Decrease font size |
| `Ctrl/Cmd+0` | Reset font size to default (14px) |
| `Ctrl/Cmd+C` (with selection) | Copy selected text |
| `Ctrl/Cmd+V` | Paste from clipboard |

### Terminal Communication

```
Browser <--WebSocket (/ws/mux, JSON+binary)--> Hono Server <--tmux -CC (control mode)--> tmux <--pipe--> Claude Code
```

The backend upgrades HTTP to WebSocket at `/ws/mux`. A single multiplexed connection manages multiple session subscriptions. Each subscription creates a `TmuxControlSession` that manages `tmux -CC attach`, parsing structured protocol messages (`%output`, `%layout-change`, `%begin/%end/%error`, `%exit`). Terminal I/O is multiplexed per-pane and per-session using `MuxClientMessage` / `MuxServerMessage` types in `shared/types.ts`.

Key behaviors:
- **Session push**: Server pushes `sessions-updated` every 5s with full session list (replaces polling)
- **Layout sync**: `%layout-change` events update all connected clients in real-time
- **Size management**: Client sends container size, tmux determines pane dimensions, xterm.js uses `setExactSize()` from layout
- **Initial content**: Deferred until first resize for correct terminal dimensions (`capture-pane -e -p -S -`)
- **UTF-8**: Raw byte processing to handle split multi-byte sequences across `%output` lines

## CLI Commands

```bash
# Server
cchub                    # Start server (port 5923)
cchub -p 8080           # Custom port
cchub -P password       # With password auth

# Management
cchub setup -P pass     # Register systemd/launchd service
cchub update            # Update from GitHub Releases
cchub update --check    # Check only (no update)
cchub status            # Show service status

# Hook notification
cchub notify            # Send hook event (reads JSON from stdin)

# Help
cchub --help
cchub --version
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port` | Port number | 5923 |
| `-H, --host` | Bind address | 0.0.0.0 |
| `-P, --password` | Auth password | none |

### Requirements

- Tailscale must be running (used for HTTPS certificates)
- Run `sudo tailscale set --operator=$USER` once to allow cert generation
- macOS: Install Tailscale via `brew install tailscale` (App Store version lacks CLI)
- tmux must be installed and accessible

## Claude Code Hook通知連携

Claude Codeのhookイベント（応答完了、ユーザー入力待ち等）をCC Hub経由でブラウザのOS通知として受け取れる。

### 仕組み

```
Claude Code hook → cchub notify (stdin JSON) → POST /api/notify → WebSocket broadcast → ブラウザ Notification API
```

### セットアップ手順

1. `~/.claude/settings.json` の `hooks` に `cchub notify` を追加する:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "cchub notify" }] }],
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "cchub notify" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "cchub notify" }] }],
    "PostToolUse": [{
      "matcher": "AskUserQuestion",
      "hooks": [{ "type": "command", "command": "cchub notify" }]
    }]
  }
}
```

2. `cchub` バイナリにPATHが通っていることを確認（hookはClaude Codeのプロセスから実行される）

3. CC Hubサーバーがデフォルトポート（5923）で起動していること。カスタムポートの場合は `cchub notify -p <port>` を指定

4. ブラウザで初回アクセス時に通知権限を許可する

### 対応イベント

| hookイベント | 通知メッセージ |
|-------------|-------------|
| `Stop` | Claudeの応答が完了しました |
| `PostToolUse` (AskUserQuestion) | Claudeがユーザー入力を待っています |
| `SubagentStop` | サブエージェントが完了しました |
| `TaskCompleted` | タスクが完了しました |
| その他 | Hook: {イベント名} |

### 注意事項

- `cchub notify` はstdinからClaude Codeのhook JSON入力を読み取る
- `/api/notify` エンドポイントは認証不要（ローカルhookから呼ばれるため）
- 既存のhookスクリプト（smart-notify.py等）と併用可能（同じイベントに複数hook登録）
- 複数のWebSocket接続がある場合でもデバウンスにより通知は1回のみ

## Internationalization (i18n)

CC Hub supports English and Japanese. Language is automatically detected.

### Frontend (Web UI)

Uses `react-i18next` with browser language detection:
- Translation files: `frontend/src/i18n/locales/{en,ja}.json`
- Language switcher in UI (EN/JA button)
- Preference saved to `localStorage` (`cchub-language`)

### Backend (CLI)

Uses custom i18n module with embedded translations:
- Module: `backend/src/i18n/index.ts`
- Language detected from environment variables: `LANG`, `LC_ALL`, `LC_MESSAGES`
- Japanese locale (`ja_*`) → Japanese, otherwise English

## Type Sharing

Types are defined in `shared/types.ts` with Zod schemas for validation. Import from `../../../shared/types` in both backend and frontend.

Key types: `ControlClientMessage`, `ControlServerMessage` (per-session terminal I/O), `MuxClientMessage`, `MuxServerMessage` (multiplexed WebSocket protocol), `SessionResponse`, `PaneInfo`, `TmuxLayoutNode`.

## Linting

Uses [Biome](https://biomejs.dev/) for linting. Configuration in `biome.json` at project root.

- a11y rules (`useButtonType`, `noSvgWithoutTitle`, etc.) set to `"warn"` — not blocking CI
- Biome 2.x config format: `{ "level": "warn" }` (NOT just `"warn"`)
- Run `bun run lint` to check all packages

## Debugging

### Remote Logging

Frontend `console.log/warn/error/info` calls are automatically sent to the backend via `/api/logs`. Logs are written to `logs/frontend.log`.

This enables debugging on mobile/tablet devices without access to browser DevTools. Use `tail -f logs/frontend.log` to monitor frontend logs in real-time.

### TMUX Nesting Caveat

When running the dev server from within a tmux session (e.g., from a CC Hub terminal), the `$TMUX` environment variable is inherited by child processes. This causes `tmux -CC attach` (used by the backend for terminal control) to fail with "sessions should be nested with care".

**Symptom**: All terminals show "Connecting..." / "Session exited: process exited"

**Fix**: Start the dev server with `$TMUX` unset:
```bash
nohup env -u TMUX bun run dev > /tmp/cchub-dev.log 2>&1 &
```
