import { useCallback, useMemo, useState } from "react";

interface LineSelection {
	start: number;
	end: number;
}

interface UseLineSelectionReturn {
	selection: LineSelection | null;
	handleLineClick: (lineNum: number) => void;
	isLineSelected: (lineNum: number) => boolean;
	clearSelection: () => void;
}

export function useLineSelection(): UseLineSelectionReturn {
	const [first, setFirst] = useState<number | null>(null);
	const [second, setSecond] = useState<number | null>(null);

	const selection = useMemo<LineSelection | null>(() => {
		if (first === null) return null;
		if (second === null) return { start: first, end: first };
		return { start: Math.min(first, second), end: Math.max(first, second) };
	}, [first, second]);

	const handleLineClick = useCallback(
		(lineNum: number) => {
			if (first === null) {
				// First click: set start
				setFirst(lineNum);
				setSecond(null);
			} else if (second === null && lineNum !== first) {
				// Second click: set end (range)
				setSecond(lineNum);
			} else {
				// Third click or same line: reset and start new
				setFirst(lineNum);
				setSecond(null);
			}
		},
		[first, second],
	);

	const isLineSelected = useCallback(
		(lineNum: number) => {
			if (!selection) return false;
			return lineNum >= selection.start && lineNum <= selection.end;
		},
		[selection],
	);

	const clearSelection = useCallback(() => {
		setFirst(null);
		setSecond(null);
	}, []);

	return { selection, handleLineClick, isLineSelected, clearSelection };
}
