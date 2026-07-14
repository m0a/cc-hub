/**
 * HerdrService — herdr-backed drop-in for TmuxService.
 *
 * Implements the TmuxService surface `routes/sessions.ts` and
 * `routes/terminal-mux.ts` consume, mapping CC Hub sessions onto herdr
 * workspaces (session id = workspace label, falling back to workspace_id).
 *
 * Notable degradations vs the tmux backend (interim, see
 * poc/herdr/FINDINGS.md): panes expose no TTY (ps-based enrichment finds
 * nothing; agent detection uses pane process info instead), copy-mode and
 * paste-buffer APIs are inert, and status-bar metadata (setSessionState /
 * setSessionMeta) is a no-op.
 */

import { detectAgentProviderFromArgs, type AgentProvider, type IndicatorState } from '../../../shared/types';
import {
  herdrRpc,
  listPanes,
  listWorkspaces,
  readPaneText,
  toTmuxPaneId,
  type HerdrWorkspace,
} from './herdr-client';
import type { ParsedProcessInfo } from './tmux';

interface HerdrPaneInfo {
  paneId: string;
  command: string;
  path: string;
  title: string;
  tty: string;
  isActive: boolean;
  isDead: boolean;
  pid?: number;
}

interface HerdrSessionInfo {
  id: string;
  name: string;
  createdAt: string;
  attached: boolean;
  currentCommand?: string;
  agent?: AgentProvider;
  currentPath?: string;
  paneTitle?: string;
  paneTty?: string;
  preview?: string;
  panes?: HerdrPaneInfo[];
}

function emptyProcessInfo(): ParsedProcessInfo {
  return {
    claudeTtys: new Set(),
    codexTtys: new Set(),
    agentTtys: new Map(),
    agentByTty: new Map(),
    agentInfo: new Map(),
    ttyArgs: new Map(),
  };
}

/** Session id for a workspace: label when present, else the workspace id. */
function workspaceSessionId(ws: HerdrWorkspace): string {
  return ws.label && ws.label.trim() !== '' ? ws.label : ws.workspace_id;
}

export class HerdrService {
  private listSessionsCache: { data: HerdrSessionInfo[]; timestamp: number } | null = null;
  private static readonly LIST_SESSIONS_CACHE_TTL = 2000;
  // pane process info cache (pane_id → foreground process snapshot)
  private processCmdCache = new Map<
    string,
    { cmdlines: string[]; leader: string; pid?: number; timestamp: number }
  >();
  private static readonly PROCESS_CMD_CACHE_TTL = 3000;

  private async resolveWorkspace(sessionId: string): Promise<HerdrWorkspace | null> {
    try {
      const workspaces = await listWorkspaces();
      return (
        workspaces.find((w) => workspaceSessionId(w) === sessionId) ??
        workspaces.find((w) => w.workspace_id === sessionId) ??
        null
      );
    } catch {
      return null;
    }
  }

  private async paneProcesses(
    herdrPaneId: string,
  ): Promise<{ cmdlines: string[]; leader: string; pid?: number }> {
    const cached = this.processCmdCache.get(herdrPaneId);
    if (cached && Date.now() - cached.timestamp < HerdrService.PROCESS_CMD_CACHE_TTL) {
      return cached;
    }
    try {
      const res = await herdrRpc<{
        process_info?: {
          shell_pid?: number;
          foreground_processes?: Array<{
            pid?: number;
            name?: string;
            argv?: string[];
            cmdline?: string;
          }>;
        };
      }>('pane.process_info', { pane_id: herdrPaneId });
      // foreground_processes lists the whole foreground group: its first
      // entry is the group leader (e.g. `claude`), later entries are its
      // children (MCP servers etc.). Agent detection scans all of them.
      const procs = res.process_info?.foreground_processes ?? [];
      const cmdlines = procs
        .map((p) => p.cmdline || p.argv?.join(' ') || p.name || '')
        .filter((c) => c.length > 0);
      const leaderProc = procs[0];
      const entry = {
        cmdlines,
        leader: leaderProc?.name || leaderProc?.cmdline || '',
        pid: typeof leaderProc?.pid === 'number' ? leaderProc.pid : undefined,
        timestamp: Date.now(),
      };
      this.processCmdCache.set(herdrPaneId, entry);
      return entry;
    } catch {
      const entry = { cmdlines: [], leader: '', timestamp: Date.now() };
      this.processCmdCache.set(herdrPaneId, entry);
      return entry;
    }
  }

  private static detectAgent(cmdlines: string[]): AgentProvider | undefined {
    for (const cmd of cmdlines) {
      const detected = detectAgentProviderFromArgs(cmd);
      if (detected) return detected;
    }
    return undefined;
  }

  async listSessions(): Promise<HerdrSessionInfo[]> {
    if (
      this.listSessionsCache &&
      Date.now() - this.listSessionsCache.timestamp < HerdrService.LIST_SESSIONS_CACHE_TTL
    ) {
      return this.listSessionsCache.data;
    }

    try {
      const [workspaces, allPanes] = await Promise.all([listWorkspaces(), listPanes()]);

      const result: HerdrSessionInfo[] = await Promise.all(
        workspaces.map(async (ws) => {
          const wsPanes = allPanes.filter((p) => p.workspace_id === ws.workspace_id);
          const panes: HerdrPaneInfo[] = await Promise.all(
            wsPanes.map(async (p) => {
              const tmuxId = toTmuxPaneId(p.pane_id) ?? p.pane_id;
              const { leader, pid } = await this.paneProcesses(p.pane_id);
              return {
                paneId: tmuxId,
                command: leader.split(/\s+/)[0]?.split('/').pop() ?? '',
                path: p.foreground_cwd || p.cwd || '',
                title: '',
                tty: '',
                isActive: p.focused,
                isDead: false,
                pid,
              };
            }),
          );

          // Agent detection from the pane's foreground process group (herdr
          // also exposes agent_status natively, but it doesn't tell us WHICH
          // agent).
          let agent: AgentProvider | undefined;
          let agentPanePath: string | undefined;
          for (const p of wsPanes) {
            const { cmdlines } = await this.paneProcesses(p.pane_id);
            const detected = HerdrService.detectAgent(cmdlines);
            if (detected) {
              agent = detected;
              agentPanePath = p.foreground_cwd || p.cwd;
              break;
            }
          }

          const rootPane = wsPanes[0];
          const rootHerdrId = rootPane?.pane_id;
          let preview: string | undefined;
          if (rootHerdrId) {
            const text = await readPaneText(rootHerdrId, 'recent', 15);
            if (text) {
              preview =
                text
                  .split('\n')
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0)
                  .slice(-3)
                  .join(' ')
                  .slice(0, 100) || undefined;
            }
          }

          const currentPath = agentPanePath ?? rootPane?.foreground_cwd ?? rootPane?.cwd;
          return {
            id: workspaceSessionId(ws),
            name: workspaceSessionId(ws),
            createdAt: new Date(0).toISOString(),
            attached: ws.focused,
            currentCommand: agent ?? panes[0]?.command,
            agent,
            currentPath,
            paneTitle: undefined,
            paneTty: undefined,
            preview,
            panes,
          };
        }),
      );

      this.listSessionsCache = { data: result, timestamp: Date.now() };
      return result;
    } catch {
      return [];
    }
  }

  async batchProcessInfo(_ttyNames: string[]): Promise<ParsedProcessInfo> {
    // herdr panes expose no TTYs; ps-based enrichment has nothing to key on.
    return emptyProcessInfo();
  }

  async batchCheckClaudeOnTtys(_ttyNames: string[]): Promise<Set<string>> {
    return new Set();
  }

  async batchGetAgentInfo(
    _ttyNames: string[],
  ): Promise<Map<string, { agentName: string; agentColor?: string }>> {
    return new Map();
  }

  async isClaudeRunningOnTty(_tty: string): Promise<boolean> {
    return false;
  }

  setSessionState(_sessionName: string, _state?: IndicatorState): void {
    // tmux status-bar dot; no herdr equivalent wired up yet
  }

  async capturePane(sessionId: string, lines: number = 15): Promise<string | null> {
    const ws = await this.resolveWorkspace(sessionId);
    if (!ws) return null;
    try {
      const panes = await listPanes(ws.workspace_id);
      const root = panes[0];
      if (!root) return null;
      return await readPaneText(root.pane_id, 'recent', lines);
    } catch {
      return null;
    }
  }

  async capturePreview(sessionId: string, lines: number = 5): Promise<string | null> {
    const text = await this.capturePane(sessionId, lines);
    if (!text) return null;
    const cleaned = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(-3)
      .join(' ')
      .slice(0, 100);
    return cleaned || null;
  }

  async captureScrollback(sessionId: string, lines: number = 1000): Promise<string | null> {
    return this.capturePane(sessionId, Math.min(lines, 1000));
  }

  invalidateCache(): void {
    this.listSessionsCache = null;
    this.processCmdCache.clear();
  }

  async createSession(name: string): Promise<string> {
    this.invalidateCache();
    const existing = await this.resolveWorkspace(name);
    if (existing) {
      throw new Error(`Failed to create session: workspace "${name}" already exists`);
    }
    await herdrRpc('workspace.create', {
      label: name,
      cwd: process.env.HOME || '/tmp',
    });
    return name;
  }

  async killSession(sessionId: string): Promise<void> {
    this.invalidateCache();
    const ws = await this.resolveWorkspace(sessionId);
    if (!ws) {
      throw new Error(`Failed to kill session: workspace not found: ${sessionId}`);
    }
    await herdrRpc('workspace.close', { workspace_id: ws.workspace_id });
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    return (await this.resolveWorkspace(sessionId)) !== null;
  }

  async isInCopyMode(_sessionId: string): Promise<boolean> {
    return false;
  }

  async getBuffer(): Promise<string | null> {
    return null;
  }

  /** Send literal text + Enter to the session's root pane. */
  async sendKeys(sessionId: string, keys: string): Promise<boolean> {
    const ws = await this.resolveWorkspace(sessionId);
    if (!ws) return false;
    try {
      const panes = await listPanes(ws.workspace_id);
      const root = panes[0];
      if (!root) return false;
      await herdrRpc('pane.send_input', {
        pane_id: root.pane_id,
        text: keys,
        keys: ['enter'],
      });
      return true;
    } catch {
      return false;
    }
  }
}
