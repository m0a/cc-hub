import { describe, expect, test } from 'bun:test';
import type { TuiSession } from '../../types';
import {
  deriveIndicator,
  deriveRow,
  formatDuration,
  formatTokens,
  indicatorGlyph,
  shortenPath,
  taskText,
} from '../session-row';

function session(overrides: Partial<TuiSession>): TuiSession {
  return { id: 's', name: 's', ...overrides };
}

describe('deriveIndicator', () => {
  test('トップレベル indicatorState を優先', () => {
    expect(deriveIndicator(session({ indicatorState: 'waiting_input' }))).toBe('waiting_input');
  });

  test('トップレベルが無ければペインで最も注意度の高いものを採用', () => {
    const s = session({
      panes: [
        { paneId: '%0', isActive: true, indicatorState: 'idle' },
        { paneId: '%1', isActive: false, indicatorState: 'processing' },
      ],
    });
    expect(deriveIndicator(s)).toBe('processing');
  });

  test('waiting_input は processing より優先', () => {
    const s = session({
      panes: [
        { paneId: '%0', isActive: true, indicatorState: 'processing' },
        { paneId: '%1', isActive: false, indicatorState: 'waiting_input' },
      ],
    });
    expect(deriveIndicator(s)).toBe('waiting_input');
  });

  test('情報が無ければ undefined', () => {
    expect(deriveIndicator(session({}))).toBeUndefined();
    expect(deriveIndicator(session({ panes: [] }))).toBeUndefined();
  });
});

describe('indicatorGlyph', () => {
  test('状態ごとにグリフ＋色', () => {
    expect(indicatorGlyph('waiting_input')).toEqual({ glyph: '●', color: 'red' });
    expect(indicatorGlyph('processing')).toEqual({ glyph: '◐', color: 'yellow' });
    expect(indicatorGlyph('idle')).toEqual({ glyph: '○', color: 'green' });
    expect(indicatorGlyph('completed')).toEqual({ glyph: '✓', color: 'cyan' });
    expect(indicatorGlyph(undefined).glyph).toBe('·');
  });
});

describe('shortenPath', () => {
  test('$HOME を ~ に畳む', () => {
    const home = process.env.HOME ?? '/home/u';
    expect(shortenPath(`${home}/work/proj`)).toBe('~/work/proj');
  });
  test('undefined は空文字', () => {
    expect(shortenPath(undefined)).toBe('');
  });
});

describe('deriveRow', () => {
  test('customTitle があれば優先、無ければ name', () => {
    expect(deriveRow(session({ name: 'sess', customTitle: 'My Work' })).title).toBe('My Work');
    expect(deriveRow(session({ name: 'sess' })).title).toBe('sess');
    expect(deriveRow(session({ name: 'sess', customTitle: '   ' })).title).toBe('sess');
  });

  test('agentLabel と paneCount を導出', () => {
    const row = deriveRow(
      session({
        agent: 'claude',
        panes: [
          { paneId: '%0', isActive: true },
          { paneId: '%1', isActive: false },
        ],
      }),
    );
    expect(row.agentLabel).toBe('claude');
    expect(row.paneCount).toBe(2);
  });
});

describe('formatDuration', () => {
  test('分/時/日に整形', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(1114)).toBe('18h');
    expect(formatDuration(1440)).toBe('1d');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });
});

describe('formatTokens', () => {
  test('k / M に整形', () => {
    expect(formatTokens(906)).toBe('906');
    expect(formatTokens(12300)).toBe('12.3k');
    expect(formatTokens(7236370)).toBe('7.2M');
    expect(formatTokens(0)).toBe('');
    expect(formatTokens(undefined)).toBe('');
  });
});

describe('taskText', () => {
  test('paneTitle を優先', () => {
    expect(taskText(session({ paneTitle: 'タスクA', ccSummary: '要約B' }))).toBe('タスクA');
  });
  test('paneTitle が無ければ ccSummary を1行化', () => {
    expect(taskText(session({ ccSummary: '要約\n  続き' }))).toBe('要約 続き');
  });
  test('どちらも無ければ空', () => {
    expect(taskText(session({}))).toBe('');
  });
});
