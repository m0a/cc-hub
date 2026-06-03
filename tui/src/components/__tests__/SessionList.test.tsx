import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import type { TuiSession } from '../../types';
import { SessionList } from '../SessionList';

const sessions: TuiSession[] = [
  {
    id: '1',
    name: 'alpha',
    agent: 'claude',
    indicatorState: 'processing',
    panes: [{ paneId: '%0', isActive: true }],
  },
  { id: '2', name: 'beta', customTitle: 'Refactor', agent: 'codex', indicatorState: 'idle' },
];

describe('SessionList', () => {
  test('セッション名 / customTitle / agent を表示', () => {
    const { lastFrame } = render(<SessionList sessions={sessions} selectedIndex={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('alpha');
    expect(frame).toContain('Refactor');
    expect(frame).toContain('claude');
    expect(frame).toContain('codex');
  });

  test('空配列は空状態メッセージ', () => {
    const { lastFrame } = render(<SessionList sessions={[]} selectedIndex={0} />);
    expect(lastFrame() ?? '').toContain('セッションがありません');
  });

  test('選択行に ❯ マーカー', () => {
    const { lastFrame } = render(<SessionList sessions={sessions} selectedIndex={1} />);
    expect(lastFrame() ?? '').toContain('❯');
  });
});
