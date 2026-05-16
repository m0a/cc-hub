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
 * Build the VT byte sequence that re-renders a full snapshot.
 *
 * Sequence:
 *   1. hide cursor (avoid flicker during repaint)
 *   2. enter/exit altscreen
 *   3. clear visible region (scrollback preserved)
 *   4. move to home, write each line (separated by CRLF, no trailing newline)
 *   5. move cursor to the snapshot's recorded position, set visibility
 */
export function snapshotToVTSequence(snapshot: PaneSnapshot): string {
  let s = '';
  s += '\x1b[?25l';
  s += snapshot.modes.altScreen ? '\x1b[?1049h' : '\x1b[?1049l';
  s += '\x1b[H\x1b[2J';
  for (let i = 0; i < snapshot.lines.length; i++) {
    if (i > 0) s += '\r\n';
    s += snapshot.lines[i];
  }
  s += `\x1b[${snapshot.cursor.y + 1};${snapshot.cursor.x + 1}H`;
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
export function diffToVTSequence(ops: DiffOp[]): { vt: string; size: { cols: number; rows: number } | null } {
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
        s += `\x1b[${op.row + 1};1H\x1b[2K${op.content}`;
        break;
      case 'cursor':
        s += `\x1b[${op.y + 1};${op.x + 1}H`;
        s += op.visible ? '\x1b[?25h' : '\x1b[?25l';
        break;
    }
  }
  return { vt: s, size };
}
