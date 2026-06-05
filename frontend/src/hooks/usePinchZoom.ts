import { type RefObject, useEffect, useRef } from "react";

function getTouchDistance(touches: TouchList): number {
	if (touches.length < 2) return 0;
	const dx = touches[0].clientX - touches[1].clientX;
	const dy = touches[0].clientY - touches[1].clientY;
	return Math.sqrt(dx * dx + dy * dy);
}

interface UsePinchZoomOptions {
	/** Element to attach the pinch listeners to. */
	ref: RefObject<HTMLElement | null>;
	/** Current font size; read at the start of each pinch gesture. */
	value: number;
	min: number;
	max: number;
	/** Called on every pinch move with the new clamped size (transient). */
	onChange: (size: number) => void;
	/** Called once when the pinch ends with the final size (persist here). */
	onCommit: (size: number) => void;
}

/**
 * Two-finger pinch-to-zoom over font size. Listeners are bound once for the
 * element's lifetime — the latest value/callbacks are read via refs so changing
 * the font size does not re-bind the touch handlers.
 */
export function usePinchZoom({
	ref,
	value,
	min,
	max,
	onChange,
	onCommit,
}: UsePinchZoomOptions): void {
	const valueRef = useRef(value);
	valueRef.current = value;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const onCommitRef = useRef(onCommit);
	onCommitRef.current = onCommit;

	useEffect(() => {
		const container = ref.current;
		if (!container) return;

		const pinch = { active: false, initialDistance: 0, initialFontSize: 0 };
		let lastSize = valueRef.current;

		const handleTouchStart = (e: TouchEvent) => {
			if (e.touches.length === 2) {
				e.preventDefault();
				pinch.active = true;
				pinch.initialDistance = getTouchDistance(e.touches);
				pinch.initialFontSize = valueRef.current;
				lastSize = valueRef.current;
			}
		};

		const handleTouchMove = (e: TouchEvent) => {
			if (e.touches.length === 2 && pinch.active && pinch.initialDistance > 0) {
				e.preventDefault();
				const currentDistance = getTouchDistance(e.touches);
				const scale = currentDistance / pinch.initialDistance;
				const newSize = Math.round(pinch.initialFontSize * scale);
				const clamped = Math.max(min, Math.min(max, newSize));
				lastSize = clamped;
				onChangeRef.current(clamped);
			}
		};

		const handleTouchEnd = (e: TouchEvent) => {
			if (pinch.active && e.touches.length < 2) {
				pinch.active = false;
				onCommitRef.current(lastSize);
			}
		};

		container.addEventListener("touchstart", handleTouchStart, {
			passive: false,
		});
		container.addEventListener("touchmove", handleTouchMove, {
			passive: false,
		});
		container.addEventListener("touchend", handleTouchEnd);

		return () => {
			container.removeEventListener("touchstart", handleTouchStart);
			container.removeEventListener("touchmove", handleTouchMove);
			container.removeEventListener("touchend", handleTouchEnd);
		};
	}, [ref, min, max]);
}
