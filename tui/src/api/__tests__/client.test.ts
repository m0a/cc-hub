import { describe, expect, test } from 'bun:test';
import { ApiError, authHeaders, buildUrl, createClient, formatError } from '../client';

describe('buildUrl', () => {
  test('連結し重複スラッシュを正規化する', () => {
    expect(buildUrl('http://h:5923', '/api/sessions')).toBe('http://h:5923/api/sessions');
    expect(buildUrl('http://h:5923/', '/api/sessions')).toBe('http://h:5923/api/sessions');
    expect(buildUrl('http://h:5923', 'api/sessions')).toBe('http://h:5923/api/sessions');
  });
});

describe('authHeaders', () => {
  test('token があれば Bearer を付与', () => {
    expect(authHeaders('abc')).toEqual({ Authorization: 'Bearer abc' });
  });
  test('token が無ければ空', () => {
    expect(authHeaders()).toEqual({});
    expect(authHeaders(null)).toEqual({});
  });
});

describe('formatError', () => {
  test('401 は認証メッセージ', () => {
    expect(formatError(401, '')).toContain('認証');
  });
  test('5xx はサーバエラー', () => {
    expect(formatError(503, '')).toContain('サーバエラー');
  });
  test('JSON 本文の error を抽出', () => {
    expect(formatError(409, '{"error":"duplicate_working_dir"}')).toContain('duplicate_working_dir');
  });
  test('非 JSON 本文は汎用メッセージ', () => {
    expect(formatError(400, 'not json')).toContain('400');
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createClient.request', () => {
  test('GET 成功で JSON を返す', async () => {
    const client = createClient({
      baseUrl: 'http://h:5923',
      fetchImpl: async () => jsonResponse(200, [{ id: 'a' }]),
    });
    const data = await client.get<Array<{ id: string }>>('/api/sessions');
    expect(data).toEqual([{ id: 'a' }]);
  });

  test('401 で ApiError(status=401) を投げる', async () => {
    const client = createClient({
      baseUrl: 'http://h:5923',
      fetchImpl: async () => new Response('', { status: 401 }),
    });
    await expect(client.get('/api/sessions')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
  });

  test('Bearer ヘッダと JSON body を送る', async () => {
    let captured: { headers: Headers; body: string | null } | undefined;
    const client = createClient({
      baseUrl: 'http://h:5923',
      token: 'tkn',
      fetchImpl: async (_url, init) => {
        captured = {
          headers: new Headers(init?.headers),
          body: (init?.body as string) ?? null,
        };
        return jsonResponse(201, { id: 'new' });
      },
    });
    await client.post<{ id: string }>('/api/sessions', { name: 'x' });
    if (!captured) throw new Error('fetchImpl was not called');
    expect(captured.headers.get('authorization')).toBe('Bearer tkn');
    expect(captured.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(captured.body as string)).toEqual({ name: 'x' });
  });

  test('ApiError は Error インスタンス', () => {
    const e = new ApiError('boom', 500);
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(500);
  });
});
