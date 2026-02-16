import { describe, test, expect } from 'bun:test';
import { decodeOctalOutput, decodeOctalOutputRaw, encodeHexInput } from '../tmux-octal-decoder';

describe('decodeOctalOutput', () => {
  test('plain ASCII text unchanged', () => {
    const result = decodeOctalOutput('hello world');
    expect(result.toString()).toBe('hello world');
  });

  test('escaped backslash', () => {
    const result = decodeOctalOutput('path\\\\to\\\\file');
    expect(result.toString()).toBe('path\\to\\file');
  });

  test('octal escape for newline (\\012)', () => {
    const result = decodeOctalOutput('line1\\012line2');
    expect(result.toString()).toBe('line1\nline2');
  });

  test('octal escape for carriage return (\\015)', () => {
    const result = decodeOctalOutput('line1\\015\\012line2');
    expect(result.toString()).toBe('line1\r\nline2');
  });

  test('octal escape for tab (\\011)', () => {
    const result = decodeOctalOutput('col1\\011col2');
    expect(result.toString()).toBe('col1\tcol2');
  });

  test('octal escape for ESC (\\033)', () => {
    const result = decodeOctalOutput('\\033[31mred\\033[0m');
    expect(result.toString()).toBe('\x1b[31mred\x1b[0m');
  });

  test('mixed content', () => {
    const result = decodeOctalOutput('hello\\012world\\011tab\\\\slash');
    expect(result.toString()).toBe('hello\nworld\ttab\\slash');
  });

  test('empty string', () => {
    const result = decodeOctalOutput('');
    expect(result.length).toBe(0);
  });

  test('consecutive octal escapes', () => {
    const result = decodeOctalOutput('\\033\\133\\101');
    // ESC [ A = cursor up
    expect(result[0]).toBe(0x1b);
    expect(result[1]).toBe(0x5b);
    expect(result[2]).toBe(0x41);
  });

  test('BMP Japanese characters (passed as-is by tmux)', () => {
    const result = decodeOctalOutput('こんにちは');
    expect(result.toString('utf-8')).toBe('こんにちは');
  });

  test('non-BMP emoji (surrogate pair in JS string)', () => {
    // Emoji "🎉" (U+1F389) is a non-BMP character stored as surrogate pair
    const result = decodeOctalOutput('🎉');
    expect(result).toEqual(Buffer.from([0xF0, 0x9F, 0x8E, 0x89]));
    expect(result.toString('utf-8')).toBe('🎉');
  });

  test('multiple non-BMP emoji', () => {
    const result = decodeOctalOutput('🎉🚀✅');
    expect(result.toString('utf-8')).toBe('🎉🚀✅');
  });

  test('mixed ASCII, Japanese and emoji', () => {
    const result = decodeOctalOutput('Hello 🌍 こんにちは!');
    expect(result.toString('utf-8')).toBe('Hello 🌍 こんにちは!');
  });

  test('emoji with octal escapes', () => {
    // Mix of emoji (non-BMP) and octal-encoded control chars
    const result = decodeOctalOutput('🎉\\012done');
    expect(result.toString('utf-8')).toBe('🎉\ndone');
  });

  test('skin tone modifier emoji (ZWJ sequence)', () => {
    const result = decodeOctalOutput('👍🏽');
    expect(result.toString('utf-8')).toBe('👍🏽');
  });

  test('arrows and mathematical symbols (BMP)', () => {
    const result = decodeOctalOutput('→ ← ↑ ↓ ≈ ≠');
    expect(result.toString('utf-8')).toBe('→ ← ↑ ↓ ≈ ≠');
  });
});

describe('decodeOctalOutputRaw', () => {
  test('plain ASCII bytes unchanged', () => {
    const input = Buffer.from('hello world');
    const result = decodeOctalOutputRaw(input);
    expect(result.toString()).toBe('hello world');
  });

  test('escaped backslash', () => {
    // Raw bytes: path \\ to \\ file
    const input = Buffer.from('path\\\\to\\\\file');
    const result = decodeOctalOutputRaw(input);
    expect(result.toString()).toBe('path\\to\\file');
  });

  test('octal escape for ESC', () => {
    // Raw bytes: \033[31mred\033[0m
    const input = Buffer.from('\\033[31mred\\033[0m');
    const result = decodeOctalOutputRaw(input);
    expect(result).toEqual(Buffer.from('\x1b[31mred\x1b[0m'));
  });

  test('raw UTF-8 bytes pass through (Japanese)', () => {
    // "コミット" in UTF-8: E3 82 B3 E3 83 9F E3 83 83 E3 83 88
    const input = Buffer.from([0xe3, 0x82, 0xb3, 0xe3, 0x83, 0x9f, 0xe3, 0x83, 0x83, 0xe3, 0x83, 0x88]);
    const result = decodeOctalOutputRaw(input);
    expect(result).toEqual(input); // Raw bytes preserved as-is
    expect(result.toString('utf-8')).toBe('コミット');
  });

  test('partial UTF-8 bytes pass through (split multi-byte)', () => {
    // Simulate tmux splitting "ミ" (E3 83 9F) across two %output lines.
    // First output: ends with E3 83 (incomplete sequence)
    const part1 = Buffer.from([0x61, 0xe3, 0x83]); // 'a' + first 2 bytes of ミ
    const result1 = decodeOctalOutputRaw(part1);
    expect(result1).toEqual(part1); // Raw bytes preserved, NOT converted to U+FFFD

    // Second output: starts with 9F (continuation byte)
    const part2 = Buffer.from([0x9f, 0x62]); // last byte of ミ + 'b'
    const result2 = decodeOctalOutputRaw(part2);
    expect(result2).toEqual(part2); // Raw bytes preserved

    // When concatenated and decoded as UTF-8, we get the correct text
    const combined = Buffer.concat([result1, result2]);
    expect(combined.toString('utf-8')).toBe('aミb');
  });

  test('mixed octal escapes and raw high bytes', () => {
    // \033[4m followed by raw UTF-8 for "下線" then \033[0m
    const input = Buffer.concat([
      Buffer.from('\\033[4m'),
      Buffer.from('下線', 'utf-8'), // raw UTF-8 bytes
      Buffer.from('\\033[0m'),
    ]);
    const result = decodeOctalOutputRaw(input);
    expect(result.toString('utf-8')).toBe('\x1b[4m下線\x1b[0m');
  });

  test('empty buffer', () => {
    const result = decodeOctalOutputRaw(Buffer.alloc(0));
    expect(result.length).toBe(0);
  });
});

describe('encodeHexInput', () => {
  test('simple ASCII', () => {
    const result = encodeHexInput(Buffer.from('abc'));
    expect(result).toBe('61 62 63');
  });

  test('newline', () => {
    const result = encodeHexInput(Buffer.from('\n'));
    expect(result).toBe('0a');
  });

  test('carriage return', () => {
    const result = encodeHexInput(Buffer.from('\r'));
    expect(result).toBe('0d');
  });

  test('ESC sequence', () => {
    const result = encodeHexInput(Buffer.from('\x1b[A'));
    expect(result).toBe('1b 5b 41');
  });

  test('empty buffer', () => {
    const result = encodeHexInput(Buffer.from(''));
    expect(result).toBe('');
  });

  test('high bytes', () => {
    const result = encodeHexInput(Buffer.from([0xff, 0x00, 0x80]));
    expect(result).toBe('ff 00 80');
  });
});
