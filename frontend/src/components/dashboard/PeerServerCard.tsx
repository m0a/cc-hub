import type { PeerClientView } from "../../../../shared/types";
import { LOCAL_PEER_ID } from "../../../../shared/types";
import { usePeerServerMetrics } from "../../hooks/usePeerServerMetrics";
import { ServerInfo } from "./ServerInfo";

interface PeerServerCardProps {
	peer: PeerClientView;
}

/**
 * Wraps ServerInfo so each peer's CPU / memory / disk panel is driven by its
 * own polling hook. Throughput is local-only (it tracks this browser's WS
 * bytes), so it's only shown on the local peer card.
 */
export function PeerServerCard({ peer }: PeerServerCardProps) {
	const isLocal = peer.id === LOCAL_PEER_ID;
	const { systemMetrics, diskUsage, connectedClients, herdrUpdate, error, refetch } =
		usePeerServerMetrics(peer.id);

	return (
		<div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]">
			<div className="flex items-center gap-1.5 mb-2">
				<span
					aria-hidden="true"
					className="w-2 h-2 rounded-full shrink-0"
					style={{ backgroundColor: peer.color }}
				/>
				<span className="text-[11px] text-th-text-muted truncate">
					{peer.nickname}
				</span>
				{error && (
					<span
						className="text-[10px] text-amber-400 ml-auto truncate"
						title={error}
					>
						offline
					</span>
				)}
			</div>
			<ServerInfo
				systemMetrics={systemMetrics}
				diskUsage={diskUsage}
				connectedClients={connectedClients}
				label={peer.nickname}
				hideThroughput={!isLocal}
				herdrUpdate={herdrUpdate}
				allowHerdrApply={isLocal}
				onHerdrApplied={refetch}
			/>
		</div>
	);
}
