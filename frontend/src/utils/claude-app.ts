/**
 * Open the Remote Control cloud session that matches a local Claude Code
 * session in the Claude app / browser.
 *
 * Uses a plain `window.open(url, "_blank")` WITHOUT a windowFeatures string:
 * passing `"noopener,noreferrer"` makes mobile Safari (and some in-app
 * browsers) treat the call as a blocked popup, so nothing opens. We harden the
 * opener afterwards instead, which keeps the new-tab navigation reliable on
 * mobile while still severing `window.opener`.
 */
export function openClaudeAppSession(bridgeSessionId: string): void {
	const url = `https://claude.ai/code/${encodeURIComponent(bridgeSessionId)}`;
	const opened = window.open(url, "_blank");
	if (opened) opened.opener = null;
}
