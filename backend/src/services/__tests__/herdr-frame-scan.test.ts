import { describe, expect, test } from 'bun:test';
import { scanFrameForState, type PaneRuntimeState } from '../herdr-control';

function freshState(): PaneRuntimeState {
  return { altScreen: false, cursorX: 0, cursorY: 0, cursorVisible: false };
}

function scan(state: PaneRuntimeState, s: string): PaneRuntimeState {
  scanFrameForState(state, Buffer.from(s, 'latin1'));
  return state;
}

describe('scanFrameForState', () => {
  test('cursor position from the last CUP of the frame', () => {
    const st = scan(freshState(), 'draw\x1b[5;10Hmid\x1b[23;6H\x1b[?25h');
    expect(st.cursorY).toBe(22);
    expect(st.cursorX).toBe(5);
    expect(st.cursorVisible).toBe(true);
  });

  test('bare CUP (\\x1b[H) means home', () => {
    const st = scan(freshState(), '\x1b[H\x1b[?25h');
    expect(st.cursorY).toBe(0);
    expect(st.cursorX).toBe(0);
  });

  test('cursor hide wins when it comes after show', () => {
    const st = scan(freshState(), '\x1b[?25h paint \x1b[?25l');
    expect(st.cursorVisible).toBe(false);
  });

  test('alt-screen enter and leave (1049)', () => {
    const st = freshState();
    scan(st, 'before\x1b[?1049h\x1b[2J');
    expect(st.altScreen).toBe(true);
    scan(st, '\x1b[?1049l\x1b[H');
    expect(st.altScreen).toBe(false);
  });

  test('last alt-screen toggle in a frame wins', () => {
    const st = scan(freshState(), '\x1b[?1049h stuff \x1b[?1049l');
    expect(st.altScreen).toBe(false);
  });

  test('legacy 47/1047 variants are recognized', () => {
    expect(scan(freshState(), '\x1b[?47h').altScreen).toBe(true);
    expect(scan(freshState(), '\x1b[?1047h').altScreen).toBe(true);
  });

  test('state persists across frames that carry no relevant sequences', () => {
    const st = scan(freshState(), '\x1b[?1049h\x1b[12;34H\x1b[?25h');
    scan(st, 'plain incremental text with colors \x1b[38;5;2mgreen\x1b[0m');
    expect(st.altScreen).toBe(true);
    expect(st.cursorY).toBe(11);
    expect(st.cursorX).toBe(33);
    expect(st.cursorVisible).toBe(true);
  });

  test('HVP (\\x1b[r;cf) also moves the cursor', () => {
    const st = scan(freshState(), '\x1b[3;4f');
    expect(st.cursorY).toBe(2);
    expect(st.cursorX).toBe(3);
  });
});
