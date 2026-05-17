/**
 * Translate state-sync messages into VT sequences for xterm.js. The server
 * is authoritative; we just issue equivalent VT writes — no reconciliation
 * against xterm's internal buffer.
 */

import type { DiffOp, PaneSnapshot } from '../../../shared/types';

export function snapshotToVTSequence(snapshot: PaneSnapshot): string {
  let s = '';
  s += '\x1b[?25l';
  s += snapshot.modes.altScreen ? '\x1b[?1049h' : '\x1b[?1049l';

  const delta = snapshot.scrollbackDelta;
  if (!snapshot.modes.altScreen && delta && delta.length > 0) {
    // Park at home so the delta fills the grid top-down, then each CRLF at
    // the bottom row pushes one row into xterm's scrollback — the whole
    // sequence ends up in scrollback (not blank rows from the initial grid).
    s += '\x1b[1;1H';
    for (const line of delta) {
      s += `${line}\r\n`;
    }
  }

  for (let i = 0; i < snapshot.rows; i++) {
    s += `\x1b[${i + 1};1H\x1b[2K${snapshot.lines[i] ?? ''}`;
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
export function diffToVTSequence(
  ops: DiffOp[],
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
