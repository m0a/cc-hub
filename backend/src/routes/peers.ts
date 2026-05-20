import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  PeerCreateSchema,
  PeerUpdateSchema,
  PeerOrderSchema,
  LOCAL_PEER_ID,
  SELF_PEER_URL,
  type PeerClientView,
  type PeerStatus,
  type PeerSession,
  type PeerSessionsResponse,
  type ExtendedSessionResponse,
} from '../../../shared/types';
import {
  listPeers,
  createPeer,
  updatePeer,
  deletePeer,
  setPeerOrder,
  type StoredPeer,
} from '../services/peer-registry';
import { loginToPeer, verifyPeer, peerFetch, PeerAuthError } from '../services/peer-auth';
import { buildSessionsList } from './sessions';

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
