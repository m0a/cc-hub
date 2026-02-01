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

- **TmuxService** (`services/tmux.ts`) - Manages tmux sessions, spawns Claude Code processes, handles terminal resize, PTY-based session identification
- **FileService** (`services/file-service.ts`) - Secure file operations with path traversal prevention
- **FileChangeTracker** (`services/file-change-tracker.ts`) - Parses Claude Code `.jsonl` logs to track file changes
- **ClaudeCodeService** (`services/claude-code.ts`) - Monitors Claude Code state from `.jsonl` files, PTY-based session matching
- **SessionHistoryService** (`services/session-history.ts`) - Reads past Claude Code session history and conversations
- **AnthropicUsageService** (`services/anthropic-usage.ts`) - Fetches usage limits from Anthropic API
- **StatsService** (`services/stats-service.ts`) - Reads cached statistics from `~/.claude/stats-cache.json`
- **UsageTrackerService** (`services/usage-tracker.ts`) - Reads limit tracker data

### Key API Routes

- `POST /api/sessions` - Create new Claude Code session
- `GET /api/sessions/:id/terminal` - WebSocket connection to tmux session
- `POST /api/sessions/:id/resume` - Resume Claude Code session with `claude -r`
- `GET /api/sessions/history` - Get past Claude Code session history
- `GET /api/sessions/history/:sessionId/conversation` - Get conversation for a session
- `POST /api/sessions/history/resume` - Resume session from history
- `GET /api/files/list` - Directory listing (restricted to session working directory)
- `GET /api/files/read` - File content (with size limits)
- `GET /api/files/changes/:sessionWorkingDir` - Claude Code changes from `.jsonl`
- `GET /api/files/images/:filename` - Serve conversation images
- `GET /api/dashboard` - Dashboard data (usage limits, statistics, cost estimates)

### Frontend Components

- **Terminal.tsx** - xterm.js terminal with custom soft keyboard
- **TabletLayout.tsx** - Split-pane layout for tablets (terminal + session list + keyboard + dashboard)
- **FileViewer** (`components/files/`) - File browser, code viewer with syntax highlighting, diff viewer
- **Dashboard** (`components/dashboard/`) - Usage limits, daily charts, model usage, cost estimates
- **SessionHistory.tsx** - Past session browser with project grouping
- **ConversationViewer.tsx** - Markdown-rendered conversation display with image support

### Terminal Communication

```
Browser <--WebSocket--> Hono Server <--PTY--> tmux <--pipe--> Claude Code
```

The backend upgrades HTTP to WebSocket for terminal connections, creates a PTY, and attaches it to tmux.

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

## Type Sharing

Types are defined in `shared/types.ts` with Zod schemas for validation. Import from `../../../shared/types` in both backend and frontend.

## Debugging

### Remote Logging

Frontend `console.log/warn/error/info` calls are automatically sent to the backend via `/api/logs`. Logs are written to `logs/frontend.log`.

This enables debugging on mobile/tablet devices without access to browser DevTools. Use `tail -f logs/frontend.log` to monitor frontend logs in real-time.
