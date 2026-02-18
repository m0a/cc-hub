import { useTranslation } from "react-i18next";
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
			<div className="flex items-center justify-between px-3 py-2 bg-[var(--color-overlay)] border-b border-th-border shrink-0">
				<span className="text-sm font-medium text-white/90">
					{t("dashboard.title")}
				</span>
				<button
					onClick={onClose}
					className="p-1 text-white/50 hover:text-th-text transition-colors"
				>
					<svg
						className="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			{/* Dashboard content */}
			<div className="flex-1 min-h-0 overflow-y-auto">
				<Dashboard className="h-full" />
			</div>
		</div>
	);
}
