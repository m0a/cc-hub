import type { HistorySession } from "../../../shared/types";

type TFunction = (key: string, options?: Record<string, unknown>) => string;

export type HistoryPeriod = "24h" | "7d" | "30d" | null;

/** Sentinel value for sessions with no git branch. */
export const UNKNOWN_BRANCH = "__unknown__";
const LOCAL_PEER = "local";

export interface FacetState {
	projects: Set<string>;
	agents: Set<string>;
	branches: Set<string>;
	peers: Set<string>;
	period: HistoryPeriod;
}

export function emptyFacetState(): FacetState {
	return {
		projects: new Set(),
		agents: new Set(),
		branches: new Set(),
		peers: new Set(),
		period: null,
	};
}

export function isFacetActive(s: FacetState): boolean {
	return (
		s.projects.size > 0 ||
		s.agents.size > 0 ||
		s.branches.size > 0 ||
		s.peers.size > 0 ||
		s.period !== null
	);
}

const PERIOD_MS: Record<NonNullable<HistoryPeriod>, number> = {
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	"30d": 30 * 24 * 60 * 60 * 1000,
};

function agentOf(s: HistorySession): string {
	return s.agent ?? "claude";
}
function branchOf(s: HistorySession): string {
	return s.gitBranch || UNKNOWN_BRANCH;
}
function peerOf(s: HistorySession): string {
	return s.peerId ?? LOCAL_PEER;
}

/**
 * Filter sessions by the facet selection. Within an axis values are OR'd; across
 * axes they're AND'd. `now` is injected for testability.
 */
export function applyFacets(
	items: HistorySession[],
	s: FacetState,
	now: number,
): HistorySession[] {
	if (!isFacetActive(s)) return items;
	return items.filter((it) => {
		if (s.projects.size && !s.projects.has(it.projectName)) return false;
		if (s.agents.size && !s.agents.has(agentOf(it))) return false;
		if (s.branches.size && !s.branches.has(branchOf(it))) return false;
		if (s.peers.size && !s.peers.has(peerOf(it))) return false;
		if (s.period) {
			const ts = new Date(it.modified).getTime();
			// Exclude unparseable dates from time-bounded views rather than letting
			// them slip through.
			if (Number.isNaN(ts) || now - ts > PERIOD_MS[s.period]) return false;
		}
		return true;
	});
}

export interface FacetValue {
	value: string;
	label: string;
	count: number;
	color?: string;
}

export interface FacetData {
	projects: FacetValue[];
	agents: FacetValue[];
	branches: FacetValue[];
	/** Empty unless more than one peer is present. */
	peers: FacetValue[];
}

function tally(
	items: HistorySession[],
	keyOf: (s: HistorySession) => string,
): Map<string, number> {
	const m = new Map<string, number>();
	for (const it of items) {
		const k = keyOf(it);
		m.set(k, (m.get(k) ?? 0) + 1);
	}
	return m;
}

function sortedValues(
	counts: Map<string, number>,
	label: (value: string) => string,
	color?: (value: string) => string | undefined,
): FacetValue[] {
	return [...counts.entries()]
		.map(([value, count]) => ({
			value,
			count,
			label: label(value),
			color: color?.(value),
		}))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Strip the leading `~/` so the sidebar shows a clean project name. */
function projectLabel(projectName: string): string {
	return projectName.replace(/^~\//, "");
}

/**
 * Build the facet value lists (with total counts) for the sidebar. Counts are
 * totals across the loaded set (not disjunctive) — simple and stable.
 */
export function computeFacetData(
	items: HistorySession[],
	t: TFunction,
): FacetData {
	const peerNick = new Map<string, string>();
	const peerColor = new Map<string, string>();
	for (const it of items) {
		const p = peerOf(it);
		if (it.peerNickname) peerNick.set(p, it.peerNickname);
		if (it.peerColor) peerColor.set(p, it.peerColor);
	}

	const peerCounts = tally(items, peerOf);
	const peers =
		peerCounts.size > 1
			? sortedValues(
					peerCounts,
					(v) => peerNick.get(v) ?? (v === LOCAL_PEER ? "local" : v),
					(v) => peerColor.get(v),
				)
			: [];

	return {
		projects: sortedValues(tally(items, (s) => s.projectName), projectLabel),
		agents: sortedValues(tally(items, agentOf), (v) =>
			v === "codex" ? "Codex" : "Claude",
		),
		branches: sortedValues(tally(items, branchOf), (v) =>
			v === UNKNOWN_BRANCH ? t("history.facetBranchUnknown") : v,
		),
		peers,
	};
}

export interface ActiveChip {
	axis: keyof Omit<FacetState, "period"> | "period";
	value: string;
	label: string;
}

/** Flatten the active selection into chips for the top bar. */
export function activeChips(
	s: FacetState,
	data: FacetData,
	t: TFunction,
): ActiveChip[] {
	const chips: ActiveChip[] = [];
	const labelFrom = (vals: FacetValue[], v: string) =>
		vals.find((x) => x.value === v)?.label ?? v;
	for (const v of s.projects)
		chips.push({ axis: "projects", value: v, label: projectLabel(v) });
	for (const v of s.agents)
		chips.push({ axis: "agents", value: v, label: labelFrom(data.agents, v) });
	for (const v of s.branches)
		chips.push({
			axis: "branches",
			value: v,
			// Translate the unknown sentinel even if it's no longer in the data
			// (e.g. the only unbranched session was evicted while selected).
			label:
				v === UNKNOWN_BRANCH
					? t("history.facetBranchUnknown")
					: labelFrom(data.branches, v),
		});
	for (const v of s.peers)
		chips.push({ axis: "peers", value: v, label: labelFrom(data.peers, v) });
	if (s.period)
		chips.push({
			axis: "period",
			value: s.period,
			label: t(
				s.period === "24h"
					? "history.periodToday"
					: s.period === "7d"
						? "history.period7d"
						: "history.period30d",
			),
		});
	return chips;
}

/** Toggle a value in a multi-select facet axis, returning a new state. */
export function toggleFacet(
	s: FacetState,
	axis: keyof Omit<FacetState, "period">,
	value: string,
): FacetState {
	const next = new Set(s[axis]);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	return { ...s, [axis]: next };
}
