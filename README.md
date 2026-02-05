# CC Hub

[日本語](README.ja.md) | English

A web-based terminal manager for remotely managing Claude Code sessions. Control Claude Code from your tablet or smartphone.

## Features

- **Multi-session Management** - Run and switch between multiple Claude Code sessions
- **Session Color Themes** - Assign colors to sessions for visual distinction
- **Tablet-optimized UI** - Split layout, floating keyboard, pinch-to-zoom
- **Mobile Support** - Tap/long-press for custom keyboard, no OS keyboard needed
- **File Viewer** - Syntax-highlighted code, image and HTML preview
- **Change Tracking** - View file diffs from Claude Code edits
- **Tailscale Integration** - Secure HTTPS via Tailscale certificates
- **Password Authentication** - Access control with `-P` option
- **Auto-update** - Automatic updates from GitHub Releases
- **systemd Integration** - Service registration with auto-restart
- **Dashboard** - Usage limits, daily statistics, cost estimates
- **Session History** - Browse and resume past Claude Code sessions
- **Conversation Viewer** - Markdown rendering, image display, system summary distinction

## Installation

### One-line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/m0a/cc-hub/main/install.sh | bash
```

### Manual Installation

1. Download the appropriate binary from [Releases](https://github.com/m0a/cc-hub/releases/latest)
   - Linux x64: `cchub-linux-x64`
   - macOS ARM64: `cchub-macos-arm64`

2. Make executable and place in PATH

```bash
chmod +x cchub-linux-x64
mv cchub-linux-x64 ~/bin/cchub
```

3. Add to PATH (if not already configured)

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Requirements

| Dependency | Required | Installation |
|------------|----------|--------------|
| [Tailscale](https://tailscale.com/) | Yes | Linux: https://tailscale.com/download / macOS: `brew install tailscale` |
| [tmux](https://github.com/tmux/tmux) 3.0+ | Yes | `apt install tmux` / `brew install tmux` |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Yes | `npm install -g @anthropic-ai/claude-code` |

## Quick Start

```bash
# 1. Allow Tailscale certificate generation (first time only)
sudo tailscale set --operator=$USER

# 2. Start CC Hub
cchub
# Or with password
cchub -P mypassword

# 3. Access in browser
#    https://<your-hostname>:5923
```

### Register as systemd Service

```bash
cchub setup -P mypassword
```

This enables:
- Auto-start on system boot
- Auto-restart on crash
- Auto-update via `cchub update`

## Development Setup

For development or building from source, [Bun](https://bun.sh/) 1.0+ is required.

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

Open http://localhost:5173 in browser (development mode).

### Build from Source

```bash
# Build as single binary
bun run build:binary
./dist/cchub
```

## Commands

```bash
# Start server
cchub                        # Start on port 5923
cchub -p 8080                # Specify port
cchub -P mypassword          # Start with password

# Register systemd service (auto-restart, auto-update)
cchub setup -P mypassword

# Update
cchub update                 # Update to latest
cchub update --check         # Check for updates only

# Status
cchub status
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port` | Port number | 5923 |
| `-H, --host` | Bind address | 0.0.0.0 |
| `-P, --password` | Auth password | none |
| `-h, --help` | Show help | - |
| `-v, --version` | Show version | - |

### Tailscale Configuration

First-time setup requires allowing certificate generation:

```bash
sudo tailscale set --operator=$USER
```

> **macOS**: Install via `brew install tailscale`, not the App Store version. The App Store version lacks CLI commands needed for certificate generation.

### tmux Configuration (Optional)

CC Hub works with default tmux settings, but these are recommended:

```bash
# ~/.tmux.conf
set -g mouse on              # Enable mouse support
set -g history-limit 10000   # Increase scrollback history
```

## Usage

1. Open CC Hub in browser
2. Create a Claude Code session with "New Session"
3. Operate Claude Code in the terminal
4. Open file viewer with the file icon

### Session Color Themes

Assign colors to sessions for visual distinction:

1. **Long-press** a session in the session list
2. Color selection menu appears
3. Choose from 9 colors (red, orange, amber, green, teal, blue, indigo, purple, pink) + none
4. Terminal background changes to selected color

Settings are saved to `~/.cchub/session-themes.json` and persist across restarts.

### Tablet Mode

Automatically switches to tablet layout when screen width ≥ 640px and height ≥ 500px:
- Left: Terminal (pinch-to-zoom supported)
- Top right: Session list / Dashboard / History (tab switching)
- Bottom right: Floating keyboard

**Pinch Zoom**: Pinch with two fingers on the terminal to zoom. UI controls are not affected by zoom.

### Keyboard Features

**Mobile (Smartphone)**:
- **Tap** or **long-press** terminal to show custom keyboard
- OS standard keyboard does not appear
- Scroll to dismiss keyboard

**Floating Keyboard (Tablet)**:
- Drag header to move position
- Minimize button for compact view
- Position saved separately for Japanese and keyboard modes

**Key Operations**:
- **Long-press** - Symbol input on number keys (1→!, 2→@, etc.)
- **あ** - Switch to Japanese input mode (uses OS standard IME)
- **ABC** - Return to keyboard mode
- **📁** - Image upload (inserts path into terminal)
- **🔗** - Show URL list from terminal

### Dashboard

View the following in the "Dashboard" tab:

- **Usage Limits** - 5-hour/7-day cycle usage rate, time until reset
- **Limit Prediction** - Estimated time to reach limit at current pace
- **Daily Statistics** - Message and session count graphs
- **Model Usage** - Opus/Sonnet token usage comparison
- **Cost Estimate** - Estimated API costs

### Session History

Browse past Claude Code sessions in the "History" tab:

- Grouped by project
- View conversation content (Markdown supported)
- Resume sessions (continues with `claude -r`)
- Full-text search across all user messages

## Development

```bash
# Frontend only
bun run dev:frontend

# Backend only
bun run dev:backend

# Test
bun run test

# Lint
bun run lint
```

## Tech Stack

- **Backend**: Bun, Hono, WebSocket
- **Frontend**: React 19, Vite, Tailwind CSS v4, xterm.js
- **Terminal**: tmux, PTY

## License

MIT
