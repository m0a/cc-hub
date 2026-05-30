import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HistorySession } from "../../../../shared/types";
import type { HistoryListRow } from "../../utils/historyBuckets";
import { HistoryRowV2 } from "./HistoryRowV2";

interface VirtualizedHistoryListProps {
	rows: HistoryListRow[];
	activeCcSessionIds: Set<string>;
	resumingId: string | null;
	onTap: (session: HistorySession, projectDirName?: string) => void;
	onResume: (session: HistorySession) => void;
	onNavigate: (session: HistorySession) => void;
}

type SessionRow = Extract<HistoryListRow, { kind: "session" }>;
type PackedRow =
	| Extract<HistoryListRow, { kind: "header" }>
	| { kind: "group"; key: string; items: SessionRow[] };

/** Pick a column count from the available width (1 / 2 / 3). */
function columnsForWidth(width: number): number {
	if (width >= 1400) return 3;
	if (width >= 640) return 2;
	return 1;
}

/**
 * Virtualized history list. Date-bucket headers span the full width; session
 * cards are packed into responsive rows of 1–3 columns so recaps don't run
 * edge-to-edge on wide screens.
 *
 * Uses an internal scroll container as the scrollElement (same pattern as
 * ConversationViewer). measureElement is NOT corrected for the SessionList
 * contentScale transform: ResizeObserver reports the pre-transform layout size,
 * so the virtualizer's math stays correct under pinch-zoom.
 */
export function VirtualizedHistoryList({
	rows,
	activeCcSessionIds,
	resumingId,
	onTap,
	onResume,
	onNavigate,
}: VirtualizedHistoryListProps) {
	const parentRef = useRef<HTMLDivElement>(null);
	const [columns, setColumns] = useState(1);

	// useLayoutEffect: read the width and set columns synchronously before paint
	// so there's no 1-column flash. Only reset scroll when the column COUNT
	// actually changes (repacking shifts row indices/keys), not on every resize.
	useLayoutEffect(() => {
		const el = parentRef.current;
		if (!el) return;
		let prev = columnsForWidth(el.clientWidth);
		setColumns(prev);
		const ro = new ResizeObserver(() => {
			const next = columnsForWidth(el.clientWidth);
			if (next !== prev) {
				prev = next;
				setColumns(next);
				el.scrollTop = 0;
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Pack consecutive session rows into groups of `columns`; headers stay solo.
	const packed = useMemo<PackedRow[]>(() => {
		const out: PackedRow[] = [];
		let i = 0;
		while (i < rows.length) {
			const row = rows[i];
			if (row.kind === "header") {
				out.push(row);
				i++;
				continue;
			}
			const group: SessionRow[] = [];
			while (
				i < rows.length &&
				rows[i].kind === "session" &&
				group.length < columns
			) {
				group.push(rows[i] as SessionRow);
				i++;
			}
			out.push({ kind: "group", key: `g:${group.map((g) => g.key).join("|")}`, items: group });
		}
		return out;
	}, [rows, columns]);

	const virtualizer = useVirtualizer({
		count: packed.length,
		getScrollElement: () => parentRef.current,
		estimateSize: (index) => {
			const row = packed[index];
			if (!row) return 90;
			if (row.kind === "header") return 30;
			// A card row is as tall as its tallest card; recap cards are taller.
			return row.items.some((s) => s.session.recap) ? 120 : 78;
		},
		overscan: 8,
		getItemKey: (index) => packed[index]?.key ?? index,
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
						const row = packed[virtualRow.index];
						if (!row) return null;
						return (
							<div
								key={virtualRow.key}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
							>
								{row.kind === "header" ? (
									<div className="flex items-center justify-between px-3 pt-2.5 pb-1 text-[10.5px] uppercase tracking-wider text-zinc-500">
										<span>{row.label}</span>
										<span className="tabular-nums">{row.count}</span>
									</div>
								) : (
									<div
										className="grid gap-2 px-2 py-1"
										style={{
											gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
										}}
									>
										{row.items.map((s) => (
											<HistoryRowV2
												key={s.key}
												session={s.session}
												isActive={activeCcSessionIds.has(s.session.sessionId)}
												isResuming={resumingId === s.session.sessionId}
												onTap={() => onTap(s.session, s.dirName)}
												onResume={() => onResume(s.session)}
												onNavigate={() => onNavigate(s.session)}
											/>
										))}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
