import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import { App } from '../App';

describe('App', () => {
  test('connected: 接続済みとセッション数を表示', () => {
    const { lastFrame } = render(
      <App connection={{ state: 'connected', baseUrl: 'https://h:5923', sessionCount: 3 }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('接続済み');
    expect(frame).toContain('3');
    expect(frame).toContain('https://h:5923');
  });

  test('unauthorized: エラーメッセージを表示', () => {
    const { lastFrame } = render(
      <App connection={{ state: 'unauthorized', baseUrl: 'https://h:5923', error: '認証に失敗しました' }} />,
    );
    expect(lastFrame() ?? '').toContain('認証に失敗しました');
  });
});
