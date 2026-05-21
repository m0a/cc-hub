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
  base64: boolean;
  localPort: number;
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

  const peer = await resolvePeer(target.peer, options.localPort);

  // base64 指定時は payload は既に base64 文字列のはず。utf-8 のときはそのまま渡す
  const body = {
    paneId: target.paneId,
    data: payload,
    encoding: options.base64 ? 'base64' : 'utf-8',
  };

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

  const json = (await res.json().catch(() => ({}))) as { bytes?: number };
  console.log(`✅ sent ${json.bytes ?? payload.length} bytes to ${target.peer}:${target.sessionId}:${target.paneId}`);
}
