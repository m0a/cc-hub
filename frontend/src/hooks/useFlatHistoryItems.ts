import { useEffect, useMemo, useRef, useState } from "react";
import type { HistorySession } from "../../../shared/types";
import { type ProjectInfo, projectKey } from "./useSessionHistory";

const HYDRATION_CONCURRENCY = 4;

interface UseFlatHistoryItemsArgs {
	projects: ProjectInfo[];
	sessionsByProject: Map<string, HistorySession[]>;
	fetchProjectSessions: (peerId: string, dirName: string) => Promise<void>;
}

interface FlatHistoryItems {
	/** All loaded sessions across every project, newest first. */
	items: HistorySession[];
	/** Maps each session's dedupe key (`${peerId}:${sessionId}`) to the project
	 * directory name it came from, so conversation fetches can be scoped to one
	 * dir instead of scanning all of them. */
	dirNameBySession: Map<string, string>;
	/** Projects whose sessions have been loaded so far. */
	hydratedCount: number;
	/** Total number of projects to load. */
	totalCount: number;
	/** True while background hydration is still in flight. */
	isHydrating: boolean;
}

/** Stable dedupe / lookup key for a session across project buckets. */
export function sessionDedupeKey(s: HistorySession): string {
	return `${s.peerId ?? "local"}:${s.sessionId}`;
}

/**
 * Flattens every project's sessions into a single modified-DESC list, kicking
 * off background hydration (4-concurrent) of all projects when the History tab
 * mounts. Facet counts / filters (PR5) sit on top of this flat list.
 */
export function useFlatHistoryItems({
	projects,
	sessionsByProject,
	fetchProjectSessions,
}: UseFlatHistoryItemsArgs): FlatHistoryItems {
	const [hydratedKeys, setHydratedKeys] = useState<Set<string>>(new Set());
	// Guard so each (peer,dir) is only requested once per mount.
	const requestedRef = useRef<Set<string>>(new Set());
	// fetchProjectSessions changes identity whenever sessionsByProject updates
	// (it's loaded into the cache). Hold it in a ref so hydration is driven only
	// by `projects` and isn't cancelled mid-flight after each project loads.
	const fetchRef = useRef(fetchProjectSessions);
	fetchRef.current = fetchProjectSessions;

	useEffect(() => {
		let cancelled = false;
		// Reset progress tracking so counts stay consistent if the project list
		// changes identity (e.g. the poller returns an updated set).
		requestedRef.current = new Set();
		setHydratedKeys(new Set());
		// Newest projects first so the top of the list fills in immediately.
		const ordered = [...projects].sort((a, b) => {
			const am = a.latestModified ? Date.parse(a.latestModified) : 0;
			const bm = b.latestModified ? Date.parse(b.latestModified) : 0;
			return bm - am;
		});

		async function hydrate() {
			let cursor = 0;
			async function worker() {
				while (!cancelled && cursor < ordered.length) {
					const project = ordered[cursor++];
					const key = projectKey(project.peerId, project.dirName);
					if (requestedRef.current.has(key)) continue;
					requestedRef.current.add(key);
					try {
						await fetchRef.current(project.peerId, project.dirName);
					} catch {
						// Individual project failures are non-fatal; skip.
					}
					if (!cancelled) {
						setHydratedKeys((prev) => {
							const next = new Set(prev);
							next.add(key);
							return next;
						});
					}
				}
			}
			await Promise.all(
				Array.from({ length: HYDRATION_CONCURRENCY }, () => worker()),
			);
		}

		hydrate();
		return () => {
			cancelled = true;
		};
	}, [projects]);

	const { items, dirNameBySession } = useMemo(() => {
		const all: HistorySession[] = [];
		const dirNames = new Map<string, string>();
		const seen = new Set<string>();
		for (const [mapKey, list] of sessionsByProject.entries()) {
			// mapKey is `${peerId}::${dirName}` (see projectKey).
			const dirName = mapKey.split("::")[1] ?? "";
			for (const s of list) {
				// A session can appear under multiple project buckets (e.g. symlinked
				// dirs). Keep whichever occurrence arrives first during hydration; the
				// sort below orders by modified date regardless.
				const dedupeKey = sessionDedupeKey(s);
				if (seen.has(dedupeKey)) continue;
				seen.add(dedupeKey);
				if (dirName) dirNames.set(dedupeKey, dirName);
				all.push(s);
			}
		}
		all.sort(
			(a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
		);
		return { items: all, dirNameBySession: dirNames };
	}, [sessionsByProject]);

	return {
		items,
		dirNameBySession,
		hydratedCount: hydratedKeys.size,
		totalCount: projects.length,
		isHydrating: projects.length > 0 && hydratedKeys.size < projects.length,
	};
}
