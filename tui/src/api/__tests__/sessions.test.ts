import { describe, expect, test } from 'bun:test';
import type { ApiClient } from '../client';
import { createSession, getSessions, killSession, resumeSession } from '../sessions';

interface Captured {
  method: string;
  path: string;
  body?: unknown;
}

function captureClient(captured: Captured[], getReturn: unknown = { sessions: [] }): ApiClient {
  return {
    get: async (path: string) => {
      captured.push({ method: 'GET', path });
      return getReturn;
    },
    post: async (path: string, body?: unknown) => {
      captured.push({ method: 'POST', path, body });
      return { id: 's', name: 's' };
    },
    del: async (path: string) => {
      captured.push({ method: 'DELETE', path });
      return {};
    },
  } as unknown as ApiClient;
}

describe('getSessions', () => {
  test('{ sessions: [...] } から配列を取り出す', async () => {
    const client = captureClient([], { sessions: [{ id: '1', name: 'a' }] });
    expect(await getSessions(client)).toEqual([{ id: '1', name: 'a' }]);
  });
  test('非配列/欠落は空配列', async () => {
    const client = captureClient([], {});
    expect(await getSessions(client)).toEqual([]);
  });
});

describe('createSession', () => {
  test('workingDir/agent を POST /api/sessions へ送る', async () => {
    const cap: Captured[] = [];
    await createSession(captureClient(cap), { workingDir: '~/proj', agent: 'codex' });
    expect(cap[0]).toEqual({ method: 'POST', path: '/api/sessions', body: { workingDir: '~/proj', agent: 'codex' } });
  });
  test('name 指定時のみ name を含める', async () => {
    const cap: Captured[] = [];
    await createSession(captureClient(cap), { workingDir: '~/p', agent: 'claude', name: 'mysess' });
    expect(cap[0].body).toEqual({ workingDir: '~/p', agent: 'claude', name: 'mysess' });
  });
});

describe('killSession / resumeSession', () => {
  test('DELETE /api/sessions/:id', async () => {
    const cap: Captured[] = [];
    await killSession(captureClient(cap), 'my-session');
    expect(cap[0]).toEqual({ method: 'DELETE', path: '/api/sessions/my-session' });
  });
  test('POST /api/sessions/:id/resume', async () => {
    const cap: Captured[] = [];
    await resumeSession(captureClient(cap), 'my-session');
    expect(cap[0].method).toBe('POST');
    expect(cap[0].path).toBe('/api/sessions/my-session/resume');
  });
});
