import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionResponse } from "../../../../shared/types";
import {
	sessionDedupeKey,
	useFlatHistoryItems,
} from "../../hooks/useFlatHistoryItems";
import { useHistoryActions } from "../../hooks/useHistoryActions";
import { useSessionHistory } from "../../hooks/useSessionHistory";
import {
	applyHistoryFilter,
	bucketizeHistory,
	EMPTY_HISTORY_FILTER,
	type HistoryFilter,
	isFilterActive,
} from "../../utils/historyBuckets";
import { ConversationViewer } from "../ConversationViewer";
import { HistoryFacetBar } from "./HistoryFacetBar";
import { VirtualizedHistoryList } from "./VirtualizedHistoryList";

interface ActiveSession extends SessionResponse {
	ccSessionId?: string;
}

interface SessionHistoryV2Props {
	onSessionResumed?: () => void;
	onSelectSession?: (session: SessionResponse) => void;
	activeSessions?: ActiveSession[];
}

/**
 * V2 history view: one virtualized, cross-project flat list with incremental
 * search. Facets / sort / date buckets land in a later PR; this is the
 * flag-gated foundation (cchub-history-v2).
 */
export function SessionHistoryV2({
	onSessionResumed,
	onSelectSession,
	activeSessions = [],
}: SessionHistoryV2Props) {
	const { t } = useTranslation();
	const {
		projects,
		isLoadingProjects,
		sessionsByProject,
		fetchProjectSessions,
		refreshAllLoadedProjects,
		searchResults,
		isSearching,
		searchQuery,
		searchSessions,
		resumeSession,
		fetchConversation,
		error,
	} = useSessionHistory();

	const { items, dirNameBySession, isHydrating, hydratedCount, totalCount } =
		useFlatHistoryItems({
			projects,
			sessionsByProject,
			fetchProjectSessions,
		});

	const {
		resumingId,
		resumeError,
		selectedSession,
		conversation,
		loadingConversation,
		activeCcSessionIds,
		handleResume,
		handleNavigate,
		handleTap,
		closeModal,
		dismissError,
	} = useHistoryActions({
		activeSessions,
		onSelectSession,
		onSessionResumed,
		resumeSession,
		fetchConversation,
		refreshAllLoadedProjects,
	});

	// Incremental search: debounce keystrokes into the existing SSE search.
	// Always route through searchSessions (it handles the empty-query case by
	// aborting the in-flight stream + clearing results + isSearching=false);
	// calling clearSearch() here would leak the SSE stream and pin isSearching.
	const [searchInput, setSearchInput] = useState("");
	useEffect(() => {
		const q = searchInput.trim();
		const handle = setTimeout(() => {
			searchSessions(q);
		}, 150);
		return () => clearTimeout(handle);
	}, [searchInput, searchSessions]);

	// Client-side facet filter (agent / period / active).
	const [filter, setFilter] = useState<HistoryFilter>(EMPTY_HISTORY_FILTER);

	const isSearchMode = searchQuery.trim().length > 0;
	const sourceItems = isSearchMode ? searchResults : items;

	// filter -> sort -> bucketize into header+session rows for the virtualizer.
	const rows = useMemo(() => {
		const now = Date.now();
		const filtered = applyHistoryFilter(
			sourceItems,
			filter,
			activeCcSessionIds,
			now,
		);
		// The flat list is already modified-DESC, but search results arrive in SSE
		// order (Codex first, then Claude dir-by-dir) — sort so bucket headers
		// don't repeat / collide on keys.
		const ordered = isSearchMode
			? [...filtered].sort(
					(a, b) =>
						new Date(b.modified).getTime() - new Date(a.modified).getTime(),
				)
			: filtered;
		return bucketizeHistory(
			ordered,
			isSearchMode ? undefined : dirNameBySession,
			sessionDedupeKey,
			t,
			now,
		);
	}, [
		sourceItems,
		filter,
		activeCcSessionIds,
		isSearchMode,
		dirNameBySession,
		t,
	]);

	const filterActive = isFilterActive(filter);
	const sessionCount = rows.reduce(
		(n, r) => (r.kind === "session" ? n + 1 : n),
		0,
	);

	if (isLoadingProjects) {
		return (
			<div className="p-4 text-center text-th-text-muted text-sm">
				{t("history.loadingHistory")}
			</div>
		);
	}

	if (error) {
		return (
			<div className="p-4 text-center text-red-400 text-sm">
				{t("common.error")}: {error}
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			{/* Search */}
			<div className="px-3 pt-3 pb-2 shrink-0">
				<div className="relative max-w-sm">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
					<input
						type="text"
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						placeholder={t("history.searchPlaceholder")}
						className="w-full pl-9 pr-3 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md text-[13px] text-white placeholder:text-zinc-700 focus:outline-none focus:border-white/[0.12] transition-colors"
					/>
					{searchInput && (
						<button
							type="button"
							onClick={() => setSearchInput("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-600 hover:text-zinc-400"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					)}
				</div>
			</div>

			{/* Facet chips */}
			<div className="px-3 pb-1 shrink-0">
				<HistoryFacetBar filter={filter} onChange={setFilter} />
			</div>

			{/* Status line: search count or hydration progress */}
			<div className="px-3 pb-1.5 shrink-0 text-[11px] text-zinc-500">
				{isSearchMode ? (
					isSearching ? (
						t("history.searching")
					) : (
						t("history.searchResults", {
							query: searchQuery,
							count: sessionCount,
						})
					)
				) : isHydrating ? (
					t("history.indexing", { done: hydratedCount, total: totalCount })
				) : (
					t("history.sessionsCount", { count: sessionCount })
				)}
			</div>

			{resumeError && (
				<div className="mx-3 mb-2 px-3 py-2 bg-red-900/50 text-red-300 text-xs flex items-center justify-between rounded shrink-0">
					<span>{resumeError}</span>
					<button
						type="button"
						onClick={dismissError}
						className="text-red-400 hover:text-red-200 ml-2"
					>
						×
					</button>
				</div>
			)}

			{/* Virtualized list */}
			<div className="flex-1 min-h-0">
				{rows.length === 0 ? (
					<div className="p-4 text-center text-th-text-muted text-sm">
						{isSearchMode
							? t("history.noSearchResults")
							: filterActive
								? t("history.noFilterMatches")
								: t("history.noSessions")}
					</div>
				) : (
					<VirtualizedHistoryList
						// Remount on mode flip AND on filter change so scrollTop +
						// measurement cache reset; otherwise a stale offset can leave the
						// list blank after the row set shrinks (e.g. applying a facet).
						key={isSearchMode ? "search" : `flat:${JSON.stringify(filter)}`}
						rows={rows}
						activeCcSessionIds={activeCcSessionIds}
						resumingId={resumingId}
						onTap={handleTap}
						onResume={handleResume}
						onNavigate={handleNavigate}
					/>
				)}
			</div>

			{selectedSession && (
				<ConversationViewer
					title={
						selectedSession.summary ||
						selectedSession.lastPrompt ||
						selectedSession.firstPrompt ||
						t("history.noTitle")
					}
					subtitle={selectedSession.projectName}
					messages={conversation}
					isLoading={loadingConversation}
					onClose={closeModal}
					onResume={() => handleResume(selectedSession)}
					isResuming={resumingId === selectedSession.sessionId}
					scrollToBottom={true}
				/>
			)}
		</div>
	);
}
