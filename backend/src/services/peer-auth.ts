/**
 * peer-auth: peer (Worker) への代理ログインを行うサービス。
 *
 * - Hub が peer 追加時にユーザーから受け取ったパスワードで POST /api/auth/login
 * - 得られた JWT トークンを保存して以降の API/WS に使う
 * - 401 が返ってきたら "unauthorized" 状態として記録（ユーザーに再認証を促す）
 */

import { recordPeerFailure, recordPeerSuccess } from './peer-registry';

const VERIFY_TIMEOUT_MS = 5_000;

export class PeerAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PeerAuthError';
  }
}

function normalizePeerUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * peer に対してパスワードログインを行い JWT トークンを取得する。
 *
 * peer 側が auth disabled (password なし) の場合、401 ではなく 400 が返るので
 * その時は「トークン不要」とみなして空文字列を返す。
 */
export async function loginToPeer(url: string, password: string): Promise<string> {
  const base = normalizePeerUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PeerAuthError(0, `peer に接続できません: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 400) {
    // peer 側で auth が無効。トークン不要で動く
    return '';
  }
  if (response.status === 401) {
    throw new PeerAuthError(401, 'パスワードが正しくありません');
  }
  if (!response.ok) {
    throw new PeerAuthError(response.status, `peer ログイン失敗: HTTP ${response.status}`);
  }

  const json = (await response.json().catch(() => ({}))) as { token?: string };
  if (!json.token && response.status !== 400) {
    // auth 無効の peer なら 400 で抜けているので、ここに来てトークン無しは異常
    throw new PeerAuthError(500, 'peer の応答に token がありません');
  }
  return json.token ?? '';
}

/**
 * peer に対して /api/auth/me (or /health) を叩いて到達性を確認する。
 * 結果は peer-registry に記録される。
 */
export async function verifyPeer(
  peerId: string,
  url: string,
  token: string | undefined,
): Promise<{ ok: true; latencyMs: number } | { ok: false; status: number; message: string }> {
  const base = normalizePeerUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  const start = Date.now();
  let response: Response;
  try {
    // 認証無効 peer でも 200 を返す /health を使う
    response = await fetch(`${base}/health`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordPeerFailure(peerId, `unreachable: ${msg}`);
    return { ok: false, status: 0, message: msg };
  } finally {
    clearTimeout(timer);
  }

  const latency = Date.now() - start;

  if (!response.ok) {
    const msg = `HTTP ${response.status}`;
    await recordPeerFailure(peerId, msg);
    return { ok: false, status: response.status, message: msg };
  }

  await recordPeerSuccess(peerId);
  return { ok: true, latencyMs: latency };
}

/**
 * peer に対して認証付きで任意の API パスを叩く。
 * 401 が返ったら failure を記録するので、呼び出し側はそれを見て unauthorized 扱いにできる。
 */
export async function peerFetch(
  peerId: string,
  url: string,
  token: string | undefined,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = normalizePeerUrl(url);

  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordPeerFailure(peerId, `unreachable: ${msg}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    await recordPeerFailure(peerId, 'unauthorized');
  } else if (response.ok) {
    await recordPeerSuccess(peerId);
  }

  return response;
}
