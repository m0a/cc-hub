/**
 * Translate state-sync messages into VT sequences for xterm.js.
 *
 * The server treats `tmux capture-pane -e -p` as the canonical pane state.
 * Snapshots contain ANSI-decorated lines plus cursor and altscreen mode;
 * diffs contain row replacements, cursor moves, mode toggles, and size
 * changes. We render them by issuing equivalent VT sequences that xterm
 * already understands.
 *
 * No attempt is made to reconcile against xterm's internal buffer; the
 * server's snapshot is authoritative.
 */

import type { DiffOp, PaneSnapshot } from '../../../shared/types';

/**
 * TEMPORARY (Claude Code workaround): grid offset for bottom-aligned writes.
 * = snap.rows - snap.lines.length. See snapshotToVTSequence for details.
 * Remove with the rest of the bottom-align workaround.
 */
export function bottomAlignOffset(rows: number, linesLen: number): number {
  return Math.max(0, rows - linesLen);
}


/**
 * Build the VT byte sequence that re-renders a full snapshot.
 *
 * Sequence:
 *   1. hide cursor (avoid flicker during repaint)
 *   2. enter/exit altscreen as appropriate
 *   3. if not altscreen and snapshot carries scrollbackDelta: park cursor at
 *      the bottom row and emit each new line with CRLF — each newline at the
 *      bottom scrolls a row off the top into xterm's scrollback buffer
 *   4. for each row, cursor to (row,1), clear line, write content
 *   5. move cursor to the snapshot's recorded position, set visibility
 *
 * `forceClearAll` controls how blank rows are treated:
 *   - `true` (use on size changes / first snapshot): rewrite every row,
 *     blanks included. Ensures stale content from a previous larger
 *     geometry doesn't survive as "ghost lines".
 *   - `false` (steady state): skip the trailing run of blank rows so the
 *     previous snapshot's content is preserved there. This matches the
 *     byte-stream era's visual where Claude Code's unrepainted region
 *     stayed populated with the prior frame instead of going black.
 */
/**
 * Build VT bytes for a snapshot.
 *
 * `prevLines` — what we previously wrote into xterm for this pane. If
 *   omitted (e.g. first paint or geometry change), every row is treated
 *   as changed.
 *
 * We always honor the snapshot as canonical: rows that changed are
 *   rewritten exactly, even when the new content is blank. Skipping
 *   blank rows leaves stale content drifting in xterm that the user
 *   sees as "ghost lines". The empty space below the prompt that some
 *   TUIs leave behind is handled by the caller's auto-scroll trick
 *   (see Terminal.tsx) rather than by hiding it here.
 */
export function snapshotToVTSequence(
  snapshot: PaneSnapshot,
  _prevLines?: string[],
): string {
  let s = '';
  s += '\x1b[?25l';
  s += snapshot.modes.altScreen ? '\x1b[?1049h' : '\x1b[?1049l';

  const delta = snapshot.scrollbackDelta;
  if (!snapshot.modes.altScreen && delta && delta.length > 0) {
    s += `\x1b[${snapshot.rows};1H`;
    for (const line of delta) {
      s += `\r\n\x1b[2K${line}`;
    }
  }

  // TEMPORARY (Claude Code workaround): snapshot.lines can be shorter than
  // snapshot.rows because tmux capture-pane trims trailing blank rows that
  // Claude TUI leaves unrendered. Write the lines bottom-aligned so the
  // input area / status footer (always the last rendered rows) lands at the
  // grid's bottom edge — matching the user's expectation of "prompt at the
  // bottom of the terminal." Rows above the bottom-aligned content are left
  // untouched so the previous frame (= scrollback / earlier render) remains
  // visible there, avoiding the black void the trimmed bottom would
  // otherwise create. Remove once Claude TUI fills the pane fully.
  const linesLen = snapshot.lines.length;
  const offset = bottomAlignOffset(snapshot.rows, linesLen);
  for (let i = 0; i < linesLen; i++) {
    s += `\x1b[${i + offset + 1};1H\x1b[2K${snapshot.lines[i] ?? ''}`;
  }
  // Cursor: re-anchor to the bottom-aligned write position. If tmux's
  // cursor.y points into the unrendered void region (cy >= linesLen), pin it
  // to the last rendered row so the cursor remains visible on-screen.
  const localCy = Math.min(snapshot.cursor.y, Math.max(0, linesLen - 1));
  const gridCy = offset + localCy;
  s += `\x1b[${gridCy + 1};${snapshot.cursor.x + 1}H`;
  s += snapshot.cursor.visible ? '\x1b[?25h' : '\x1b[?25l';
  return s;
}

/**
 * Build the VT byte sequence for a list of DiffOps. Returns null for
 * size-change ops — those require a synchronous terminal resize on the
 * client, which is the caller's responsibility.
 *
 * Save/restore cursor (DECSC/DECRC) is *not* used here because xterm.js
 * applies it per cell-attr context. Instead we end with the diff's own
 * cursor op (always present at the end of a meaningful diff from the server).
 */
export function diffToVTSequence(
  ops: DiffOp[],
  // TEMPORARY (Claude Code workaround): row offset for bottom-aligned write.
  // Diff line ops are indexed within snapshot.lines (= pane top-aligned),
  // but the client renders bottom-aligned, so each row index must be shifted
  // by `offset = snap.rows - snap.lines.length` to address the correct grid
  // row. Removed alongside the bottom-aligned write workaround.
  offset = 0,
): { vt: string; size: { cols: number; rows: number } | null } {
  let s = '';
  let size: { cols: number; rows: number } | null = null;
  for (const op of ops) {
    switch (op.op) {
      case 'size':
        size = { cols: op.cols, rows: op.rows };
        break;
      case 'mode':
        if (op.name === 'altScreen') {
          s += op.value ? '\x1b[?1049h' : '\x1b[?1049l';
        }
        break;
      case 'line':
        s += `\x1b[${op.row + offset + 1};1H\x1b[2K${op.content}`;
        break;
      case 'cursor': {
        // Cursor.y is also pane top-aligned; shift by offset to land on the
        // bottom-aligned grid position.
        const y = op.y + offset;
        s += `\x1b[${y + 1};${op.x + 1}H`;
        s += op.visible ? '\x1b[?25h' : '\x1b[?25l';
        break;
      }
    }
  }
  return { vt: s, size };
}
