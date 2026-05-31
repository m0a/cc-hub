import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import { HistoryRow } from '../HistoryRow';

describe('HistoryRow', () => {
  test('firstPrompt / projectName / agent / 日付を表示', () => {
    const { lastFrame } = render(
      <HistoryRow
        selected={false}
        entry={{
          sessionId: 's',
          projectPath: '/home/x/proj',
          projectName: 'proj',
          firstPrompt: 'hello world prompt',
          agent: 'codex',
          modified: '2026-05-22T10:11:28.556Z',
        }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('hello world prompt');
    expect(frame).toContain('proj');
    expect(frame).toContain('codex');
    expect(frame).toContain('2026-05-22');
  });

  test('プロンプト無しは代替表示', () => {
    const { lastFrame } = render(
      <HistoryRow selected entry={{ sessionId: 's', projectPath: '/p' }} />,
    );
    expect(lastFrame() ?? '').toContain('プロンプトなし');
  });
});
