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
let lastError: string | null = null;
const listeners = new Set<() => void>();

// usePeers は複数コンポーネントから同時に呼ばれるが、ポーリングタイマーは
// モジュールレベルで1本だけ管理する（参照カウント方式）。インスタンスごとに
// setInterval を張ると /api/peers への 5 秒ポーリングが N 倍に多重化する (#336)
let pollTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight: Promise<void> | null = null;

function notifyListeners() {
	for (const l of listeners) l();
}

async function fetchPeers(): Promise<PeerClientView[]> {
	const res = await authFetch(`${API_BASE}/api/peers`);
	if (!res.ok) throw new Error(`Failed to load peers: HTTP ${res.status}`);
	const data = (await res.json()) as { peers: PeerClientView[] };
	return data.peers;
}

// 同時要求は1本の fetch に合流させる
function refreshShared(): Promise<void> {
	if (refreshInFlight) return refreshInFlight;
	refreshInFlight = (async () => {
		try {
			cachedPeers = await fetchPeers();
			lastError = null;
		} catch (err) {
			lastError = err instanceof Error ? err.message : "Failed to load peers";
		} finally {
			refreshInFlight = null;
			notifyListeners();
		}
	})();
	return refreshInFlight;
}

function subscribePeers(listener: () => void): () => void {
	listeners.add(listener);
	if (!pollTimer) {
		// 定期更新 (peer の status を最新化するため)。購読者がいる間だけ動かす
		pollTimer = setInterval(() => {
			void refreshShared();
		}, 5000);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	};
}

export function usePeers(): UsePeersReturn {
	const [peers, setPeers] = useState<PeerClientView[]>(() => cachedPeers ?? []);
	const [isLoading, setIsLoading] = useState(() => cachedPeers === null);
	const [error, setError] = useState<string | null>(() => lastError);

	useEffect(() => {
		const listener = () => {
			setPeers(cachedPeers ?? []);
			setError(lastError);
			setIsLoading(false);
		};
		const unsubscribe = subscribePeers(listener);
		// 初回ロード。キャッシュ済みなら即確定し、裏のポーリングが最新化する
		if (cachedPeers === null) {
			void refreshShared();
		} else {
			listener();
		}
		return unsubscribe;
	}, []);

	const refresh = useCallback(async () => {
		await refreshShared();
	}, []);

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
