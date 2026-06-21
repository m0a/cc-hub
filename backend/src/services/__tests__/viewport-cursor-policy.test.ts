import { describe, expect, test } from 'bun:test';
import {
  computeCursorPadShift,
  resolveViewportCursor,
  resolveViewportCursorPolicy,
} from '../viewport-cursor-policy';

describe('viewport cursor policy', () => {
  test('maps codex sessions to the codex policy', () => {
    expect(resolveViewportCursorPolicy('codex')).toBe('codex-footer');
    expect(resolveViewportCursorPolicy('claude')).toBe('default');
    expect(resolveViewportCursorPolicy()).toBe('default');
  });

  test('computes cursor pad shift per policy', () => {
    // The default policy shifts the cursor down by exactly the number of
    // prepended scrollback rows so it tracks the input row that padFill
    // pushed down. Codex keeps its own footer-relative cursor (no shift).
    expect(computeCursorPadShift('default', 5)).toBe(5);
    expect(computeCursorPadShift('default', 1)).toBe(1);
    expect(computeCursorPadShift('default', 0)).toBe(0);
    expect(computeCursorPadShift('codex-footer', 5)).toBe(0);
  });

  test('resolves a default live cursor with pad shift', () => {
    const cursor = resolveViewportCursor('default', {
      cols: 80,
      rows: 24,
      cursorX: 3,
      cursorY: 10,
      cursorVisible: true,
      cursorPadShift: 2,
      renderedLines: ['', '', '', '', '', '', '', '', '', '', '', '', 'line', ''],
      atTail: true,
    });

    expect(cursor).toEqual({ x: 3, y: 12, visible: true });
  });

  test('clamps default cursor to the last visible content row', () => {
    const cursor = resolveViewportCursor('default', {
      cols: 80,
      rows: 24,
      cursorX: 3,
      cursorY: 23,
      cursorVisible: true,
      cursorPadShift: 0,
      renderedLines: ['prompt line', ''],
      atTail: true,
    });

    expect(cursor).toEqual({ x: 3, y: 0, visible: true });
  });

  test('resolves Codex cursor above the footer', () => {
    const cursor = resolveViewportCursor('codex-footer', {
      cols: 80,
      rows: 24,
      cursorX: 3,
      cursorY: 22,
      cursorVisible: true,
      cursorPadShift: 0,
      renderedLines: [
        '› h',
        '',
        'tab to queue message',
      ],
      atTail: true,
    });

    expect(cursor).toEqual({ x: 3, y: 1, visible: true });
  });

  test('hides cursor when not at tail', () => {
    const cursor = resolveViewportCursor('default', {
      cols: 80,
      rows: 24,
      cursorX: 3,
      cursorY: 10,
      cursorVisible: true,
      cursorPadShift: 2,
      renderedLines: ['line'],
      atTail: false,
    });

    expect(cursor).toEqual({ x: 3, y: 0, visible: false });
  });
});
