import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { ensureDataDir } from '../utils/storage';
import {
  type Peer,
  LOCAL_PEER_ID,
  SELF_PEER_URL,
} from '../../../shared/types';

const PEERS_FILE = 'peers.json';

// peer 追加時にラウンドロビンで割り当てる palette。
// ユーザーが手動で色を選ばなければ、追加順に PALETTE から拾う。
const COLOR_PALETTE = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
];

// peer のトークンは disk に平文保存（家庭内マシン前提）。
// 必要なら将来 OS keychain 連携に差し替える。
interface StoredPeer extends Peer {
  // peer 自身のログインで得たトークン。selfには持たない
  wsToken?: string;
  // 最後の verify 時刻と結果
  lastSeenAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
}

interface PeersStore {
  peers: StoredPeer[];
}

async function getFilePath(): Promise<string> {
  const dataDir = await ensureDataDir();
  return join(dataDir, PEERS_FILE);
}

async function load(): Promise<PeersStore> {
  const filePath = await getFilePath();
  try {
    const data = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as PeersStore;
    if (!Array.isArray(parsed.peers)) {
      return { peers: [] };
    }
    return parsed;
  } catch {
    return { peers: [] };
  }
}

async function save(store: PeersStore): Promise<void> {
  const filePath = await getFilePath();
  await writeFile(filePath, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return `p_${randomBytes(4).toString('hex')}`;
}

function pickColor(existing: StoredPeer[]): string {
  const used = new Set(existing.map(p => p.color.toLowerCase()));
  for (const c of COLOR_PALETTE) {
    if (!used.has(c.toLowerCase())) return c;
  }
  // 全部使い切ったらランダム
  return COLOR_PALETTE[existing.length % COLOR_PALETTE.length] ?? '#64748b';
}

function localPeer(): StoredPeer {
  return {
    id: LOCAL_PEER_ID,
    nickname: '🏠 Local',
    url: SELF_PEER_URL,
    color: COLOR_PALETTE[0] ?? '#10b981',
    order: 0,
  };
}

/**
 * 全 peer を取得（self を必ず先頭に含めて返す）。
 * order 昇順でソート済み。
 */
export async function listPeers(): Promise<StoredPeer[]> {
  const store = await load();
  const hasLocal = store.peers.some(p => p.id === LOCAL_PEER_ID);
  const peers = hasLocal ? [...store.peers] : [localPeer(), ...store.peers];
  return peers.sort((a, b) => a.order - b.order);
}

export async function getPeer(id: string): Promise<StoredPeer | null> {
  const peers = await listPeers();
  return peers.find(p => p.id === id) ?? null;
}

export interface CreatePeerArgs {
  nickname: string;
  url: string;
  color?: string;
  wsToken?: string;
}

export async function createPeer(args: CreatePeerArgs): Promise<StoredPeer> {
  const store = await load();
  const id = generateId();
  const existing = await listPeers();
  const order = existing.reduce((max, p) => Math.max(max, p.order), 0) + 1;

  const peer: StoredPeer = {
    id,
    nickname: args.nickname,
    url: args.url,
    color: args.color ?? pickColor(existing),
    order,
    wsToken: args.wsToken,
    lastSeenAt: new Date().toISOString(),
  };

  store.peers.push(peer);
  await save(store);
  return peer;
}

export interface UpdatePeerArgs {
  nickname?: string;
  color?: string;
  wsToken?: string;
}

export async function updatePeer(id: string, args: UpdatePeerArgs): Promise<StoredPeer | null> {
  if (id === LOCAL_PEER_ID) {
    // local peer は nickname/color のみ編集可。 token は持たない
    const store = await load();
    let local = store.peers.find(p => p.id === LOCAL_PEER_ID);
    if (!local) {
      local = localPeer();
      store.peers.push(local);
    }
    if (args.nickname !== undefined) local.nickname = args.nickname;
    if (args.color !== undefined) local.color = args.color;
    await save(store);
    return local;
  }

  const store = await load();
  const peer = store.peers.find(p => p.id === id);
  if (!peer) return null;

  if (args.nickname !== undefined) peer.nickname = args.nickname;
  if (args.color !== undefined) peer.color = args.color;
  if (args.wsToken !== undefined) {
    peer.wsToken = args.wsToken;
    peer.lastSeenAt = new Date().toISOString();
    peer.lastErrorAt = undefined;
    peer.lastErrorMessage = undefined;
  }

  await save(store);
  return peer;
}

export async function deletePeer(id: string): Promise<boolean> {
  if (id === LOCAL_PEER_ID) return false; // self は削除不可
  const store = await load();
  const before = store.peers.length;
  store.peers = store.peers.filter(p => p.id !== id);
  if (store.peers.length === before) return false;
  await save(store);
  return true;
}

export async function setPeerOrder(orderedIds: string[]): Promise<void> {
  const store = await load();
  const indexById = new Map(orderedIds.map((id, i) => [id, i]));
  // 配列に含まれない peer は末尾に追いやる
  const maxIndex = orderedIds.length;
  for (const peer of store.peers) {
    const idx = indexById.get(peer.id);
    peer.order = idx !== undefined ? idx : maxIndex + peer.order;
  }
  await save(store);
}

export async function recordPeerSuccess(id: string): Promise<void> {
  if (id === LOCAL_PEER_ID) return;
  const store = await load();
  const peer = store.peers.find(p => p.id === id);
  if (!peer) return;
  peer.lastSeenAt = new Date().toISOString();
  peer.lastErrorAt = undefined;
  peer.lastErrorMessage = undefined;
  await save(store);
}

export async function recordPeerFailure(id: string, message: string): Promise<void> {
  if (id === LOCAL_PEER_ID) return;
  const store = await load();
  const peer = store.peers.find(p => p.id === id);
  if (!peer) return;
  peer.lastErrorAt = new Date().toISOString();
  peer.lastErrorMessage = message;
  await save(store);
}

export type { StoredPeer };
