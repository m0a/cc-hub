import { describe, expect, test } from "bun:test";
import type { UsageSnapshot } from "../../../../shared/types";
import {
	CYCLE_DROP_TOLERANCE,
	filterToCurrentCycle,
} from "../../../../shared/usage-cycle";

const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

function snap(
	timestamp: string,
	sevenDayUtil: number,
	fiveHourUtil = 0,
): UsageSnapshot {
	return {
		timestamp,
		fiveHour: { utilization: fiveHourUtil, resetsAt: "2026-05-30T06:00:00Z" },
		sevenDay: { utilization: sevenDayUtil, resetsAt: "2026-05-30T06:00:00Z" },
	};
}

const NOW = new Date("2026-05-30T05:11:00Z").getTime();
const CYCLE_START = NOW - SEVEN_DAY_MS;

describe("filterToCurrentCycle", () => {
	test("empty input → empty output", () => {
		expect(filterToCurrentCycle([], "sevenDay", CYCLE_START, NOW)).toEqual([]);
	});

	test("monotonic sequence → unchanged", () => {
		const xs = [
			snap("2026-05-29T12:00:00Z", 7),
			snap("2026-05-29T18:00:00Z", 8),
			snap("2026-05-30T00:00:00Z", 10),
			snap("2026-05-30T05:00:00Z", 13),
		];
		expect(filterToCurrentCycle(xs, "sevenDay", CYCLE_START, NOW)).toEqual(xs);
	});

	test("real-data shape (18,18,18,18,7,7,8,9) → only post-drop segment", () => {
		const xs = [
			snap("2026-05-26T08:37:00Z", 18),
			snap("2026-05-26T08:45:00Z", 18),
			snap("2026-05-26T08:55:00Z", 18),
			snap("2026-05-26T09:03:00Z", 18),
			snap("2026-05-29T12:34:00Z", 7), // cycle boundary
			snap("2026-05-29T13:00:00Z", 7),
			snap("2026-05-30T00:00:00Z", 8),
			snap("2026-05-30T05:00:00Z", 9),
		];
		const out = filterToCurrentCycle(xs, "sevenDay", CYCLE_START, NOW);
		expect(out.length).toBe(4);
		expect(out[0].sevenDay.utilization).toBe(7);
		expect(out[out.length - 1].sevenDay.utilization).toBe(9);
	});

	test("two drops → only segment after the LAST drop", () => {
		const xs = [
			snap("2026-05-22T10:00:00Z", 15),
			snap("2026-05-25T10:00:00Z", 4), // first drop
			snap("2026-05-26T10:00:00Z", 12),
			snap("2026-05-29T10:00:00Z", 3), // last drop (more recent)
			snap("2026-05-30T05:00:00Z", 5),
		];
		const out = filterToCurrentCycle(xs, "sevenDay", CYCLE_START, NOW);
		expect(out.length).toBe(2);
		expect(out[0].sevenDay.utilization).toBe(3);
		expect(out[1].sevenDay.utilization).toBe(5);
	});

	test(`drop within tolerance (${CYCLE_DROP_TOLERANCE} pts) is NOT treated as boundary`, () => {
		const xs = [
			snap("2026-05-29T12:00:00Z", 10),
			snap("2026-05-29T18:00:00Z", 9), // -1, within tolerance
			snap("2026-05-30T00:00:00Z", 11),
		];
		const out = filterToCurrentCycle(xs, "sevenDay", CYCLE_START, NOW);
		expect(out.length).toBe(3);
	});

	test("drop exactly at tolerance is NOT a boundary; one past tolerance IS", () => {
		const justInTolerance = [
			snap("2026-05-29T12:00:00Z", 10),
			snap("2026-05-29T18:00:00Z", 10 - CYCLE_DROP_TOLERANCE),
		];
		expect(
			filterToCurrentCycle(justInTolerance, "sevenDay", CYCLE_START, NOW)
				.length,
		).toBe(2);

		const pastTolerance = [
			snap("2026-05-29T12:00:00Z", 10),
			snap("2026-05-29T18:00:00Z", 10 - CYCLE_DROP_TOLERANCE - 1),
		];
		expect(
			filterToCurrentCycle(pastTolerance, "sevenDay", CYCLE_START, NOW).length,
		).toBe(1);
	});

	test("snapshots outside [cycleStart, now] are dropped", () => {
		const xs = [
			snap("2026-05-20T00:00:00Z", 5), // before cycleStart
			snap("2026-05-25T00:00:00Z", 7),
			snap("2026-06-30T00:00:00Z", 100), // after now
		];
		const out = filterToCurrentCycle(xs, "sevenDay", CYCLE_START, NOW);
		expect(out.length).toBe(1);
		expect(out[0].sevenDay.utilization).toBe(7);
	});

	test("unsorted input is sorted before drop detection", () => {
		const xs = [
			snap("2026-05-30T00:00:00Z", 8),
			snap("2026-05-29T12:34:00Z", 7),
			snap("2026-05-26T08:37:00Z", 18),
			snap("2026-05-30T05:00:00Z", 9),
		];
		const out = filterToCurrentCycle(xs, "sevenDay", CYCLE_START, NOW);
		expect(out.map((s) => s.sevenDay.utilization)).toEqual([7, 8, 9]);
	});

	test("5h chart with 0→0→0→N pattern is NOT treated as a drop", () => {
		const fiveHourCycleStart = NOW - 5 * 60 * 60 * 1000;
		const xs = [
			snap("2026-05-30T00:15:00Z", 18, 0),
			snap("2026-05-30T00:45:00Z", 18, 0),
			snap("2026-05-30T01:15:00Z", 18, 0),
			snap("2026-05-30T01:45:00Z", 18, 2),
			snap("2026-05-30T02:15:00Z", 18, 5),
		];
		const out = filterToCurrentCycle(
			xs,
			"fiveHour",
			fiveHourCycleStart,
			NOW,
		);
		expect(out.length).toBe(5);
	});

	test("all-old-cycle data: returns just the last point as the surviving segment", () => {
		const xs = [
			snap("2026-05-26T08:37:00Z", 50),
			snap("2026-05-26T09:03:00Z", 50),
			snap("2026-05-26T09:10:00Z", 1),
		];
		const out = filterToCurrentCycle(xs, "sevenDay", CYCLE_START, NOW);
		expect(out.length).toBe(1);
		expect(out[0].sevenDay.utilization).toBe(1);
	});
});
