import type { ServerWebSocket } from 'bun';
import type { Subprocess } from 'bun';
import { TmuxService } from '../services/tmux';
import { updateSessionAccess, createSession, getSession } from '../services/sessions';

interface TerminalData {
  sessionId: string;
  visitorId: string;
  process: Subprocess | null;
}

const tmuxService = new TmuxService('cchub-');

// Map to track active terminal connections
const activeConnections = new Map<string, Set<ServerWebSocket<TerminalData>>>();

// Map to track PTY process per session (only one per session)
const sessionProcesses = new Map<string, Subprocess>();

export const terminalWebSocket = {
  async open(ws: ServerWebSocket<TerminalData>) {
    const { sessionId } = ws.data;
    console.log(`Terminal WebSocket opened for session: ${sessionId}`);

    // Add to active connections
    if (!activeConnections.has(sessionId)) {
      activeConnections.set(sessionId, new Set());
    }
    activeConnections.get(sessionId)!.add(ws);

    // Extract session ID without prefix for API session management
    const apiSessionId = sessionId.replace('cchub-', '');

    // Update session access time (or create session if it doesn't exist in API)
    const session = await getSession(apiSessionId);
    if (session) {
      await updateSessionAccess(apiSessionId);
    } else {
      // Create session in API if it doesn't exist (for backward compatibility)
      await createSession(apiSessionId);
    }

    // Check if tmux session exists, create if not
    const exists = await tmuxService.sessionExists(sessionId);
    if (!exists) {
      try {
        await tmuxService.createSession(apiSessionId);
      } catch (error) {
        console.error('Failed to create tmux session:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to create session' }));
        ws.close();
        return;
      }
    }

    // Check if PTY process already exists for this session
    let proc = sessionProcesses.get(sessionId);

    if (!proc || proc.killed) {
      // Spawn PTY process attached to tmux session
      try {
        proc = Bun.spawn(['tmux', 'attach', '-t', sessionId], {
          stdin: 'pipe',
          terminal: {
            cols: 80,
            rows: 24,
            data(_terminal, data) {
              // Send terminal output to all connected clients
              const connections = activeConnections.get(sessionId);
              if (connections) {
                const dataArray = new Uint8Array(data);
                for (const client of connections) {
                  try {
                    client.send(dataArray);
                  } catch {
                    // Client may have disconnected
                  }
                }
              }
            },
          },
        });

        sessionProcesses.set(sessionId, proc);
        console.log(`PTY process started for session: ${sessionId}`);
      } catch (error) {
        console.error('Failed to spawn PTY:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to start terminal' }));
        ws.close();
        return;
      }
    } else {
      console.log(`Reusing existing PTY process for session: ${sessionId}`);
    }

    ws.data.process = proc;
  },

  async message(ws: ServerWebSocket<TerminalData>, message: string | Buffer) {
    const { process, sessionId } = ws.data;

    if (!process?.terminal) {
      console.log(`[${sessionId}] No terminal process`);
      return;
    }

    // Handle binary data (terminal input)
    if (message instanceof Buffer || message instanceof Uint8Array) {
      const hex = Array.from(new Uint8Array(message)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`[${sessionId}] Binary input: ${hex}`);
      process.terminal.write(message);
      return;
    }

    // Handle JSON messages (resize commands)
    if (message.startsWith('{')) {
      try {
        const data = JSON.parse(message);
        if (data.type === 'resize' && typeof data.cols === 'number' && typeof data.rows === 'number') {
          process.terminal.resize(data.cols, data.rows);
          console.log(`[${sessionId}] Resized to ${data.cols}x${data.rows}`);
          return;
        }
      } catch {
        // Not valid JSON, continue to treat as input
      }
    }

    // String input - send directly to terminal
    const hex = Array.from(new TextEncoder().encode(message)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[${sessionId}] String input: "${message}" (${hex})`);
    process.terminal.write(message);
  },

  close(ws: ServerWebSocket<TerminalData>) {
    const { sessionId } = ws.data;
    console.log(`Terminal WebSocket closed for session: ${sessionId}`);

    // Remove from active connections
    const connections = activeConnections.get(sessionId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        activeConnections.delete(sessionId);

        // Kill the PTY process when no clients are connected
        const proc = sessionProcesses.get(sessionId);
        if (proc) {
          proc.kill();
          sessionProcesses.delete(sessionId);
          console.log(`PTY process killed for session: ${sessionId}`);
        }
      }
    }
  },
};

// Upgrade HTTP request to WebSocket (no auth required)
export async function handleTerminalUpgrade(
  req: Request,
  server: { upgrade: (req: Request, options: { data: TerminalData }) => boolean }
): Promise<Response | null> {
  const url = new URL(req.url);
  const pathMatch = url.pathname.match(/^\/ws\/terminal\/(.+)$/);

  if (!pathMatch) {
    return null;
  }

  const sessionId = decodeURIComponent(pathMatch[1]);
  const fullSessionId = sessionId.startsWith('cchub-') ? sessionId : `cchub-${sessionId}`;

  const upgraded = server.upgrade(req, {
    data: {
      sessionId: fullSessionId,
      visitorId: crypto.randomUUID(),
      process: null,
    },
  });

  if (upgraded) {
    return undefined as unknown as Response;
  }

  return new Response('WebSocket upgrade failed', { status: 500 });
}

export type { TerminalData };
