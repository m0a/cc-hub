/** biome-ignore-all lint/correctness/useExhaustiveDependencies: depends on refs and setters that React guarantees stable; adding them would cause unintended re-runs */
/** biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: legacy click-on-div UI; keyboard navigation provided via main shortcuts */
import { MessageSquare, Terminal as TerminalIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	AgentProvider,
	PaneInfo,
	SessionState,
	SessionTheme,
} from "../../../shared/types";
import { authFetch } from "../services/api";
import { toHomeShortPath } from "../utils/path";
import { ChatView } from "./chat/ChatView";
import type { ControlModeConfig } from "./Terminal";
import { TerminalComponent, type TerminalRef } from "./Terminal";

const API_BASE = import.meta.env.VITE_API_URL || "";

// ペインノード型定義
export type PaneNode =
	| { type: "terminal"; sessionId: string | null; id: string }
	| {
			type: "split";
			direction: "horizontal" | "vertical";
			children: PaneNode[];
			ratio: number[];
			id: string;
	  };

// Extended session type with ccSessionId
interface ExtendedSession {
	id: string;
	name: string;
	state: SessionState;
	currentPath?: string;
	ccSessionId?: string;
	agent?: AgentProvider;
	agentSessionId?: string;
	currentCommand?: string;
	theme?: SessionTheme;
	panes?: PaneInfo[];
}

// Control mode context passed through the pane tree
export interface ControlModeContext {
	getControlConfig: (paneId: string) => ControlModeConfig | undefined;
	splitPane: (paneId: string, direction: "h" | "v") => void;
	closePane: (paneId: string) => void;
	zoomPane?: (paneId: string) => void;
	isZoomed?: boolean;
	respawnPane?: (paneId: string) => void;
	deadPanes?: Set<string>;
	onCopyPrompt?: (text: string) => void;
	setKeyboardVisible?: (visible: boolean) => void;
	onShowSessions?: () => void;
	onOpenFileViewer?: (dir: string) => void;
}

interface PaneContainerProps {
	node: PaneNode;
	activePane: string;
	onFocusPane: (paneId: string) => void;
	onSelectSession: (paneId: string, sessionId?: string) => void;
	onSessionStateChange: (sessionId: string, state: SessionState) => void;
	onSplitRatioChange: (nodeId: string, ratio: number[]) => void;
	onClosePane: (paneId: string) => void;
	onSplit?: (direction: "horizontal" | "vertical") => void;
	sessions: ExtendedSession[];
	terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
	isTablet?: boolean;
	globalReloadKey?: number;
	controlModeContext: ControlModeContext;
}

export function PaneContainer({
	node,
	activePane,
	onFocusPane,
	onSelectSession,
	onSessionStateChange,
	onSplitRatioChange,
	onClosePane,
	onSplit,
	sessions,
	terminalRefs,
	isTablet = false,
	globalReloadKey = 0,
	controlModeContext,
}: PaneContainerProps) {
	if (node.type === "terminal") {
		return (
			<TerminalPane
				paneId={node.id}
				sessionId={node.sessionId}
				isActive={activePane === node.id}
				onFocus={() => onFocusPane(node.id)}
				onSelectSession={(sessionId) => onSelectSession(node.id, sessionId)}
				onSessionStateChange={onSessionStateChange}
				onClose={() => onClosePane(node.id)}
				onSplit={onSplit}
				sessions={sessions}
				terminalRefs={terminalRefs}
				globalReloadKey={globalReloadKey}
				isTablet={isTablet}
				controlModeContext={controlModeContext}
			/>
		);
	}

	if (node.type === "split") {
		return (
			<SplitContainer
				node={node}
				activePane={activePane}
				onFocusPane={onFocusPane}
				onSelectSession={onSelectSession}
				onSessionStateChange={onSessionStateChange}
				onSplitRatioChange={onSplitRatioChange}
				onClosePane={onClosePane}
				onSplit={onSplit}
				sessions={sessions}
				terminalRefs={terminalRefs}
				isTablet={isTablet}
				globalReloadKey={globalReloadKey}
				controlModeContext={controlModeContext}
			/>
		);
	}

	// Unknown pane type - should not happen
	return null;
}

interface TerminalPaneProps {
	paneId: string;
	sessionId: string | null;
	isActive: boolean;
	onFocus: () => void;
	onSelectSession: (sessionId?: string) => void;
	onSessionStateChange: (sessionId: string, state: SessionState) => void;
	onClose: () => void;
	onSplit?: (direction: "horizontal" | "vertical") => void;
	sessions: ExtendedSession[];
	terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
	globalReloadKey?: number;
	isTablet?: boolean;
	controlModeContext: ControlModeContext;
}

function TerminalPane({
	paneId,
	sessionId,
	isActive,
	onFocus,
	onSelectSession,
	onSessionStateChange,
	onClose,
	onSplit: _onSplit,
	sessions,
	terminalRefs,
	globalReloadKey = 0,
	isTablet = false,
	controlModeContext,
}: TerminalPaneProps) {
	const isDead = controlModeContext.deadPanes?.has(paneId) ?? false;
	const { t } = useTranslation();
	const terminalRef = useRef<TerminalRef>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	// Persist chat-mode state per pane so it survives remounts (e.g. after a
	// split changes the React tree from <TerminalPane> to <SplitContainer>).
	const conversationModeKey = sessionId
		? `cchub-pane-conv-mode:${sessionId}:${paneId}`
		: null;
	const [showConversation, setShowConversationState] = useState<boolean>(() => {
		if (!conversationModeKey) return false;
		try {
			return localStorage.getItem(conversationModeKey) === "1";
		} catch {
			return false;
		}
	});
	const setShowConversation = useCallback<
		React.Dispatch<React.SetStateAction<boolean>>
	>(
		(next) => {
			setShowConversationState((prev) => {
				const value =
					typeof next === "function"
						? (next as (p: boolean) => boolean)(prev)
						: next;
				if (conversationModeKey) {
					try {
						if (value) localStorage.setItem(conversationModeKey, "1");
						else localStorage.removeItem(conversationModeKey);
					} catch {
						/* ignore */
					}
				}
				return value;
			});
		},
		[conversationModeKey],
	);
	const [reloadKey, setReloadKey] = useState(0);
	const [confirmClose, setConfirmClose] = useState(false);
	const confirmCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	// Refresh terminal display (force tmux redraw without remounting)
	const handleReload = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		if (terminalRef.current?.refreshTerminal) {
			terminalRef.current.refreshTerminal();
		} else {
			// Fallback: remount terminal
			setReloadKey((prev) => prev + 1);
		}
	}, []);

	// Open file viewer (hide keyboard while open)
	const handleOpenFileViewer = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			const s = sessionId ? sessions.find((s) => s.id === sessionId) : null;
			controlModeContext.onOpenFileViewer?.(s?.currentPath || "/");
			controlModeContext.setKeyboardVisible?.(false);
		},
		[controlModeContext, sessionId, sessions],
	);

	// Cleanup confirm close timer on unmount
	useEffect(() => {
		return () => {
			if (confirmCloseTimerRef.current) {
				clearTimeout(confirmCloseTimerRef.current);
			}
		};
	}, []);

	// Register terminal ref
	useEffect(() => {
		if (sessionId && terminalRef.current) {
			terminalRefs.current.set(paneId, terminalRef.current);
		}
		return () => {
			terminalRefs.current.delete(paneId);
		};
	}, [paneId, sessionId, terminalRefs]);

	const handleConnect = useCallback(() => {
		if (sessionId) {
			onSessionStateChange(sessionId, "idle");
		}
	}, [sessionId, onSessionStateChange]);

	const handleDisconnect = useCallback(() => {
		if (sessionId) {
			onSessionStateChange(sessionId, "disconnected");
		}
	}, [sessionId, onSessionStateChange]);

	const session = sessionId ? sessions.find((s) => s.id === sessionId) : null;

	// Re-read persisted state when the (sessionId, paneId) pair changes — e.g.
	// user picks a different session in this pane. Initial mount already
	// hydrated from localStorage via useState, so this is a no-op then.
	useEffect(() => {
		if (!conversationModeKey) {
			setShowConversationState(false);
			return;
		}
		try {
			setShowConversationState(
				localStorage.getItem(conversationModeKey) === "1",
			);
		} catch {
			setShowConversationState(false);
		}
	}, [conversationModeKey]);

	// Fall back to terminal view only if pane data has loaded AND no supported
	// agent is running on the active pane. Without the loaded check, the very
	// first render after remount (e.g. after a split) sees panes=undefined and
	// would wrongly clear chat mode.
	const activeTmuxPane = session?.panes?.find((p) => p.isActive);
	const claudeRunning = activeTmuxPane?.currentCommand === "claude";
	const codexRunning = activeTmuxPane?.currentCommand === "codex";
	const conversationAvailable = claudeRunning || codexRunning;
	const panesLoaded = !!session?.panes;
	useEffect(() => {
		if (!panesLoaded) return;
		if (!conversationAvailable && showConversation) {
			setShowConversation(false);
		}
	}, [
		conversationAvailable,
		showConversation,
		panesLoaded,
		setShowConversation,
	]);

	const handleToggleConversation = useCallback(() => {
		setShowConversation((prev) => !prev);
	}, []);

	return (
		<div
			ref={containerRef}
			className={`h-full flex flex-col bg-th-bg relative select-none ${isActive ? "ring-2 ring-blue-500" : ""}`}
			onMouseDown={onFocus}
		>
			{/* Pane header - overlay on tablet, normal on desktop */}
			<div
				className={`flex items-center px-2 py-1 text-base select-none ${
					isTablet
						? "absolute top-0 right-0 z-50 justify-end pointer-events-auto bg-[var(--color-overlay)] backdrop-blur-sm rounded-bl-lg"
						: "justify-between bg-[var(--color-overlay)] border-b border-th-border shrink-0"
				}`}
			>
				{!isTablet && (
					<span className="text-th-text-secondary truncate flex-1">
						{showConversation
							? t("conversation.history")
							: session?.name || t("pane.noSession")}
					</span>
				)}
				<div className={`flex items-center ${isTablet ? "gap-0" : "gap-1.5"}`}>
					{/* Terminal / Chat single-icon toggle — shows the destination mode */}
					{(() => {
						const disabled = !showConversation && !conversationAvailable;
						return (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									if (!disabled) handleToggleConversation();
								}}
								disabled={disabled}
								className={`${isTablet ? "p-2" : "p-1"} rounded transition-colors ${
									disabled
										? "text-white/20 cursor-not-allowed"
										: "text-white/60 hover:text-th-text hover:bg-white/[0.06]"
								}`}
								title={
									showConversation
										? "ターミナルに切替"
										: conversationAvailable
											? "会話履歴に切替"
											: "エージェントが起動していません"
								}
								aria-label={
									showConversation ? "Switch to Terminal" : "Switch to Chat"
								}
							>
								{showConversation ? (
									<TerminalIcon
										className={isTablet ? "w-4 h-4" : "w-[14px] h-[14px]"}
									/>
								) : (
									<MessageSquare
										className={isTablet ? "w-4 h-4" : "w-[14px] h-[14px]"}
									/>
								)}
							</button>
						);
					})()}
					{/* File browser button (desktop only) */}
					{!isTablet && session?.currentPath && !showConversation && (
						<button
							type="button"
							onClick={handleOpenFileViewer}
							className="p-1.5 text-white/50 hover:text-th-text transition-colors"
							title={t("files.title")}
							data-onboarding="file-browser"
						>
							<svg
								aria-hidden="true"
								className="w-[18px] h-[18px]"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
								/>
							</svg>
						</button>
					)}
					{/* Reload button (desktop only) */}
					{!isTablet && sessionId && !showConversation && (
						<button
							type="button"
							onClick={handleReload}
							className="p-1.5 text-white/50 hover:text-th-text transition-colors"
							title={t("files.reload")}
						>
							<svg
								aria-hidden="true"
								className="w-[18px] h-[18px]"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
						</button>
					)}
					{/* Zoom button — only meaningful when there are multiple panes */}
					{sessionId &&
						!showConversation &&
						controlModeContext.zoomPane &&
						(session?.panes?.length ?? 0) > 1 && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									controlModeContext.zoomPane?.(paneId);
								}}
								className={`${isTablet ? "p-2.5" : "p-1.5"} transition-colors ${
									controlModeContext.isZoomed
										? "text-blue-400 hover:text-blue-300"
										: "text-white/50 hover:text-th-text"
								}`}
								title={controlModeContext.isZoomed ? "Unzoom" : "Zoom"}
							>
								{controlModeContext.isZoomed ? (
									<svg
										aria-hidden="true"
										className={isTablet ? "w-5 h-5" : "w-[18px] h-[18px]"}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M9 4H4m0 0v5m0-5l5 5m6-5h5m0 0v5m0-5l-5 5M9 20H4m0 0v-5m0 5l5-5m6 5h5m0 0v-5m0 5l-5-5"
										/>
									</svg>
								) : (
									<svg
										aria-hidden="true"
										className={isTablet ? "w-5 h-5" : "w-[18px] h-[18px]"}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
										/>
									</svg>
								)}
							</button>
						)}
					{/* Split buttons - desktop only */}
					{!isTablet && (
						<div className="flex items-center" data-onboarding="split-pane">
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									controlModeContext.splitPane(paneId, "h");
								}}
								className="p-1.5 text-white/50 hover:text-th-text transition-colors"
								title="縦分割 (Ctrl+D)"
								data-onboarding="split-pane"
							>
								<svg
									aria-hidden="true"
									className="w-[18px] h-[18px]"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth={2}
								>
									<rect x="3" y="3" width="18" height="18" rx="2" />
									<line x1="12" y1="3" x2="12" y2="21" />
								</svg>
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									controlModeContext.splitPane(paneId, "v");
								}}
								className="p-1.5 text-white/50 hover:text-th-text transition-colors"
								title="横分割 (Ctrl+Shift+D)"
							>
								<svg
									aria-hidden="true"
									className="w-[18px] h-[18px]"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth={2}
								>
									<rect x="3" y="3" width="18" height="18" rx="2" />
									<line x1="3" y1="12" x2="21" y2="12" />
								</svg>
							</button>
						</div>
					)}
					{/* Close button with confirmation — only shown when there are
              multiple panes (the backend rejects closing the last pane). */}
					{(session?.panes?.length ?? 0) > 1 && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								if (confirmClose) {
									if (confirmCloseTimerRef.current) {
										clearTimeout(confirmCloseTimerRef.current);
										confirmCloseTimerRef.current = null;
									}
									setConfirmClose(false);
									onClose();
								} else {
									setConfirmClose(true);
									confirmCloseTimerRef.current = setTimeout(() => {
										setConfirmClose(false);
										confirmCloseTimerRef.current = null;
									}, 3000);
								}
							}}
							className={`${isTablet ? "p-2.5" : "p-1.5"} transition-colors ${
								confirmClose
									? "text-red-400 bg-red-900/50 rounded"
									: "text-white/50 hover:text-red-400"
							}`}
							title={confirmClose ? t("pane.confirmClose") : t("common.close")}
						>
							{confirmClose ? (
								<span
									className={`${isTablet ? "text-xs" : "text-[10px]"} font-bold whitespace-nowrap`}
								>
									{t("pane.confirmClose")}
								</span>
							) : (
								<svg
									aria-hidden="true"
									className={isTablet ? "w-5 h-5" : "w-[18px] h-[18px]"}
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
							)}
						</button>
					)}
				</div>
			</div>

			{/* Dead pane overlay */}
			{isDead && (
				<div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
					<div className="flex flex-col items-center gap-4 px-8 py-6 bg-th-surface/95 border border-th-border rounded-xl shadow-2xl max-w-xs">
						<div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
							<svg
								aria-hidden="true"
								className="w-5 h-5 text-red-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
								/>
							</svg>
						</div>
						<p className="text-th-text text-sm font-medium">
							{t("pane.processExited")}
						</p>
						<div className="flex gap-2 w-full">
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									controlModeContext.respawnPane?.(paneId);
								}}
								className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
							>
								{t("pane.restart")}
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									if (sessionId) {
										authFetch(
											`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`,
											{
												method: "DELETE",
											},
										)
											.then(() => {
												window.location.reload();
											})
											.catch(() => {
												window.location.reload();
											});
									}
								}}
								className="flex-1 px-4 py-2 bg-th-surface-hover hover:bg-th-border text-th-text-secondary rounded-lg text-sm font-medium transition-colors"
							>
								{t("common.close")}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Terminal, conversation, or session selector */}
			<div className="flex-1 min-h-0">
				{showConversation && sessionId && (
					<ChatView
						sessionId={sessionId}
						title={t("conversation.history")}
						subtitle={session?.name}
						inline={true}
						enabled={showConversation}
						// Tablet has its own FloatingKeyboard that already routes input to
						// the active pane (same as Terminal mode) — no in-view composer.
						showComposer={!isTablet}
						paneId={controlModeContext.getControlConfig(paneId)?.paneId}
						theme={session?.theme}
						agent={session?.agent}
						agentSessionId={session?.agentSessionId}
					/>
				)}
				{sessionId ? (
					<div className={showConversation ? "hidden" : "h-full"}>
						<TerminalComponent
							key={`${sessionId}-${reloadKey}-${globalReloadKey}`}
							ref={terminalRef}
							sessionId={sessionId}
							hideKeyboard={true}
							onConnect={handleConnect}
							onDisconnect={handleDisconnect}
							theme={session?.theme}
							controlMode={controlModeContext.getControlConfig(paneId)}
						/>
					</div>
				) : (
					!showConversation && (
						<SessionSelector
							sessions={sessions}
							onSelect={(sess) => {
								onSelectSession(sess.id);
							}}
						/>
					)
				)}
			</div>
		</div>
	);
}

interface SessionSelectorProps {
	sessions: ExtendedSession[];
	onSelect: (session: ExtendedSession) => void;
}

function SessionSelector({ sessions, onSelect }: SessionSelectorProps) {
	const { t } = useTranslation();
	return (
		<div className="h-full flex flex-col items-center justify-center bg-th-bg p-4">
			<p className="text-th-text-secondary mb-4">{t("pane.selectSession")}</p>
			<div className="max-h-64 overflow-y-auto w-full max-w-xs space-y-2">
				{sessions.map((session) => (
					<button
						type="button"
						key={session.id}
						onClick={() => onSelect(session)}
						className="w-full text-left px-3 py-2 bg-th-surface hover:bg-th-surface-hover rounded text-th-text text-sm transition-colors"
					>
						<div className="font-medium truncate">{session.name}</div>
						{session.currentPath && (
							<div className="text-xs text-th-text-secondary truncate">
								{toHomeShortPath(session.currentPath)}
							</div>
						)}
					</button>
				))}
				{sessions.length === 0 && (
					<p className="text-th-text-muted text-sm text-center">
						{t("session.noSessions")}
					</p>
				)}
			</div>
		</div>
	);
}

interface SplitContainerProps {
	node: Extract<PaneNode, { type: "split" }>;
	activePane: string;
	onFocusPane: (paneId: string) => void;
	onSelectSession: (paneId: string, sessionId?: string) => void;
	onSessionStateChange: (sessionId: string, state: SessionState) => void;
	onSplitRatioChange: (nodeId: string, ratio: number[]) => void;
	onClosePane: (paneId: string) => void;
	onSplit?: (direction: "horizontal" | "vertical") => void;
	sessions: ExtendedSession[];
	terminalRefs: React.RefObject<Map<string, TerminalRef | null>>;
	isTablet?: boolean;
	globalReloadKey?: number;
	controlModeContext: ControlModeContext;
}

function SplitContainer({
	node,
	activePane,
	onFocusPane,
	onSelectSession,
	onSessionStateChange,
	onSplitRatioChange,
	onClosePane,
	onSplit,
	sessions,
	terminalRefs,
	isTablet = false,
	globalReloadKey = 0,
	controlModeContext,
}: SplitContainerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isDragging, setIsDragging] = useState<number | null>(null);
	const draggingRef = useRef<number | null>(null);

	// Pointer-capture based drag: all pointer events go to the captured element
	const handlePointerDown = useCallback(
		(index: number) => (e: React.PointerEvent) => {
			e.preventDefault();
			e.currentTarget.setPointerCapture(e.pointerId);
			setIsDragging(index);
			draggingRef.current = index;
		},
		[],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			const dragIndex = draggingRef.current;
			if (dragIndex === null) return;
			e.preventDefault();
			if (!containerRef.current) return;
			const rect = containerRef.current.getBoundingClientRect();
			const clientPos = node.direction === "horizontal" ? e.clientX : e.clientY;
			const containerSize =
				node.direction === "horizontal" ? rect.width : rect.height;
			const offset = node.direction === "horizontal" ? rect.left : rect.top;

			const newRatio = [...node.ratio];
			const beforeSum = node.ratio
				.slice(0, dragIndex + 1)
				.reduce((a, b) => a + b, 0);
			const afterSum = node.ratio
				.slice(dragIndex + 1)
				.reduce((a, b) => a + b, 0);
			const position = ((clientPos - offset) / containerSize) * 100;
			const minRatio = 10;
			const newBefore = Math.max(
				minRatio,
				Math.min(beforeSum + afterSum - minRatio, position),
			);
			const diff = newBefore - beforeSum;

			if (
				newRatio[dragIndex] !== undefined &&
				newRatio[dragIndex + 1] !== undefined
			) {
				newRatio[dragIndex] = newRatio[dragIndex] + diff;
				newRatio[dragIndex + 1] = newRatio[dragIndex + 1] - diff;
				if (
					newRatio[dragIndex] >= minRatio &&
					newRatio[dragIndex + 1] >= minRatio
				) {
					onSplitRatioChange(node.id, newRatio);
				}
			}
		},
		[node, onSplitRatioChange],
	);

	const handlePointerUp = useCallback((e: React.PointerEvent) => {
		if (draggingRef.current === null) return;
		e.currentTarget.releasePointerCapture(e.pointerId);
		setIsDragging(null);
		draggingRef.current = null;
	}, []);

	// Touch fallback for devices that don't support pointer capture well
	const handleTouchStart = useCallback(
		(index: number) => (e: React.TouchEvent) => {
			e.preventDefault();
			setIsDragging(index);
			draggingRef.current = index;
		},
		[],
	);

	useEffect(() => {
		const dragIndex = draggingRef.current;
		if (dragIndex === null) return;

		const handleTouchMove = (e: TouchEvent) => {
			e.preventDefault();
			if (!containerRef.current) return;
			const rect = containerRef.current.getBoundingClientRect();
			const clientPos =
				node.direction === "horizontal"
					? e.touches[0].clientX
					: e.touches[0].clientY;
			const containerSize =
				node.direction === "horizontal" ? rect.width : rect.height;
			const offset = node.direction === "horizontal" ? rect.left : rect.top;

			const newRatio = [...node.ratio];
			const beforeSum = node.ratio
				.slice(0, dragIndex + 1)
				.reduce((a, b) => a + b, 0);
			const afterSum = node.ratio
				.slice(dragIndex + 1)
				.reduce((a, b) => a + b, 0);
			const position = ((clientPos - offset) / containerSize) * 100;
			const minRatio = 10;
			const newBefore = Math.max(
				minRatio,
				Math.min(beforeSum + afterSum - minRatio, position),
			);
			const diff = newBefore - beforeSum;

			if (
				newRatio[dragIndex] !== undefined &&
				newRatio[dragIndex + 1] !== undefined
			) {
				newRatio[dragIndex] = newRatio[dragIndex] + diff;
				newRatio[dragIndex + 1] = newRatio[dragIndex + 1] - diff;
				if (
					newRatio[dragIndex] >= minRatio &&
					newRatio[dragIndex + 1] >= minRatio
				) {
					onSplitRatioChange(node.id, newRatio);
				}
			}
		};

		const handleTouchEnd = () => {
			setIsDragging(null);
			draggingRef.current = null;
		};

		document.addEventListener("touchmove", handleTouchMove, { passive: false });
		document.addEventListener("touchend", handleTouchEnd);

		return () => {
			document.removeEventListener("touchmove", handleTouchMove);
			document.removeEventListener("touchend", handleTouchEnd);
		};
	}, [isDragging, node, onSplitRatioChange]);

	const isHorizontal = node.direction === "horizontal";

	// Divider size: 4px on desktop, 8px on tablet
	const dividerSize = isTablet ? 8 : 4;

	// Build elements array with panes and dividers interleaved
	const elements: React.ReactNode[] = [];
	node.children.forEach((child, index) => {
		// Child pane
		elements.push(
			<div
				key={child.id}
				style={{
					[isHorizontal ? "width" : "height"]:
						`calc(${node.ratio[index]}% - ${index < node.children.length - 1 ? dividerSize / 2 : 0}px)`,
					[isHorizontal ? "height" : "width"]: "100%",
				}}
				className="flex-shrink-0 overflow-hidden"
			>
				<PaneContainer
					node={child}
					activePane={activePane}
					onFocusPane={onFocusPane}
					onSelectSession={onSelectSession}
					onSessionStateChange={onSessionStateChange}
					onSplitRatioChange={onSplitRatioChange}
					onClosePane={onClosePane}
					onSplit={onSplit}
					sessions={sessions}
					terminalRefs={terminalRefs}
					isTablet={isTablet}
					globalReloadKey={globalReloadKey}
					controlModeContext={controlModeContext}
				/>
			</div>,
		);

		// Divider (not after last child)
		if (index < node.children.length - 1) {
			elements.push(
				<div
					key={`divider-${child.id}`}
					style={{
						[isHorizontal ? "width" : "height"]: `${dividerSize}px`,
						position: "relative",
					}}
					className={`
            ${isHorizontal ? "h-full cursor-col-resize" : "w-full cursor-row-resize"}
            flex items-center justify-center bg-th-surface-hover hover:bg-blue-500/50 transition-colors flex-shrink-0 z-10
            ${isDragging === index ? "bg-blue-500/70" : ""}
          `}
				>
					{/* Expanded touch/click target for easier dragging */}
					<div
						onPointerDown={handlePointerDown(index)}
						onPointerMove={handlePointerMove}
						onPointerUp={handlePointerUp}
						onTouchStart={handleTouchStart(index)}
						style={{
							position: "absolute",
							[isHorizontal ? "left" : "top"]: isTablet ? "-16px" : "-8px",
							[isHorizontal ? "right" : "bottom"]: isTablet ? "-16px" : "-8px",
							[isHorizontal ? "top" : "left"]: "0",
							[isHorizontal ? "bottom" : "right"]: "0",
							touchAction: "none",
							zIndex: 20,
						}}
						className={isHorizontal ? "cursor-col-resize" : "cursor-row-resize"}
					/>
					<div
						className={`
            ${isHorizontal ? "w-0.5 h-8" : "h-0.5 w-8"}
            bg-gray-500 rounded-full pointer-events-none
          `}
					/>
				</div>,
			);
		}
	});

	return (
		<div
			ref={containerRef}
			className={`h-full w-full flex select-none ${isHorizontal ? "flex-row" : "flex-col"}`}
		>
			{elements}
		</div>
	);
}
