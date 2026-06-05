import { type RefObject, useEffect, useRef } from "react";

interface UseScrollRatioOptions {
	/** Scrollable element to observe. */
	ref: RefObject<HTMLElement | null>;
	/** Scroll position to restore once on mount, as a 0..1 ratio. */
	initialRatio?: number;
	/** Notified with the current scroll ratio whenever the user scrolls. */
	onChange?: (ratio: number) => void;
}

/**
 * Restores a viewer's scroll position from a ratio on mount and reports the
 * scroll ratio back to the parent as the user scrolls.
 */
export function useScrollRatio({
	ref,
	initialRatio = 0,
	onChange,
}: UseScrollRatioOptions): void {
	// Restore scroll position from ratio on mount (once).
	const restoredRef = useRef(false);
	useEffect(() => {
		if (restoredRef.current) return;
		restoredRef.current = true;
		const el = ref.current;
		if (initialRatio > 0 && el) {
			requestAnimationFrame(() => {
				el.scrollTop = initialRatio * (el.scrollHeight - el.clientHeight);
			});
		}
	}, [ref, initialRatio]);

	// Track scroll ratio for the parent. Keep the callback in a ref so the
	// listener stays bound even when the parent passes a fresh function each render.
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const handleScroll = () => {
			const maxScroll = el.scrollHeight - el.clientHeight;
			onChangeRef.current?.(maxScroll > 0 ? el.scrollTop / maxScroll : 0);
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => el.removeEventListener("scroll", handleScroll);
	}, [ref]);
}
