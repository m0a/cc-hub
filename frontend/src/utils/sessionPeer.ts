import { LOCAL_PEER_ID } from "../../../shared/types";

/** The peer the user last explicitly picked a session from. */
export interface SessionPeerIntent {
	id: string;
	peerId: string;
}

/**
 * Resolve which peer owns session `sid`. Session ids are herdr workspace
 * labels and can collide across peers, so an id lookup in the merged list
 * (local peer first) would silently pick the local session. Order of trust:
 * the user's last explicit pick (intent), then the App-opened session entry,
 * then the merged list.
 */
export function resolveSessionPeer(
	sid: string | null | undefined,
	intent: SessionPeerIntent | null,
	openSessions: { id: string; peerId?: string }[],
	mergedSessions: { id: string; peerId?: string }[],
): string | undefined {
	if (!sid) return undefined;
	if (intent?.id === sid) return intent.peerId;
	const open = openSessions.find((s) => s.id === sid);
	if (open) return open.peerId ?? LOCAL_PEER_ID;
	return mergedSessions.find((s) => s.id === sid)?.peerId;
}
