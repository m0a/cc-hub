import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dashboard } from "./dashboard/Dashboard";

interface DashboardPanelProps {
	isOpen: boolean;
	onClose: () => void;
	isTablet?: boolean;
}

export function DashboardPanel({
	isOpen,
	onClose,
	isTablet,
}: DashboardPanelProps) {
	const { t } = useTranslation();

	if (!isOpen) return null;

	// Desktop typography is too small for monitor viewing distance — scale the
	// panel up. Tablets stay at native size so finger reach areas aren't
	// distorted.
	const desktopZoom = isTablet ? undefined : { zoom: 1.25 };

	return (
		<div
			className="w-[360px] xl:w-[420px] 2xl:w-[480px] shrink-0 flex flex-col bg-th-bg border-l border-th-border z-[60]"
			style={desktopZoom}
		>
			{/* Header */}
			<div className="shrink-0 px-4 pt-3 pb-3 border-b border-white/[0.06]">
				<div className="flex items-center justify-between max-w-lg">
					<h1 className="text-[18px] font-semibold tracking-[-0.02em] text-white">
						{t("dashboard.title")}
					</h1>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={onClose}
							className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
						>
							<X className="w-[18px] h-[18px]" />
						</button>
					</div>
				</div>
			</div>

			{/* Dashboard content */}
			<div className="flex-1 min-h-0 overflow-y-auto">
				<Dashboard className="h-full" compact />
			</div>
		</div>
	);
}
