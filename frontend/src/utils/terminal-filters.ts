/**
 * Terminal input/output filter utilities.
 *
 * These are extracted from Terminal.tsx so they can be unit-tested independently
 * of the React component and xterm.js runtime.
 */

/**
 * Filter mouse tracking escape sequences from terminal INPUT data.
 *
 * xterm.js may generate SGR-style (\x1b[<...M/m) and legacy (\x1b[M...)
 * mouse reports when it's in mouse tracking mode or when touch/scroll events
 * occur. These must be stripped before sending to tmux via `send-keys -H`,
 * since tmux would deliver them as literal bytes to the shell.
 */
export function filterMouseTrackingInput(data: string): string {
  return data
    .replace(/\x1b\[<[\d;]*[Mm]/g, '')    // SGR mouse reports
    .replace(/\x1b\[M[\s\S]{3}/g, '');     // Legacy X10 mouse reports
}

/**
 * Filter mouse tracking enable/disable sequences from terminal OUTPUT data.
 *
 * Applications like Claude Code (ink TUI) and tmux send sequences like
 * \x1b[?1000h to enable mouse tracking. If left in, xterm.js enters mouse
 * tracking mode and clicks generate escape sequences instead of normal
 * text selection behaviour.
 */
const MOUSE_TRACKING_OUTPUT_RE = /\x1b\[\?(?:1000|1002|1003|1005|1006|1015)[hl]/g;

export function filterMouseTrackingOutput(data: string): string {
  return data.replace(MOUSE_TRACKING_OUTPUT_RE, '');
}

/**
 * Determine whether a keyboard event should be intercepted by our custom
 * handler (returning false to xterm's attachCustomKeyEventHandler).
 *
 * Returns a string describing the action to take, or null if xterm should
 * handle the event normally.
 */
export type InterceptAction = 'shift-enter' | 'paste' | null;

export function shouldInterceptKeyEvent(e: {
  type: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): InterceptAction {
  if (e.type !== 'keydown') return null;

  // Shift+Enter → send literal backslash + carriage return
  if (e.shiftKey && e.key === 'Enter') {
    return 'shift-enter';
  }

  // Ctrl/Cmd + V → delegate to DesktopLayout's handlePaste (supports images)
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
    const key = e.key.toLowerCase();
    if (key === 'v') {
      return 'paste';
    }
  }

  return null;
}
