import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import type { TuiSession } from '../../types';
import { SidebarList } from '../Sidebar';

const sessions: TuiSession[] = [
  { id: '1', name: 'alpha', agent: 'claude', indicatorState: 'processing' },
  { id: '2', name: 'beta', customTitle: 'Refactor', agent: 'codex', indicatorState: 'idle' },
];

describe('SidebarList', () => {
  test('1 行 1 セッションで名前 / customTitle を表示', () => {
    const { lastFrame } = render(<SidebarList sessions={sessions} selectedIndex={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('alpha');
    expect(frame).toContain('Refactor');
    expect(frame).toContain('≡ sessions');
  });

  test('選択行に ▸ マーカーが付く', () => {
    const { lastFrame } = render(<SidebarList sessions={sessions} selectedIndex={1} />);
    expect(lastFrame() ?? '').toContain('▸');
  });

  test('空配列は空状態メッセージ', () => {
    const { lastFrame } = render(<SidebarList sessions={[]} selectedIndex={0} />);
    expect(lastFrame() ?? '').toContain('セッションがありません');
  });
});
