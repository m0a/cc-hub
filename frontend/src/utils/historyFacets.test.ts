import { describe, expect, test } from "bun:test";
import type { HistorySession } from "../../../shared/types";
import {
	activeChips,
	applyFacets,
	computeFacetData,
	emptyFacetState,
	isFacetActive,
	toggleFacet,
	UNKNOWN_BRANCH,
} from "./historyFacets";

const NOW = new Date("2026-05-30T12:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const t = (k: string) => k;

function snap(
	id: string,
	opts: Partial<HistorySession> & { modifiedMs?: number } = {},
): HistorySession {
	const { modifiedMs = NOW - HOUR, ...rest } = opts;
	return {
		sessionId: id,
		projectPath: `/home/m0a/${id}`,
		projectName: rest.projectName ?? `~/${id}`,
		modified: new Date(modifiedMs).toISOString(),
		agent: rest.agent ?? "claude",
		...rest,
	};
}

describe("applyFacets", () => {
	const items = [
		snap("a", { projectName: "~/p1", agent: "claude", gitBranch: "main" }),
		snap("b", { projectName: "~/p2", agent: "codex", gitBranch: "feat/x" }),
		snap("c", { projectName: "~/p1", agent: "claude" }), // no branch
		snap("d", { projectName: "~/p2", agent: "claude", modifiedMs: NOW - 10 * DAY }),
	];

	test("empty state returns all", () => {
		expect(applyFacets(items, emptyFacetState(), NOW)).toHaveLength(4);
	});

	test("project facet (OR within axis)", () => {
		const s = { ...emptyFacetState(), projects: new Set(["~/p1"]) };
		expect(applyFacets(items, s, NOW).map((x) => x.sessionId)).toEqual(["a", "c"]);
	});

	test("agent + project compose (AND across axes)", () => {
		const s = {
			...emptyFacetState(),
			projects: new Set(["~/p2"]),
			agents: new Set(["claude"]),
		};
		expect(applyFacets(items, s, NOW).map((x) => x.sessionId)).toEqual(["d"]);
	});

	test("branch facet incl. unknown sentinel", () => {
		const s = { ...emptyFacetState(), branches: new Set([UNKNOWN_BRANCH]) };
		// both c and d have no gitBranch
		expect(applyFacets(items, s, NOW).map((x) => x.sessionId)).toEqual(["c", "d"]);
	});

	test("period filter", () => {
		const s = { ...emptyFacetState(), period: "7d" as const };
		expect(applyFacets(items, s, NOW).map((x) => x.sessionId)).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	test("period filter excludes sessions with an unparseable date", () => {
		const bad: HistorySession = {
			sessionId: "z",
			projectPath: "/home/m0a/z",
			projectName: "~/z",
			modified: "",
		};
		const s = { ...emptyFacetState(), period: "24h" as const };
		expect(applyFacets([bad], s, NOW)).toHaveLength(0);
	});
});

describe("computeFacetData", () => {
	test("tallies values with counts, sorted desc", () => {
		const items = [
			snap("a", { projectName: "~/p1", agent: "claude" }),
			snap("b", { projectName: "~/p1", agent: "codex" }),
			snap("c", { projectName: "~/p2", agent: "claude" }),
		];
		const data = computeFacetData(items, t);
		expect(data.projects[0]).toMatchObject({ label: "p1", count: 2 });
		expect(data.agents.find((v) => v.value === "claude")?.count).toBe(2);
		// single peer → peers facet empty
		expect(data.peers).toHaveLength(0);
	});

	test("peers facet appears only with multiple peers", () => {
		const items = [
			snap("a", { peerId: "local" }),
			snap("b", { peerId: "mac", peerNickname: "m0a-mac" }),
		];
		const data = computeFacetData(items, t);
		expect(data.peers.length).toBe(2);
		expect(data.peers.find((v) => v.value === "mac")?.label).toBe("m0a-mac");
	});
});

describe("toggleFacet / isFacetActive / activeChips", () => {
	test("toggle adds then removes", () => {
		let s = emptyFacetState();
		s = toggleFacet(s, "agents", "codex");
		expect(s.agents.has("codex")).toBe(true);
		expect(isFacetActive(s)).toBe(true);
		s = toggleFacet(s, "agents", "codex");
		expect(s.agents.has("codex")).toBe(false);
		expect(isFacetActive(s)).toBe(false);
	});

	test("activeChips reflects selection across axes", () => {
		const data = computeFacetData([snap("a", { agent: "codex" })], t);
		const s = {
			...emptyFacetState(),
			agents: new Set(["codex"]),
			period: "24h" as const,
		};
		const chips = activeChips(s, data, t);
		expect(chips.map((c) => c.axis).sort()).toEqual(["agents", "period"]);
	});
});
