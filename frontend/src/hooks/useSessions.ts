import { useCallback, useEffect, useState } from "react";
import {
	type AgentProvider,
	DEFAULT_AGENT_PROVIDER,
	type ExtendedSessionResponse,
	type IndicatorState,
	type PeerSession,
	type SessionResponse,
	type SessionTheme,
} from "../../../shared/types";
import { authFetch, isTransientNetworkError } from "../services/api";
import { sessionFetch } from "../services/peer-fetch";
import {
	applyHookIndicatorUpdate,
	usePeerSessionsWatcher,
} from "./usePeerSessionsWatcher";
import { usePeers } from "./usePeers";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Module-level merged cache produced by the peer sessions watcher.
// Every peer — including the local Hub — pushes `sessions-updated` over its
// own WS, so this is the single source of truth.
let cachedSessions: ExtendedSessionResponse[] = [];

// Cross-peer session order persisted on the Hub. Each entry is the composite
// key `${peerId}:${sessionId}`. `null` = not yet fetched.
let cachedMergedOrder: string[] | null = null;
let mergedOrderFetched = false;

function compositeKey(s: ExtendedSessionResponse): string {
	return `${s.peerId ?? "local"}:${s.id}`;
}

function sortByMergedOrder(
	list: ExtendedSessionResponse[],
): ExtendedSessionResponse[] {
	if (!cachedMergedOrder || cachedMergedOrder.length === 0) return list;
	const orderMap = new Map(cachedMergedOrder.map((key, i) => [key, i]));
	return [...list].sort((a, b) => {
		const ai = orderMap.get(compositeKey(a)) ?? Number.MAX_SAFE_INTEGER;
		const bi = orderMap.get(compositeKey(b)) ?? Number.MAX_SAFE_INTEGER;
		return ai - bi;
	});
}

/**
 * Apply a new cross-peer order locally and re-sort the cached sessions.
 * Used by the drag-end handler for optimistic update — the same value is
 * also PUT to the Hub so reload / other clients pick it up.
 */
export function applyLocalSessionOrder(order: string[]) {
	cachedMergedOrder = order;
	cachedSessions = sortByMergedOrder(cachedSessions);
	window.dispatchEvent(new CustomEvent("cchub-sessions-reorder"));
}

async function fetchMergedOrderOnce(): Promise<void> {
	if (mergedOrderFetched) return;
	mergedOrderFetched = true;
	try {
		const res = await authFetch(`${API_BASE}/api/peers/session-order`);
		if (!res.ok) return;
		const data = (await res.json()) as { order?: string[] };
		if (Array.isArray(data.order)) {
			cachedMergedOrder = data.order;
			cachedSessions = sortByMergedOrder(cachedSessions);
			window.dispatchEvent(new CustomEvent("cchub-sessions-reorder"));
		}
	} catch {
		mergedOrderFetched = false;
	}
}

/** hookイベントで Hub local セッションの indicatorState を即座に更新する */
export function updateCachedSessionsByHookEvent(
	event: string,
	ccSessionId?: string,
) {
	const newState = hookEventToIndicatorState(event);
	if (!newState || !ccSessionId) return;
	if (applyHookIndicatorUpdate(ccSessionId, newState)) {
		window.dispatchEvent(new CustomEvent("cchub-hook-event"));
	}
}

function hookEventToIndicatorState(event: string): IndicatorState | null {
	switch (event) {
		case "Stop":
		case "Notification":
		case "SubagentStop":
			return "completed";
		case "PostToolUse":
			return "waiting_input";
		case "PreToolUse":
		case "UserPromptSubmit":
			return "processing";
		default:
			return null;
	}
}

interface UseSessionsReturn {
	sessions: ExtendedSessionResponse[];
	isLoading: boolean;
	error: string | null;
	createSession: (
		name?: string,
		workingDir?: string,
		agent?: AgentProvider,
		// Multi-server: 指定した peer (remote cchub) にセッションを作る。
		// 省略時 or local 指定で Hub に作る。
		peerId?: string,
	) => Promise<ExtendedSessionResponse | null>;
	deleteSession: (id: string) => Promise<boolean>;
	updateSessionTheme: (
		id: string,
		theme: SessionTheme | null,
	) => Promise<boolean>;
}

function flattenPeerSessions(
	sessionsByPeer: ReadonlyMap<string, PeerSession[]>,
): ExtendedSessionResponse[] {
	const out: ExtendedSessionResponse[] = [];
	for (const sessions of sessionsByPeer.values()) {
		out.push(...sessions);
	}
	return out;
}

export function useSessions(): UseSessionsReturn {
	const { peers } = usePeers();
	const [sessions, setSessions] =
		useState<ExtendedSessionResponse[]>(cachedSessions);
	const [isLoading, setIsLoading] = useState(() => cachedSessions.length === 0);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const hookHandler = () => setSessions(cachedSessions);
		const reorderHandler = () => setSessions(cachedSessions);
		window.addEventListener("cchub-hook-event", hookHandler);
		window.addEventListener("cchub-sessions-reorder", reorderHandler);
		void fetchMergedOrderOnce();
		return () => {
			window.removeEventListener("cchub-hook-event", hookHandler);
			window.removeEventListener("cchub-sessions-reorder", reorderHandler);
		};
	}, []);

	// Per-peer WS watcher already dedups by payload before notifying, so a
	// listener firing here implies the data actually changed for some peer.
	const handlePeerSessions = useCallback(
		(sessionsByPeer: ReadonlyMap<string, PeerSession[]>) => {
			cachedSessions = sortByMergedOrder(flattenPeerSessions(sessionsByPeer));
			setSessions(cachedSessions);
			setIsLoading(false);
		},
		[],
	);
	usePeerSessionsWatcher(peers, handlePeerSessions);

	const createSession = useCallback(
		async (
			name?: string,
			workingDir?: string,
			agent: AgentProvider = DEFAULT_AGENT_PROVIDER,
			peerId?: string,
		): Promise<SessionResponse | null> => {
			setError(null);
			// peerId が指定されてれば peer に対して POST する。
			// `sessionFetch` は session オブジェクトを取るので、ダミーで peerId だけ渡す。
			const response = await sessionFetch(
				peerId ? { peerId } : undefined,
				peers,
				"/api/sessions",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name, workingDir, agent }),
				},
			);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const err = new Error(errorData.error || "Failed to create session");
				(err as Error & { data?: unknown }).data = errorData;
				throw err;
			}

			const session = (await response.json()) as ExtendedSessionResponse;
			// peer に作ったなら peerId を埋め込む (UIで識別できるように)
			const enriched: ExtendedSessionResponse = peerId
				? { ...session, peerId }
				: session;
			setSessions((prev) => [enriched, ...prev]);
			return enriched;
		},
		[peers],
	);

	const deleteSession = useCallback(async (id: string): Promise<boolean> => {
		setError(null);
		try {
			const session = sessions.find((s) => s.id === id);
			const response = await sessionFetch(session, peers, `/api/sessions/${id}`, {
				method: "DELETE",
			});

			if (!response.ok) throw new Error("Failed to delete session");

			setSessions((prev) => prev.filter((s) => s.id !== id));
			return true;
		} catch (err) {
			if (!isTransientNetworkError(err)) {
				setError(err instanceof Error ? err.message : "Unknown error");
			}
			return false;
		}
	}, [sessions, peers]);

	const updateSessionTheme = useCallback(
		async (id: string, theme: SessionTheme | null): Promise<boolean> => {
			setError(null);
			try {
				const session = sessions.find((s) => s.id === id);
				const response = await sessionFetch(
					session,
					peers,
					`/api/sessions/${id}/theme`,
					{
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ theme }),
					},
				);

				if (!response.ok) throw new Error("Failed to update session theme");

				setSessions((prev) =>
					prev.map((s) =>
						s.id === id ? { ...s, theme: theme ?? undefined } : s,
					),
				);
				return true;
			} catch (err) {
				if (!isTransientNetworkError(err)) {
					setError(err instanceof Error ? err.message : "Unknown error");
				}
				return false;
			}
		},
		[sessions, peers],
	);

	return {
		sessions,
		isLoading,
		error,
		createSession,
		deleteSession,
		updateSessionTheme,
	};
}
