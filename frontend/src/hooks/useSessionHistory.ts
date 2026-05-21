import { useCallback, useEffect, useState } from "react";
import type {
	ConversationMessage,
	HistorySession,
	PeerHistoryProject,
	PeerHistoryProjectsResponse,
} from "../../../shared/types";
import { LOCAL_PEER_ID } from "../../../shared/types";
import { authFetch, isTransientNetworkError } from "../services/api";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Multi-server: 内部キーは `${peerId}::${dirName}` で識別する (peer 跨ぎで dirName が
// 衝突しうるため)。UI 側もこのキーで expand 状態などを持つ。
export type ProjectKey = string;
export function projectKey(peerId: string, dirName: string): ProjectKey {
	return `${peerId}::${dirName}`;
}

export type ProjectInfo = PeerHistoryProject;

interface UseSessionHistoryResult {
	projects: ProjectInfo[];
	isLoadingProjects: boolean;

	sessionsByProject: Map<ProjectKey, HistorySession[]>;
	loadingProjects: Set<ProjectKey>;
	fetchProjectSessions: (
		peerId: string,
		dirName: string,
		forceRefresh?: boolean,
	) => Promise<void>;
	refreshAllLoadedProjects: () => Promise<void>;

	searchResults: HistorySession[];
	isSearching: boolean;
	searchQuery: string;
	searchSessions: (query: string) => Promise<void>;
	clearSearch: () => void;

	error: string | null;

	refresh: () => Promise<void>;
	resumeSession: (
		sessionId: string,
		projectPath: string,
		agent?: "claude" | "codex",
		peerId?: string,
	) => Promise<{ tmuxSessionId: string } | null>;
	fetchConversation: (
		sessionId: string,
		projectDirName?: string,
		agent?: "claude" | "codex",
		peerId?: string,
	) => Promise<ConversationMessage[]>;
}

export function useSessionHistory(): UseSessionHistoryResult {
	const [projects, setProjects] = useState<ProjectInfo[]>([]);
	const [isLoadingProjects, setIsLoadingProjects] = useState(true);
	const [sessionsByProject, setSessionsByProject] = useState<
		Map<ProjectKey, HistorySession[]>
	>(new Map());
	const [loadingProjects, setLoadingProjects] = useState<Set<ProjectKey>>(
		new Set(),
	);
	const [error, setError] = useState<string | null>(null);

	const [searchResults, setSearchResults] = useState<HistorySession[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");

	// 全 peer のプロジェクト一覧を取得
	const fetchProjects = useCallback(async (silent = false) => {
		try {
			if (!silent) {
				setIsLoadingProjects(true);
				setError(null);
			}
			const response = await authFetch(
				`${API_BASE}/api/peers/history/projects`,
			);
			if (!response.ok) {
				throw new Error("Failed to fetch projects");
			}
			const data = (await response.json()) as PeerHistoryProjectsResponse;
			setProjects((prev) => {
				const newJson = JSON.stringify(data.projects || []);
				const prevJson = JSON.stringify(prev);
				return newJson === prevJson ? prev : data.projects || [];
			});
		} catch (err) {
			if (!silent && !isTransientNetworkError(err)) {
				setError(err instanceof Error ? err.message : "Unknown error");
			}
		} finally {
			if (!silent) {
				setIsLoadingProjects(false);
			}
		}
	}, []);

	const fetchProjectSessions = useCallback(
		async (peerId: string, dirName: string, forceRefresh = false) => {
			const key = projectKey(peerId, dirName);
			if (
				!forceRefresh &&
				(sessionsByProject.has(key) || loadingProjects.has(key))
			) {
				return;
			}

			try {
				setLoadingProjects((prev) => new Set(prev).add(key));
				const response = await authFetch(
					`${API_BASE}/api/peers/history/${encodeURIComponent(peerId)}/projects/${encodeURIComponent(dirName)}`,
				);
				if (!response.ok) {
					throw new Error("Failed to fetch project sessions");
				}
				const data = (await response.json()) as { sessions?: HistorySession[] };
				setSessionsByProject((prev) => {
					const next = new Map(prev);
					next.set(key, data.sessions ?? []);
					return next;
				});
			} catch (err) {
				console.error("Failed to fetch project sessions:", err);
			} finally {
				setLoadingProjects((prev) => {
					const next = new Set(prev);
					next.delete(key);
					return next;
				});
			}
		},
		[sessionsByProject, loadingProjects],
	);

	const refreshAllLoadedProjects = useCallback(async () => {
		const loadedKeys = Array.from(sessionsByProject.keys());
		setSessionsByProject(new Map());
		await Promise.all(
			loadedKeys.map((key) => {
				const [peerId, dirName] = key.split("::");
				return fetchProjectSessions(peerId, dirName, true);
			}),
		);
	}, [sessionsByProject, fetchProjectSessions]);

	const resumeSession = useCallback(
		async (
			sessionId: string,
			projectPath: string,
			agent?: "claude" | "codex",
			peerId?: string,
		) => {
			try {
				const isRemote = peerId && peerId !== LOCAL_PEER_ID;
				const url = isRemote
					? `${API_BASE}/api/peers/history/${encodeURIComponent(peerId)}/resume`
					: `${API_BASE}/api/sessions/history/resume`;
				const response = await authFetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId, projectPath, agent }),
				});
				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					const err = new Error(errorData.error || "Failed to resume session");
					(err as Error & { data?: unknown }).data = errorData;
					throw err;
				}
				const data = await response.json();
				return { tmuxSessionId: data.tmuxSessionId };
			} catch (err) {
				console.error("Failed to resume session:", err);
				throw err;
			}
		},
		[],
	);

	const fetchConversation = useCallback(
		async (
			sessionId: string,
			projectDirName?: string,
			agent?: "claude" | "codex",
			peerId?: string,
		): Promise<ConversationMessage[]> => {
			try {
				const isRemote = peerId && peerId !== LOCAL_PEER_ID;
				const base = isRemote
					? `${API_BASE}/api/peers/history/${encodeURIComponent(peerId)}/${encodeURIComponent(sessionId)}/conversation`
					: `${API_BASE}/api/sessions/history/${encodeURIComponent(sessionId)}/conversation`;
				const url = new URL(base, window.location.origin);
				if (projectDirName) {
					url.searchParams.set("projectDirName", projectDirName);
				}
				if (agent === "codex") {
					url.searchParams.set("agent", "codex");
				}
				const response = await authFetch(url.toString(), { cache: "no-store" });
				if (!response.ok) {
					throw new Error("Failed to fetch conversation");
				}
				const data = await response.json();
				return data.messages || [];
			} catch (err) {
				console.error("Failed to fetch conversation:", err);
				return [];
			}
		},
		[],
	);

	// Search は Hub の SSE をそのまま使用 (Phase: peer 横断 search は未実装)
	const searchSessions = useCallback(async (query: string) => {
		setSearchQuery(query);
		if (!query.trim()) {
			setSearchResults([]);
			return;
		}

		setIsSearching(true);
		setSearchResults([]);

		try {
			const url = `${API_BASE}/api/sessions/history/search/stream?q=${encodeURIComponent(query)}`;
			const eventSource = new EventSource(url);

			eventSource.onmessage = (event) => {
				try {
					const session = JSON.parse(event.data) as HistorySession;
					setSearchResults((prev) => [...prev, session]);
				} catch {
					/* Ignore parse errors */
				}
			};

			eventSource.addEventListener("done", () => {
				setIsSearching(false);
				eventSource.close();
			});

			eventSource.addEventListener("error", () => {
				setIsSearching(false);
				eventSource.close();
			});

			eventSource.onerror = () => {
				setIsSearching(false);
				eventSource.close();
			};
		} catch (err) {
			console.error("Failed to search sessions:", err);
			setSearchResults([]);
			setIsSearching(false);
		}
	}, []);

	const clearSearch = useCallback(() => {
		setSearchQuery("");
		setSearchResults([]);
	}, []);

	useEffect(() => {
		fetchProjects();
	}, [fetchProjects]);

	return {
		projects,
		isLoadingProjects,
		sessionsByProject,
		loadingProjects,
		fetchProjectSessions,
		refreshAllLoadedProjects,
		searchResults,
		isSearching,
		searchQuery,
		searchSessions,
		clearSearch,
		error,
		refresh: fetchProjects,
		resumeSession,
		fetchConversation,
	};
}
