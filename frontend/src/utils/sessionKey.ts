import { LOCAL_PEER_ID } from "../../../shared/types";

/**
 * Composite session key `peerId:id` — the frontend-only identity of a session.
 *
 * Session ids are herdr workspace labels and can collide across peers (#487),
 * so every piece of frontend state that references a session (pane tree,
 * active session, open sessions, localStorage) stores this key. The bare id is
 * recovered with `parseSessionKey` right before it goes on the wire (WS
 * subscribe / REST paths) — the server protocol never sees composite keys.
 */

export interface SessionKeyTarget {
	peerId: string;
	id: string;
}

// Peer ids are 'local' or `p_<hex>` (backend peer-registry.ts). A workspace
// label may itself contain `:`, so only a peer-id-shaped prefix marks a
// composite key; anything else is a legacy bare id owned by the local Hub.
// (A workspace literally named `local:...` would mis-parse, but ':' cannot
// survive tmux-compatible naming and the legacy branch only runs during the
// one-time upgrade of persisted state.)
const COMPOSITE_KEY_RE = /^(local|p_[0-9a-f]+):/;

export function makeSessionKey(id: string, peerId?: string | null): string {
	return `${peerId ?? LOCAL_PEER_ID}:${id}`;
}

export function sessionKeyOf(session: {
	id: string;
	peerId?: string | null;
}): string {
	return makeSessionKey(session.id, session.peerId);
}

export function parseSessionKey(key: string): SessionKeyTarget {
	const match = COMPOSITE_KEY_RE.exec(key);
	if (match) {
		return { peerId: match[1], id: key.slice(match[0].length) };
	}
	return { peerId: LOCAL_PEER_ID, id: key };
}

/** Normalize a persisted value (possibly a pre-#487 bare id) to composite form. */
export function normalizeSessionKey(value: string): string {
	const { peerId, id } = parseSessionKey(value);
	return makeSessionKey(id, peerId);
}

/**
 * Structural view of a persisted desktop pane tree. The real `PaneNode` type
 * lives in PaneContainer.tsx; this migration must also accept the pre-#487
 * shape where terminal leaves stored a bare `sessionId`, plus long-dead leaf
 * types ("sessions", "dashboard", ...) that old saved states may still carry.
 */
export interface StoredPaneNode {
	type: string;
	id: string;
	sessionKey?: string | null;
	/** Legacy field (pre-composite). Dropped by the migration. */
	sessionId?: string | null;
	children?: StoredPaneNode[];
	[key: string]: unknown;
}

/**
 * Upgrade a persisted pane tree to composite session keys. `legacyIntent` is
 * the old `cchub-desktop-session-peer` record ("the peer the user last picked
 * a session from") — a legacy bare id matching it keeps that peer; any other
 * bare id is interpreted as local. Idempotent on already-migrated trees.
 */
export function migrateStoredPaneNode(
	node: StoredPaneNode,
	legacyIntent: { id: string; peerId: string } | null,
): StoredPaneNode {
	if (node.type === "terminal") {
		const { sessionId: legacyId, ...rest } = node;
		const raw = node.sessionKey ?? legacyId ?? null;
		let sessionKey: string | null = null;
		if (raw !== null) {
			sessionKey =
				node.sessionKey == null && legacyIntent?.id === raw
					? makeSessionKey(raw, legacyIntent.peerId)
					: normalizeSessionKey(raw);
		}
		return { ...rest, sessionKey };
	}
	if (node.children) {
		return {
			...node,
			children: node.children.map((child) =>
				migrateStoredPaneNode(child, legacyIntent),
			),
		};
	}
	return node;
}
