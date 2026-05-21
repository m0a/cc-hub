import { useCallback, useEffect, useState } from "react";
import type {
	PeerClientView,
	PeerCreateInput,
	PeerUpdateInput,
} from "../../../shared/types";
import { authFetch } from "../services/api";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface UsePeersReturn {
	peers: PeerClientView[];
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
	addPeer: (input: PeerCreateInput) => Promise<PeerClientView>;
	updatePeer: (id: string, input: PeerUpdateInput) => Promise<PeerClientView>;
	deletePeer: (id: string) => Promise<void>;
	verifyPeer: (id: string) => Promise<{ status: string; latencyMs?: number; message?: string }>;
	reorderPeers: (orderedIds: string[]) => Promise<void>;
}

// module-level cache: 全コンポーネントで共有
let cachedPeers: PeerClientView[] | null = null;
const listeners = new Set<(peers: PeerClientView[]) => void>();

function broadcast(peers: PeerClientView[]) {
	cachedPeers = peers;
	for (const l of listeners) l(peers);
}

async function fetchPeers(): Promise<PeerClientView[]> {
	const res = await authFetch(`${API_BASE}/api/peers`);
	if (!res.ok) throw new Error(`Failed to load peers: HTTP ${res.status}`);
	const data = (await res.json()) as { peers: PeerClientView[] };
	return data.peers;
}

export function usePeers(): UsePeersReturn {
	const [peers, setPeers] = useState<PeerClientView[]>(() => cachedPeers ?? []);
	const [isLoading, setIsLoading] = useState(() => cachedPeers === null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const listener = (next: PeerClientView[]) => setPeers(next);
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}, []);

	const refresh = useCallback(async () => {
		try {
			const next = await fetchPeers();
			broadcast(next);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load peers");
		} finally {
			setIsLoading(false);
		}
	}, []);

	// 初回ロード + 定期更新 (peer の status を最新化するため)
	useEffect(() => {
		let cancelled = false;
		if (cachedPeers === null) {
			void refresh();
		} else {
			setIsLoading(false);
		}
		const timer = setInterval(() => {
			if (cancelled) return;
			void refresh();
		}, 5000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [refresh]);

	const addPeer = useCallback(async (input: PeerCreateInput): Promise<PeerClientView> => {
		const res = await authFetch(`${API_BASE}/api/peers`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(err.error ?? `HTTP ${res.status}`);
		}
		const data = (await res.json()) as { peer: PeerClientView };
		await refresh();
		return data.peer;
	}, [refresh]);

	const updatePeerFn = useCallback(async (id: string, input: PeerUpdateInput): Promise<PeerClientView> => {
		const res = await authFetch(`${API_BASE}/api/peers/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(err.error ?? `HTTP ${res.status}`);
		}
		const data = (await res.json()) as { peer: PeerClientView };
		await refresh();
		return data.peer;
	}, [refresh]);

	const deletePeerFn = useCallback(async (id: string): Promise<void> => {
		const res = await authFetch(`${API_BASE}/api/peers/${id}`, { method: "DELETE" });
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(err.error ?? `HTTP ${res.status}`);
		}
		await refresh();
	}, [refresh]);

	const verifyPeerFn = useCallback(async (id: string) => {
		const res = await authFetch(`${API_BASE}/api/peers/${id}/verify`, { method: "POST" });
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(err.error ?? `HTTP ${res.status}`);
		}
		const result = (await res.json()) as { status: string; latencyMs?: number; message?: string };
		// verify は registry を更新するので peers も再取得
		await refresh();
		return result;
	}, [refresh]);

	const reorderPeers = useCallback(async (orderedIds: string[]): Promise<void> => {
		const res = await authFetch(`${API_BASE}/api/peers/order`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ order: orderedIds }),
		});
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(err.error ?? `HTTP ${res.status}`);
		}
		await refresh();
	}, [refresh]);

	return {
		peers,
		isLoading,
		error,
		refresh,
		addPeer,
		updatePeer: updatePeerFn,
		deletePeer: deletePeerFn,
		verifyPeer: verifyPeerFn,
		reorderPeers,
	};
}
