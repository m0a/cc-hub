/**
 * Low-level herdr socket API client.
 *
 * herdr (https://herdr.dev) speaks newline-delimited JSON over a Unix socket.
 * The server closes the connection after each response, so `herdrRpc` opens
 * one connection per request. `events.subscribe` is the exception: the
 * connection is held open and later lines are pushed events.
 *
 * Pane id mapping: CC Hub's wire protocol and frontend validate pane ids as
 * tmux-style `%N` (PaneIdSchema). herdr ids are `w<K>:p<N>` with `N` unique
 * within a workspace, so `%N ↔ <workspaceId>:pN` is a lossless mapping as
 * long as one CC Hub session maps to one herdr workspace.
 */

import { connect } from 'node:net';
import { homedir } from 'node:os';

export function herdrSocketPath(): string {
  return process.env.HERDR_SOCKET_PATH || `${homedir()}/.config/herdr/herdr.sock`;
}

export interface HerdrScroll {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
  viewport_rows: number;
}

export interface HerdrPane {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  terminal_id: string;
  cwd: string;
  foreground_cwd?: string;
  focused: boolean;
  agent_status: string;
  revision: number;
  scroll: HerdrScroll;
}

export interface HerdrWorkspace {
  workspace_id: string;
  label: string;
  number: number;
  focused: boolean;
  active_tab_id?: string;
  agent_status?: string;
  pane_count?: number;
  tab_count?: number;
}

const RPC_TIMEOUT_MS = 10_000;
let reqCounter = 0;

export async function herdrRpc<T = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const sock = connect(herdrSocketPath());
    let buf = '';
    const id = `cchub_${++reqCounter}`;
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`herdr rpc timeout: ${method}`));
    }, RPC_TIMEOUT_MS);
    sock.on('connect', () => {
      sock.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      sock.end();
      try {
        const msg = JSON.parse(buf.slice(0, nl)) as {
          result?: T;
          error?: { code?: string; message?: string };
        };
        if (msg.error) {
          reject(new Error(`herdr ${method}: ${msg.error.message ?? msg.error.code ?? 'error'}`));
        } else {
          resolve(msg.result as T);
        }
      } catch (err) {
        reject(err as Error);
      }
    });
    sock.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Subscribe to herdr push events. Returns an unsubscribe function.
 * The first response line is the subscription ack; later lines are events.
 * `onClose` fires once if the connection drops (herdr restart etc.).
 */
export function herdrSubscribe(
  subscriptions: Array<Record<string, unknown>>,
  onEvent: (ev: Record<string, unknown>) => void,
  onClose: () => void,
): () => void {
  const sock = connect(herdrSocketPath());
  let buf = '';
  let acked = false;
  let stopped = false;
  sock.on('connect', () => {
    sock.write(
      `${JSON.stringify({ id: 'cchub_sub', method: 'events.subscribe', params: { subscriptions } })}\n`,
    );
  });
  sock.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8');
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (!acked) {
          acked = true;
        } else {
          onEvent(msg);
        }
      } catch {
        // skip malformed line
      }
      nl = buf.indexOf('\n');
    }
  });
  const emitClose = () => {
    if (!stopped) {
      stopped = true;
      onClose();
    }
  };
  sock.on('close', emitClose);
  sock.on('error', emitClose);
  return () => {
    stopped = true;
    sock.destroy();
  };
}

/** `w1:p3` → `%3` (null if the id doesn't match the herdr shape) */
export function toTmuxPaneId(herdrPaneId: string): string | null {
  const m = herdrPaneId.match(/:p(\d+)$/);
  return m ? `%${m[1]}` : null;
}

/** `%3` + workspace `w1` → `w1:p3` */
export function toHerdrPaneId(workspaceId: string, tmuxPaneId: string): string {
  return `${workspaceId}:p${tmuxPaneId.slice(1)}`;
}

export async function listWorkspaces(): Promise<HerdrWorkspace[]> {
  const res = await herdrRpc<{ workspaces: HerdrWorkspace[] }>('workspace.list', {});
  return res.workspaces ?? [];
}

export async function listPanes(workspaceId?: string): Promise<HerdrPane[]> {
  const params: Record<string, unknown> = workspaceId ? { workspace_id: workspaceId } : {};
  const res = await herdrRpc<{ panes: HerdrPane[] }>('pane.list', params);
  return res.panes ?? [];
}

export async function getPane(herdrPaneId: string): Promise<HerdrPane | null> {
  try {
    const res = await herdrRpc<{ pane: HerdrPane }>('pane.get', { pane_id: herdrPaneId });
    return res.pane ?? null;
  } catch {
    return null;
  }
}

export interface HerdrReadResult {
  pane_id: string;
  source: string;
  format: string;
  text: string;
}

export async function readPane(
  herdrPaneId: string,
  source: 'visible' | 'recent' | 'recent_unwrapped',
  lines?: number,
): Promise<string | null> {
  try {
    const res = await herdrRpc<{ read: HerdrReadResult }>('pane.read', {
      pane_id: herdrPaneId,
      source,
      ...(lines != null ? { lines } : {}),
      format: 'ansi',
      strip_ansi: false,
    });
    return res.read?.text ?? null;
  } catch {
    return null;
  }
}

export async function readPaneText(
  herdrPaneId: string,
  source: 'visible' | 'recent',
  lines?: number,
): Promise<string | null> {
  try {
    const res = await herdrRpc<{ read: HerdrReadResult }>('pane.read', {
      pane_id: herdrPaneId,
      source,
      ...(lines != null ? { lines } : {}),
      format: 'text',
      strip_ansi: true,
    });
    return res.read?.text ?? null;
  } catch {
    return null;
  }
}

export interface FrameMeta {
  /** true = full repaint, false = incremental */
  full: boolean;
  width: number;
  height: number;
  seq: number;
}

export interface PaneControllerHandlers {
  /** Called for every terminal.frame with the decoded VT bytes. */
  onFrame: (bytes: Buffer, meta: FrameMeta) => void;
  /** Called once when the control subprocess exits or its stream ends. */
  onExit: () => void;
}

/**
 * Persistent `herdr terminal session control` client for one pane.
 *
 * This is the herdr equivalent of tmux -CC for a single pane: stdin accepts
 * newline-delimited JSON commands and stdout streams terminal.frame records.
 *
 *   {"type":"terminal.input","bytes":"<base64>"}  raw PTY write, NO
 *       sanitization (verified against herdr 0.7.3 src/client/mod.rs) —
 *       unlike pane.send_input, which strips ESC/newlines from text.
 *   {"type":"terminal.resize","cols":N,"rows":N}  absolute PTY resize.
 *
 * Input ordering is guaranteed by the single stdin pipe, and raw byte
 * passthrough means mouse SGR sequences, bracketed paste, and arbitrary
 * escape sequences reach the application intact.
 */
export class PaneController {
  private proc: ReturnType<typeof Bun.spawn>;
  private stdinWriter: { write(s: string): unknown; flush?(): unknown };
  private exited = false;

  constructor(
    readonly herdrPaneId: string,
    cols: number,
    rows: number,
    handlers: PaneControllerHandlers,
  ) {
    this.proc = Bun.spawn(
      [
        'herdr',
        'terminal',
        'session',
        'control',
        herdrPaneId,
        '--takeover',
        '--cols',
        String(cols),
        '--rows',
        String(rows),
      ],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
    );
    this.stdinWriter = this.proc.stdin as unknown as { write(s: string): unknown };

    void this.readFrames(handlers);
    void this.proc.exited.then(() => {
      if (!this.exited) {
        this.exited = true;
        handlers.onExit();
      }
    });
  }

  private async readFrames(handlers: PaneControllerHandlers): Promise<void> {
    const stdout = this.proc.stdout;
    if (!stdout || typeof stdout === 'number') return;
    const reader = stdout.getReader();
    let buf = '';
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf('\n');
        while (nl >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          try {
            const msg = JSON.parse(line) as {
              type?: string;
              bytes?: string;
              full?: boolean;
              width?: number;
              height?: number;
              seq?: number;
            };
            if (msg.type === 'terminal.frame' && typeof msg.bytes === 'string') {
              handlers.onFrame(Buffer.from(msg.bytes, 'base64'), {
                full: msg.full ?? false,
                width: msg.width ?? 0,
                height: msg.height ?? 0,
                seq: msg.seq ?? 0,
              });
            }
          } catch {
            // skip malformed line
          }
          nl = buf.indexOf('\n');
        }
      }
    } catch {
      // stream torn down
    }
  }

  private send(obj: Record<string, unknown>): void {
    if (this.exited) return;
    try {
      this.stdinWriter.write(`${JSON.stringify(obj)}\n`);
    } catch {
      // stdin closed
    }
  }

  /** Write raw bytes to the pane's PTY (ordering guaranteed by the pipe). */
  input(data: Buffer): void {
    this.send({ type: 'terminal.input', bytes: data.toString('base64') });
  }

  /** Absolute PTY resize. */
  resize(cols: number, rows: number): void {
    this.send({ type: 'terminal.resize', cols, rows });
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  kill(): void {
    this.exited = true;
    try {
      (this.proc.stdin as unknown as { end?: () => void })?.end?.();
    } catch {
      // already closed
    }
    try {
      this.proc.kill();
    } catch {
      // already dead
    }
  }
}
