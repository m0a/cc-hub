import { describe, expect, test } from 'bun:test';
import { sendSubmitKeys } from '../send';

describe('sendSubmitKeys', () => {
  test('bracketed paste（ESC[200~ / ESC[201~）+ リテラル + Enter を構築', () => {
    const cmds = sendSubmitKeys('my-session', '/compact');
    expect(cmds[0]).toEqual(['send-keys', '-t', 'my-session', '-H', '1b', '5b', '32', '30', '30', '7e']);
    expect(cmds[1]).toEqual(['send-keys', '-t', 'my-session', '-l', '/compact']);
    expect(cmds[2]).toEqual(['send-keys', '-t', 'my-session', '-H', '1b', '5b', '32', '30', '31', '7e']);
    expect(cmds[3]).toEqual(['send-keys', '-t', 'my-session', 'Enter']);
  });
});
