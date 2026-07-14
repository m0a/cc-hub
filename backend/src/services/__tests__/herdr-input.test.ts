import { describe, expect, test } from 'bun:test';
import { translateInput } from '../herdr-input';

function t(input: string) {
  return translateInput(Buffer.from(input, 'utf-8'));
}

describe('translateInput', () => {
  test('plain text stays one text op', () => {
    expect(t('echo hello')).toEqual([{ text: 'echo hello' }]);
  });

  test('UTF-8 (Japanese + emoji) passes through as text', () => {
    expect(t('日本語テスト🚀')).toEqual([{ text: '日本語テスト🚀' }]);
  });

  test('Enter (\\r) becomes enter key', () => {
    expect(t('\r')).toEqual([{ keys: ['enter'] }]);
  });

  test('command + Enter splits into text then key, in order', () => {
    expect(t('ls -la\r')).toEqual([{ text: 'ls -la' }, { keys: ['enter'] }]);
  });

  test('Ctrl+C becomes ctrl+c', () => {
    expect(t('\x03')).toEqual([{ keys: ['ctrl+c'] }]);
  });

  test('arrow keys (CSI and application mode)', () => {
    expect(t('\x1b[A\x1b[B\x1b[C\x1b[D')).toEqual([{ keys: ['up', 'down', 'right', 'left'] }]);
    expect(t('\x1bOA')).toEqual([{ keys: ['up'] }]);
  });

  test('consecutive keys coalesce into one op', () => {
    expect(t('\r\r\x7f')).toEqual([{ keys: ['enter', 'enter', 'backspace'] }]);
  });

  test('lone escape becomes escape key', () => {
    expect(t('\x1b')).toEqual([{ keys: ['escape'] }]);
  });

  test('alt chord (ESC + printable)', () => {
    expect(t('\x1bx')).toEqual([{ keys: ['alt+x'] }]);
  });

  test('bracketed paste markers are stripped, newline inside becomes enter', () => {
    expect(t('\x1b[200~fix the bug\r\x1b[201~')).toEqual([
      { text: 'fix the bug' },
      { keys: ['enter'] },
    ]);
  });

  test('multiline paste keeps interleaved order', () => {
    expect(t('line1\nline2\n')).toEqual([
      { text: 'line1' },
      { keys: ['enter'] },
      { text: 'line2' },
      { keys: ['enter'] },
    ]);
  });

  test('tab and shift+tab', () => {
    expect(t('\t')).toEqual([{ keys: ['tab'] }]);
    expect(t('\x1b[Z')).toEqual([{ keys: ['shift+tab'] }]);
  });

  test('unknown CSI sequence is consumed, not leaked as text', () => {
    // DECSET private mode toggle-style report — not a key at all
    const ops = t('\x1b[?25hOK');
    expect(ops).toEqual([{ text: 'OK' }]);
  });

  test('empty input yields no ops', () => {
    expect(t('')).toEqual([]);
  });
});
