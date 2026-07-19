import { useCallback, useEffect } from "react";
import type { SessionResponse } from "../../../shared/types";
import { WorkspaceList } from "./WorkspaceList";

interface SessionModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectSession: (session: SessionResponse) => void;
	isTablet?: boolean;
}

export function SessionModal({
	isOpen,
	onClose,
	onSelectSession,
	isTablet,
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

	// Desktop only: scale up. Tablet keeps native size so touch targets are
	// unchanged.
	const desktopZoom = isTablet ? undefined : { zoom: 1.25 };

	return (
		<div
			className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a]"
			style={desktopZoom}
		>
			<div className="flex-1 min-h-0 overflow-hidden w-full h-full">
				<WorkspaceList
					onSelectSession={handleSelectSession}
					inline={true}
					onClose={onClose}
				/>
			</div>
		</div>
	);
}
