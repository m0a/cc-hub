import { useCallback, useEffect, useRef } from "react";
import type { FileChange } from "../../../shared/types";

export type ViewMode = "browser" | "file" | "changes" | "diff";
export type ListMode = "browser" | "changes";

export interface SelectedGitDiff {
	path: string;
	diff: string;
}

export interface ViewHistoryState {
	viewMode: ViewMode;
	listMode: ListMode;
	selectedChange: FileChange | null;
	selectedGitDiff: SelectedGitDiff | null;
}

interface UseViewHistoryOptions {
	/** Restore a prior view when the user navigates back. */
	onRestore: (state: ViewHistoryState) => void;
	/** Close the viewer when there is no history left to pop. */
	onClose: () => void;
}

/**
 * Back-navigation for the file viewer: an in-memory view stack synced with
 * `window.history` so the browser/OS back gesture, the in-app back button, and
 * Escape all step backward through views (and finally close the viewer).
 *
 * The stack lives in a ref to survive React strict-mode double-invocation and
 * re-renders; callbacks are read via refs so listeners bind once for the
 * component's lifetime.
 */
export function useViewHistory({ onRestore, onClose }: UseViewHistoryOptions) {
	const historyRef = useRef<ViewHistoryState[]>([]);

	const onRestoreRef = useRef(onRestore);
	onRestoreRef.current = onRestore;
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	const pushToHistory = useCallback((state: ViewHistoryState) => {
		historyRef.current.push(state);
		window.history.pushState({ fileViewer: true }, "", window.location.href);
	}, []);

	const handleBack = useCallback(() => {
		if (historyRef.current.length === 0) {
			onCloseRef.current();
			return;
		}
		window.history.back();
	}, []);

	// Browser back gesture / back button. Capture phase so this runs BEFORE
	// App.tsx's bubble-phase handler.
	useEffect(() => {
		const handlePopState = (e: PopStateEvent) => {
			const prev = historyRef.current.pop();
			e.stopImmediatePropagation();
			if (prev) {
				onRestoreRef.current(prev);
			} else {
				onCloseRef.current();
			}
		};

		window.addEventListener("popstate", handlePopState, true);
		return () => window.removeEventListener("popstate", handlePopState, true);
	}, []);

	// Escape always goes back.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				handleBack();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleBack]);

	// Cleanup remaining history entries on unmount (e.g. close button).
	useEffect(() => {
		return () => {
			const remaining = historyRef.current.length;
			historyRef.current = [];
			if (remaining > 0) {
				window.history.go(-remaining);
			}
		};
	}, []);

	return { pushToHistory, handleBack };
}
