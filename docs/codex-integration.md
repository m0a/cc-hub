# Codex Integration

## Goal

CC Hub can create, detect, and display tmux sessions that run either Claude Code or OpenAI Codex CLI.

Claude Code remains the default agent. Codex is supported as a first-class additional agent provider with detection, session metadata, conversation viewing (`useCodexConversation`), and usage tracking (`CodexUsageService`).

## Scope

- Add `claude` / `codex` as supported session agent providers.
- Allow the session creation API to receive an optional `agent`.
- Start the selected agent in the selected working directory.
- Detect running Claude Code and Codex processes from tmux pane TTYs.
- Return the detected `agent` in session API responses.
- Read basic Codex thread metadata from the local Codex state database.
- Add a Claude/Codex selector to the new session modal.
- Preserve existing Claude-specific metadata behavior.

## Out of Scope

- Generated Codex recaps equivalent to Claude Code recap hooks.
- Codex prompt/recap parsing beyond what Codex's own state DB / transcripts provide.
- Agent filtering or sorting in the session list.
- Full agent-provider abstraction for adding future CLIs beyond Claude + Codex.
- Broad UI redesign of the session list.

## Behavior

### Session Creation

`POST /api/sessions` accepts:

```json
{
  "name": "example",
  "workingDir": "/path/to/project",
  "agent": "codex"
}
```

If `agent` is omitted, it defaults to `claude`.

The backend starts the selected agent with:

```sh
cd '<workingDir>' && <agent>
```

The working directory is shell-quoted before being sent to tmux.

### Duplicate Guard

The duplicate working directory guard now checks the same agent and same working directory.

For example:

- existing Claude session in `/repo` blocks another Claude session in `/repo`
- existing Codex session in `/repo` blocks another Codex session in `/repo`
- Claude and Codex can be considered separately by the current MVP logic

### Process Detection

The tmux service inspects processes by pane TTY and detects:

- Claude Code: `claude` or Claude versioned paths
- Codex: `codex` or `@openai/codex` paths

When a supported agent is detected on a pane TTY:

- session `currentCommand` becomes `claude` or `codex`
- session `agent` is set to `claude` or `codex`
- pane `currentCommand` becomes `claude` or `codex`

If no supported agent is detected, existing tmux command behavior remains.

### UI

The new session modal includes a Claude/Codex selector.

The frontend sends the selected `agent` in the session creation payload. Claude remains the default.

Codex session cards use the session name instead of pane title for display, because Codex pane titles can resolve to the host name.

### Codex Metadata

Codex does not expose the same JSONL recap fields that CC Hub reads for Claude Code. Instead, CC Hub reads:

- Local SQLite state at `~/.codex/state_5.sqlite` for: thread ID, title, first user message, token count, git branch, updated time.
- Codex conversation transcripts via `CodexConversationService` (`backend/src/services/codex-conversation.ts`).
- Codex token usage / rate limit state via `CodexUsageService` (`backend/src/services/codex-usage.ts`).

This metadata enriches Codex session cards and feeds the conversation viewer. Claude-only actions such as `claude -r` resume are not available for Codex sessions; resume is handled through Codex's own mechanism when supported.

## Changed Files

- `shared/types.ts`
  - Adds `AgentProvider`.
  - Adds optional `agent` to session responses.
  - Adds optional `agent` to `CreateSessionSchema`, defaulting to `claude`.
- `backend/src/services/session-metadata.ts`
  - Persists optional `agent` in last-known session metadata.
- `backend/src/services/tmux.ts`
  - Adds Codex process detection.
  - Adds TTY-to-agent mapping.
  - Selects an agent pane as the representative session pane when available.
- `backend/src/services/codex.ts`
  - Reads latest Codex thread metadata per working directory from local Codex state.
- `backend/src/routes/sessions.ts`
  - Reads `agent` from create-session requests.
  - Starts the selected CLI.
  - Applies duplicate guard by same agent and same working directory.
  - Includes `agent` in list/detail/create responses.
  - Enriches Codex sessions with title, first prompt, thread ID, git branch, and token count when available.
  - Removes last-known metadata during delete.
- `frontend/src/hooks/useSessions.ts`
  - Sends `agent` in create-session requests.
- `frontend/src/components/SessionList.tsx`
  - Adds the Claude/Codex selector to the create modal.
  - Passes selected `agent` into session creation.
- `frontend/src/i18n/locales/en.json`
  - Adds agent labels and updated duplicate message.
- `frontend/src/i18n/locales/ja.json`
  - Adds agent labels and updated duplicate message.

## Agent Registry

A shared agent registry is the source of truth for supported CLI providers.

Current shape:

```ts
export const AGENT_PROVIDERS = {
  claude: {
    id: 'claude',
    command: 'claude',
    labelKey: 'session.agentProvider.claude',
    processPatterns: [/.../],
    supportsConversationMetadata: true,
  },
  codex: {
    id: 'codex',
    command: 'codex',
    labelKey: 'session.agentProvider.codex',
    processPatterns: [/.../],
    supportsConversationMetadata: false,
  },
} as const;
```

The registry is used to derive:

- `AgentProvider`
- `CreateSessionSchema` enum values
- frontend selector options
- backend start command
- tmux process matching
- provider capability checks

Claude-specific services remain Claude-specific, but callers use capability checks such as `supportsConversationMetadata` where practical instead of relying only on direct `agent === 'claude'` checks.

## Verification

Completed checks:

- `bun run typecheck`
- `bun run test`
- Focused agent-provider unit tests for registry IDs, create-session schema, process detection, provider capabilities, and start command quoting.
- Codex metadata unit tests for missing DB, latest thread selection by cwd, and archived thread filtering.
- API confirmed an existing Codex session reports `currentCommand: "codex"` and `agent: "codex"`.
- API confirmed an existing Codex session can include `ccSummary`, `ccFirstPrompt`, `agentSessionId`, `gitBranch`, and token count derived from local Codex metadata.
- API confirmed duplicate working directory handling for an existing Codex session.
- A temporary Codex smoke session was created, detected as Codex, shown in the UI, and deleted.

## Follow-Up Tasks

1. Add route-level tests for duplicate handling by same agent and working directory.
2. Add integration coverage for tmux process detection when a real Codex process is running.
3. Decide whether Claude and Codex should be allowed to share the same working directory at the same time.
4. Add visible agent badges or filters to the session list if useful.
5. Investigate whether Codex exposes additional stable metadata that can be shown alongside Claude Code metadata.
