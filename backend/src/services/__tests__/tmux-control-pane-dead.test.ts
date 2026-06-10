import { describe, expect, test } from 'bun:test';
import { TmuxControlSession } from '../tmux-control';

/**
 * Tests for %window-renamed [dead] handling (#348).
 *
 * A pane process exiting under remain-on-exit makes tmux rename the window
 * with a "[dead]" suffix. The old code flagged EVERY known pane as dead,
 * so live sibling panes (and panes in other windows) were wrongly marked
 * dead. These tests lock in window scoping and per-pane dead detection.
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

function consumeReady(session: TmuxControlSession): void {
  respond(session, 0, '');
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('%window-renamed [dead] handling', () => {
  test('single-pane window: notifies that pane synchronously', () => {
    const session = new TmuxControlSession('test');
    attachFakeProc(session);
    consumeReady(session);

    const dead: string[] = [];
    session.onPaneDead((paneId) => dead.push(paneId));

    feed(session, '%layout-change @1 a1b2,80x24,0,0,0');
    feed(session, '%window-renamed @1 zsh[dead]');

    expect(dead).toEqual(['%0']);
  });

  test('multi-pane window: flags only the pane tmux reports as dead', async () => {
    const session = new TmuxControlSession('test');
    attachFakeProc(session);
    consumeReady(session);

    const dead: string[] = [];
    session.onPaneDead((paneId) => dead.push(paneId));

    // Window @1 has two panes: %0 and %1.
    feed(session, '%layout-change @1 a1b2,80x24,0,0{40x24,0,0,0,39x24,41,0,1}');
    feed(session, '%window-renamed @1 zsh[dead]');

    // No synchronous notification — a list-panes query is in flight.
    expect(dead).toEqual([]);

    await flushMicrotasks();
    // Reply: %0 alive, %1 dead.
    respond(session, 1, '%0 0\n%1 1');
    await flushMicrotasks();

    expect(dead).toEqual(['%1']);
  });

  test('does not flag panes in unaffected windows', () => {
    const session = new TmuxControlSession('test');
    attachFakeProc(session);
    consumeReady(session);

    const dead: string[] = [];
    session.onPaneDead((paneId) => dead.push(paneId));

    // Window @1: panes %0,%1.  Window @2: single pane %2.
    feed(session, '%layout-change @1 a1b2,80x24,0,0{40x24,0,0,0,39x24,41,0,1}');
    feed(session, '%layout-change @2 c3d4,80x24,0,0,2');

    // @2's pane dies — @1's panes must not be touched.
    feed(session, '%window-renamed @2 zsh[dead]');

    expect(dead).toEqual(['%2']);
  });

  test('ignores non-dead window renames', () => {
    const session = new TmuxControlSession('test');
    attachFakeProc(session);
    consumeReady(session);

    const dead: string[] = [];
    session.onPaneDead((paneId) => dead.push(paneId));

    feed(session, '%layout-change @1 a1b2,80x24,0,0,0');
    feed(session, '%window-renamed @1 my-project');

    expect(dead).toEqual([]);
  });
});
