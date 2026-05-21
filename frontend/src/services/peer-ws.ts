/**
 * Peer WebSocket URL helpers — shared by `useMultiplexedTerminal`,
 * `usePeerConnection`, and `usePeerSessionsWatcher`.
 */

export function peerHttpUrlToWsUrl(httpUrl: string): string {
	return httpUrl
		.replace(/^http(s?):/, (_match, s) => `ws${s}:`)
		.replace(/\/+$/, "");
}

export function appendWsToken(wsUrl: string, token: string | null): string {
	if (!token) return wsUrl;
	const sep = wsUrl.includes("?") ? "&" : "?";
	return `${wsUrl}${sep}token=${encodeURIComponent(token)}`;
}
