import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ActiveChip } from "../../utils/historyFacets";

interface HistoryActiveChipsProps {
	chips: ActiveChip[];
	onRemove: (chip: ActiveChip) => void;
	onClearAll: () => void;
}

const AXIS_CLASS: Record<ActiveChip["axis"], string> = {
	projects: "border-blue-400/30 bg-blue-400/15 text-blue-200",
	agents: "border-violet-400/30 bg-violet-400/15 text-violet-200",
	branches: "border-purple-400/30 bg-purple-400/15 text-purple-200",
	peers: "border-pink-400/30 bg-pink-400/15 text-pink-200",
	period: "border-amber-400/30 bg-amber-400/15 text-amber-200",
};

/** Removable chips for the active facet selection, with a Clear-all action. */
export function HistoryActiveChips({
	chips,
	onRemove,
	onClearAll,
}: HistoryActiveChipsProps) {
	const { t } = useTranslation();
	if (chips.length === 0) return null;
	return (
		<div className="flex items-center gap-1.5 flex-wrap">
			{chips.map((chip) => (
				<button
					type="button"
					key={`${chip.axis}:${chip.value}`}
					onClick={() => onRemove(chip)}
					className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${AXIS_CLASS[chip.axis]}`}
				>
					<span className="opacity-70">#</span>
					{chip.label}
					<X className="w-3 h-3 opacity-70" />
				</button>
			))}
			<button
				type="button"
				onClick={onClearAll}
				className="px-2 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-300"
			>
				{t("history.clearFilters")}
			</button>
		</div>
	);
}
