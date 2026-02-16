import { describe, test, expect } from 'bun:test';
import {
  filterMouseTrackingInput,
  filterMouseTrackingOutput,
  shouldInterceptKeyEvent,
} from '../terminal-filters';

// ---------------------------------------------------------------------------
// filterMouseTrackingInput
// ---------------------------------------------------------------------------
describe('filterMouseTrackingInput', () => {
  test('passes through normal text', () => {
    expect(filterMouseTrackingInput('hello world')).toBe('hello world');
  });

  test('passes through normal escape sequences (e.g. cursor movement)', () => {
    const cursorUp = '\x1b[A';
    const cursorDown = '\x1b[B';
    expect(filterMouseTrackingInput(cursorUp)).toBe(cursorUp);
    expect(filterMouseTrackingInput(cursorDown)).toBe(cursorDown);
  });

  test('strips SGR mouse button press \\x1b[<0;5;3M', () => {
    expect(filterMouseTrackingInput('\x1b[<0;5;3M')).toBe('');
  });

  test('strips SGR mouse button release \\x1b[<0;5;3m', () => {
    expect(filterMouseTrackingInput('\x1b[<0;5;3m')).toBe('');
  });

  test('strips SGR mouse scroll \\x1b[<64;10;20M', () => {
    expect(filterMouseTrackingInput('\x1b[<64;10;20M')).toBe('');
  });

  test('strips SGR mouse motion with large coordinates', () => {
    expect(filterMouseTrackingInput('\x1b[<32;255;100M')).toBe('');
  });

  test('strips legacy X10 mouse report \\x1b[M...', () => {
    // X10 format: \x1b[M followed by exactly 3 bytes (button, col, row)
    expect(filterMouseTrackingInput('\x1b[M #!')).toBe('');
  });

  test('strips mouse sequences embedded in normal text', () => {
    const input = 'before\x1b[<0;5;3Mafter';
    expect(filterMouseTrackingInput(input)).toBe('beforeafter');
  });

  test('strips multiple mouse sequences', () => {
    const input = '\x1b[<0;1;1M\x1b[<0;1;1m';
    expect(filterMouseTrackingInput(input)).toBe('');
  });

  test('preserves bracketed paste sequences', () => {
    const paste = '\x1b[200~pasted text\x1b[201~';
    expect(filterMouseTrackingInput(paste)).toBe(paste);
  });

  test('preserves Japanese text', () => {
    const japanese = 'こんにちは世界';
    expect(filterMouseTrackingInput(japanese)).toBe(japanese);
  });

  test('preserves empty string', () => {
    expect(filterMouseTrackingInput('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// filterMouseTrackingOutput
// ---------------------------------------------------------------------------
describe('filterMouseTrackingOutput', () => {
  test('passes through normal text', () => {
    expect(filterMouseTrackingOutput('hello')).toBe('hello');
  });

  test('strips mouse tracking enable \\x1b[?1000h', () => {
    expect(filterMouseTrackingOutput('\x1b[?1000h')).toBe('');
  });

  test('strips mouse tracking disable \\x1b[?1000l', () => {
    expect(filterMouseTrackingOutput('\x1b[?1000l')).toBe('');
  });

  test('strips button event tracking \\x1b[?1002h', () => {
    expect(filterMouseTrackingOutput('\x1b[?1002h')).toBe('');
  });

  test('strips any-event tracking \\x1b[?1003h', () => {
    expect(filterMouseTrackingOutput('\x1b[?1003h')).toBe('');
  });

  test('strips UTF-8 mouse mode \\x1b[?1005h', () => {
    expect(filterMouseTrackingOutput('\x1b[?1005h')).toBe('');
  });

  test('strips SGR mouse mode \\x1b[?1006h', () => {
    expect(filterMouseTrackingOutput('\x1b[?1006h')).toBe('');
  });

  test('strips urxvt mouse mode \\x1b[?1015h', () => {
    expect(filterMouseTrackingOutput('\x1b[?1015h')).toBe('');
  });

  test('strips multiple tracking sequences embedded in output', () => {
    const output = 'prompt$ \x1b[?1000h\x1b[?1006hsome output\x1b[?1000l\x1b[?1006l';
    expect(filterMouseTrackingOutput(output)).toBe('prompt$ some output');
  });

  test('preserves other DEC private modes (e.g. alternate screen)', () => {
    // \x1b[?1049h = alternate screen buffer (should NOT be stripped)
    const altScreen = '\x1b[?1049h';
    expect(filterMouseTrackingOutput(altScreen)).toBe(altScreen);
  });

  test('preserves cursor visibility toggle', () => {
    // \x1b[?25h = show cursor, \x1b[?25l = hide cursor
    expect(filterMouseTrackingOutput('\x1b[?25h')).toBe('\x1b[?25h');
    expect(filterMouseTrackingOutput('\x1b[?25l')).toBe('\x1b[?25l');
  });

  test('preserves SGR color sequences', () => {
    const bold = '\x1b[1m';
    const red = '\x1b[31m';
    const reset = '\x1b[0m';
    const input = `${bold}${red}error${reset}`;
    expect(filterMouseTrackingOutput(input)).toBe(input);
  });

  test('preserves Japanese text with tracking sequences removed', () => {
    const output = '\x1b[?1000hこんにちは\x1b[?1000l';
    expect(filterMouseTrackingOutput(output)).toBe('こんにちは');
  });
});

// ---------------------------------------------------------------------------
// shouldInterceptKeyEvent
// ---------------------------------------------------------------------------
describe('shouldInterceptKeyEvent', () => {
  // Helper to create a mock key event
  const mkEvent = (overrides: Partial<{
    type: string;
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {}) => ({
    type: 'keydown',
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  });

  test('intercepts Shift+Enter as "shift-enter"', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ shiftKey: true, key: 'Enter' }))).toBe('shift-enter');
  });

  test('intercepts Ctrl+V as "paste"', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ ctrlKey: true, key: 'v' }))).toBe('paste');
  });

  test('intercepts Cmd+V (metaKey) as "paste"', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ metaKey: true, key: 'v' }))).toBe('paste');
  });

  test('intercepts uppercase V with Ctrl', () => {
    // e.key is 'V' when Caps Lock is on
    expect(shouldInterceptKeyEvent(mkEvent({ ctrlKey: true, key: 'V' }))).toBe('paste');
  });

  test('does NOT intercept Ctrl+Shift+V (we only intercept without shift)', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ ctrlKey: true, shiftKey: true, key: 'v' }))).toBe(null);
  });

  test('does NOT intercept Ctrl+C (should go through to xterm for SIGINT)', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ ctrlKey: true, key: 'c' }))).toBe(null);
  });

  test('does NOT intercept Ctrl+D', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ ctrlKey: true, key: 'd' }))).toBe(null);
  });

  test('does NOT intercept regular Enter (without Shift)', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ key: 'Enter' }))).toBe(null);
  });

  test('does NOT intercept regular character keys', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ key: 'a' }))).toBe(null);
    expect(shouldInterceptKeyEvent(mkEvent({ key: '1' }))).toBe(null);
  });

  test('does NOT intercept keyup events', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ type: 'keyup', ctrlKey: true, key: 'v' }))).toBe(null);
    expect(shouldInterceptKeyEvent(mkEvent({ type: 'keyup', shiftKey: true, key: 'Enter' }))).toBe(null);
  });

  test('does NOT intercept arrow keys without modifier', () => {
    expect(shouldInterceptKeyEvent(mkEvent({ key: 'ArrowUp' }))).toBe(null);
    expect(shouldInterceptKeyEvent(mkEvent({ key: 'ArrowDown' }))).toBe(null);
  });
});
