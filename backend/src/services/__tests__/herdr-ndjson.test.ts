import { describe, expect, test } from 'bun:test';
import { createNdjsonReader } from '../herdr-client';

function collect(): { lines: string[]; feed: (chunk: Buffer) => void } {
  const lines: string[] = [];
  const feed = createNdjsonReader((l) => lines.push(l));
  return { lines, feed };
}

describe('createNdjsonReader', () => {
  test('splits complete lines in one chunk', () => {
    const { lines, feed } = collect();
    feed(Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test('buffers partial lines across chunks', () => {
    const { lines, feed } = collect();
    feed(Buffer.from('{"a":'));
    expect(lines).toEqual([]);
    feed(Buffer.from('1}\n'));
    expect(lines).toEqual(['{"a":1}']);
  });

  test('multi-byte UTF-8 split across chunk boundary survives intact', () => {
    const { lines, feed } = collect();
    const payload = Buffer.from('{"text":"日本語テスト🚀"}\n', 'utf-8');
    // Split in the middle of a multi-byte sequence (inside 語)
    const cut = payload.indexOf(Buffer.from('語', 'utf-8')) + 1;
    feed(payload.subarray(0, cut));
    feed(payload.subarray(cut));
    expect(lines).toEqual(['{"text":"日本語テスト🚀"}']);
    expect(lines[0]).not.toContain('�');
  });

  test('emoji (4-byte sequence) split across chunks survives', () => {
    const { lines, feed } = collect();
    const payload = Buffer.from('🎉🎌\n', 'utf-8');
    feed(payload.subarray(0, 2)); // mid-🎉
    feed(payload.subarray(2, 6)); // rest of 🎉 + start of 🎌
    feed(payload.subarray(6));
    expect(lines).toEqual(['🎉🎌']);
    expect(lines[0]).not.toContain('�');
  });

  test('empty lines are skipped', () => {
    const { lines, feed } = collect();
    feed(Buffer.from('\n\n{"a":1}\n\n'));
    expect(lines).toEqual(['{"a":1}']);
  });
});
