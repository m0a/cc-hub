import type { PaneCursor } from '../../../shared/types';

export type ViewportCursorPolicy = 'default' | 'codex-footer';

export interface ViewportCursorInput {
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  cursorPadShift: number;
  renderedLines: string[];
  atTail: boolean;
}

export function resolveViewportCursorPolicy(agent?: string): ViewportCursorPolicy {
  return agent === 'codex' ? 'codex-footer' : 'default';
}

export function computeCursorPadShift(policy: ViewportCursorPolicy, prependCount: number): number {
  if (policy === 'codex-footer') return 0;
  // padFill prepends exactly `prependCount` scrollback rows to the top of the
  // viewport, so every row below — including the cursor row — shifts down by
  // that same amount. The shift must match the prepend 1:1; any fudge factor
  // (we previously subtracted 2) leaves the cursor floating above the real
  // input row whenever the pane has trailing blanks below the footer.
  return Math.max(0, prependCount);
}

export function resolveViewportCursor(policy: ViewportCursorPolicy, input: ViewportCursorInput): PaneCursor {
  const x = Math.max(0, Math.min(input.cols - 1, input.cursorX));
  if (!input.atTail) {
    return { x, y: 0, visible: false };
  }

  if (policy === 'codex-footer') {
    const lastNonBlankRow = (() => {
      for (let i = input.renderedLines.length - 1; i >= 0; i--) {
        if (input.renderedLines[i]?.trim()) return i;
      }
      return -1;
    })();
    return {
      x,
      y: Math.max(0, Math.min(input.rows - 1, lastNonBlankRow - 1)),
      visible: input.cursorVisible,
    };
  }

  const lastNonBlankRow = (() => {
    for (let i = input.renderedLines.length - 1; i >= 0; i--) {
      if (input.renderedLines[i]?.trim()) return i;
    }
    return -1;
  })();
  const resolvedY = input.cursorY + input.cursorPadShift;
  return {
    x,
    y: Math.max(
      0,
      Math.min(
        input.rows - 1,
        lastNonBlankRow >= 0 ? Math.min(resolvedY, lastNonBlankRow) : resolvedY,
      ),
    ),
    visible: input.cursorVisible,
  };
}
