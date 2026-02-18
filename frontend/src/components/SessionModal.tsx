import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { SessionResponse } from "../../../shared/types";
import { SessionList } from "./SessionList";

interface SessionModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectSession: (session: SessionResponse) => void;
}

export function SessionModal({
	isOpen,
	onClose,
	onSelectSession,
}: SessionModalProps) {
	const { t } = useTranslation();

	// Close on Escape
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	const handleSelectSession = useCallback(
		(session: SessionResponse) => {
			onSelectSession(session);
			onClose();
		},
		[onSelectSession, onClose],
	);

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-40 bg-[var(--color-overlay)] flex items-center justify-center animate-backdrop-in"
			onClick={onClose}
		>
			<div
				className="max-w-lg w-full h-[80vh] bg-th-bg rounded-lg shadow-2xl border border-th-border overflow-hidden flex flex-col mx-4 animate-modal-in"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-2 bg-[var(--color-overlay)] border-b border-th-border shrink-0">
					<span className="text-sm font-medium text-white/90">
						{t("session.title")}
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

				{/* Session list */}
				<div className="flex-1 min-h-0 overflow-hidden">
					<SessionList
						onSelectSession={handleSelectSession}
						inline={true}
						hideDashboardTab={true}
					/>
				</div>
			</div>
		</div>
	);
}
