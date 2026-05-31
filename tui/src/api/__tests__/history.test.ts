import { describe, expect, test } from 'bun:test';
import type { ApiClient } from '../client';
import { type HistoryEntry, parseSSEBuffer, resumeHistory, streamHistorySearch } from '../history';

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('parseSSEBuffer', () => {
  test('完結したイベントを取り出し、残りを返す', () => {
    const { events, rest } = parseSSEBuffer('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(events).toEqual([{ event: undefined, data: '{"a":1}' }, { event: undefined, data: '{"b":2}' }]);
    expect(rest).toBe('data: {"c"');
  });

  test('event: 行を解釈する（done/error）', () => {
    const { events } = parseSSEBuffer('event: done\ndata: {}\n\n');
    expect(events[0]).toEqual({ event: 'done', data: '{}' });
  });

  test('未完のイベントは持ち越し（events 空）', () => {
    const { events, rest } = parseSSEBuffer('data: {"partial"');
    expect(events).toEqual([]);
    expect(rest).toBe('data: {"partial"');
  });

  test('チャンク跨ぎ: 前回の rest と結合して完成', () => {
    const first = parseSSEBuffer('data: {"x":');
    expect(first.events).toEqual([]);
    const second = parseSSEBuffer(`${first.rest}1}\n\n`);
    expect(second.events).toEqual([{ event: undefined, data: '{"x":1}' }]);
    expect(second.rest).toBe('');
  });

  test('空ブロックはスキップ', () => {
    const { events } = parseSSEBuffer('\n\ndata: {"a":1}\n\n');
    expect(events).toEqual([{ event: undefined, data: '{"a":1}' }]);
  });
});

describe('streamHistorySearch', () => {
  test('SSE を逐次 onResult し、done で終了', async () => {
    const got: HistoryEntry[] = [];
    let done = false;
    await streamHistorySearch({
      baseUrl: 'https://h:5923',
      query: 'x',
      fetchImpl: async () =>
        sseResponse([
          'data: {"sessionId":"a","projectPath":"/p"}\n\n',
          'data: {"sessionId":"b","projectPath":"/q"}\n\nevent: done\ndata: {}\n\n',
        ]),
      onResult: (e) => got.push(e),
      onDone: () => {
        done = true;
      },
    });
    expect(got.map((e) => e.sessionId)).toEqual(['a', 'b']);
    expect(done).toBe(true);
  });

  test('非 OK 応答で onError', async () => {
    let errored = false;
    await streamHistorySearch({
      baseUrl: 'https://h:5923',
      query: 'x',
      fetchImpl: async () => new Response('', { status: 500 }),
      onResult: () => {},
      onError: () => {
        errored = true;
      },
    });
    expect(errored).toBe(true);
  });
});

describe('resumeHistory', () => {
  test('sessionId / projectPath / agent を POST し tmuxSessionId を返す', async () => {
    let body: unknown;
    const client = {
      post: async (_path: string, b?: unknown) => {
        body = b;
        return { tmuxSessionId: 't1' };
      },
    } as unknown as ApiClient;
    const res = await resumeHistory(client, { sessionId: 's', projectPath: '/p', agent: 'claude' });
    expect(body).toEqual({ sessionId: 's', projectPath: '/p', agent: 'claude' });
    expect(res.tmuxSessionId).toBe('t1');
  });
});
