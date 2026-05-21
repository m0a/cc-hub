/**
 * peer-discovery: Tailscale tailnet をスキャンして cchub が動いてる peer を検出する。
 *
 * - `tailscale status --json` で online な peer 一覧を取得
 * - 各 peer の :5923/health に並列 fetch（タイムアウト 3秒）
 * - 200 が返れば cchub あり、version を読む
 * - 自分自身は除外（DNSName マッチで判定）
 */

import { listPeers } from './peer-registry';
import { SELF_PEER_URL, type DiscoveredPeer } from '../../../shared/types';

const DISCOVERY_TIMEOUT_MS = 3_000;
const DEFAULT_PORT = 5923;

interface TailscaleStatus {
  Self?: { DNSName?: string };
  Peer?: Record<string, {
    HostName?: string;
    DNSName?: string;
    Online?: boolean;
    OS?: string;
  }>;
}

function normalizeDns(dns: string | undefined): string {
  if (!dns) return '';
  // 末尾の "." を取り除く
  return dns.replace(/\.$/, '');
}

async function fetchTailscaleStatus(): Promise<TailscaleStatus | null> {
  try {
    const proc = Bun.spawnSync(['tailscale', 'status', '--json']);
    if (proc.exitCode !== 0) return null;
    return JSON.parse(proc.stdout.toString()) as TailscaleStatus;
  } catch {
    return null;
  }
}

async function probeCchub(url: string): Promise<{ ok: true; version?: string } | { ok: false }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json().catch(() => ({}))) as { status?: string; version?: string };
    if (body.status !== 'ok') return { ok: false };
    return { ok: true, version: body.version };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverPeers(): Promise<DiscoveredPeer[]> {
  const status = await fetchTailscaleStatus();
  if (!status) return [];

  const selfDns = normalizeDns(status.Self?.DNSName);
  const existingPeers = await listPeers();

  // 既存 peer の URL を hostname:port キーで引けるようにする
  const existingByHost = new Map<string, { nickname: string }>();
  for (const p of existingPeers) {
    if (p.url === SELF_PEER_URL) continue;
    try {
      const u = new URL(p.url);
      existingByHost.set(`${u.hostname}:${u.port || '443'}`, { nickname: p.nickname });
    } catch {
      /* skip malformed */
    }
  }

  const candidates: { displayName: string; hostname: string }[] = [];
  for (const peer of Object.values(status.Peer ?? {})) {
    if (!peer.Online) continue;
    const dns = normalizeDns(peer.DNSName);
    if (!dns || dns === selfDns) continue;
    candidates.push({
      displayName: peer.HostName ?? dns,
      hostname: dns,
    });
  }

  // 並列 probe
  const results = await Promise.all(candidates.map(async (c) => {
    const url = `https://${c.hostname}:${DEFAULT_PORT}`;
    const probe = await probeCchub(url);
    if (!probe.ok) return null;
    const existing = existingByHost.get(`${c.hostname}:${DEFAULT_PORT}`);
    const discovered: DiscoveredPeer = {
      displayName: c.displayName,
      hostname: c.hostname,
      url,
      version: probe.version,
      alreadyRegistered: !!existing,
      registeredAs: existing?.nickname,
    };
    return discovered;
  }));

  return results.filter((r): r is DiscoveredPeer => r !== null);
}
