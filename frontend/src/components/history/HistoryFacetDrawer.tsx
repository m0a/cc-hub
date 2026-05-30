import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface HistoryFacetDrawerProps {
	open: boolean;
	onClose: () => void;
	children: React.ReactNode;
}

/** Bottom-sheet wrapper for the facet sidebar on narrow screens. */
export function HistoryFacetDrawer({
	open,
	onClose,
	children,
}: HistoryFacetDrawerProps) {
	const { t } = useTranslation();
	if (!open) return null;
	return (
		<div className="fixed inset-0 z-40">
			<button
				type="button"
				aria-label={t("common.close")}
				onClick={onClose}
				className="absolute inset-0 bg-black/50"
			/>
			<div className="absolute left-0 right-0 bottom-0 max-h-[75vh] overflow-y-auto bg-[#0f0f0f] border-t border-white/10 rounded-t-2xl px-4 pt-3 pb-6">
				<div className="flex items-center justify-between mb-3 sticky -top-3 -mx-4 px-4 py-2 bg-[#0f0f0f]">
					<span className="text-[13px] font-medium text-zinc-200">
						{t("history.filters")}
					</span>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("common.close")}
						className="p-1 text-zinc-500 hover:text-zinc-300"
					>
						<X className="w-4 h-4" aria-hidden="true" />
					</button>
				</div>
				{children}
			</div>
		</div>
	);
}
