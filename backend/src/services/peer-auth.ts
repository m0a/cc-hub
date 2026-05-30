/**
 * peer-auth: peer (Worker) への代理ログインを行うサービス。
 *
 * - Hub が peer 追加時にユーザーから受け取ったパスワードで POST /api/auth/login
 * - 得られた JWT トークンを保存して以降の API/WS に使う
 * - 401 が返ってきたら "unauthorized" 状態として記録（ユーザーに再認証を促す）
 */

import { recordPeerFailure, recordPeerSuccess } from './peer-registry';
import { isSafePeerUrl } from './peer-url';

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

// SSRF guard: every outbound peer request goes through here. Reject non-https
// or loopback/link-local/private targets before fetching (covers freshly
// supplied URLs at creation and already-stored URLs). #235
function assertSafePeerUrl(url: string): void {
  if (!isSafePeerUrl(url)) {
    throw new PeerAuthError(0, 'peer URL は https かつ非ローカルなホストである必要があります');
  }
}

/**
 * peer の /api/auth/required を叩いて、認証が有効か確認する。
 * 接続失敗時は throw する (PeerAuthError)。
 */
async function isPeerAuthRequired(url: string): Promise<boolean> {
  assertSafePeerUrl(url);
  const base = normalizePeerUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${base}/api/auth/required`, {
      method: 'GET',
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PeerAuthError(0, `peer に接続できません: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new PeerAuthError(response.status, `peer 確認失敗: HTTP ${response.status}`);
  }
  const body = (await response.json().catch(() => ({}))) as { required?: boolean };
  return body.required === true;
}

/**
 * peer に対してパスワードログインを行い JWT トークンを取得する。
 *
 * password が undefined/空文字の場合:
 *   - peer 側 auth 無効 → 空トークンを返す (OK)
 *   - peer 側 auth 有効 → "password 必須" エラー
 *
 * password が指定されている場合:
 *   - 通常通り /api/auth/login へ POST
 *   - peer 側 auth 無効なら 400 が返るので空トークンとして扱う
 */
export async function loginToPeer(url: string, password?: string): Promise<string> {
  assertSafePeerUrl(url);
  const base = normalizePeerUrl(url);

  // password 未指定: まず peer 側の auth 設定を確認
  if (!password) {
    const required = await isPeerAuthRequired(url);
    if (required) {
      throw new PeerAuthError(401, 'この peer はパスワード認証が有効です。パスワードを入力してください');
    }
    return '';
  }

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
  if (!json.token) {
    throw new PeerAuthError(500, 'peer の応答に token がありません');
  }
  return json.token;
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
  assertSafePeerUrl(url);
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
  timeoutMs: number = VERIFY_TIMEOUT_MS,
): Promise<Response> {
  assertSafePeerUrl(url);
  const base = normalizePeerUrl(url);

  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
