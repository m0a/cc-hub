import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { HistorySession } from "../../../../shared/types";
import { sessionDedupeKey } from "../../hooks/useFlatHistoryItems";
import { HistoryRowV2 } from "./HistoryRowV2";

interface VirtualizedHistoryListProps {
	items: HistorySession[];
	activeCcSessionIds: Set<string>;
	resumingId: string | null;
	onTap: (session: HistorySession, projectDirName?: string) => void;
	onResume: (session: HistorySession) => void;
	onNavigate: (session: HistorySession) => void;
	/** Maps a session's dedupe key to its project dir, so taps can scope the
	 * conversation fetch. Undefined in search mode (results span projects). */
	dirNameBySession?: Map<string, string>;
}

/**
 * Virtualized flat list of history rows. Uses an internal scroll container as
 * the scrollElement (same pattern as ConversationViewer). measureElement is NOT
 * corrected for the SessionList contentScale transform: ResizeObserver reports
 * the pre-transform layout size, so the virtualizer's math stays correct under
 * pinch-zoom.
 */
export function VirtualizedHistoryList({
	items,
	activeCcSessionIds,
	resumingId,
	onTap,
	onResume,
	onNavigate,
	dirNameBySession,
}: VirtualizedHistoryListProps) {
	const parentRef = useRef<HTMLDivElement>(null);

	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => parentRef.current,
		// Rows vary: a plain prompt row is ~66px, a 3-line recap row ~108px.
		// measureElement corrects these; the estimates just minimize first-paint
		// scroll jump.
		estimateSize: (index) => (items[index]?.recap ? 108 : 66),
		overscan: 12,
		getItemKey: (index) => {
			const s = items[index];
			return s ? sessionDedupeKey(s) : index;
		},
	});

	return (
		<div ref={parentRef} className="h-full overflow-y-auto overscroll-contain">
			<div
				style={{
					height: `${virtualizer.getTotalSize()}px`,
					width: "100%",
					position: "relative",
				}}
			>
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: "100%",
						transform: `translateY(${virtualizer.getVirtualItems()[0]?.start ?? 0}px)`,
					}}
				>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const session = items[virtualRow.index];
						if (!session) return null;
						return (
							<div
								key={virtualRow.key}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
							>
								<HistoryRowV2
									session={session}
									isActive={activeCcSessionIds.has(session.sessionId)}
									isResuming={resumingId === session.sessionId}
									onTap={() =>
										onTap(session, dirNameBySession?.get(sessionDedupeKey(session)))
									}
									onResume={() => onResume(session)}
									onNavigate={() => onNavigate(session)}
								/>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
