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
import { isTransientNetworkError } from "../services/api";
import { sessionFetch } from "../services/peer-fetch";
import {
	applyHookIndicatorUpdate,
	usePeerSessionsWatcher,
} from "./usePeerSessionsWatcher";
import { usePeers } from "./usePeers";

// Module-level merged cache produced by the peer sessions watcher.
// Every peer — including the local Hub — pushes `sessions-updated` over its
// own WS, so this is the single source of truth.
let cachedSessions: ExtendedSessionResponse[] = [];

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

	// Listen for WS push and hook events
	useEffect(() => {
		const hookHandler = () => setSessions(cachedSessions);
		window.addEventListener("cchub-hook-event", hookHandler);
		return () => window.removeEventListener("cchub-hook-event", hookHandler);
	}, []);

	// Per-peer WS watcher already dedups by payload before notifying, so a
	// listener firing here implies the data actually changed for some peer.
	const handlePeerSessions = useCallback(
		(sessionsByPeer: ReadonlyMap<string, PeerSession[]>) => {
			cachedSessions = flattenPeerSessions(sessionsByPeer);
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
