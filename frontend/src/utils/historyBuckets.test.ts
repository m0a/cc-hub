import { describe, expect, test } from "bun:test";
import type { HistorySession } from "../../../shared/types";
import {
	applyHistoryFilter,
	bucketizeHistory,
	EMPTY_HISTORY_FILTER,
	isFilterActive,
} from "./historyBuckets";

const NOW = new Date("2026-05-30T12:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function snap(
	id: string,
	modifiedMs: number,
	agent: "claude" | "codex" = "claude",
): HistorySession {
	return {
		sessionId: id,
		projectPath: `/home/m0a/${id}`,
		projectName: `~/${id}`,
		modified: new Date(modifiedMs).toISOString(),
		agent,
	};
}

const keyOf = (s: HistorySession) => `local:${s.sessionId}`;
const t = (k: string) => k;

describe("isFilterActive", () => {
	test("empty filter is inactive", () => {
		expect(isFilterActive(EMPTY_HISTORY_FILTER)).toBe(false);
	});
	test("any axis set makes it active", () => {
		expect(isFilterActive({ ...EMPTY_HISTORY_FILTER, agent: "codex" })).toBe(
			true,
		);
		expect(isFilterActive({ ...EMPTY_HISTORY_FILTER, period: "7d" })).toBe(true);
		expect(isFilterActive({ ...EMPTY_HISTORY_FILTER, activeOnly: true })).toBe(
			true,
		);
	});
});

describe("applyHistoryFilter", () => {
	const items = [
		snap("a", NOW - HOUR, "claude"),
		snap("b", NOW - 2 * DAY, "codex"),
		snap("c", NOW - 10 * DAY, "claude"),
	];

	test("no filter returns all", () => {
		expect(
			applyHistoryFilter(items, EMPTY_HISTORY_FILTER, new Set(), NOW),
		).toHaveLength(3);
	});

	test("agent filter", () => {
		const out = applyHistoryFilter(
			items,
			{ ...EMPTY_HISTORY_FILTER, agent: "codex" },
			new Set(),
			NOW,
		);
		expect(out.map((s) => s.sessionId)).toEqual(["b"]);
	});

	test("period 24h keeps only the last day", () => {
		const out = applyHistoryFilter(
			items,
			{ ...EMPTY_HISTORY_FILTER, period: "24h" },
			new Set(),
			NOW,
		);
		expect(out.map((s) => s.sessionId)).toEqual(["a"]);
	});

	test("activeOnly keeps only sessions in the active set", () => {
		const out = applyHistoryFilter(
			items,
			{ ...EMPTY_HISTORY_FILTER, activeOnly: true },
			new Set(["c"]),
			NOW,
		);
		expect(out.map((s) => s.sessionId)).toEqual(["c"]);
	});

	test("filters compose (AND)", () => {
		const out = applyHistoryFilter(
			[snap("x", NOW - HOUR, "claude"), snap("y", NOW - HOUR, "codex")],
			{ agent: "claude", period: "24h", activeOnly: false },
			new Set(),
			NOW,
		);
		expect(out.map((s) => s.sessionId)).toEqual(["x"]);
	});
});

describe("bucketizeHistory", () => {
	test("groups into date buckets with headers and counts", () => {
		const items = [
			snap("today1", NOW - HOUR),
			snap("today2", NOW - 2 * HOUR),
			snap("yest", NOW - 28 * HOUR),
			snap("week", NOW - 4 * DAY),
			snap("old", NOW - 20 * DAY),
		];
		const rows = bucketizeHistory(items, undefined, keyOf, t, NOW);
		const headers = rows.filter((r) => r.kind === "header");
		expect(headers.map((h) => (h.kind === "header" ? h.label : ""))).toEqual([
			"history.bucketToday",
			"history.bucketYesterday",
			"history.bucketThisWeek",
			"history.bucketEarlier",
		]);
		const todayHeader = headers[0];
		expect(todayHeader.kind === "header" && todayHeader.count).toBe(2);
		// 4 headers + 5 sessions
		expect(rows).toHaveLength(9);
	});

	test("attaches dirName from the lookup map", () => {
		const items = [snap("s1", NOW - HOUR)];
		const dirMap = new Map([["local:s1", "-home-m0a-proj"]]);
		const rows = bucketizeHistory(items, dirMap, keyOf, t, NOW);
		const sessionRow = rows.find((r) => r.kind === "session");
		expect(sessionRow?.kind === "session" && sessionRow.dirName).toBe(
			"-home-m0a-proj",
		);
	});

	test("empty input yields no rows", () => {
		expect(bucketizeHistory([], undefined, keyOf, t, NOW)).toHaveLength(0);
	});

	test("out-of-order input still yields one header per bucket in canonical order", () => {
		// Simulates SSE search results: not globally date-sorted.
		const items = [
			snap("old", NOW - 20 * DAY),
			snap("today1", NOW - HOUR),
			snap("yest", NOW - 28 * HOUR),
			snap("today2", NOW - 2 * HOUR),
		];
		const rows = bucketizeHistory(items, undefined, keyOf, t, NOW);
		const headers = rows.filter((r) => r.kind === "header");
		// Exactly one header per non-empty bucket, in canonical order.
		expect(headers.map((h) => (h.kind === "header" ? h.label : ""))).toEqual([
			"history.bucketToday",
			"history.bucketYesterday",
			"history.bucketEarlier",
		]);
		// No duplicate row keys (would break React + virtualizer).
		const keys = rows.map((r) => r.key);
		expect(new Set(keys).size).toBe(keys.length);
		// Today bucket groups both today sessions.
		const todayHeader = headers[0];
		expect(todayHeader.kind === "header" && todayHeader.count).toBe(2);
	});
});
