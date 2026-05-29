import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  PeerCreateSchema,
  PeerUpdateSchema,
  PeerOrderSchema,
  CrossPeerSessionOrderSchema,
  LOCAL_PEER_ID,
  SELF_PEER_URL,
  type PeerClientView,
  type PeerStatus,
  type PeerSession,
  type PeerSessionsResponse,
  type ExtendedSessionResponse,
  type PeerHistoryProject,
  type PeerHistoryProjectsResponse,
  type HistorySession,
} from '../../../shared/types';
import {
  listPeers,
  createPeer,
  updatePeer,
  deletePeer,
  setPeerOrder,
  getCrossPeerSessionOrder,
  setCrossPeerSessionOrder,
  type StoredPeer,
} from '../services/peer-registry';
import { loginToPeer, verifyPeer, peerFetch, PeerAuthError } from '../services/peer-auth';
import { isSafePeerUrl } from '../services/peer-url';
import { discoverPeers } from '../services/peer-discovery';
import { buildSessionsList, sessionHistoryService, codexHistoryService } from './sessions';
import { buildDashboard } from './dashboard';
import { saveUploadedImage } from './upload';
import type { DashboardResponse } from '../../../shared/types';

export const peers = new Hono();

function toClientView(peer: StoredPeer & {
  wsToken?: string;
  lastSeenAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
}): PeerClientView {
  const status: PeerStatus = peer.id === LOCAL_PEER_ID
    ? 'online'
    : peer.lastErrorMessage
      ? (peer.lastErrorMessage === 'unauthorized' ? 'unauthorized' : 'offline')
      : peer.lastSeenAt
        ? 'online'
        : 'unknown';

  return {
    id: peer.id,
    nickname: peer.nickname,
    url: peer.url,
    color: peer.color,
    order: peer.order,
    wsToken: peer.id === LOCAL_PEER_ID ? undefined : peer.wsToken,
    status,
    lastSeenAt: peer.lastSeenAt,
    errorMessage: peer.lastErrorMessage,
  };
}

// GET /api/peers - peer 一覧 (selfを含む)
peers.get('/', async (c) => {
  const all = await listPeers();
  return c.json({ peers: all.map(toClientView) });
});

// GET /api/peers/discover - Tailscale tailnet 内で cchub が動いている peer を検出
peers.get('/discover', async (c) => {
  const discovered = await discoverPeers();
  return c.json({ discovered });
});

// POST /api/peers - peer を追加
peers.post('/', zValidator('json', PeerCreateSchema), async (c) => {
  const { nickname, url, password, color } = c.req.valid('json');

  // 追加前に必ず疎通＆ログインを試す
  let token: string;
  try {
    token = await loginToPeer(url, password);
  } catch (err) {
    if (err instanceof PeerAuthError) {
      return c.json({ error: err.message, code: 'PEER_AUTH_FAILED' }, 400);
    }
    return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }

  const peer = await createPeer({ nickname, url, color, wsToken: token });
  return c.json({ peer: toClientView(peer) });
});

// PATCH /api/peers/:id - nickname/color/password 更新
peers.patch('/:id', zValidator('json', PeerUpdateSchema), async (c) => {
  const id = c.req.param('id');
  const { nickname, color, password } = c.req.valid('json');

  let wsToken: string | undefined;
  if (password) {
    const peer = (await listPeers()).find(p => p.id === id);
    if (!peer || peer.id === LOCAL_PEER_ID) {
      return c.json({ error: 'Peer not found or is local' }, 404);
    }
    try {
      wsToken = await loginToPeer(peer.url, password);
    } catch (err) {
      if (err instanceof PeerAuthError) {
        return c.json({ error: err.message, code: 'PEER_AUTH_FAILED' }, 400);
      }
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
    }
  }

  const peer = await updatePeer(id, { nickname, color, wsToken });
  if (!peer) return c.json({ error: 'Peer not found' }, 404);
  return c.json({ peer: toClientView(peer) });
});

// DELETE /api/peers/:id
peers.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (id === LOCAL_PEER_ID) {
    return c.json({ error: 'Cannot delete local peer' }, 400);
  }
  const deleted = await deletePeer(id);
  if (!deleted) return c.json({ error: 'Peer not found' }, 404);
  return c.json({ success: true });
});

// PUT /api/peers/order - peer 並び替え
peers.put('/order', zValidator('json', PeerOrderSchema), async (c) => {
  const { order } = c.req.valid('json');
  await setPeerOrder(order);
  return c.json({ success: true });
});

// GET /api/peers/session-order - peer 横断のセッション並び順を取得
peers.get('/session-order', async (c) => {
  const order = await getCrossPeerSessionOrder();
  return c.json({ order });
});

// PUT /api/peers/session-order - peer 横断のセッション並び順を保存
peers.put('/session-order', zValidator('json', CrossPeerSessionOrderSchema), async (c) => {
  const { order } = c.req.valid('json');
  await setCrossPeerSessionOrder(order);
  return c.json({ success: true });
});

// POST /api/peers/:id/verify - 疎通確認
peers.post('/:id/verify', async (c) => {
  const id = c.req.param('id');
  const peer = await listPeers().then(ps => ps.find(p => p.id === id));
  if (!peer) return c.json({ error: 'Peer not found' }, 404);
  if (peer.id === LOCAL_PEER_ID) {
    return c.json({ status: 'online', latencyMs: 0 });
  }
  const result = await verifyPeer(peer.id, peer.url, peer.wsToken);
  if (result.ok) {
    return c.json({ status: 'online', latencyMs: result.latencyMs });
  }
  return c.json({
    status: result.status === 401 ? 'unauthorized' : 'offline',
    message: result.message,
  });
});

// -----------------------------------------------------------------------------
// History アグリゲーション
// 各 peer の `/api/sessions/history/...` を並列 fetch して merge する。
// dirName は peer 間で衝突しうるので、peer 情報を必ず併載してクライアントが
// (peerId, dirName) の複合キーで識別できるようにする。
// -----------------------------------------------------------------------------

interface HistoryProjectsResp {
  projects: Array<{
    dirName: string;
    projectPath: string;
    projectName: string;
    sessionCount: number;
    latestModified?: string;
  }>;
}

async function buildLocalHistoryProjects(): Promise<HistoryProjectsResp['projects']> {
  const [claudeProjects, codexProjects] = await Promise.all([
    sessionHistoryService.getProjects(),
    codexHistoryService.getProjects(),
  ]);
  const byDir = new Map<string, HistoryProjectsResp['projects'][number]>();
  for (const p of claudeProjects) byDir.set(p.dirName, p);
  for (const p of codexProjects) {
    const existing = byDir.get(p.dirName);
    if (existing) {
      existing.sessionCount += p.sessionCount;
      if (!existing.latestModified || (p.latestModified && p.latestModified > existing.latestModified)) {
        existing.latestModified = p.latestModified;
      }
    } else {
      byDir.set(p.dirName, p);
    }
  }
  return Array.from(byDir.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
}

// GET /api/peers/history/projects - 全 peer のプロジェクトを merge
peers.get('/history/projects', async (c) => {
  const allPeers = await listPeers();
  const errors: { peerId: string; message: string }[] = [];

  const results = await Promise.all(allPeers.map(async (peer): Promise<PeerHistoryProject[]> => {
    try {
      let projects: HistoryProjectsResp['projects'];
      if (peer.url === SELF_PEER_URL) {
        projects = await buildLocalHistoryProjects();
      } else {
        const res = await peerFetch(peer.id, peer.url, peer.wsToken, '/api/sessions/history/projects');
        if (!res.ok) {
          errors.push({ peerId: peer.id, message: `HTTP ${res.status}` });
          return [];
        }
        const data = (await res.json()) as HistoryProjectsResp;
        if (!Array.isArray(data.projects)) {
          errors.push({ peerId: peer.id, message: 'Invalid response' });
          return [];
        }
        projects = data.projects;
      }
      return projects.map(p => ({
        ...p,
        peerId: peer.id,
        peerNickname: peer.nickname,
        peerColor: peer.color,
      }));
    } catch (err) {
      errors.push({ peerId: peer.id, message: err instanceof Error ? err.message : 'Fetch failed' });
      return [];
    }
  }));

  const merged = results.flat();
  const response: PeerHistoryProjectsResponse = errors.length > 0
    ? { projects: merged, errors }
    : { projects: merged };
  return c.json(response);
});

async function buildLocalProjectSessions(dirName: string): Promise<HistorySession[]> {
  const [claudeSessions, codexSessions] = await Promise.all([
    sessionHistoryService.getProjectSessions(dirName),
    codexHistoryService.getProjectSessions(dirName),
  ]);
  const merged: HistorySession[] = [
    ...claudeSessions.map(s => ({ ...s, agent: s.agent ?? 'claude' as const })),
    ...codexSessions,
  ].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return merged;
}

// GET /api/peers/history/:peerId/projects/:dirName - 指定 peer のプロジェクト内 session 一覧
peers.get('/history/:peerId/projects/:dirName', async (c) => {
  const peerId = c.req.param('peerId');
  const dirName = c.req.param('dirName');
  const peer = (await listPeers()).find(p => p.id === peerId);
  if (!peer) return c.json({ error: 'Peer not found' }, 404);

  let sessions: HistorySession[];
  if (peer.url === SELF_PEER_URL) {
    sessions = await buildLocalProjectSessions(dirName);
  } else {
    const path = `/api/sessions/history/projects/${encodeURIComponent(dirName)}`;
    const res = await peerFetch(peer.id, peer.url, peer.wsToken, path);
    if (!res.ok) return c.json({ error: `HTTP ${res.status}` }, 502);
    const data = (await res.json()) as { sessions: HistorySession[] };
    sessions = data.sessions ?? [];
  }
  // peer 情報を付与
  const enriched = sessions.map(s => ({
    ...s,
    peerId: peer.id,
    peerNickname: peer.nickname,
    peerColor: peer.color,
  }));
  return c.json({ sessions: enriched });
});

// GET /api/peers/history/:peerId/:sessionId/conversation - 指定 peer の会話履歴
peers.get('/history/:peerId/:sessionId/conversation', async (c) => {
  const peerId = c.req.param('peerId');
  const sessionId = c.req.param('sessionId');
  const peer = (await listPeers()).find(p => p.id === peerId);
  if (!peer) return c.json({ error: 'Peer not found' }, 404);

  const agent = c.req.query('agent');
  const projectDirName = c.req.query('projectDirName');
  const lastQuery = c.req.query('last');
  const last = lastQuery ? parseInt(lastQuery, 10) : undefined;

  if (peer.url === SELF_PEER_URL) {
    const messages = agent === 'codex'
      ? await codexHistoryService.getConversation(sessionId)
      : await sessionHistoryService.getConversation(sessionId, projectDirName);
    return c.json({ messages: last ? messages.slice(-last) : messages });
  }

  const qs = new URLSearchParams();
  if (agent) qs.set('agent', agent);
  if (projectDirName) qs.set('projectDirName', projectDirName);
  if (lastQuery) qs.set('last', lastQuery);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const path = `/api/sessions/history/${encodeURIComponent(sessionId)}/conversation${suffix}`;
  const res = await peerFetch(peer.id, peer.url, peer.wsToken, path);
  if (!res.ok) return c.json({ error: `HTTP ${res.status}` }, 502);
  const data = (await res.json()) as { messages: unknown[] };
  return c.json(data);
});

// POST /api/peers/history/:peerId/resume - 指定 peer 上で session を resume
peers.post('/history/:peerId/resume', async (c) => {
  const peerId = c.req.param('peerId');
  const peer = (await listPeers()).find(p => p.id === peerId);
  if (!peer) return c.json({ error: 'Peer not found' }, 404);

  const body = await c.req.json().catch(() => ({}));

  if (peer.url === SELF_PEER_URL) {
    // self: Hub の resume 処理を呼ぶしかないが、 sessions.ts が export してないので
    // peer の REST API 経由で投げる (localhost 越しではなく Hub 自身に対しては
    // 認証無効/有効に関わらず直接 fetch では成り立たない)。
    // → /api/peers の同期 fetch を経由しない最もシンプルな方法: 内部関数を export
    // 今回は最小実装として「self の resume はクライアント側で Hub の /api/sessions/history/resume を直に呼ぶ」前提にし、
    // この endpoint は remote 専用とする。
    return c.json({ error: 'Use /api/sessions/history/resume for local sessions' }, 400);
  }

  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const path = '/api/sessions/history/resume';
  const res = await peerFetch(peer.id, peer.url, peer.wsToken, path, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // peer 側のステータスをそのまま透過 (duplicate_working_dir などのコードもクライアントに届ける)
  if (res.ok) return c.json(data);
  return c.json(data, (res.status >= 400 && res.status < 600 ? res.status : 502) as 400 | 401 | 404 | 409 | 500 | 502);
});

// -----------------------------------------------------------------------------
// Files API プロキシ (peer 上のディレクトリ browse / mkdir 用)
// 新規セッション作成ダイアログで peer 側の filesystem を参照させるため、
// /api/files/browse と /api/files/mkdir を peer-aware にする。
// -----------------------------------------------------------------------------

// GET /api/peers/:peerId/files/browse?path=...
peers.get('/:peerId/files/browse', async (c) => {
  const peerId = c.req.param('peerId');
  const peer = (await listPeers()).find(p => p.id === peerId);
  if (!peer) return c.json({ error: 'Peer not found' }, 404);

  const qsPath = c.req.query('path');
  const suffix = qsPath ? `?path=${encodeURIComponent(qsPath)}` : '';
  const path = `/api/files/browse${suffix}`;

  if (peer.url === SELF_PEER_URL) {
    // self は Hub の /api/files/browse をそのまま使えるが、ルーター越しに呼ぶより
    // クライアントが直接 /api/files/browse を叩いた方が良いので、ここは remote 専用と割り切る
    return c.json({ error: 'Use /api/files/browse for local peer' }, 400);
  }

  const res = await peerFetch(peer.id, peer.url, peer.wsToken, path);
  const data = await res.json().catch(() => ({}));
  if (res.ok) return c.json(data as Record<string, unknown>);
  return c.json(data as Record<string, unknown>, (res.status >= 400 && res.status < 600 ? res.status : 502) as 400 | 404 | 500 | 502);
});

// POST /api/peers/:peerId/files/mkdir
peers.post('/:peerId/files/mkdir', async (c) => {
  const peerId = c.req.param('peerId');
  const peer = (await listPeers()).find(p => p.id === peerId);
  if (!peer) return c.json({ error: 'Peer not found' }, 404);
  if (peer.url === SELF_PEER_URL) {
    return c.json({ error: 'Use /api/files/mkdir for local peer' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const res = await peerFetch(peer.id, peer.url, peer.wsToken, '/api/files/mkdir', init);
  const data = await res.json().catch(() => ({}));
  if (res.ok) return c.json(data as Record<string, unknown>);
  return c.json(data as Record<string, unknown>, (res.status >= 400 && res.status < 600 ? res.status : 502) as 400 | 404 | 500 | 502);
});

// POST /api/peers/:peerId/upload/image
// 画像アップロードを peer 側に転送し、peer のローカル絶対パスを返す。
// peer 上で動いている Claude Code が、そのパスを直接読めるようにするため必須。
peers.post('/:peerId/upload/image', async (c) => {
  const peerId = c.req.param('peerId');
  const peer = (await listPeers()).find(p => p.id === peerId);
  if (!peer) return c.json({ error: 'Peer not found' }, 404);

  // ── local: ハブ自身に保存
  if (peer.url === SELF_PEER_URL) {
    try {
      const formData = await c.req.formData();
      const file = formData.get('image');
      if (!file || !(file instanceof File)) {
        return c.json({ error: 'No image file provided' }, 400);
      }
      const result = await saveUploadedImage(file);
      return c.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload image';
      const status = /Invalid file type|too large/.test(message) ? 400 : 500;
      if (status === 500) console.error('Upload error (self):', err);
      return c.json({ error: message }, status);
    }
  }

  // ── remote: peer の /api/upload/image に multipart を中継
  let incoming: FormData;
  try {
    incoming = await c.req.formData();
  } catch {
    return c.json({ error: 'Invalid multipart body' }, 400);
  }
  const file = incoming.get('image');
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No image file provided' }, 400);
  }

  // 新しい FormData に詰め直して peer に転送 (元の FormData をそのまま fetch
  // body に渡すと boundary 制御が安定しないことがあるため)
  const outgoing = new FormData();
  outgoing.append('image', file, file.name);

  try {
    const res = await peerFetch(peer.id, peer.url, peer.wsToken, '/api/upload/image', {
      method: 'POST',
      body: outgoing,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const status = (res.status >= 400 && res.status < 600 ? res.status : 502) as 400 | 401 | 404 | 500 | 502;
      return c.json(data, status);
    }
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload to peer failed';
    return c.json({ error: message }, 502);
  }
});

// GET /api/peers/:peerId/dashboard - peer (or self) の dashboard を返す
peers.get('/:peerId/dashboard', async (c) => {
  const peerId = c.req.param('peerId');
  const peer = (await listPeers()).find(p => p.id === peerId);
  if (!peer) return c.json({ error: 'Peer not found' }, 404);

  if (peer.url === SELF_PEER_URL) {
    const data = await buildDashboard();
    return c.json(data);
  }

  try {
    const res = await peerFetch(peer.id, peer.url, peer.wsToken, '/api/dashboard');
    if (!res.ok) {
      return c.json({ error: `HTTP ${res.status}` }, 502);
    }
    const data = (await res.json()) as DashboardResponse;
    return c.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fetch failed';
    return c.json({ error: message }, 502);
  }
});

// GET /api/peers/sessions - 全 peer のセッション一覧をマージして返す
peers.get('/sessions', async (c) => {
  const allPeers = await listPeers();
  const errors: { peerId: string; message: string }[] = [];

  const results = await Promise.all(allPeers.map(async (peer): Promise<PeerSession[]> => {
    const enrich = (s: ExtendedSessionResponse): PeerSession => ({
      ...s,
      peerId: peer.id,
      peerNickname: peer.nickname,
      peerColor: peer.color,
    });

    if (peer.url === SELF_PEER_URL) {
      try {
        const local = await buildSessionsList();
        return local.map(enrich);
      } catch (err) {
        errors.push({ peerId: peer.id, message: err instanceof Error ? err.message : 'Local sessions failed' });
        return [];
      }
    }

    try {
      const res = await peerFetch(peer.id, peer.url, peer.wsToken, '/api/sessions');
      if (!res.ok) {
        errors.push({ peerId: peer.id, message: `HTTP ${res.status}` });
        return [];
      }
      const data = (await res.json()) as { sessions?: ExtendedSessionResponse[] };
      if (!data || !Array.isArray(data.sessions)) {
        errors.push({ peerId: peer.id, message: 'Invalid response' });
        return [];
      }
      return data.sessions.map(enrich);
    } catch (err) {
      errors.push({ peerId: peer.id, message: err instanceof Error ? err.message : 'Fetch failed' });
      return [];
    }
  }));

  const merged = results.flat();
  const response: PeerSessionsResponse = errors.length > 0
    ? { sessions: merged, errors }
    : { sessions: merged };
  return c.json(response);
});

// -----------------------------------------------------------------------------
// Generic Files API proxy
// -----------------------------------------------------------------------------
// FileViewer (list / read / raw / changes / git-changes / git-diff / language /
// download / upload) needs to target the peer that owns the files on disk.
// The individual /browse and /mkdir proxies above stay as-is — they were added
// first and have specific shapes. Everything else is forwarded via this
// catch-all so we don't have to hand-write a route per endpoint.
//
// We bypass peerFetch (5s timeout) so that streamed responses such as
// /files/raw on a large image or video don't get cut off mid-flight.

function normalizePeerBaseUrl(u: string): string {
  return u.replace(/\/+$/, '');
}

async function proxyPeerFiles(c: Context): Promise<Response> {
  const peerId = c.req.param('peerId');
  const peer = (await listPeers()).find(p => p.id === peerId);
  if (!peer) return c.json({ error: 'Peer not found' }, 404);
  if (peer.url === SELF_PEER_URL) {
    return c.json({ error: 'Use /api/files/* for local peer' }, 400);
  }
  if (!isSafePeerUrl(peer.url)) {
    return c.json({ error: 'Unsafe peer URL' }, 400);
  }

  // /api/peers/:peerId/files/<rest>?<query>  →  peer's /api/files/<rest>?<query>
  const incoming = new URL(c.req.url);
  const prefix = `/api/peers/${peerId}/files`;
  const subpath = incoming.pathname.startsWith(prefix)
    ? incoming.pathname.slice(prefix.length)
    : '';
  const targetPath = `/api/files${subpath}${incoming.search}`;

  const headers = new Headers();
  if (peer.wsToken) headers.set('Authorization', `Bearer ${peer.wsToken}`);
  const ct = c.req.header('Content-Type');
  if (ct) headers.set('Content-Type', ct);

  const init: RequestInit = { method: c.req.method, headers };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = c.req.raw.body;
    // Bun requires duplex: 'half' when streaming a request body.
    (init as RequestInit & { duplex?: string }).duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${normalizePeerBaseUrl(peer.url)}${targetPath}`, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Peer unreachable';
    return c.json({ error: message }, 502);
  }

  // Strip hop-by-hop headers but keep Content-Type / Content-Length etc.
  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    const lk = k.toLowerCase();
    if (lk === 'connection' || lk === 'transfer-encoding' || lk === 'keep-alive') continue;
    respHeaders.set(k, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

peers.all('/:peerId/files/list', proxyPeerFiles);
peers.all('/:peerId/files/read', proxyPeerFiles);
peers.all('/:peerId/files/raw', proxyPeerFiles);
peers.all('/:peerId/files/download', proxyPeerFiles);
peers.all('/:peerId/files/upload', proxyPeerFiles);
peers.all('/:peerId/files/language', proxyPeerFiles);
peers.all('/:peerId/files/changes/:dir', proxyPeerFiles);
peers.all('/:peerId/files/git-changes/:dir', proxyPeerFiles);
peers.all('/:peerId/files/git-diff/:dir', proxyPeerFiles);
peers.all('/:peerId/files/images/:filename', proxyPeerFiles);
