/**
 * HerdrService — session-level operations on the herdr backend.
 *
 * Maps CC Hub sessions onto herdr workspaces (session id = workspace label,
 * falling back to workspace_id). Panes expose no TTY; agent detection uses
 * the pane's foreground process group instead. Copy-mode and paste-buffer
 * APIs are inert (no herdr equivalent).
 */

import { detectAgentProviderFromArgs, type AgentProvider } from '../../../shared/types';
import {
  herdrRpc,
  listPanes,
  listWorkspaces,
  readPaneText,
  toTmuxPaneId,
  type HerdrAgentStatus,
  type HerdrWorkspace,
} from './herdr-client';
import { herdrControlSessions } from './herdr-control';

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
  /** Native agent session id (e.g. Claude conversation UUID) reported by the
   *  herdr agent integration hook. Authoritative for .jsonl matching — two
   *  sessions in the same workingDir stay distinguishable. */
  agentSessionId?: string;
  /** herdr's own agent detection, verified against Claude 2.x on herdr 0.7.3:
   *  `working` while it responds, `blocked` while a TUI prompt waits on the
   *  user (AskUserQuestion / permission), `idle` before a turn, `done` after
   *  one, `unknown` when no agent is on the pane. Drives the indicator, so
   *  hooks no longer have to report every state transition. */
  agentStatus?: HerdrAgentStatus;
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

  /**
   * pane_id → native agent session id (Claude conversation UUID etc.),
   * reported to herdr by its agent integration hooks. Best-effort: without
   * the integration installed the map is simply empty.
   */
  private async listAgentSessions(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const res = await herdrRpc<{
        agents?: Array<{
          pane_id?: string;
          agent_session?: { kind?: string; value?: string };
        }>;
      }>('agent.list', {});
      for (const a of res.agents ?? []) {
        if (a.pane_id && a.agent_session?.kind === 'id' && a.agent_session.value) {
          map.set(a.pane_id, a.agent_session.value);
        }
      }
    } catch {
      // enrichment only
    }
    return map;
  }

  async listSessions(): Promise<HerdrSessionInfo[]> {
    if (
      this.listSessionsCache &&
      Date.now() - this.listSessionsCache.timestamp < HerdrService.LIST_SESSIONS_CACHE_TTL
    ) {
      return this.listSessionsCache.data;
    }

    try {
      const [workspaces, allPanes, agentSessions] = await Promise.all([
        listWorkspaces(),
        listPanes(),
        this.listAgentSessions(),
      ]);

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
          let agentPaneStatus: HerdrAgentStatus | undefined;
          for (const p of wsPanes) {
            const { cmdlines } = await this.paneProcesses(p.pane_id);
            const detected = HerdrService.detectAgent(cmdlines);
            if (detected) {
              agent = detected;
              agentPanePath = p.foreground_cwd || p.cwd;
              agentPaneStatus = p.agent_status;
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
          const agentSessionId = wsPanes
            .map((p) => agentSessions.get(p.pane_id))
            .find((id) => id !== undefined);
          // `blocked` anywhere in the workspace wins: an agent waiting on a
          // prompt is the state the user has to act on, even if the split it
          // sits in isn't the one we matched an agent process to.
          const agentStatus: HerdrAgentStatus | undefined = wsPanes.some(
            (p) => p.agent_status === 'blocked',
          )
            ? 'blocked'
            : agentPaneStatus;
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
            agentSessionId,
            agentStatus,
          };
        }),
      );

      this.listSessionsCache = { data: result, timestamp: Date.now() };
      return result;
    } catch {
      return [];
    }
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

  /**
   * Move a session's workspace to `targetIndex` in herdr's workspace order.
   * herdr IS the session order — there is no cchub-side order to keep in sync.
   *
   * herdr's `insert_index` means "insert before the workspace currently at
   * that index", evaluated against the list with the moved workspace still in
   * it. Moving backward (to a smaller index) therefore lands exactly on the
   * index, but moving forward lands one slot short, so compensate. Verified
   * against herdr 0.7.3/0.7.4: index 13 → insert 0 lands at 0; index 0 →
   * insert 5 lands at 4.
   */
  async moveSession(sessionId: string, targetIndex: number): Promise<boolean> {
    const workspaces = await listWorkspaces();
    const current = workspaces.findIndex(
      (w) => workspaceSessionId(w) === sessionId || w.workspace_id === sessionId,
    );
    if (current === -1) return false;

    const clamped = Math.max(0, Math.min(targetIndex, workspaces.length - 1));
    if (clamped === current) return true;

    const insertIndex = current < clamped ? clamped + 1 : clamped;
    await herdrRpc('workspace.move', {
      workspace_id: workspaces[current].workspace_id,
      insert_index: insertIndex,
    });
    // The 2s list cache would otherwise serve the pre-move order back to the
    // very next sessions push and snap the dragged row back.
    this.invalidateCache();
    return true;
  }

  async killSession(sessionId: string): Promise<void> {
    this.invalidateCache();
    const ws = await this.resolveWorkspace(sessionId);
    if (!ws) {
      throw new Error(`Failed to kill session: workspace not found: ${sessionId}`);
    }
    await herdrRpc('workspace.close', { workspace_id: ws.workspace_id });
    // Reap the control session immediately. Left in the registry, it would
    // be handed out for a future same-name workspace while still bound to
    // the closed one (blank viewports, dead-pane controller spawn loops).
    herdrControlSessions.get(sessionId)?.destroy();
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    return (await this.resolveWorkspace(sessionId)) !== null;
  }
}
