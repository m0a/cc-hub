import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import { HistorySearch } from '../HistorySearch';

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const noop = () => {};

describe('HistorySearch', () => {
  test('初期は入力プロンプトの空状態', () => {
    const { lastFrame, unmount } = render(
      <HistorySearch baseUrl="https://h:5923" token={null} onPick={noop} onCancel={noop} />,
    );
    expect(lastFrame() ?? '').toContain('キーワードを入力');
    unmount();
  });

  test('入力した文字がクエリ欄に反映（デバウンス前に確認）', async () => {
    const { stdin, lastFrame, unmount } = render(
      <HistorySearch baseUrl="https://h:5923" token={null} onPick={noop} onCancel={noop} />,
    );
    stdin.write('abc');
    await tick();
    expect(lastFrame() ?? '').toContain('abc');
    unmount();
  });

  test('Esc で onCancel を呼ぶ', async () => {
    let cancelled = false;
    const { stdin, unmount } = render(
      <HistorySearch
        baseUrl="https://h:5923"
        token={null}
        onPick={noop}
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    stdin.write('\x1b'); // Esc
    await tick(120); // ink は単独 ESC をシーケンス判定のため僅かに遅延配信する
    expect(cancelled).toBe(true);
    unmount();
  });
});
