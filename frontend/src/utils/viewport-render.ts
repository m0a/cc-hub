/**
 * Translate a PaneViewport into VT bytes for xterm.js.
 *
 * The server-side scrollback model treats herdr (`pane.read`) as the
 * canonical source for both visible region and history. xterm.js is configured
 * with `scrollback: 0`
 * and is used purely as an ANSI rendering surface — we clear + write the
 * `rows`×`cols` window from the viewport on each apply.
 */

import type { PaneViewport } from "../../../shared/types";

export function viewportToVTSequence(viewport: PaneViewport): string {
	let s = "";
	// Hide cursor while we paint to avoid a flicker train.
	s += "\x1b[?25l";
	// Synchronize altScreen mode. The server's pane read returns the visible
	// surface of whichever buffer is active, so the client just needs to be
	// on the matching buffer before the line writes land.
	s += viewport.modes.altScreen ? "\x1b[?1049h" : "\x1b[?1049l";

	for (let i = 0; i < viewport.rows; i++) {
		// Position at column 1 of row (i+1), then erase the row before writing
		// so leftover content from the previous viewport can't show through.
		s += `\x1b[${i + 1};1H\x1b[2K${viewport.lines[i] ?? ""}`;
	}

	// Cursor: only painted when the client is viewing the live edge. In
	// scrolled mode the server reports visible=false so we hide it here.
	s += `\x1b[${viewport.cursor.y + 1};${viewport.cursor.x + 1}H`;
	s += viewport.cursor.visible ? "\x1b[?25h" : "\x1b[?25l";
	return s;
}
