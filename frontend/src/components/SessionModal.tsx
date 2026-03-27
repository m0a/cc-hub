import { useCallback, useEffect } from "react";
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
		<div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a]">
			<div className="flex-1 min-h-0 overflow-hidden w-full h-full">
				<SessionList
					onSelectSession={handleSelectSession}
					inline={true}
					hideDashboardTab={true}
					onClose={onClose}
				/>
			</div>
		</div>
	);
}
