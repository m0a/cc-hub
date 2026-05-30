import { describe, expect, test } from "bun:test";
import type { HistorySession } from "../../../shared/types";
import { bucketizeHistory } from "./historyBuckets";

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
