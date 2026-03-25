import { useTranslation } from "react-i18next";
import { Settings, X } from "lucide-react";
import { Dashboard } from "./dashboard/Dashboard";

interface DashboardPanelProps {
	isOpen: boolean;
	onClose: () => void;
}

export function DashboardPanel({ isOpen, onClose }: DashboardPanelProps) {
	const { t } = useTranslation();

	if (!isOpen) return null;

	return (
		<div className="w-[350px] shrink-0 flex flex-col bg-th-bg border-l border-th-border z-30">
			{/* Header */}
			<div className="shrink-0 px-4 pt-3 pb-3 border-b border-white/[0.06]">
				<div className="flex items-center justify-between max-w-lg">
					<h1 className="text-[18px] font-semibold tracking-[-0.02em] text-white">
						{t("dashboard.title")}
					</h1>
					<div className="flex items-center gap-1">
						<button
							className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
							title={t("dashboard.title")}
						>
							<Settings className="w-[18px] h-[18px]" />
						</button>
						<button
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
