import type { UsageSnapshot } from "./types";

/**
 * Anthropic's API reports the same `resetsAt` on all snapshots after a cycle
 * rolls over, so we can't use resetsAt to attribute a snapshot to its origin
 * cycle. The only signal is a drop in utilization larger than rounding noise:
 * a cycle reset is the only mechanism that can cause cumulative utilization
 * to decrease.
 */
export const CYCLE_DROP_TOLERANCE = 2;

/**
 * Return snapshots that belong to the cycle currently in progress.
 *
 * Walks the timestamp-sorted snapshots backwards, finds the LAST index where
 * utilization drops by more than CYCLE_DROP_TOLERANCE versus its predecessor,
 * and returns everything from that index onward. If no drop is found, returns
 * all snapshots in the window.
 *
 * The window itself is `[cycleStart, now]` — anything outside is discarded.
 */
export function filterToCurrentCycle(
	snapshots: UsageSnapshot[],
	field: "fiveHour" | "sevenDay",
	cycleStart: number,
	now: number,
): UsageSnapshot[] {
	const inWindow = snapshots
		.filter((s) => {
			const ts = new Date(s.timestamp).getTime();
			return ts >= cycleStart && ts <= now;
		})
		.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

	let cycleStartIdx = 0;
	for (let i = inWindow.length - 1; i >= 1; i--) {
		const curr = inWindow[i][field].utilization;
		const prev = inWindow[i - 1][field].utilization;
		if (curr + CYCLE_DROP_TOLERANCE < prev) {
			cycleStartIdx = i;
			break;
		}
	}

	return inWindow.slice(cycleStartIdx);
}
