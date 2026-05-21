import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneViewport, TmuxLayoutNode } from "../../../shared/types";
import { reportWsLatency } from "../services/latency-store";

interface UseMultiplexedTerminalOptions {
	sessionId: string;
	token?: string | null;
	// Multi-server: アクティブな peer の WS base URL ("wss://host:port") を指定。
	// 省略時は Hub (window.location.host) を使う。
	peerWsBase?: string | null;
	onPaneViewport?: (paneId: string, viewport: PaneViewport) => void;
	onLayoutChange?: (layout: TmuxLayoutNode) => void;
	onNewSession?: (sessionId: string, sessionName: string) => void;
	onPaneDead?: (paneId: string) => void;
	onHookEvent?: (
		event: string,
		cwd?: string,
		sessionId?: string,
		data?: Record<string, unknown>,
		message?: string,
	) => void;
	onConnect?: () => void;
	onDisconnect?: () => void;
	onError?: (error: string, paneId?: string) => void;
}

interface UseMultiplexedTerminalReturn {
	isConnected: boolean;
	connect: () => void;
	disconnect: () => void;
	sendInput: (paneId: string, data: string) => void;
	resize: (cols: number, rows: number) => void;
	splitPane: (paneId: string, direction: "h" | "v") => void;
	closePane: (paneId: string) => void;
	resizePane: (paneId: string, cols: number, rows: number) => void;
	selectPane: (paneId: string) => void;
	adjustPane: (
		paneId: string,
		direction: "L" | "R" | "U" | "D",
		amount: number,
	) => void;
	equalizePanes: (direction: "horizontal" | "vertical") => void;
	sendClientInfo: (deviceType: "mobile" | "tablet" | "desktop") => void;
	// Ask the server for the viewport `offset` rows above the live edge.
	// offset=0 == live mode; the server will keep pushing unsolicited
	// updates whenever output arrives. offset>0 silences unsolicited pushes
	// until the next request-viewport.
	requestViewport: (paneId: string, offset: number) => void;
	zoomPane: (paneId: string) => void;
	respawnPane: (paneId: string) => void;
	deadPanes: Set<string>;
}

// =============================================================================
// Module-level singleton WebSocket — survives React component remounts
// =============================================================================

const getWsBase = () => {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
};

const getAuthToken = (): string | null => {
	return localStorage.getItem("cc-hub-token");
};

let sharedWs: WebSocket | null = null;
let sharedPingInterval: number | null = null;
let sharedReconnectTimeout: number | null = null;
let sharedConnectWatchdog: number | null = null;
let sharedWsConnectStart = 0;
let sharedLastPongAt = 0;
let subscribedSession: string | null = null;
let wsReady = false;
// Multi-server: 現在の WS 接続が向いている base URL。
// 接続先が切り替わったら force close して新しい URL に再接続する。
let currentWsBase: string | null = null;
let currentWsToken: string | null = null;

// Force-close a CONNECTING socket if onopen hasn't fired by this deadline.
// Mobile networks can leave the TCP handshake in a zombie state — no onopen,
// no onclose — and the existing `ensureConnection()` would early-return on
// CONNECTING forever. The watchdog turns the silent hang into an explicit
// close, letting the onclose reconnect path take over.
const CONNECT_WATCHDOG_MS = 10_000;
const PING_INTERVAL_MS = 10_000;
// Force-close OPEN socket if no pong reply for this long. Catches "silently
// dead" connections where the OS hasn't yet noticed the TCP is gone (common
// on mobile when carrier NAT drops the session).
const PONG_TIMEOUT_MS = 25_000;

// Conversation subscriptions (multiple sessions can be subscribed at once)
const subscribedConversations = new Set<string>();
const pendingConversationSubs = new Set<string>();
const pendingConversationUnsubs = new Set<string>();

function flushConversationPending() {
	if (!sharedWs || sharedWs.readyState !== WebSocket.OPEN || !wsReady) return;
	for (const sid of pendingConversationUnsubs) {
		sharedWs.send(
			JSON.stringify({ type: "unsubscribe-conversation", sessionId: sid }),
		);
		subscribedConversations.delete(sid);
	}
	pendingConversationUnsubs.clear();
	for (const sid of pendingConversationSubs) {
		sharedWs.send(
			JSON.stringify({ type: "subscribe-conversation", sessionId: sid }),
		);
		subscribedConversations.add(sid);
	}
	pendingConversationSubs.clear();
}

type MuxCallbacks = {
	onPaneViewport?: (paneId: string, viewport: PaneViewport) => void;
	onLayoutChange?: (layout: TmuxLayoutNode) => void;
	onNewSession?: (sessionId: string, sessionName: string) => void;
	onPaneDead?: (paneId: string) => void;
	onHookEvent?: (
		event: string,
		cwd?: string,
		sessionId?: string,
		data?: Record<string, unknown>,
		message?: string,
	) => void;
	onConnect?: () => void;
	onDisconnect?: () => void;
	onError?: (error: string, paneId?: string) => void;
	setIsConnected?: (v: boolean) => void;
	setDeadPanes?: (fn: (prev: Set<string>) => Set<string>) => void;
	sessionId: string;
	deadPanes: Set<string>;
};

let activeCallbacks: MuxCallbacks | null = null;

function sendRaw(msg: Record<string, unknown>) {
	if (sharedWs?.readyState === WebSocket.OPEN) {
		sharedWs.send(JSON.stringify(msg));
	}
}

function sendSessionMessage(msg: Record<string, unknown>) {
	if (activeCallbacks) {
		sendRaw({ ...msg, sessionId: activeCallbacks.sessionId });
	}
}

function subscribeToSession(sessionId: string, force = false) {
	if (subscribedSession === sessionId && !force) return;

	if (subscribedSession && subscribedSession !== sessionId) {
		sendRaw({ type: "unsubscribe", sessionId: subscribedSession });
	}

	subscribedSession = sessionId;
	activeCallbacks?.setIsConnected?.(false);
	activeCallbacks?.setDeadPanes?.(() => new Set());
	sendRaw({ type: "subscribe", sessionId });
}

function ensureConnection(token?: string | null, wsBase?: string | null) {
	const desiredBase = wsBase ?? getWsBase();
	const desiredToken = (token ?? getAuthToken()) || null;

	// 接続先 (URL or token) が変わったら force close して再接続させる
	const baseChanged =
		(currentWsBase !== null && currentWsBase !== desiredBase) ||
		(currentWsToken !== null && currentWsToken !== desiredToken);
	if (baseChanged && sharedWs) {
		console.log(
			`[MUX] target changed (${currentWsBase} → ${desiredBase}); reconnecting`,
		);
		try {
			sharedWs.close();
		} catch {}
		sharedWs = null;
		subscribedSession = null;
		wsReady = false;
	}

	currentWsBase = desiredBase;
	currentWsToken = desiredToken;

	if (sharedWs?.readyState === WebSocket.OPEN) return;

	if (sharedWs?.readyState === WebSocket.CONNECTING) {
		const elapsed = Date.now() - sharedWsConnectStart;
		if (elapsed < CONNECT_WATCHDOG_MS) return;
		console.warn(
			`[MUX] stale CONNECTING (${elapsed}ms); force closing for retry`,
		);
		try {
			sharedWs.close();
		} catch {}
		sharedWs = null;
	}

	if (sharedReconnectTimeout) {
		clearTimeout(sharedReconnectTimeout);
		sharedReconnectTimeout = null;
	}
	if (sharedConnectWatchdog) {
		clearTimeout(sharedConnectWatchdog);
		sharedConnectWatchdog = null;
	}

	let wsUrl = `${desiredBase}/ws/mux`;
	if (desiredToken) {
		wsUrl += `?token=${encodeURIComponent(desiredToken)}`;
	}

	const ws = new WebSocket(wsUrl);
	sharedWs = ws;
	wsReady = false;
	sharedWsConnectStart = Date.now();

	sharedConnectWatchdog = window.setTimeout(() => {
		if (sharedWs === ws && ws.readyState === WebSocket.CONNECTING) {
			console.warn(
				"[MUX] connect watchdog timed out; force closing CONNECTING socket",
			);
			try {
				ws.close();
			} catch {}
		}
		sharedConnectWatchdog = null;
	}, CONNECT_WATCHDOG_MS);

	ws.onopen = () => {
		console.log("[MUX] WebSocket opened");
		if (sharedConnectWatchdog) {
			clearTimeout(sharedConnectWatchdog);
			sharedConnectWatchdog = null;
		}
		sharedLastPongAt = Date.now();

		if (sharedPingInterval) clearInterval(sharedPingInterval);
		sharedPingInterval = window.setInterval(() => {
			if (ws.readyState !== WebSocket.OPEN) return;
			if (Date.now() - sharedLastPongAt > PONG_TIMEOUT_MS) {
				console.warn(
					`[MUX] pong timeout (${Date.now() - sharedLastPongAt}ms); force closing socket`,
				);
				try {
					ws.close();
				} catch {}
				return;
			}
			const sid = activeCallbacks?.sessionId || "";
			ws.send(
				JSON.stringify({ type: "ping", timestamp: Date.now(), sessionId: sid }),
			);
		}, PING_INTERVAL_MS);
	};

	let wsMsgCount = 0;

	// Track bytes per second for throughput display
	let wsBytesThisSec = 0;
	const bytesTimer = setInterval(() => {
		window.__cchub_ws_bytes_per_sec = wsBytesThisSec;
		wsBytesThisSec = 0;
	}, 1000);

	// Plain JSON transport only — no binary frames in the state-sync protocol.
	ws.onmessage = (event) => {
		wsMsgCount++;
		if (typeof event.data === "string") {
			wsBytesThisSec += event.data.length;
		}

		if (typeof event.data !== "string") return;

		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(event.data);
		} catch {
			return;
		}

		const cb = activeCallbacks;
		const currentSession = cb?.sessionId;
		const msgSessionId = msg.sessionId as string | undefined;

		switch (msg.type) {
			case "ready": {
				wsReady = true;
				if (currentSession) {
					subscribeToSession(currentSession, true);
				}
				for (const sid of subscribedConversations) {
					pendingConversationSubs.add(sid);
				}
				flushConversationPending();
				break;
			}
			case "subscribed": {
				if (msgSessionId === currentSession) {
					cb?.setIsConnected?.(true);
					cb?.onConnect?.();
				}
				break;
			}
			case "unsubscribed":
				break;
			case "sessions-updated": {
				// Multi-server: peer 接続中の sessions-updated はその peer 単独の
				// セッション一覧で、Hub が返すマージ済みリストと整合しない。
				// Hub に向いている時 (or 初期接続) のみ受け取る。
				const isHubConnection =
					currentWsBase === null || currentWsBase === getWsBase();
				if (isHubConnection) {
					window.dispatchEvent(
						new CustomEvent("cchub-sessions-push", {
							detail: msg.sessions,
						}),
					);
				}
				break;
			}
			case "viewport": {
				if (msgSessionId !== currentSession) return;
				const viewport = msg.viewport as PaneViewport;
				cb?.onPaneViewport?.(viewport.paneId, viewport);
				break;
			}
			case "layout": {
				if (msgSessionId !== currentSession) return;
				cb?.onLayoutChange?.(msg.layout as TmuxLayoutNode);
				break;
			}
			case "pong": {
				sharedLastPongAt = Date.now();
				const rtt = Date.now() - (msg.timestamp as number);
				reportWsLatency(rtt);
				break;
			}
			case "error": {
				if (msgSessionId && msgSessionId !== currentSession) return;
				cb?.onError?.(msg.message as string, msg.paneId as string | undefined);
				break;
			}
			case "new-session": {
				cb?.onNewSession?.(msg.sessionId as string, msg.sessionName as string);
				break;
			}
			case "pane-dead": {
				if (msgSessionId !== currentSession) return;
				cb?.setDeadPanes?.((prev: Set<string>) =>
					new Set(prev).add(msg.paneId as string),
				);
				cb?.onPaneDead?.(msg.paneId as string);
				break;
			}
			case "hook-event": {
				cb?.onHookEvent?.(
					msg.event as string,
					msg.cwd as string | undefined,
					msg.sessionId as string | undefined,
					msg.data as Record<string, unknown> | undefined,
					msg.message as string | undefined,
				);
				break;
			}
			case "conversation-subscribed":
			case "conversation-unsubscribed":
			case "initial-conversation":
			case "conversation-update": {
				window.dispatchEvent(
					new CustomEvent("cchub-conversation", { detail: msg }),
				);
				break;
			}
		}
	};

	ws.onclose = (event) => {
		console.log(
			`[MUX] WebSocket closed: code=${event.code} reason=${event.reason} msgs=${wsMsgCount}`,
		);
		clearInterval(bytesTimer);
		if (sharedConnectWatchdog) {
			clearTimeout(sharedConnectWatchdog);
			sharedConnectWatchdog = null;
		}
		if (sharedWs !== ws) return;

		sharedWs = null;
		wsReady = false;
		subscribedSession = null;
		if (sharedPingInterval) {
			clearInterval(sharedPingInterval);
			sharedPingInterval = null;
		}
		activeCallbacks?.setIsConnected?.(false);
		activeCallbacks?.onDisconnect?.();

		if (event.code !== 1000) {
			sharedReconnectTimeout = window.setTimeout(() => {
				ensureConnection(currentWsToken, currentWsBase);
			}, 2000);
		}
	};

	ws.onerror = () => {
		activeCallbacks?.onError?.("WebSocket connection error");
	};
}

// Visibility-based reconnect (shared, registered once)
let visibilityListenerRegistered = false;
function registerVisibilityListener() {
	if (visibilityListenerRegistered) return;
	visibilityListenerRegistered = true;
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		if (
			!sharedWs ||
			sharedWs.readyState === WebSocket.CLOSED ||
			sharedWs.readyState === WebSocket.CLOSING
		) {
			if (sharedReconnectTimeout) {
				clearTimeout(sharedReconnectTimeout);
				sharedReconnectTimeout = null;
			}
			ensureConnection(currentWsToken, currentWsBase);
			return;
		}
		// Returning to tab: if CONNECTING is older than a short threshold (3s),
		// assume the handshake stalled while backgrounded and force a fresh attempt
		// without waiting the full watchdog window.
		if (
			sharedWs.readyState === WebSocket.CONNECTING &&
			Date.now() - sharedWsConnectStart > 3000
		) {
			console.warn(
				"[MUX] visibility-change: stale CONNECTING, forcing reconnect",
			);
			try {
				sharedWs.close();
			} catch {}
		}
	});

	// Network status: when the OS reports the network came back, force a fresh
	// connection check. Without this, a stale OPEN socket left over from a
	// dropped cellular session can sit unnoticed until the next ping/pong fails.
	window.addEventListener("online", () => {
		console.log("[MUX] navigator online; refreshing connection");
		if (
			sharedWs?.readyState === WebSocket.CONNECTING ||
			sharedWs?.readyState === WebSocket.OPEN
		) {
			try {
				sharedWs.close();
			} catch {}
		}
		if (sharedReconnectTimeout) {
			clearTimeout(sharedReconnectTimeout);
			sharedReconnectTimeout = null;
		}
		ensureConnection(currentWsToken, currentWsBase);
	});
	window.addEventListener("offline", () => {
		console.log("[MUX] navigator offline");
	});
}

// =============================================================================
// Conversation stream API
// =============================================================================

export function subscribeConversation(
	sessionId: string,
	token?: string | null,
) {
	pendingConversationUnsubs.delete(sessionId);
	if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
		if (!subscribedConversations.has(sessionId)) {
			sharedWs.send(
				JSON.stringify({ type: "subscribe-conversation", sessionId }),
			);
			subscribedConversations.add(sessionId);
		} else {
			sharedWs.send(
				JSON.stringify({ type: "subscribe-conversation", sessionId }),
			);
		}
	} else {
		pendingConversationSubs.add(sessionId);
		ensureConnection(token);
	}
}

export function unsubscribeConversation(sessionId: string) {
	pendingConversationSubs.delete(sessionId);
	subscribedConversations.delete(sessionId);
	if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
		sharedWs.send(
			JSON.stringify({ type: "unsubscribe-conversation", sessionId }),
		);
	} else {
		pendingConversationUnsubs.add(sessionId);
	}
}

/**
 * Send terminal input to a specific pane on a session, regardless of which session
 * the active terminal hook is subscribed to. Used by ChatView's composer.
 */
export function sendTerminalInput(
	sessionId: string,
	paneId: string,
	data: string,
): boolean {
	if (sharedWs?.readyState !== WebSocket.OPEN || !wsReady) return false;
	const bytes = new TextEncoder().encode(data);
	const base64 = uint8ArrayToBase64(bytes);
	sharedWs.send(
		JSON.stringify({ type: "input", sessionId, paneId, data: base64 }),
	);
	dispatchInputEcho(sessionId, paneId, data);
	return true;
}

export function dispatchInputEcho(
	sessionId: string,
	paneId: string,
	data: string,
) {
	window.dispatchEvent(
		new CustomEvent("cchub-input-echo", {
			detail: { sessionId, paneId, data },
		}),
	);
}

// =============================================================================
// React Hook
// =============================================================================

export function useMultiplexedTerminal(
	options: UseMultiplexedTerminalOptions,
): UseMultiplexedTerminalReturn {
	const { sessionId, token, peerWsBase } = options;
	const [isConnected, setIsConnected] = useState(false);
	const [deadPanes, setDeadPanes] = useState<Set<string>>(new Set());

	const onPaneViewportRef = useRef(options.onPaneViewport);
	const onLayoutChangeRef = useRef(options.onLayoutChange);
	const onNewSessionRef = useRef(options.onNewSession);
	const onPaneDeadRef = useRef(options.onPaneDead);
	const onHookEventRef = useRef(options.onHookEvent);
	const onConnectRef = useRef(options.onConnect);
	const onDisconnectRef = useRef(options.onDisconnect);
	const onErrorRef = useRef(options.onError);

	onPaneViewportRef.current = options.onPaneViewport;
	onLayoutChangeRef.current = options.onLayoutChange;
	onNewSessionRef.current = options.onNewSession;
	onPaneDeadRef.current = options.onPaneDead;
	onHookEventRef.current = options.onHookEvent;
	onConnectRef.current = options.onConnect;
	onDisconnectRef.current = options.onDisconnect;
	onErrorRef.current = options.onError;

	useEffect(() => {
		activeCallbacks = {
			onPaneViewport: (p, v) => onPaneViewportRef.current?.(p, v),
			onLayoutChange: (l) => onLayoutChangeRef.current?.(l),
			onNewSession: (s, n) => onNewSessionRef.current?.(s, n),
			onPaneDead: (p) => onPaneDeadRef.current?.(p),
			onHookEvent: (e, c, s, d, m) => onHookEventRef.current?.(e, c, s, d, m),
			onConnect: () => onConnectRef.current?.(),
			onDisconnect: () => onDisconnectRef.current?.(),
			onError: (e, p) => onErrorRef.current?.(e, p),
			setIsConnected,
			setDeadPanes,
			sessionId,
			deadPanes,
		};
	});

	useEffect(() => {
		// peer 切替時は ensureConnection が force close + 再接続するので、
		// 接続復帰後 (onopen/ready) で subscribeToSession が呼ばれる
		if (peerWsBase !== undefined) {
			ensureConnection(token, peerWsBase);
		}
		if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
			subscribeToSession(sessionId);
		}
	}, [sessionId, token, peerWsBase]);

	const connect = useCallback(() => {
		registerVisibilityListener();
		ensureConnection(token, peerWsBase);
		if (sharedWs?.readyState === WebSocket.OPEN && wsReady) {
			subscribeToSession(sessionId);
		}
	}, [sessionId, token, peerWsBase]);

	const disconnect = useCallback(() => {
		if (subscribedSession) {
			sendRaw({ type: "unsubscribe", sessionId: subscribedSession });
			subscribedSession = null;
		}
		setIsConnected(false);
	}, []);

	const sendInput = useCallback((paneId: string, data: string) => {
		const bytes = new TextEncoder().encode(data);
		const base64 = uint8ArrayToBase64(bytes);
		sendSessionMessage({ type: "input", paneId, data: base64 });
		if (subscribedSession) dispatchInputEcho(subscribedSession, paneId, data);
	}, []);

	const resize = useCallback((cols: number, rows: number) => {
		sendSessionMessage({ type: "resize", cols, rows });
	}, []);

	const splitPane = useCallback((paneId: string, direction: "h" | "v") => {
		sendSessionMessage({ type: "split", paneId, direction });
	}, []);

	const closePane = useCallback((paneId: string) => {
		sendSessionMessage({ type: "close-pane", paneId });
	}, []);

	const resizePane = useCallback(
		(paneId: string, cols: number, rows: number) => {
			sendSessionMessage({ type: "resize-pane", paneId, cols, rows });
		},
		[],
	);

	const selectPane = useCallback((paneId: string) => {
		sendSessionMessage({ type: "select-pane", paneId });
	}, []);

	const adjustPane = useCallback(
		(paneId: string, direction: "L" | "R" | "U" | "D", amount: number) => {
			sendSessionMessage({ type: "adjust-pane", paneId, direction, amount });
		},
		[],
	);

	const equalizePanes = useCallback((direction: "horizontal" | "vertical") => {
		sendSessionMessage({ type: "equalize-panes", direction });
	}, []);

	const sendClientInfo = useCallback(
		(deviceType: "mobile" | "tablet" | "desktop") => {
			sendSessionMessage({ type: "client-info", deviceType });
		},
		[],
	);

	const requestViewport = useCallback((paneId: string, offset: number) => {
		sendSessionMessage({ type: "request-viewport", paneId, offset });
	}, []);

	const zoomPane = useCallback((paneId: string) => {
		sendSessionMessage({ type: "zoom-pane", paneId });
	}, []);

	const respawnPane = useCallback(
		(paneId: string) => {
			setDeadPanes((prev) => {
				const next = new Set(prev);
				next.delete(paneId);
				return next;
			});
			if (sharedWs?.readyState === WebSocket.OPEN) {
				sendSessionMessage({ type: "respawn-pane", paneId });
			} else {
				const apiBase = import.meta.env.VITE_API_URL || "";
				fetch(
					`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/panes/respawn`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ paneId }),
					},
				)
					.then(() => {
						setTimeout(() => ensureConnection(), 500);
					})
					.catch(() => {
						setTimeout(() => ensureConnection(), 500);
					});
			}
		},
		[sessionId],
	);

	return {
		isConnected,
		connect,
		disconnect,
		sendInput,
		resize,
		splitPane,
		closePane,
		resizePane,
		selectPane,
		adjustPane,
		equalizePanes,
		sendClientInfo,
		requestViewport,
		zoomPane,
		respawnPane,
		deadPanes,
	};
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}
