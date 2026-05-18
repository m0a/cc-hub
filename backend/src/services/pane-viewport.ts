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

function isVisuallyBlank(s: string): boolean {
  return stripAnsi(s).trim() === '';
}

/**
 * Fetch up to `wanted` rows of scrollback ending just above the visible
 * region (`-S -wanted -E -1`). Returns trimmed rows or [] on failure.
 */
async function captureScrollback(
  cs: TmuxControlSession,
  paneId: string,
  wanted: number,
): Promise<string[]> {
  if (wanted <= 0) return [];
  try {
    const raw = await cs.sendCommand(
      `capture-pane -e -p -t ${paneId} -S -${wanted} -E -1`,
    );
    const sb = raw.split('\n');
    while (sb.length > 0 && isVisuallyBlank(sb[sb.length - 1])) sb.pop();
    return sb;
  } catch {
    return [];
  }
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

  // Claude TUI (and similar) only paints the rows it actually wrote to;
  // tmux's capture-pane returns visually-blank entries for the rest.
  // Any window that overlaps the visible region (offset < rows) ends
  // with those blanks, producing a "void" at the bottom of the slice
  // even when the user has scrolled up. Trim them and prepend more
  // scrollback rows from immediately above the current window so the
  // viewport is full of meaningful content at every offset.
  //
  // altScreen mode (htop, vim, etc.) is left alone — the TUI owns the
  // whole surface there and blanks are intentional.
  //
  // At offset=0 we must never trim past the cursor row, even if the
  // rows between content and cursor are blank (= a normal shell parking
  // its prompt below the last output). Keeping the cursor row in the
  // kept region means the post-padFill cursor shift lands the cursor on
  // its original blank line, just pushed down to make room for history.
  let cursorPadShift = 0;
  if (!altScreen && historySize > 0) {
    const cursorFloor = clampedOffset === 0 ? cy : -1;
    while (
      lines.length > cursorFloor + 1 &&
      isVisuallyBlank(lines[lines.length - 1])
    ) {
      lines.pop();
    }
    const padNeeded = rows - lines.length;
    if (padNeeded > 0) {
      // The current window starts at tmux line `start` (= -clampedOffset).
      // To fill `padNeeded` rows we want the slice ending one row above
      // `start` — i.e. -(clampedOffset + 1) — and extending `padNeeded`
      // rows upward.
      const padEnd = -(clampedOffset + 1);
      const padStart = padEnd - (padNeeded - 1);
      // Skip if the pad slice would go past the oldest scrollback row,
      // or if we'd be sampling visible-region rows (offset==0 special
      // case, handled by the simpler captureScrollback helper below).
      if (clampedOffset === 0) {
        const fetched = await captureScrollback(cs, paneId, padNeeded);
        if (fetched.length > 0) {
          const prepend = fetched.slice(-padNeeded);
          lines = [...prepend, ...lines];
          cursorPadShift = prepend.length;
        }
      } else if (padStart >= -historySize) {
        try {
          const padRaw = await cs.sendCommand(
            `capture-pane -e -p -t ${paneId} -S ${padStart} -E ${padEnd}`,
          );
          const padLines = padRaw.split('\n');
          while (padLines.length > 0 && isVisuallyBlank(padLines[padLines.length - 1])) {
            padLines.pop();
          }
          if (padLines.length > 0) {
            const prepend = padLines.slice(-padNeeded);
            lines = [...prepend, ...lines];
            // Cursor stays hidden in scrolled mode (atTail===false below),
            // so no shift is needed here.
          }
        } catch {
          // Capture failed (pane gone, etc.); fall through to blank pad.
        }
      }
    }
  }

  while (lines.length < rows) {
    lines.push('');
  }

  const atTail = clampedOffset === 0;
  const cursor: PaneCursor = atTail
    ? {
        x: Math.max(0, Math.min(cols - 1, cx)),
        y: Math.max(0, Math.min(rows - 1, cy + cursorPadShift)),
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
