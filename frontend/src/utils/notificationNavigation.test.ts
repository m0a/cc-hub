import { describe, expect, test } from "bun:test";
import {
	findNotificationSession,
	isSameNotificationPeer,
	parseNotificationTarget,
} from "./notificationNavigation";

const sessions = [
	{
		id: "claude-local",
		ccSessionId: "claude-thread",
		peerId: "local",
	},
	{
		id: "codex-local",
		agentSessionId: "codex-thread",
		peerId: "local",
	},
	{
		id: "codex-remote",
		agentSessionId: "codex-thread",
		peerId: "peer-1",
	},
];

describe("parseNotificationTarget", () => {
	test("parses session and peer from a notification deep link", () => {
		expect(
			parseNotificationTarget(
				"?notify-session=thread%2F1&notify-peer=peer%201",
			),
		).toEqual({ sessionId: "thread/1", peerId: "peer 1" });
	});

	test("rejects a deep link without a session", () => {
		expect(parseNotificationTarget("?notify-peer=peer-1")).toBeNull();
	});
});

describe("findNotificationSession", () => {
	test("matches Claude sessions by ccSessionId", () => {
		expect(
			findNotificationSession(sessions, { sessionId: "claude-thread" })?.id,
		).toBe("claude-local");
	});

	test("matches Codex sessions by agentSessionId", () => {
		expect(
			findNotificationSession(sessions, { sessionId: "codex-thread" })?.id,
		).toBe("codex-local");
	});

	test("uses peerId to select the remote session", () => {
		expect(
			findNotificationSession(sessions, {
				sessionId: "codex-thread",
				peerId: "peer-1",
			})?.id,
		).toBe("codex-remote");
	});

	test("does not fall through to another peer when the requested peer is absent", () => {
		expect(
			findNotificationSession(sessions, {
				sessionId: "codex-thread",
				peerId: "peer-missing",
			}),
		).toBeUndefined();
	});
});

describe("isSameNotificationPeer", () => {
	test("treats an omitted peer as the local peer", () => {
		expect(isSameNotificationPeer(undefined, "local")).toBeTrue();
	});
});

describe("notification Service Worker", () => {
	async function loadClickHandler(clients: unknown[], openWindow = () => {}) {
		const handlers = new Map<string, (event: unknown) => void>();
		const worker = {
			addEventListener: (type: string, handler: (event: unknown) => void) => {
				handlers.set(type, handler);
			},
			clients: {
				matchAll: async () => clients,
				openWindow,
			},
		};
		const source = await Bun.file(
			new URL("../../public/sw-notification.js", import.meta.url),
		).text();
		new Function("self", source)(worker);
		return handlers.get("notificationclick");
	}

	test("posts to and focuses an existing client without navigating it", async () => {
		const messages: unknown[] = [];
		let focusCount = 0;
		let navigateCount = 0;
		const handler = await loadClickHandler([
			{
				postMessage: (message: unknown) => messages.push(message),
				focus: async () => {
					focusCount++;
				},
				navigate: async () => {
					navigateCount++;
				},
			},
		]);
		let completion: Promise<unknown> | undefined;
		handler?.({
			notification: {
				data: { sessionId: "codex-thread", peerId: "peer-1" },
				close: () => {},
			},
			waitUntil: (promise: Promise<unknown>) => {
				completion = promise;
			},
		});
		await completion;

		expect(focusCount).toBe(1);
		expect(navigateCount).toBe(0);
		expect(messages).toContainEqual({
			type: "notification-click",
			sessionId: "codex-thread",
			peerId: "peer-1",
		});
	});

	test("opens an encoded deep link when no client exists", async () => {
		let openedUrl = "";
		const handler = await loadClickHandler([], (url?: string) => {
			openedUrl = url || "";
		});
		let completion: Promise<unknown> | undefined;
		handler?.({
			notification: {
				data: { sessionId: "thread/1", peerId: "peer 1" },
				close: () => {},
			},
			waitUntil: (promise: Promise<unknown>) => {
				completion = promise;
			},
		});
		await completion;

		expect(openedUrl).toBe(
			"/?notify-session=thread%2F1&notify-peer=peer+1",
		);
	});
});
