/**
 * Viewport capture for server-side scrollback.
 *
 * tmux is the authoritative store for both the visible region and the
 * scrollback ring buffer. We expose a single primitive: given a pane and
 * a non-negative offset (rows above the live edge), return the lines
 * tmux currently has for that window.
 *
 *   offset = 0           → live mode (visible region as it stands now)
 *   offset = N > 0       → window ending N rows above the visible top
 *
 *  capture-pane line numbers used here:
 *   0..(pane_height-1)  visible region (0 = top of visible)
 *   -1, -2, ...         scrollback (-1 = first line above visible, ...)
 *
 * So a window of `rows` rows at `offset` is `-S start -E end` where
 *   start = -offset
 *   end   = -offset + (rows - 1)
 */

import type { PaneViewport, PaneCursor, PaneModes } from '../../../shared/types';
import type { TmuxControlSession } from './tmux-control';

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes by design.
const ANSI_RE = /\x1b\[[\d;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export interface ViewportRequest {
  offset: number;
}

/**
 * Capture a viewport from a pane. Returns null if the pane no longer exists.
 *
 * The returned `lines` array always has exactly `rows` entries (pane height).
 * Missing rows (e.g. offset > history_size) are padded with empty strings.
 *
 * In live mode (offset=0) the cursor position from tmux is included. In
 * scrolled mode the cursor is hidden so the client doesn't render a stale
 * cursor inside historical content.
 */
export async function captureViewport(
  cs: TmuxControlSession,
  paneId: string,
  offset: number,
): Promise<PaneViewport | null> {
  let metaRaw: string;
  try {
    metaRaw = await cs.sendCommand(
      `display-message -t ${paneId} -p '#{pane_width},#{pane_height},#{cursor_x},#{cursor_y},#{cursor_flag},#{alternate_on},#{history_size}'`,
    );
  } catch {
    return null;
  }

  const parts = metaRaw.trim().split(',');
  if (parts.length < 7) return null;
  const cols = Number.parseInt(parts[0], 10);
  const rows = Number.parseInt(parts[1], 10);
  const cx = Number.parseInt(parts[2], 10);
  const cy = Number.parseInt(parts[3], 10);
  const cursorVisible = parts[4] === '1';
  const altScreen = parts[5] === '1';
  const historySize = Number.parseInt(parts[6], 10) || 0;

  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
    return null;
  }

  // Clamp the requested offset to the available scrollback. We allow
  // offset == historySize (= window starts exactly at the oldest scrollback
  // line and trails down into the visible region) but not beyond.
  const clampedOffset = Math.max(0, Math.min(offset, historySize));

  const start = -clampedOffset;
  const end = -clampedOffset + (rows - 1);
  // tmux `capture-pane -e -p -S a -E b`:
  //   - `-e` preserves ANSI escapes (colours, hyperlinks, etc.)
  //   - `-p` writes to stdout instead of a tmux buffer
  //   - `-S`/`-E` accept negative values for scrollback addressing
  // We deliberately avoid `-a` so altScreen TUIs (htop, vim, Codex) return
  // their actual rendered surface rather than the screen behind them.
  let linesRaw: string;
  try {
    linesRaw = await cs.sendCommand(`capture-pane -e -p -t ${paneId} -S ${start} -E ${end}`);
  } catch {
    return null;
  }

  // tmux always returns exactly `end - start + 1` rows when both bounds are
  // in-range; pad with blanks defensively in case it returned fewer (e.g.
  // racing with a resize).
  let lines = linesRaw.split('\n');
  if (lines.length > rows) {
    lines = lines.slice(0, rows);
  }
  while (lines.length < rows) {
    lines.push('');
  }

  const atTail = clampedOffset === 0;
  const cursor: PaneCursor = atTail
    ? {
        x: Math.max(0, Math.min(cols - 1, cx)),
        y: Math.max(0, Math.min(rows - 1, cy)),
        visible: cursorVisible,
      }
    : { x: 0, y: 0, visible: false };
  const modes: PaneModes = { altScreen };

  return {
    paneId,
    cols,
    rows,
    lines,
    cursor,
    modes,
    historySize,
    offset: clampedOffset,
    atTail,
  };
}
