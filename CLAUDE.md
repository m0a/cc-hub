# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CC Hub is a web-based terminal session manager for Claude Code. It runs Claude Code instances in tmux sessions and provides a web UI for remote access from tablets/mobile devices.

## Commands

```bash
# Development (starts both backend and frontend)
bun run dev

# Individual services
bun run dev:backend   # Backend only (port 3000)
bun run dev:frontend  # Frontend only (port 5173)

# Testing and linting
bun run test          # Run all tests
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
shared/      # Shared types and Zod schemas
```

### Backend Services

- **TmuxControlSession** (`services/tmux-control.ts`) - Core service for tmux `-CC` control mode. Manages subprocess lifecycle, processes structured protocol messages (`%output`, `%layout-change`, `%begin`/`%end`/`%error`, `%exit`), handles raw byte streams for UTF-8 preservation, command queuing with FIFO correlation, per-pane output routing, client lifecycle with 30s grace period
- **TmuxService** (`services/tmux.ts`) - Manages tmux sessions, spawns Claude Code processes, collects all pane info per session, batch agent info extraction
- **TmuxLayoutParser** (`services/tmux-layout-parser.ts`) - Parses tmux layout strings into `TmuxLayoutNode` tree for frontend rendering
- **TmuxOctalDecoder** (`services/tmux-octal-decoder.ts`) - Decodes tmux octal-encoded output, raw byte processing for split UTF-8 sequences, hex encoding for `send-keys -H`
- **TerminalFilterUtils** (`services/terminal-filter-utils.ts`) - Filters mouse escape sequences and control characters from terminal I/O
- **ClaudeCodeService** (`services/claude-code.ts`) - Monitors Claude Code state from `.jsonl` files, PTY-based session matching
- **SessionHistoryService** (`services/session-history.ts`) - Reads past Claude Code session history and conversations
- **PromptHistoryService** (`services/prompt-history.ts`) - Searches prompt history across sessions
- **FileService** (`services/file-service.ts`) - Secure file operations with path traversal prevention
- **FileChangeTracker** (`services/file-change-tracker.ts`) - Parses Claude Code `.jsonl` logs to track file changes
- **AnthropicUsageService** (`services/anthropic-usage.ts`) - Fetches usage limits from Anthropic API
- **StatsService** (`services/stats-service.ts`) - Reads cached statistics from `~/.claude/stats-cache.json`
- **UsageTrackerService** (`services/usage-tracker.ts`) - Reads limit tracker data
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
- `GET /:id/copy-mode` - Get tmux copy mode selection
- `GET /clipboard` - Get clipboard content
- `GET /prompts/search` - Search prompt history

**Session History** (`/api/sessions/history`):
- `GET /` - Get past Claude Code session history
- `GET /projects` - List projects with sessions
- `GET /projects/:dirName` - Get sessions for a project
- `GET /:sessionId/conversation` - Get conversation for a session
- `POST /resume` - Resume session from history
- `POST /metadata` - Update session metadata

**Files** (`/api/files`):
- `GET /list` - Directory listing
- `GET /read` - File content (with size limits)
- `GET /browse` - Browse directory tree
- `GET /changes/:sessionWorkingDir` - Claude Code changes from `.jsonl`
- `GET /git-changes/:workingDir` - Git-tracked changed files (`git status --porcelain`)
- `GET /git-diff/:workingDir?path=...` - Unified diff for a specific file (`git diff`)
- `GET /images/:filename` - Serve conversation images
- `GET /language` - Detect file language
- `POST /mkdir` - Create directory

**Terminal WebSocket** (`/ws/control/:id`):
- Real-time pane I/O via JSON protocol
- Client messages: `input`, `resize`, `split`, `close-pane`, `resize-pane`, `select-pane`, `scroll`, `adjust-pane`, `equalize-panes`, `zoom-pane`, `request-content`, `ping`, `client-info`
- Server messages: `output`, `layout`, `initial-content`, `ready`, `pong`, `error`, `new-session`

**Other**:
- `GET /api/dashboard` - Dashboard data (usage limits, statistics, cost estimates)
- `POST /api/upload/image` - Upload image file
- `POST /api/auth` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user
- `POST /api/logs` - Frontend log submission

### Frontend Components

**Layout**:
- **DesktopLayout.tsx** - Main layout with tmux control mode integration, pane tree management, keyboard shortcuts (Ctrl+B session modal, Ctrl+Shift+B dashboard, Ctrl+D/Shift+D split, Ctrl+W close, Ctrl+Shift+Arrow resize, Ctrl+Shift+= equalize). Supports desktop and tablet modes
- **PaneContainer.tsx** - Tree-based pane renderer with `ControlModeContext` for tmux pane operations (split, close, zoom, resize)
- **SessionModal.tsx** - Session picker modal (Ctrl+B) with pane count badges and expandable pane list

**Onboarding**:
- **Onboarding.tsx** - Spotlight-style walkthrough for new users with `beforeAction` support for triggering UI before showing steps

**Terminal**:
- **Terminal.tsx** - xterm.js terminal with WebGL rendering, `ControlModeConfig` for tmux size sync (`proposeDimensions()` instead of `fit()`, `setExactSize()` from tmux layout)

**Session Management**:
- **SessionList.tsx** - Full session list with tabs (Active/History/Dashboard), pane list with focus/close/split actions, pinch-to-zoom support
- **SessionHistory.tsx** - Past session browser with project grouping
- **ConversationViewer.tsx** - Markdown-rendered conversation display with image support

**Keyboard**:
- **FloatingKeyboard.tsx** - Draggable floating keyboard, minimizable, saves position separately per input mode (keyboard/Japanese)
- **Keyboard.tsx** - Virtual keyboard component with long-press for symbols

**Files** (`components/files/`):
- **FileViewer.tsx** - Container with file browser and content viewer, Claude/Git change toggle, browser history navigation
- **FileBrowser.tsx** - Directory tree navigation
- **CodeViewer.tsx** - Syntax highlighted code display
- **DiffViewer.tsx** - Side-by-side diff view for file changes
- **ImageViewer.tsx** - Image preview with zoom
- **MarkdownViewer.tsx** - Markdown rendering

**Hooks** (`hooks/`):
- **useControlTerminal.ts** - WebSocket connection to `/ws/control/:sessionId` for tmux control mode. Handles auto-reconnect, keepalive pings, `ready` signal handshake, base64 I/O encoding. Returns `sendInput`, `resize`, `splitPane`, `closePane`, `zoomPane`, `scrollPane`, `adjustPane`, `equalizePanes` etc.

**Dashboard** (`components/dashboard/`):
- **Dashboard.tsx** - Main dashboard container
- **UsageLimits.tsx** - 5-hour/7-day usage cycle display with progress bars
- **DailyUsageChart.tsx** - Message and session count bar charts
- **ModelUsageChart.tsx** - Opus/Sonnet token usage comparison
- **CostEstimate.tsx** - API cost calculation
- **HourlyHeatmap.tsx** - Activity heatmap by hour
- **LimitWarning.tsx** - Usage limit warnings

### Terminal Communication

```
Browser <--WebSocket (JSON)--> Hono Server <--tmux -CC (control mode)--> tmux <--pipe--> Claude Code
```

The backend upgrades HTTP to WebSocket at `/ws/control/:sessionId`. A `TmuxControlSession` manages the `tmux -CC attach` subprocess, parsing structured protocol messages (`%output`, `%layout-change`, `%begin/%end/%error`, `%exit`). Terminal I/O is multiplexed per-pane over a single WebSocket connection using JSON messages (`ControlClientMessage` / `ControlServerMessage` types in `shared/types.ts`).

Key behaviors:
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
cchub setup -P pass     # Register systemd service
cchub update            # Update from GitHub Releases
cchub status            # Show service status

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

```bash
# Run CLI in Japanese
LANG=ja_JP.UTF-8 cchub --help

# Run CLI in English
LANG=en_US.UTF-8 cchub --help
```

## Type Sharing

Types are defined in `shared/types.ts` with Zod schemas for validation. Import from `../../../shared/types` in both backend and frontend.

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
