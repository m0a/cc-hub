/**
 * cchub send - send raw input to a specific pane on a peer or local cchub server.
 *
 * Usage:
 *   cchub send <peer>:<session>:<paneId> "text"
 *   echo "text" | cchub send <peer>:<session>:<paneId> --stdin
 *   cchub send <peer>:<session>:<paneId> "ls -la" --newline
 *
 * <peer> can be a peer nickname, peer id, or "local" for self.
 */

import { listPeers, type StoredPeer } from '../services/peer-registry';

export interface SendOptions {
  target: string;
  text?: string;
  stdin: boolean;
  newline: boolean;
  // Append `\r\r` so Claude Code's TUI exits paste mode and submits the input.
  // Plain `--newline` is `\r` only, which Claude Code treats as a newline
  // inside multi-line paste and never submits.
  submit: boolean;
  base64: boolean;
  localPort: number;
  // --wait: after sending, snapshot the pane viewport and print it. Useful so
  // the sender can see what landed on the peer's screen (and whether the peer
  // is mid-permission-prompt) without opening the peer UI.
  wait: boolean;
  waitMs: number;   // delay before snapshot
  lines: number;    // trailing rows to print (0 = whole viewport)
}

interface ViewportResponse {
  cols: number;
  rows: number;
  totalLines: number;
  lines: string[];      // ANSI preserved
  text: string;          // ANSI stripped
  cursor: { x: number; y: number; visible: boolean };
  detectedState: 'permission_prompt' | 'ask_user_question' | 'processing' | 'idle' | 'unknown';
}

function printViewport(target: ParsedTarget, vp: ViewportResponse): void {
  const stateLabel: Record<ViewportResponse['detectedState'], string> = {
    permission_prompt: '⚠️  permission_prompt (peer is waiting for Yes/No)',
    ask_user_question: '❓ ask_user_question (peer is waiting for a numbered choice)',
    processing: '⏳ processing (peer is running a tool)',
    idle: '✳  idle (peer is at the prompt)',
    unknown: '?  unknown',
  };
  console.error(`\n── ${target.peer}:${target.sessionId}:${target.paneId} (${vp.cols}x${vp.rows}) — ${stateLabel[vp.detectedState]}`);
  // Print viewport WITH ANSI escapes preserved so colors come through.
  for (const line of vp.lines) {
    console.log(line);
  }
  console.error(`── end ─ cursor (${vp.cursor.x},${vp.cursor.y})`);
}

interface ParsedTarget {
  peer: string;
  sessionId: string;
  paneId: string;
}

function parseTarget(target: string): ParsedTarget {
  const parts = target.split(':');
  if (parts.length !== 3 || parts.some(p => !p)) {
    throw new Error(`target は <peer>:<session>:<paneId> 形式で指定してください (got: ${target})`);
  }
  return { peer: parts[0], sessionId: parts[1], paneId: parts[2] };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function resolvePeer(name: string, localPort: number): Promise<{ url: string; token?: string }> {
  if (name === 'local' || name === 'self') {
    // cchub serves HTTPS on localhost (Tailscale cert). notify.ts uses the same pattern.
    return { url: `https://localhost:${localPort}` };
  }
  const peers = await listPeers();
  const match = peers.find(
    (p): p is StoredPeer => p.id === name || p.nickname === name,
  );
  if (!match) {
    const known = peers.map(p => `${p.id} (${p.nickname})`).join(', ');
    throw new Error(`peer "${name}" が見つかりません。登録済み peer: ${known || '(none)'}`);
  }
  if (match.url === 'self') {
    return { url: `http://localhost:${localPort}`, token: undefined };
  }
  return { url: match.url.replace(/\/+$/, ''), token: match.wsToken };
}

export async function runSend(options: SendOptions): Promise<void> {
  const target = parseTarget(options.target);

  let payload: string;
  if (options.stdin) {
    payload = await readStdin();
  } else if (options.text !== undefined) {
    payload = options.text;
  } else {
    throw new Error('text 引数か --stdin のいずれかを指定してください');
  }

  if (options.newline) {
    payload = `${payload}\r`;
  }
  if (options.submit) {
    payload = `${payload}\r\r`;
  }

  const peer = await resolvePeer(target.peer, options.localPort);

  // base64 指定時は payload は既に base64 文字列のはず。utf-8 のときはそのまま渡す
  const body: Record<string, unknown> = {
    paneId: target.paneId,
    data: payload,
    encoding: options.base64 ? 'base64' : 'utf-8',
  };
  if (options.wait) {
    body.wait = true;
    body.waitMs = options.waitMs;
    body.lines = options.lines;
  }

  // Tailscale 証明書は localhost 名と一致しないので TLS 検証を切る (notify.ts と同じ運用)
  if (peer.url.startsWith('https://')) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (peer.token) {
    headers.Authorization = `Bearer ${peer.token}`;
  }

  const url = `${peer.url}/api/sessions/${encodeURIComponent(target.sessionId)}/panes/input`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`send 失敗: HTTP ${res.status} ${errText}`);
  }

  const json = (await res.json().catch(() => ({}))) as { bytes?: number; viewport?: ViewportResponse };
  console.error(`✅ sent ${json.bytes ?? payload.length} bytes to ${target.peer}:${target.sessionId}:${target.paneId}`);
  if (json.viewport) {
    printViewport(target, json.viewport);
  }
}

export interface PeekOptions {
  target: string;
  lines: number;
  localPort: number;
}

export async function runPeek(options: PeekOptions): Promise<void> {
  const target = parseTarget(options.target);
  const peer = await resolvePeer(target.peer, options.localPort);

  if (peer.url.startsWith('https://')) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const headers: Record<string, string> = {};
  if (peer.token) {
    headers.Authorization = `Bearer ${peer.token}`;
  }

  const url = `${peer.url}/api/sessions/${encodeURIComponent(target.sessionId)}/panes/${encodeURIComponent(target.paneId)}/viewport?lines=${options.lines}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`peek 失敗: HTTP ${res.status} ${errText}`);
  }

  const vp = (await res.json()) as ViewportResponse;
  printViewport(target, vp);
}
