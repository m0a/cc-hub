/**
 * Pane snapshot capture and diff for state-sync transport.
 *
 * The server treats `tmux capture-pane -e -p` as the canonical state of a
 * tmux pane. On each output debounce window we:
 *   1. capture the pane's visible region (with ANSI escapes)
 *   2. capture cursor position and a few VT modes via display-message
 *   3. diff against the previously captured snapshot for that pane
 *   4. emit either a full snapshot (initial / recovery) or a list of DiffOps
 *
 * Snapshot seq numbers are monotonically increasing per pane.
 */

import type { DiffOp, PaneSnapshot } from '../../../shared/types';
import type { TmuxControlSession } from './tmux-control';

let nextSeq = 1;
function allocSeq(): number {
  return nextSeq++;
}

/**
 * Capture a snapshot of a pane. Returns null if the pane no longer exists.
 *
 * The visible region uses `-e` so ANSI color/attribute escapes are preserved;
 * the client writes them straight into xterm.js without further parsing.
 *
 * `display-message` returns a single line with cursor + mode fields packed in
 * a known order so we only pay for one round-trip.
 */
export async function captureSnapshot(
  cs: TmuxControlSession,
  paneId: string,
): Promise<PaneSnapshot | null> {
  let metaRaw: string;
  try {
    metaRaw = await cs.sendCommand(
      `display-message -t ${paneId} -p '#{pane_width},#{pane_height},#{cursor_x},#{cursor_y},#{cursor_flag},#{alternate_on}'`,
    );
  } catch {
    return null;
  }

  const parts = metaRaw.trim().split(',');
  if (parts.length < 6) return null;
  const cols = Number.parseInt(parts[0], 10);
  const rows = Number.parseInt(parts[1], 10);
  const cx = Number.parseInt(parts[2], 10);
  const cy = Number.parseInt(parts[3], 10);
  const cursorVisible = parts[4] === '1';
  const altScreen = parts[5] === '1';

  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
    return null;
  }

  let linesRaw: string;
  try {
    linesRaw = await cs.sendCommand(`capture-pane -e -p -t ${paneId}`);
  } catch {
    return null;
  }

  // tmux capture-pane returns lines separated by \n. The last entry can be an
  // empty trailing element after a trailing newline; keep all lines so the
  // client gets exactly `rows` rows (pad if tmux trimmed blanks).
  let lines = linesRaw.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < rows) {
    const pad = rows - lines.length;
    for (let i = 0; i < pad; i++) lines.push('');
  } else if (lines.length > rows) {
    lines = lines.slice(0, rows);
  }

  return {
    paneId,
    seq: allocSeq(),
    cols,
    rows,
    lines,
    cursor: {
      x: Math.max(0, Math.min(cols - 1, cx)),
      y: Math.max(0, Math.min(rows - 1, cy)),
      visible: cursorVisible,
    },
    modes: { altScreen },
  };
}

/**
 * Diff two snapshots. Returns the list of ops the client must apply to move
 * from `prev` to `next`. Ordering matters: size first, then mode (so altScreen
 * is set before line writes go to the correct buffer), then lines, then
 * cursor.
 */
export function diffSnapshots(prev: PaneSnapshot, next: PaneSnapshot): DiffOp[] {
  const ops: DiffOp[] = [];

  if (prev.cols !== next.cols || prev.rows !== next.rows) {
    ops.push({ op: 'size', cols: next.cols, rows: next.rows });
  }

  if (prev.modes.altScreen !== next.modes.altScreen) {
    ops.push({ op: 'mode', name: 'altScreen', value: next.modes.altScreen });
  }

  // A size or altScreen change invalidates all line state on the receiver, so
  // emit every line. Otherwise emit only changed lines.
  const reseat = ops.length > 0;
  const rowCount = Math.max(prev.lines.length, next.lines.length);
  for (let i = 0; i < rowCount; i++) {
    const prevLine = prev.lines[i] ?? '';
    const nextLine = next.lines[i] ?? '';
    if (reseat || prevLine !== nextLine) {
      ops.push({ op: 'line', row: i, content: nextLine });
    }
  }

  if (
    reseat ||
    prev.cursor.x !== next.cursor.x ||
    prev.cursor.y !== next.cursor.y ||
    prev.cursor.visible !== next.cursor.visible
  ) {
    ops.push({
      op: 'cursor',
      x: next.cursor.x,
      y: next.cursor.y,
      visible: next.cursor.visible,
    });
  }

  return ops;
}
