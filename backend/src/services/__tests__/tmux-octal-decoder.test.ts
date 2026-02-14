import { describe, test, expect } from 'bun:test';
import { decodeOctalOutput, encodeHexInput } from '../tmux-octal-decoder';

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
