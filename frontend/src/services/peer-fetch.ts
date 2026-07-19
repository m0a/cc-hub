/**
 * Multi-server: session の peerId に応じて peer 側 API を直接叩くヘルパー。
 *
 * Hub の REST API (/api/workspaces/:id/theme 等) は local session 用なので、
 * peer のセッションには peer 自身の URL + 取得済みトークンで fetch する。
 */
import { LOCAL_PEER_ID, type PeerClientView } from "../../../shared/types";
import { authFetch, fetchWithTimeout } from "./api";

interface SessionWithPeer {
	peerId?: string;
}

function resolveSessionApi(
	session: SessionWithPeer | undefined,
	peers: PeerClientView[],
): { apiBase: string; token: string | null; isRemote: boolean } {
	const peerId = session?.peerId;
	if (!peerId || peerId === LOCAL_PEER_ID) {
		return { apiBase: "", token: null, isRemote: false };
	}
	const peer = peers.find((p) => p.id === peerId);
	if (!peer || peer.url === "self") {
		return { apiBase: "", token: null, isRemote: false };
	}
	return {
		apiBase: peer.url.replace(/\/+$/, ""),
		token: peer.wsToken ?? null,
		isRemote: true,
	};
}

/**
 * Session が remote peer に属するなら peer URL + そのトークンで fetch、
 * それ以外なら Hub に対する authFetch にフォールバックする。
 */
export async function sessionFetch(
	session: SessionWithPeer | undefined,
	peers: PeerClientView[],
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const { apiBase, token, isRemote } = resolveSessionApi(session, peers);
	if (!isRemote) {
		return authFetch(`${apiBase}${path}`, init);
	}
	const headers = new Headers(init.headers);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	return fetchWithTimeout(`${apiBase}${path}`, { ...init, headers });
}
