/**
 * Pseudo-scroll helpers.
 *
 * The server-side scrollback model has the canonical history sitting on the
 * server (herdr pane history) — every offset change normally requires a
 * round-trip. While that round-trip is
 * in flight we still want the screen to *move* in response to wheel / touch so
 * the user has continuous feedback. `makePseudoViewport` produces a synthetic
 * viewport by shifting the most recent real viewport by `deltaOffset` rows and
 * padding the exposed edge with blank rows. The server's real reply will
 * overwrite it as soon as it arrives.
 */

import type { PaneViewport } from "../../../shared/types";

export function makePseudoViewport(
	source: PaneViewport,
	deltaOffset: number,
): PaneViewport {
	if (deltaOffset === 0) return source;
	const blank = " ".repeat(source.cols);
	let lines: string[];
	if (deltaOffset > 0) {
		// Scrolled UP into history → new blank rows at the top, drop rows from the bottom.
		const d = Math.min(deltaOffset, source.rows);
		lines = Array<string>(d)
			.fill(blank)
			.concat(source.lines.slice(0, source.rows - d));
	} else {
		// Scrolled DOWN toward live → new blank rows at the bottom, drop rows from the top.
		const d = Math.min(-deltaOffset, source.rows);
		lines = source.lines.slice(d).concat(Array<string>(d).fill(blank));
	}
	const newOffset = source.offset + deltaOffset;
	return {
		...source,
		lines,
		offset: newOffset,
		atTail: newOffset === 0,
		// Hide the cursor while we're showing a stitched frame. The real viewport
		// will restore it.
		cursor: { ...source.cursor, visible: false },
	};
}
