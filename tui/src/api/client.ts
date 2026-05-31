// 稼働中 CC Hub サーバへの最小 HTTP クライアント。
// 純粋ロジック（buildUrl / authHeaders / formatError）は単体テスト対象。

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** fetch の最小シグネチャ（Bun の `typeof fetch` は preconnect を要求するため緩める） */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ClientConfig {
  baseUrl: string;
  token?: string | null;
  /** テスト用に注入可能（既定はグローバル fetch） */
  fetchImpl?: FetchLike;
}

/** base URL と path を安全に連結（重複スラッシュを正規化） */
export function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** Bearer ヘッダ（token があれば付与） */
export function authHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** HTTP ステータス + 本文から人間向けエラーメッセージを構築 */
export function formatError(status: number, body: string): string {
  if (status === 401) return '認証に失敗しました（トークンが無効または期限切れ）';
  if (status >= 500) return `サーバエラー (${status})`;
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed?.error) return `${parsed.error} (${status})`;
  } catch {
    // 本文が JSON でない場合は汎用メッセージへフォールスルー
  }
  return `リクエストに失敗しました (${status})`;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function createClient(config: ClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(buildUrl(config.baseUrl, path), {
      method,
      headers: {
        ...authHeaders(config.token),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(formatError(res.status, text), res.status);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    del: (path) => request('DELETE', path),
  };
}
