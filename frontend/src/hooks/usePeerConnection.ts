import { useMemo } from "react";
import {
	type ExtendedSessionResponse,
	LOCAL_PEER_ID,
	type PeerClientView,
} from "../../../shared/types";

export interface PeerConnectionInfo {
	peerId: string;
	wsBase: string | null; // null = use Hub default (window.location.host)
	token: string | null;
	apiBase: string; // REST API base URL ("" for Hub, "https://host:port" for remote peer)
}

/**
 * 指定したセッションが属する peer の WS接続情報を返す。
 * - sessionId が見つからない / peerId が local / 不明: Hub の接続情報を返す
 * - peerId が remote: peer.url から wsBase + apiBase を導出
 */
export function usePeerConnection(
	sessionId: string,
	sessions: ExtendedSessionResponse[],
	peers: PeerClientView[],
): PeerConnectionInfo {
	return useMemo(() => {
		const hubInfo: PeerConnectionInfo = {
			peerId: LOCAL_PEER_ID,
			wsBase: null,
			token: null,
			apiBase: "",
		};

		if (!sessionId) return hubInfo;

		const session = sessions.find((s) => s.id === sessionId);
		const peerId = session?.peerId;
		if (!peerId || peerId === LOCAL_PEER_ID) return hubInfo;

		const peer = peers.find((p) => p.id === peerId);
		if (!peer || peer.url === "self") return hubInfo;

		const wsBase = peer.url.replace(/^http(s?):/, (_match, s) => `ws${s}:`).replace(/\/+$/, "");
		return {
			peerId,
			wsBase,
			token: peer.wsToken ?? null,
			apiBase: peer.url.replace(/\/+$/, ""),
		};
	}, [sessionId, sessions, peers]);
}
