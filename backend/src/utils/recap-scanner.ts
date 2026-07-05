import { readLastLines } from "./read-last-lines";

export interface RecapEntry {
	content: string;
	timestamp: string;
}

/** How many trailing lines of a jsonl file are scanned for a recap. */
const RECAP_SCAN_LINES = 300;

/**
 * Parse the latest recap out of already-read jsonl lines. Two sources:
 *   1. system/away_summary — auto-emitted by Claude Code after the terminal has
 *      been unfocused for ≥3 minutes.
 *   2. system/local_command — output of a manual `/recap` slash command,
 *      detected by checking that the preceding user entry contains
 *      `<command-name>/recap</command-name>`.
 * Returns whichever appears most recently in the scanned window.
 *
 * Pure (no I/O) so it can be unit-tested with synthetic lines.
 */
export function parseRecapFromLines(lines: string[]): RecapEntry | null {
	let pendingRecapTrigger = false; // true when the most recent user entry was /recap
	let lastRecap: RecapEntry | null = null;

	for (const line of lines) {
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}

		// Track /recap slash command triggers from user entries.
		if (entry.type === "user") {
			const message = entry.message as { content?: unknown } | undefined;
			const content = message?.content;
			let text = "";
			if (typeof content === "string") {
				text = content;
			} else if (Array.isArray(content)) {
				const block = content.find(
					(b): b is { type: string; text: string } =>
						typeof b === "object" &&
						b !== null &&
						(b as { type?: string }).type === "text",
				);
				text = block?.text || "";
			}
			pendingRecapTrigger = /<command-name>\/?recap<\/command-name>/.test(text);
			continue;
		}

		if (entry.type !== "system") continue;
		const content = entry.content;
		if (typeof content !== "string" || content.length === 0) continue;
		const timestamp = (entry.timestamp as string) || "";

		if (entry.subtype === "away_summary") {
			// Strip the trailing "(disable recaps in /config)" hint Claude Code appends.
			const cleaned = content
				.replace(/\s*\(disable recaps in \/config\)\s*$/, "")
				.trim();
			if (cleaned) lastRecap = { content: cleaned, timestamp };
			// An auto-summary is not the output of a /recap command, so it ends any
			// pending trigger — a later local_command must have its own /recap user
			// entry to count.
			pendingRecapTrigger = false;
		} else if (entry.subtype === "local_command" && pendingRecapTrigger) {
			const cleaned = content
				.replace(/^<local-command-stdout>/, "")
				.replace(/<\/local-command-stdout>$/, "")
				.trim();
			// Skip error outputs (e.g. "API Error: 529 ..." when the recap call fails)
			if (cleaned && !cleaned.startsWith("API Error")) {
				lastRecap = { content: cleaned, timestamp };
			}
			pendingRecapTrigger = false;
		}
	}

	return lastRecap;
}

/**
 * Read the latest recap from a session jsonl file. Returns null when the file
 * has no recap or cannot be read. Claude-only; codex transcripts have no recap.
 */
export async function scanLastRecap(
	filePath: string,
): Promise<RecapEntry | null> {
	const text = await readLastLines(filePath, RECAP_SCAN_LINES);
	if (!text) return null;
	return parseRecapFromLines(text.trim().split("\n"));
}
