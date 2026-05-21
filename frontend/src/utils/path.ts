/**
 * Shorten `/home/<user>` / `/Users/<user>` prefixes to `~`.
 * Handles both Linux and macOS layouts so peer sessions display consistently.
 */
export function toHomeShortPath(absPath: string | undefined): string {
	if (!absPath) return "";
	return absPath.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~");
}

/**
 * Strip the `/home/<user>/<project>/` (or macOS equivalent) prefix entirely,
 * leaving only the project-relative path.
 */
export function stripHomeProjectPrefix(absPath: string): string {
	return absPath.replace(/^\/(?:home|Users)\/[^/]+\/[^/]+\//, "");
}
