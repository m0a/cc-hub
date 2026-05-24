import { describe, test, expect } from 'bun:test';
import { TmuxControlSession } from '../tmux-control';

/**
 * Direct unit tests for `sendCommand` serialization and FIFO integrity.
 *
 * These tests bypass tmux entirely by injecting a fake `proc.stdin` that
 * records writes and by replaying `%begin`/`%end` lines through the private
 * `processRawLine` entrypoint. The goal is to lock in two invariants:
 *
 *   1. Two concurrent `sendCommand` calls must not interleave bytes on
 *      stdin — the second command waits until the first one has settled.
 *   2. tmux responses are correlated to commands in strict FIFO order so a
 *      `display-message` result can never be mis-attributed to a
 *      `capture-pane` request (the original Mac-only viewport corruption).
 */

interface FakeStdin {
  writes: string[];
  write(data: string): void;
}

function attachFakeProc(session: TmuxControlSession): FakeStdin {
  const stdin: FakeStdin = {
    writes: [],
    write(data: string) {
      this.writes.push(data);
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: test seam into private fields.
  (session as any).proc = { stdin, killed: false, pid: 0 };
  return stdin;
}

function feed(session: TmuxControlSession, line: string): void {
  // biome-ignore lint/suspicious/noExplicitAny: test seam into private method.
  (session as any).processRawLine(Buffer.from(line, 'utf-8'));
}

function respond(session: TmuxControlSession, num: number, output: string): void {
  feed(session, `%begin 0 ${num} 0`);
  if (output.length > 0) {
    for (const out of output.split('\n')) feed(session, out);
  }
  feed(session, `%end 0 ${num} 0`);
}

// Each TmuxControlSession starts holding a "ready" promise that resolves on
// the first %end. The tests below need that to be consumed first so subsequent
// %begin/%end blocks flow into the FIFO.
function consumeReady(session: TmuxControlSession): void {
  respond(session, 0, '');
}

// `sendCommand` is async and yields on `await prev` before pushing its pending
// or writing to stdin. Tests that want to inject a tmux response right after
// calling `sendCommand` need to give those microtasks a chance to run.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('TmuxControlSession.sendCommand serialization', () => {
  test('two concurrent sendCommand calls write to stdin in order, one at a time', async () => {
    const session = new TmuxControlSession('test');
    const stdin = attachFakeProc(session);
    consumeReady(session);

    const p1 = session.sendCommand('display-message -p first');
    const p2 = session.sendCommand('display-message -p second');

    // Let microtasks settle. Only the first command should have been written.
    await flushMicrotasks();
    expect(stdin.writes).toEqual(['display-message -p first\n']);

    // Respond to the first command. Now the second should be flushed.
    respond(session, 1, 'first-result');
    expect(await p1).toBe('first-result');

    await flushMicrotasks();
    expect(stdin.writes).toEqual([
      'display-message -p first\n',
      'display-message -p second\n',
    ]);

    respond(session, 2, 'second-result');
    expect(await p2).toBe('second-result');
  });

  test('each tmux response resolves only its matching FIFO entry, never another', async () => {
    const session = new TmuxControlSession('test');
    attachFakeProc(session);
    consumeReady(session);

    // Three commands back-to-back. With serialization in place, command N
    // cannot be written until command N-1 has settled, so the FIFO is locked
    // to the call order — but we still verify each response only delivers
    // its own value to its own pending.
    const meta = '277,74,2,70,0,0,8452';
    const captured = 'line one\nline two';

    const p1 = session.sendCommand('display-message -p meta-1');
    await flushMicrotasks();
    respond(session, 1, meta);
    expect(await p1).toBe(meta);

    const p2 = session.sendCommand('capture-pane -e -p ...');
    await flushMicrotasks();
    respond(session, 2, captured);
    expect(await p2).toBe(captured);

    // Critically: the second pending got `captured`, NOT a leftover `meta`.
    expect(await p2).not.toBe(meta);
  });

  test('a thrown rejection on one command does not block subsequent commands', async () => {
    const session = new TmuxControlSession('test');
    attachFakeProc(session);
    consumeReady(session);

    const p1 = session.sendCommand('bad-command');
    await flushMicrotasks();
    feed(session, '%begin 0 1 0');
    feed(session, 'unknown command: bad-command');
    feed(session, '%error 0 1 0');
    await expect(p1).rejects.toThrow();

    const p2 = session.sendCommand('display-message -p ok');
    await flushMicrotasks();
    respond(session, 2, 'ok-result');
    expect(await p2).toBe('ok-result');
  });

  // Regression for the v0.1.159 viewport corruption: capture-pane responses
  // contain literal blank rows (every-other-row dev log spacing, Claude TUI
  // partial paint, etc.). If the protocol parser drops those blank lines,
  // `pane-viewport` sees fewer rows than tmux actually captured, padFill
  // pads the bottom with `''` rows, and the user sees a void at the bottom
  // of the rendered viewport that fluctuates as they scroll.
  test('blank lines inside a command response block are preserved in the FIFO output', async () => {
    const session = new TmuxControlSession('test');
    attachFakeProc(session);
    consumeReady(session);

    const p = session.sendCommand('capture-pane -e -p -t %1 -S 0 -E 4');
    await flushMicrotasks();

    // Replay a 5-row capture where rows 1 and 3 are literal blank lines.
    feed(session, '%begin 0 1 0');
    feed(session, 'row0-content');
    feed(session, '');
    feed(session, 'row2-content');
    feed(session, '');
    feed(session, 'row4-content');
    feed(session, '%end 0 1 0');

    const result = await p;
    expect(result.split('\n')).toEqual([
      'row0-content',
      '',
      'row2-content',
      '',
      'row4-content',
    ]);
  });

  test('trailing blank line inside a command response block survives', async () => {
    const session = new TmuxControlSession('test');
    attachFakeProc(session);
    consumeReady(session);

    const p = session.sendCommand('capture-pane -e -p -t %1 -S 0 -E 2');
    await flushMicrotasks();

    // Last captured row is a literal blank — must NOT be silently dropped.
    feed(session, '%begin 0 1 0');
    feed(session, 'row0');
    feed(session, 'row1');
    feed(session, '');
    feed(session, '%end 0 1 0');

    const result = await p;
    expect(result.split('\n')).toEqual(['row0', 'row1', '']);
  });
});
