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

// On the first snapshot for a pane, ship up to this many recent scrollback
// rows in one shot so the client's xterm scrollback has substantive history
// from the start. tmux history-limit defaults to 10000; cap below that to
// keep the first-snapshot payload bounded (≈ 400 KB at 200 byte/row with
// ANSI escapes).
const INITIAL_SCROLLBACK_ROWS = 2000;

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

/**
 * Capture a snapshot of a pane. Returns null if the pane no longer exists.
 *
 * Captures:
 *   - visible region (with ANSI escapes preserved via -e)
 *   - cursor + altscreen via display-message (single round-trip)
 *   - any new scrollback lines added since `prevHistorySize`, so the client
 *     can grow its own scrollback ring buffer for wheel/touch scrolling
 */
export interface PadFillCache {
  historySize: number;
  rows: string[];
}

export async function captureSnapshot(
  cs: TmuxControlSession,
  paneId: string,
  prevHistorySize?: number,
  prevPadFill?: PadFillCache,
): Promise<{ snapshot: PaneSnapshot; historySize: number; padFill?: PadFillCache } | null> {
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

  let linesRaw: string;
  try {
    linesRaw = await cs.sendCommand(`capture-pane -e -p -t ${paneId}`);
  } catch {
    return null;
  }

  let lines = linesRaw.split('\n');
  // Trim trailing rows that are visually blank (whitespace / ANSI escapes
  // only). tmux's capture-pane already returns at most one trailing newline,
  // but Claude TUI sometimes paints space-only rows in the unused bottom
  // region — they would otherwise survive into snap.lines as visible blanks.
  while (lines.length > 0 && isVisuallyBlank(lines[lines.length - 1])) lines.pop();
  if (lines.length > rows) {
    lines = lines.slice(0, rows);
  }
  // TEMPORARY WORKAROUND — Claude Code 固有 (TODO: remove when fixed upstream).
  //
  // Claude TUI は pane の下半分を描画せず、 capture-pane も描かれた cell
  // の最終行までしか返さない。 visible 余白を埋めるため、 不足分を
  // scrollback の末尾 (= 直前まで visible にいた過去履歴) から取って
  // snap.lines の先頭に prepend する。
  //   - 上: scrollback 末尾 (= 古い履歴)
  //   - 下: TUI 描画 (= 新しい履歴 + input area)
  // Claude TUI が pane を full に描画するようになれば、 この prepend
  // と空文字 padding を削除して通常の path に戻せる。
  //
  // padFill は historySize 単位でキャッシュ可能 (= 同じ historySize なら
  // scrollback の末尾 N 行は同じ)。 reuse することで毎 snapshot tick の
  // tmux round-trip を減らす。
  let padFill: PadFillCache | undefined = prevPadFill;
  const padNeeded = rows - lines.length;
  if (padNeeded > 0 && !altScreen && historySize > 0) {
    if (!padFill || padFill.historySize !== historySize || padFill.rows.length < padNeeded) {
      const fetched = await captureScrollback(cs, paneId, Math.max(padNeeded, padFill?.rows.length ?? 0));
      if (fetched.length > 0) padFill = { historySize, rows: fetched };
    }
    if (padFill && padFill.rows.length > 0) {
      lines = [...padFill.rows.slice(-padNeeded), ...lines];
    }
  }
  while (lines.length < rows) lines.push('');

  // Initial-only scrollback: ship up to INITIAL_SCROLLBACK_ROWS of the most
  // recent rows once (on the first snapshot for this pane), nothing after.
  let scrollbackDelta: string[] | undefined;
  if (!altScreen && prevHistorySize === undefined && historySize > 0) {
    const sb = await captureScrollback(cs, paneId, Math.min(historySize, INITIAL_SCROLLBACK_ROWS));
    if (sb.length > 0) scrollbackDelta = sb;
  }

  return {
    historySize,
    padFill,
    snapshot: {
      paneId,
      seq: allocSeq(),
      cols,
      rows,
      lines,
      scrollbackDelta,
      cursor: {
        x: Math.max(0, Math.min(cols - 1, cx)),
        y: Math.max(0, Math.min(rows - 1, cy)),
        visible: cursorVisible,
      },
      modes: { altScreen },
    },
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
