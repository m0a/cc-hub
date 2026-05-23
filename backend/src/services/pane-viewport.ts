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
import {
  computeCursorPadShift,
  resolveViewportCursor,
  type ViewportCursorPolicy,
} from './viewport-cursor-policy';

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes by design.
const ANSI_RE = /\x1b\[[\d;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export type DetectedPaneState =
  | 'permission_prompt'   // Claude Code permission dialog visible
  | 'ask_user_question'   // AskUserQuestion (numbered choice) dialog visible
  | 'processing'          // Claude Code "Esc to interrupt" / spinner visible
  | 'idle'                // Claude Code prompt visible, idle ✳ marker
  | 'unknown';            // nothing decisive found in viewport

/**
 * Best-effort detection of what state the pane is currently in, based purely
 * on the rendered viewport. Used by peer-dialog tools (`cchub send --wait`,
 * `cchub peek`) so the sender can disambiguate idle vs. permission-prompt vs.
 * mid-processing — `indicatorState` from hooks is too coarse for this.
 *
 * Heuristics are based on patterns Claude Code prints. They will need updating
 * if Claude Code's TUI changes. Detection is intentionally non-authoritative;
 * 'unknown' is fine.
 */
export function detectPaneState(lines: string[]): DetectedPaneState {
  // Walk the last ~25 visible rows (where prompts always live).
  const tail = lines.slice(-25).map(stripAnsi);
  const joined = tail.join('\n');

  // Permission prompt — Claude Code's confirm dialog.
  // Examples: "Do you want to proceed?", "1. Yes", "Yes, and don't ask again"
  if (
    /Do you want to (proceed|make this edit|create)/i.test(joined) ||
    /Yes, and don'?t ask again/i.test(joined) ||
    /^\s*❯?\s*[12]\.\s+(Yes|No)\b/m.test(joined)
  ) {
    return 'permission_prompt';
  }

  // AskUserQuestion — numbered choice list, distinguishable from permission
  // by lacking the Yes/No structure and usually having ≥3 options.
  if (/^\s*❯?\s*[1-9][.)]\s+\S/m.test(joined) && /\?\s*$/m.test(joined)) {
    return 'ask_user_question';
  }

  // Processing — Claude Code spinner has these signatures, in priority order:
  //  - explicit "(esc to interrupt)" hint
  //  - the "· <Verb>… (<time> · ↓/↑ <n> tokens · ...)" spinner line. The
  //    spinner verb changes per release (Kneading, Brewing, Pondering, …),
  //    so we anchor on the stable "tokens" keyword followed by ")" on the
  //    same line — this is uniquely emitted by the spinner.
  if (
    /\(esc to interrupt\)/i.test(joined) ||
    /tokens(?:\s*·[^)]*)?\)\s*$/m.test(joined)
  ) {
    return 'processing';
  }

  // Idle — Claude prints "✻/✳/✶ <verb>"-prefixed status line above the input
  // box (✻ = completed task, ✳ = idle waiting), or the input box is visible
  // and empty ("│ > " or "❯ " alone on a line). If the spinner check above
  // didn't match and we still see Claude's mode-hint footer, we treat it as
  // idle by default.
  if (
    /^\s*[✳✻✶✴]\s/m.test(joined) ||
    /^\s*│\s+>\s*$/m.test(joined) ||
    /^\s*❯\s*$/m.test(joined) ||
    /⏵⏵\s+(auto mode|accept edits|plan mode)/.test(joined)
  ) {
    return 'idle';
  }

  return 'unknown';
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
  cursorPolicy: ViewportCursorPolicy = 'default',
): Promise<PaneViewport | null> {
  let metaRaw: string;
  try {
    metaRaw = await cs.sendCommand(
      `display-message -t ${paneId} -p '#{pane_width},#{pane_height},#{alternate_on},#{history_size}'`,
    );
  } catch {
    return null;
  }

  const parts = metaRaw.trim().split(',');
  if (parts.length < 4) return null;
  const cols = Number.parseInt(parts[0], 10);
  const rows = Number.parseInt(parts[1], 10);
  const altScreen = parts[2] === '1';
  const historySize = Number.parseInt(parts[3], 10) || 0;

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

  let cx = 0;
  let cy = 0;
  let cursorVisible = false;
  if (clampedOffset === 0) {
    // Fetch cursor metadata after capture so the rendered cursor is based on
    // the freshest possible position. This reduces visible drift on panes
    // that redraw quickly (Codex tends to do this more than the shell UI).
    try {
      const cursorRaw = await cs.sendCommand(
        `display-message -t ${paneId} -p '#{cursor_x},#{cursor_y},#{cursor_flag}'`,
      );
      const cursorParts = cursorRaw.trim().split(',');
      if (cursorParts.length >= 3) {
        cx = Number.parseInt(cursorParts[0], 10);
        cy = Number.parseInt(cursorParts[1], 10);
        cursorVisible = cursorParts[2] === '1';
      }
    } catch {
      // Fall back to a hidden cursor if tmux is busy or the pane vanished
      // between the viewport capture and the cursor query.
    }
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
          cursorPadShift = computeCursorPadShift(cursorPolicy, prepend.length);
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
  const cursor: PaneCursor = resolveViewportCursor(cursorPolicy, {
    cols,
    rows,
    cursorX: cx,
    cursorY: cy,
    cursorVisible,
    cursorPadShift,
    renderedLines: lines,
    atTail,
  });
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
