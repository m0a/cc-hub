import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type FacetData,
	type FacetState,
	type FacetValue,
	type HistoryPeriod,
	toggleFacet,
} from "../../utils/historyFacets";

interface HistoryFacetSidebarProps {
	data: FacetData;
	state: FacetState;
	onChange: (next: FacetState) => void;
}

const VISIBLE_CAP = 6;

function CheckRow({
	checked,
	label,
	count,
	color,
	onToggle,
}: {
	checked: boolean;
	label: string;
	count: number;
	color?: string;
	onToggle: () => void;
}) {
	return (
		<label className="flex items-center justify-between gap-2 py-1 cursor-pointer group">
			<span className="flex items-center gap-2 min-w-0">
				<input
					type="checkbox"
					checked={checked}
					onChange={onToggle}
					className="w-3.5 h-3.5 accent-blue-500 shrink-0"
				/>
				{color && (
					<span
						className="w-1.5 h-1.5 rounded-full shrink-0"
						style={{ backgroundColor: color }}
					/>
				)}
				<span
					className={`truncate text-[12.5px] ${checked ? "text-zinc-100" : "text-zinc-400 group-hover:text-zinc-300"}`}
				>
					{label}
				</span>
			</span>
			<span className="text-[11px] text-zinc-600 tabular-nums shrink-0">
				{count}
			</span>
		</label>
	);
}

function MultiGroup({
	title,
	values,
	selected,
	onToggle,
}: {
	title: string;
	values: FacetValue[];
	selected: Set<string>;
	onToggle: (value: string) => void;
}) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);
	if (values.length === 0) return null;
	const shown = expanded ? values : values.slice(0, VISIBLE_CAP);
	return (
		<div className="mb-4">
			<div className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">
				{title}
			</div>
			{shown.map((v) => (
				<CheckRow
					key={v.value}
					checked={selected.has(v.value)}
					label={v.label}
					count={v.count}
					color={v.color}
					onToggle={() => onToggle(v.value)}
				/>
			))}
			{values.length > VISIBLE_CAP && (
				<button
					type="button"
					onClick={() => setExpanded((e) => !e)}
					className="mt-0.5 text-[11px] text-zinc-500 hover:text-zinc-300"
				>
					{expanded
						? t("common.showLess")
						: t("history.facetMore", { count: values.length - VISIBLE_CAP })}
				</button>
			)}
		</div>
	);
}

/**
 * Faceted filter sidebar (desktop left rail / drawer body). Project / Agent /
 * Branch / Peer are multi-select; Period is single-select. Counts are totals
 * across the loaded set.
 */
export function HistoryFacetSidebar({
	data,
	state,
	onChange,
}: HistoryFacetSidebarProps) {
	const { t } = useTranslation();

	const periods: { value: HistoryPeriod; label: string }[] = [
		{ value: "24h", label: t("history.periodToday") },
		{ value: "7d", label: t("history.period7d") },
		{ value: "30d", label: t("history.period30d") },
		{ value: null, label: t("history.periodAll") },
	];

	return (
		<div className="text-[12.5px]">
			<MultiGroup
				title={t("history.facetProject")}
				values={data.projects}
				selected={state.projects}
				onToggle={(v) => onChange(toggleFacet(state, "projects", v))}
			/>
			<MultiGroup
				title={t("history.facetAgent")}
				values={data.agents}
				selected={state.agents}
				onToggle={(v) => onChange(toggleFacet(state, "agents", v))}
			/>
			<MultiGroup
				title={t("history.facetBranch")}
				values={data.branches}
				selected={state.branches}
				onToggle={(v) => onChange(toggleFacet(state, "branches", v))}
			/>
			{data.peers.length > 0 && (
				<MultiGroup
					title={t("history.facetPeer")}
					values={data.peers}
					selected={state.peers}
					onToggle={(v) => onChange(toggleFacet(state, "peers", v))}
				/>
			)}
			<div className="mb-2">
				<div className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">
					{t("history.facetPeriod")}
				</div>
				{periods.map((p) => (
					<label
						key={p.value ?? "all"}
						className="flex items-center gap-2 py-1 cursor-pointer group"
					>
						<input
							type="radio"
							name="history-period"
							checked={state.period === p.value}
							onChange={() => onChange({ ...state, period: p.value })}
							className="w-3.5 h-3.5 accent-blue-500 shrink-0"
						/>
						<span
							className={`text-[12.5px] ${state.period === p.value ? "text-zinc-100" : "text-zinc-400 group-hover:text-zinc-300"}`}
						>
							{p.label}
						</span>
					</label>
				))}
			</div>
		</div>
	);
}
