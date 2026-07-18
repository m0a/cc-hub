/** biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: legacy click-on-div row UI shared with V1; keyboard navigation provided via main shortcuts */
import { Clock, FolderOpen, MessageCircle, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HistorySession } from "../../../../shared/types";
import { agentBadge } from "../../utils/agentDisplay";
import { formatDuration, formatRelativeTime } from "../../utils/format";

interface HistoryRowV2Props {
	session: HistorySession;
	isActive: boolean;
	isResuming: boolean;
	onTap: () => void;
	onResume: () => void;
	onNavigate: () => void;
}

/**
 * One row of the flat (V2) history list. Unlike V1's HistoryItem this always
 * shows the project as a breadcrumb (the list is cross-project) and renders the
 * recap as an amber preview when present.
 */
export function HistoryRowV2({
	session,
	isActive,
	isResuming,
	onTap,
	onResume,
	onNavigate,
}: HistoryRowV2Props) {
	const { t, i18n } = useTranslation();

	const displayText =
		session.lastPrompt ||
		session.firstPrompt ||
		session.summary ||
		"No description";
	const truncatedText =
		displayText.length > 70 ? `${displayText.substring(0, 70)}…` : displayText;

	const duration = formatDuration(session.durationMinutes, t);
	const badge = agentBadge(session.agent);

	const showPeer =
		session.peerId && session.peerId !== "local" && session.peerNickname;

	return (
		<div
			onClick={onTap}
			className="group px-3 py-2.5 hover:bg-white/[0.04] cursor-pointer transition-colors border-b border-white/[0.04]"
			style={
				showPeer && session.peerColor
					? { borderLeft: `3px solid ${session.peerColor}`, paddingLeft: 9 }
					: undefined
			}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 text-[10.5px] text-zinc-500 mb-0.5">
						<FolderOpen className="w-3 h-3 shrink-0" />
						<span className="truncate">{session.projectName}</span>
						<span
							className={`shrink-0 inline-flex items-center px-1.5 py-px rounded border text-[10px] font-medium ${badge.badgeClassName}`}
						>
							{badge.label}
						</span>
						{showPeer && (
							<span
								className="shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[9.5px]"
								style={{
									backgroundColor: `${session.peerColor}26`,
									color: session.peerColor,
								}}
							>
								<span
									className="w-1 h-1 rounded-full"
									style={{ backgroundColor: session.peerColor }}
								/>
								{session.peerNickname}
							</span>
						)}
					</div>

					{session.recap ? (
						<p className="text-[12.5px] text-amber-200 leading-relaxed line-clamp-3">
							{session.recap}
						</p>
					) : (
						<p className="text-[13px] text-zinc-300 leading-snug truncate">
							{truncatedText}
						</p>
					)}

					<div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-600">
						<span>
							{/* Show `modified` — the same key the list is sorted and
							    bucketed by. Using recapAt here made the times look
							    out of order (a recap can be days older than the last
							    activity). */}
							{formatRelativeTime(session.modified, t, i18n.language)}
						</span>
						{duration && (
							<span className="inline-flex items-center gap-1">
								<Clock className="w-3 h-3" />
								{duration}
							</span>
						)}
						{session.messageCount !== undefined && session.messageCount > 0 && (
							<span className="inline-flex items-center gap-1">
								<MessageCircle className="w-3 h-3" />
								{session.messageCount}
							</span>
						)}
						{session.gitBranch && (
							<span className="inline-flex items-center gap-1 text-purple-500 truncate max-w-[120px]">
								<Tag className="w-3 h-3" />
								{session.gitBranch}
							</span>
						)}
					</div>
				</div>

				{isActive ? (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onNavigate();
						}}
						className="shrink-0 mt-0.5 px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] rounded-md transition-colors"
					>
						{t("session.navigate")}
					</button>
				) : (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onResume();
						}}
						disabled={isResuming}
						className="shrink-0 mt-0.5 px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] rounded-md transition-colors disabled:opacity-50"
					>
						{isResuming ? "..." : t("session.resume")}
					</button>
				)}
			</div>
		</div>
	);
}
