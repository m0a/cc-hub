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

// Strip CSI (e.g. SGR colors) and OSC (e.g. OSC 8 hyperlinks) escapes
// before comparing rows. Without this, color-only changes force a
// rewrite, and comparing snap.lines (ANSI-rich, from capture-pane -e)
// with xterm's translateToString output (plain text) always mismatches.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes by design.
const CSI_RE = /\x1b\[[\d;?]*[a-zA-Z]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes by design.
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
function normalize(s: string): string {
  // Strip ANSI then rtrim trailing whitespace (grid cells are space-padded).
  const stripped = s.replace(OSC_RE, '').replace(CSI_RE, '');
  let end = stripped.length;
  while (end > 0 && (stripped.charCodeAt(end - 1) === 0x20 || stripped.charCodeAt(end - 1) === 0x09)) {
    end--;
  }
  return stripped.slice(0, end);
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
  prevLines?: string[],
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

  for (let i = 0; i < snapshot.rows; i++) {
    const content = snapshot.lines[i] ?? '';
    // Compare against prev after ANSI stripping so SGR-only changes
    // don't force a needless rewrite. The caller should pass prevLines
    // sourced from xterm's actual grid (not a cached snap) so this
    // accurately reflects what's drawn — otherwise stale grid rows can
    // be missed when prev and snap agree they're blank but the grid
    // is actually showing leftover content from a taller frame.
    if (prevLines && normalize(prevLines[i] ?? '') === normalize(content)) continue;
    s += `\x1b[${i + 1};1H\x1b[2K${content}`;
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
        // Apply every line op as-is; a row that went blank really did
        // go blank in tmux, and pretending otherwise creates ghost
        // lines. The void-below-prompt UX problem is handled by the
        // caller's auto-scroll on snapshot apply.
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
