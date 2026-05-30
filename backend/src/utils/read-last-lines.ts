/**
 * Read the last N lines from a file without spawning a subprocess.
 * Reads from the end of the file in chunks, retrying with larger chunks
 * when the initial estimate doesn't capture enough lines (Claude Code JSONL
 * lines can be 2KB+ when they contain large tool results).
 *
 * Returns an empty string on any error (missing file, permission, etc.).
 */
export async function readLastLines(
	filePath: string,
	lineCount: number,
): Promise<string> {
	try {
		const file = Bun.file(filePath);
		const size = file.size;
		if (size === 0) return "";

		let bytesPerLine = 2048;
		for (let attempt = 0; attempt < 3; attempt++) {
			const chunkSize = Math.min(size, lineCount * bytesPerLine);
			const buffer = await file.slice(size - chunkSize, size).text();
			const lines = buffer.split("\n");
			// Drop incomplete first line unless we read the entire file
			if (chunkSize < size) lines.shift();
			if (lines.length >= lineCount || chunkSize >= size) {
				return lines.slice(-lineCount).join("\n");
			}
			bytesPerLine *= 4; // 2K → 8K → 32K
		}
		// Last resort: read entire file
		const buffer = await file.text();
		return buffer.split("\n").slice(-lineCount).join("\n");
	} catch {
		return "";
	}
}
