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

- **TmuxService** (`services/tmux.ts`) - Manages tmux sessions, spawns Claude Code processes, handles terminal resize
- **FileService** (`services/file-service.ts`) - Secure file operations with path traversal prevention
- **FileChangeTracker** (`services/file-change-tracker.ts`) - Parses Claude Code `.jsonl` logs to track file changes
- **ClaudeCodeService** (`services/claude-code.ts`) - Monitors Claude Code state from `.jsonl` files

### Key API Routes

- `POST /api/sessions` - Create new Claude Code session
- `GET /api/sessions/:id/terminal` - WebSocket connection to tmux session
- `GET /api/files/list` - Directory listing (restricted to session working directory)
- `GET /api/files/read` - File content (with size limits)
- `GET /api/files/changes/:sessionWorkingDir` - Claude Code changes from `.jsonl`

### Frontend Components

- **Terminal.tsx** - xterm.js terminal with custom soft keyboard
- **TabletLayout.tsx** - Split-pane layout for tablets (terminal + session list + keyboard)
- **FileViewer** (`components/files/`) - File browser, code viewer with syntax highlighting, diff viewer

### Terminal Communication

```
Browser <--WebSocket--> Hono Server <--PTY--> tmux <--pipe--> Claude Code
```

The backend upgrades HTTP to WebSocket for terminal connections, creates a PTY, and attaches it to tmux.

## Environment Variables

```bash
PORT=3000              # Server port
HOST=0.0.0.0           # Server host
TLS=1                  # Enable TLS (auto-generates self-signed cert)
TLS=tailscale          # Use Tailscale certificate
TLS_CERT=/path         # Custom TLS certificate
TLS_KEY=/path          # Custom TLS key
STATIC_ROOT=../frontend/dist  # Static files location
```

## Type Sharing

Types are defined in `shared/types.ts` with Zod schemas for validation. Import from `../../../shared/types` in both backend and frontend.
