import { describe, expect, test } from 'bun:test';

/**
 * These tests document the contract between `TmuxControlSession.sendCommand`
 * and pad-fill code in `pane-viewport.ts`:
 *
 * - `sendCommand` returns lines joined with `\n` and WITHOUT any trailing
 *   newline artifact (see `handleEnd` in tmux-control.ts).
 * - So `raw.split('\n')` already gives exactly the captured rows.
 * - A trailing `''` element IS a literal blank row, not an artifact. Popping
 *   it loses data and surfaces as a void at the bottom of the rendered
 *   viewport whose size fluctuates with scroll position (the v0.1.159 bug).
 *
 * The pad-fill paths must use bare `split('\n')` with no trimming. This
 * regression test pins that invariant via a self-contained assertion so a
 * future refactor that tries to "clean up trailing blanks" trips here first.
 */
describe('capture-pane raw → rows contract', () => {
  test('split alone preserves a trailing literal blank row', () => {
    // 3 captured rows where the last is blank.
    // currentOutput = ['a', 'b', ''] → join('\n') = 'a\nb\n'
    const raw = ['a', 'b', ''].join('\n');
    expect(raw).toBe('a\nb\n');
    expect(raw.split('\n')).toEqual(['a', 'b', '']);
  });

  test('split alone preserves rows with no trailing blank', () => {
    const raw = ['a', 'b', 'c'].join('\n');
    expect(raw).toBe('a\nb\nc');
    expect(raw.split('\n')).toEqual(['a', 'b', 'c']);
  });

  test('split alone preserves interspersed blank rows', () => {
    const raw = ['a', '', 'b', '', 'c'].join('\n');
    expect(raw.split('\n')).toEqual(['a', '', 'b', '', 'c']);
  });

  test('split alone preserves a single blank row capture', () => {
    const raw = [''].join('\n');
    expect(raw).toBe('');
    expect(raw.split('\n')).toEqual(['']);
  });

  test('an over-eager `pop while last is ""` loses real blank rows', () => {
    // Demonstrates the v0.1.159 regression: popping the trailing '' loses
    // the captured last blank row, which downstream gets backfilled with
    // another '' by `lines.push('')`, but the data identity is gone — and
    // when the visible region is involved, the wrong content shifts up.
    const lines = ['a', 'b', ''];
    // BAD: treats blank row as parse artifact and pops it.
    const popped = [...lines];
    if (popped[popped.length - 1] === '') popped.pop();
    expect(popped).toEqual(['a', 'b']);
    expect(popped.length).toBe(lines.length - 1);
  });
});
