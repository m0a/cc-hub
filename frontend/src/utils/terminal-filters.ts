/**
 * Terminal input/output filter utilities.
 *
 * These are extracted from Terminal.tsx so they can be unit-tested independently
 * of the React component and xterm.js runtime.
 */

// ESC character used in terminal escape sequences
const ESC = String.fromCharCode(0x1b);

/**
 * Filter mouse tracking escape sequences from terminal INPUT data.
 *
 * xterm.js may generate SGR-style (\x1b[<...M/m) and legacy (\x1b[M...)
 * mouse reports when it's in mouse tracking mode or when touch/scroll events
 * occur. These must be stripped before sending to the server: input is passed
 * through to the pane's raw PTY, so they would reach the shell as literal bytes.
 */
const SGR_MOUSE_RE = new RegExp(`${ESC}\\[<[\\d;]*[Mm]`, "g");
const LEGACY_MOUSE_RE = new RegExp(`${ESC}\\[M[\\s\\S]{3}`, "g");

export function filterMouseTrackingInput(data: string): string {
	return data
		.replace(SGR_MOUSE_RE, "") // SGR mouse reports
		.replace(LEGACY_MOUSE_RE, ""); // Legacy X10 mouse reports
}

/**
 * Determine whether a keyboard event should be intercepted by our custom
 * handler (returning false to xterm's attachCustomKeyEventHandler).
 *
 * Returns a string describing the action to take, or null if xterm should
 * handle the event normally.
 */
export type InterceptAction = "shift-enter" | "paste" | "copy" | null;

export function shouldInterceptKeyEvent(
	e: {
		type: string;
		key: string;
		ctrlKey: boolean;
		metaKey: boolean;
		shiftKey: boolean;
	},
	hasSelection?: boolean,
): InterceptAction {
	if (e.type !== "keydown") return null;

	// Shift+Enter → send literal backslash + carriage return
	if (e.shiftKey && e.key === "Enter") {
		return "shift-enter";
	}

	if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
		const key = e.key.toLowerCase();
		// Ctrl/Cmd + C with selection → copy (prevent xterm from sending \x03 SIGINT)
		// Without selection → let xterm handle normally (sends SIGINT)
		if (key === "c" && hasSelection) {
			return "copy";
		}
		// Ctrl/Cmd + V → delegate to DesktopLayout's handlePaste (supports images)
		if (key === "v") {
			return "paste";
		}
	}

	return null;
}
