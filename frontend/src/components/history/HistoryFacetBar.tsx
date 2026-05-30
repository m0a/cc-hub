import { useTranslation } from "react-i18next";
import type {
	HistoryAgentFilter,
	HistoryFilter,
	HistoryPeriodFilter,
} from "../../utils/historyBuckets";

interface HistoryFacetBarProps {
	filter: HistoryFilter;
	onChange: (next: HistoryFilter) => void;
}

interface ChipProps {
	active: boolean;
	color: "violet" | "cyan" | "emerald" | "amber" | "zinc";
	onClick: () => void;
	children: React.ReactNode;
}

const ACTIVE_CLASS: Record<ChipProps["color"], string> = {
	violet: "border-violet-400/40 bg-violet-400/15 text-violet-200",
	cyan: "border-cyan-400/40 bg-cyan-400/15 text-cyan-200",
	emerald: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
	amber: "border-amber-400/40 bg-amber-400/15 text-amber-200",
	zinc: "border-white/20 bg-white/10 text-zinc-100",
};

function Chip({ active, color, onClick, children }: ChipProps) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
				active
					? ACTIVE_CLASS[color]
					: "border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20"
			}`}
		>
			{active && (
				<span className="w-1 h-1 rounded-full bg-current" aria-hidden="true" />
			)}
			{children}
		</button>
	);
}

/**
 * Horizontal scrollable chip bar for the V2 history view. Agent and period are
 * single-select within their axis (tapping the active chip clears it); Active
 * is a boolean toggle. All filtering is client-side.
 */
export function HistoryFacetBar({ filter, onChange }: HistoryFacetBarProps) {
	const { t } = useTranslation();
	const setAgent = (agent: HistoryAgentFilter) =>
		onChange({ ...filter, agent: filter.agent === agent ? null : agent });
	const setPeriod = (period: HistoryPeriodFilter) =>
		onChange({ ...filter, period: filter.period === period ? null : period });
	const toggleActive = () =>
		onChange({ ...filter, activeOnly: !filter.activeOnly });

	return (
		<div className="flex gap-1.5 overflow-x-auto pb-1 -mx-3 px-3 [scrollbar-width:thin]">
			<Chip
				active={filter.agent === "claude"}
				color="violet"
				onClick={() => setAgent("claude")}
			>
				Claude
			</Chip>
			<Chip
				active={filter.agent === "codex"}
				color="cyan"
				onClick={() => setAgent("codex")}
			>
				Codex
			</Chip>
			<Chip active={filter.activeOnly} color="emerald" onClick={toggleActive}>
				{t("session.activeSessions")}
			</Chip>
			<Chip
				active={filter.period === "24h"}
				color="amber"
				onClick={() => setPeriod("24h")}
			>
				24h
			</Chip>
			<Chip
				active={filter.period === "7d"}
				color="amber"
				onClick={() => setPeriod("7d")}
			>
				7d
			</Chip>
			<Chip
				active={filter.period === "30d"}
				color="amber"
				onClick={() => setPeriod("30d")}
			>
				30d
			</Chip>
		</div>
	);
}
