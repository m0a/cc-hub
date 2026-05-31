import { describe, expect, test } from 'bun:test';
import { parseSSEBuffer } from '../history';

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
