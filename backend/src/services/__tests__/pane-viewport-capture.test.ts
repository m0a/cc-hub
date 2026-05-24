import { describe, expect, test } from 'bun:test';
import { parseCaptureOutput } from '../pane-viewport';

describe('parseCaptureOutput', () => {
  test('strips the single trailing-\\n artifact', () => {
    expect(parseCaptureOutput('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
  });

  test('preserves a literal blank row that ends the capture', () => {
    // tmux blank row + trailing \n => raw "a\n\n", split => ['a','',''].
    // We pop ONLY the final '' artifact and keep the blank row.
    expect(parseCaptureOutput('a\n\n')).toEqual(['a', '']);
  });

  test('preserves multiple consecutive blank rows', () => {
    // Real dev-log pattern: alternating content + blank
    // raw "a\n\nb\n\n" => split ['a','','b','',''], pop => ['a','','b','']
    expect(parseCaptureOutput('a\n\nb\n\n')).toEqual(['a', '', 'b', '']);
  });

  test('returns [] for empty raw input', () => {
    expect(parseCaptureOutput('')).toEqual([]);
  });

  test('returns [""] for raw single newline (a single blank row)', () => {
    expect(parseCaptureOutput('\n')).toEqual(['']);
  });

  test('preserves rows containing ANSI escapes', () => {
    expect(parseCaptureOutput('\x1b[38;5;114mfoo\x1b[39m\n')).toEqual([
      '\x1b[38;5;114mfoo\x1b[39m',
    ]);
  });

  test('does not trim whitespace-only rows', () => {
    // Important: whitespace-only rows might appear when a TUI pads with
    // spaces. Capture should preserve them so padFill math stays correct.
    expect(parseCaptureOutput('a\n   \nb\n')).toEqual(['a', '   ', 'b']);
  });
});
