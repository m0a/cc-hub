import { useCallback, useEffect, useState } from "react";
import {
	type AgentProvider,
	DEFAULT_AGENT_PROVIDER,
	type ExtendedSessionResponse,
	type IndicatorState,
	LOCAL_PEER_ID,
	type PeerSession,
	type PeerSessionsResponse,
	type SessionResponse,
	type SessionTheme,
} from "../../../shared/types";
import { authFetch, isTransientNetworkError } from "../services/api";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Module-level cache (shared across all useSessions instances, updated by WS push)
let cachedSessions: ExtendedSessionResponse[] | null = null;
// Remote peer sessions (excluding local). Updated by polling /api/peers/sessions.
let cachedRemotePeerSessions: PeerSession[] = [];

const PEER_POLL_INTERVAL = 5000;

/** hookイベントでcachedSessionsのindicatorStateを即座に更新する */
export function updateCachedSessionsByHookEvent(
	event: string,
	ccSessionId?: string,
) {
	const newState = hookEventToIndicatorState(event);
	if (!newState || !ccSessionId || !cachedSessions) return;

	cachedSessions = cachedSessions.map((session) => {
		if (session.ccSessionId !== ccSessionId) return session;
		if (!session.panes) return session;
		return {
			...session,
			panes: session.panes.map((pane) => ({
				...pane,
				indicatorState: newState,
			})),
		};
	});

	window.dispatchEvent(new CustomEvent("cchub-hook-event"));
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
	) => Promise<ExtendedSessionResponse | null>;
	deleteSession: (id: string) => Promise<boolean>;
	updateSessionTheme: (
		id: string,
		theme: SessionTheme | null,
	) => Promise<boolean>;
}

function mergedSessions(): ExtendedSessionResponse[] {
	const local = (cachedSessions ?? []).map((s) =>
		// 既存の WS push 由来セッションには peerId が付かないので、local として注釈
		s.peerId ? s : { ...s, peerId: LOCAL_PEER_ID },
	);
	return [...local, ...cachedRemotePeerSessions];
}

function updateSessions(
	setSessions: React.Dispatch<React.SetStateAction<ExtendedSessionResponse[]>>,
	newLocalSessions: ExtendedSessionResponse[],
) {
	cachedSessions = newLocalSessions;
	const merged = mergedSessions();
	setSessions((prev) => {
		const newJson = JSON.stringify(merged);
		const prevJson = JSON.stringify(prev);
		return newJson === prevJson ? prev : merged;
	});
}

async function pollRemotePeerSessions(
	setSessions: React.Dispatch<React.SetStateAction<ExtendedSessionResponse[]>>,
): Promise<boolean> {
	try {
		const res = await authFetch(`${API_BASE}/api/peers/sessions`);
		if (!res.ok) return false;
		const data = (await res.json()) as PeerSessionsResponse;
		if (!Array.isArray(data.sessions)) return false;
		const remote = data.sessions.filter((s) => s.peerId !== LOCAL_PEER_ID);
		const stableJson = JSON.stringify(remote);
		const prevJson = JSON.stringify(cachedRemotePeerSessions);
		if (stableJson === prevJson) return true;
		cachedRemotePeerSessions = remote;
		const merged = mergedSessions();
		setSessions(merged);
		return true;
	} catch {
		return false;
	}
}

export function useSessions(): UseSessionsReturn {
	const [sessions, setSessions] = useState<ExtendedSessionResponse[]>(
		() => mergedSessions(),
	);
	const [isLoading, setIsLoading] = useState(() => !cachedSessions);
	const [error, setError] = useState<string | null>(null);

	// Listen for WS push and hook events
	useEffect(() => {
		const hookHandler = () => {
			if (cachedSessions) setSessions(mergedSessions());
		};

		const pushHandler = (e: Event) => {
			const pushed = (e as CustomEvent).detail as ExtendedSessionResponse[];
			if (pushed) {
				updateSessions(setSessions, pushed);
				setIsLoading(false);
			}
		};

		window.addEventListener("cchub-hook-event", hookHandler);
		window.addEventListener("cchub-sessions-push", pushHandler);
		return () => {
			window.removeEventListener("cchub-hook-event", hookHandler);
			window.removeEventListener("cchub-sessions-push", pushHandler);
		};
	}, []);

	// Poll remote peer sessions (only fires while non-local peers exist)
	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setInterval> | null = null;

		void pollRemotePeerSessions(setSessions);

		timer = setInterval(() => {
			if (cancelled) return;
			void pollRemotePeerSessions(setSessions);
		}, PEER_POLL_INTERVAL);

		return () => {
			cancelled = true;
			if (timer) clearInterval(timer);
		};
	}, []);

	const createSession = useCallback(
		async (
			name?: string,
			workingDir?: string,
			agent: AgentProvider = DEFAULT_AGENT_PROVIDER,
		): Promise<SessionResponse | null> => {
			setError(null);
			const response = await authFetch(`${API_BASE}/api/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, workingDir, agent }),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const err = new Error(errorData.error || "Failed to create session");
				(err as Error & { data?: unknown }).data = errorData;
				throw err;
			}

			const session = await response.json();
			setSessions((prev) => [session, ...prev]);
			return session;
		},
		[],
	);

	const deleteSession = useCallback(async (id: string): Promise<boolean> => {
		setError(null);
		try {
			const response = await authFetch(`${API_BASE}/api/sessions/${id}`, {
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
	}, []);

	const updateSessionTheme = useCallback(
		async (id: string, theme: SessionTheme | null): Promise<boolean> => {
			setError(null);
			try {
				const response = await authFetch(
					`${API_BASE}/api/sessions/${id}/theme`,
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
		[],
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
