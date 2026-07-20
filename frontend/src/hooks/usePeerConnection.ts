import { useMemo } from "react";
import {
	type ExtendedSessionResponse,
	LOCAL_PEER_ID,
	type PeerClientView,
} from "../../../shared/types";
import { peerHttpUrlToWsUrl } from "../services/peer-ws";

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
 * - preferredPeerId: セッション id は peer 間で重複し得る（herdr workspace 名）
 *   ので、呼び出し側がユーザーの選択した peer を知っている場合はそれを渡す。
 *   指定時は sessions からの id 検索（最初の一致 = local 優先）を行わない。
 */
export function usePeerConnection(
	sessionId: string,
	sessions: ExtendedSessionResponse[],
	peers: PeerClientView[],
	preferredPeerId?: string,
): PeerConnectionInfo {
	return useMemo(() => {
		const hubInfo: PeerConnectionInfo = {
			peerId: LOCAL_PEER_ID,
			wsBase: null,
			token: null,
			apiBase: "",
		};

		if (!sessionId) return hubInfo;

		const peerId =
			preferredPeerId ?? sessions.find((s) => s.id === sessionId)?.peerId;
		if (!peerId || peerId === LOCAL_PEER_ID) return hubInfo;

		const peer = peers.find((p) => p.id === peerId);
		if (!peer || peer.url === "self") return hubInfo;

		return {
			peerId,
			wsBase: peerHttpUrlToWsUrl(peer.url),
			token: peer.wsToken ?? null,
			apiBase: peer.url.replace(/\/+$/, ""),
		};
	}, [sessionId, sessions, peers, preferredPeerId]);
}
