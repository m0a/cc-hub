import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import type { ApiClient } from '../../api/client';
import type { ListAction } from '../../types';
import { App } from '../App';

function fakeClient(sessions: unknown[]): ApiClient {
  return {
    get: async () => ({ sessions }),
    post: async () => ({}),
    del: async () => ({}),
  } as unknown as ApiClient;
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('App (US1 list)', () => {
  test('接続後にセッション一覧と baseUrl を表示', async () => {
    const client = fakeClient([{ id: '1', name: 'alpha', agent: 'claude' }]);
    const { lastFrame, unmount } = render(
      <App client={client} baseUrl="https://h:5923" onAction={() => {}} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('alpha');
    expect(frame).toContain('https://h:5923');
    unmount();
  });

  test('Enter で選択セッションへ attach アクションを返す', async () => {
    const actions: ListAction[] = [];
    const client = fakeClient([{ id: '1', name: 'alpha' }]);
    const { stdin, unmount } = render(
      <App client={client} baseUrl="https://h:5923" onAction={(a) => actions.push(a)} />,
    );
    await tick();
    stdin.write('\r'); // Enter
    await tick(10);
    expect(actions[0]).toEqual({ type: 'attach', sessionName: 'alpha' });
    unmount();
  });

  test('q で quit アクションを返す', async () => {
    const actions: ListAction[] = [];
    const client = fakeClient([]);
    const { stdin, unmount } = render(
      <App client={client} baseUrl="https://h:5923" onAction={(a) => actions.push(a)} />,
    );
    await tick();
    stdin.write('q');
    await tick(10);
    expect(actions[0]).toEqual({ type: 'quit' });
    unmount();
  });

  test('n で create アクションを返す', async () => {
    const actions: ListAction[] = [];
    const client = fakeClient([]);
    const { stdin, unmount } = render(
      <App client={client} baseUrl="https://h:5923" onAction={(a) => actions.push(a)} />,
    );
    await tick();
    stdin.write('n');
    await tick(10);
    expect(actions[0]).toEqual({ type: 'create' });
    unmount();
  });

  test('x で終了確認プロンプトを表示', async () => {
    const client = fakeClient([{ id: '1', name: 'alpha' }]);
    const { stdin, lastFrame, unmount } = render(
      <App client={client} baseUrl="https://h:5923" onAction={() => {}} />,
    );
    await tick();
    stdin.write('x');
    await tick(10);
    expect(lastFrame() ?? '').toContain('終了しますか');
    unmount();
  });

  test('? でヘルプを開閉', async () => {
    const client = fakeClient([{ id: '1', name: 'alpha' }]);
    const { stdin, lastFrame, unmount } = render(
      <App client={client} baseUrl="https://h:5923" onAction={() => {}} />,
    );
    await tick();
    stdin.write('?');
    await tick(10);
    expect(lastFrame() ?? '').toContain('キーバインド');
    stdin.write('x'); // 何かキーで閉じる
    await tick(10);
    expect(lastFrame() ?? '').not.toContain('キーバインド');
    unmount();
  });
});
