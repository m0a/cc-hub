import { describe, expect, test } from "bun:test";
import {
	makeSessionKey,
	migrateStoredPaneNode,
	normalizeSessionKey,
	parseSessionKey,
	sessionKeyOf,
	type StoredPaneNode,
} from "./sessionKey";

describe("makeSessionKey / parseSessionKey", () => {
	test("unset peer means local", () => {
		expect(makeSessionKey("cchub")).toBe("local:cchub");
		expect(makeSessionKey("cchub", undefined)).toBe("local:cchub");
		expect(makeSessionKey("cchub", null)).toBe("local:cchub");
	});

	test("remote peer round-trips", () => {
		const key = makeSessionKey("cchub", "p_ab12cd34");
		expect(key).toBe("p_ab12cd34:cchub");
		expect(parseSessionKey(key)).toEqual({ peerId: "p_ab12cd34", id: "cchub" });
	});

	test("id containing ':' round-trips (only the peer prefix is split off)", () => {
		const key = makeSessionKey("feat:branch", "p_12ab34cd");
		expect(parseSessionKey(key)).toEqual({
			peerId: "p_12ab34cd",
			id: "feat:branch",
		});
		expect(parseSessionKey("local:a:b")).toEqual({ peerId: "local", id: "a:b" });
	});

	test("legacy bare id parses as local", () => {
		expect(parseSessionKey("my-workspace")).toEqual({
			peerId: "local",
			id: "my-workspace",
		});
	});

	test("bare id with a non-peer-shaped ':' prefix stays intact", () => {
		expect(parseSessionKey("feat:branch")).toEqual({
			peerId: "local",
			id: "feat:branch",
		});
	});

	test("sessionKeyOf reads the (id, peerId) tuple", () => {
		expect(sessionKeyOf({ id: "cchub" })).toBe("local:cchub");
		expect(sessionKeyOf({ id: "cchub", peerId: "p_ab12cd34" })).toBe(
			"p_ab12cd34:cchub",
		);
	});
});

describe("normalizeSessionKey", () => {
	test("bare id becomes a local key", () => {
		expect(normalizeSessionKey("cchub")).toBe("local:cchub");
	});

	test("idempotent on composite keys", () => {
		expect(normalizeSessionKey("local:cchub")).toBe("local:cchub");
		expect(normalizeSessionKey("p_ab12cd34:cchub")).toBe("p_ab12cd34:cchub");
	});
});

describe("migrateStoredPaneNode", () => {
	const intent = { id: "cchub", peerId: "p_ab12cd34" };

	test("legacy bare id matching the intent keeps that peer", () => {
		const node: StoredPaneNode = { type: "terminal", id: "pane-1", sessionId: "cchub" };
		expect(migrateStoredPaneNode(node, intent)).toEqual({
			type: "terminal",
			id: "pane-1",
			sessionKey: "p_ab12cd34:cchub",
		});
	});

	test("legacy bare id not matching the intent becomes local", () => {
		const node: StoredPaneNode = { type: "terminal", id: "pane-1", sessionId: "other" };
		expect(migrateStoredPaneNode(node, intent)).toEqual({
			type: "terminal",
			id: "pane-1",
			sessionKey: "local:other",
		});
	});

	test("null session stays null and the legacy field is dropped", () => {
		const node: StoredPaneNode = { type: "terminal", id: "pane-1", sessionId: null };
		expect(migrateStoredPaneNode(node, null)).toEqual({
			type: "terminal",
			id: "pane-1",
			sessionKey: null,
		});
	});

	test("already-migrated trees are unchanged (intent is ignored)", () => {
		const node: StoredPaneNode = {
			type: "terminal",
			id: "pane-1",
			sessionKey: "local:cchub",
		};
		expect(migrateStoredPaneNode(node, intent)).toEqual(node);
	});

	test("splits recurse into children", () => {
		const node: StoredPaneNode = {
			type: "split",
			id: "split-r",
			direction: "horizontal",
			ratio: [50, 50],
			children: [
				{ type: "terminal", id: "%1", sessionId: "cchub" },
				{ type: "terminal", id: "%2", sessionId: "cchub" },
			],
		};
		const migrated = migrateStoredPaneNode(node, intent);
		expect(migrated.children?.map((c) => c.sessionKey)).toEqual([
			"p_ab12cd34:cchub",
			"p_ab12cd34:cchub",
		]);
		expect(migrated.ratio).toEqual([50, 50]);
	});

	test("unknown legacy leaf types pass through untouched", () => {
		const node: StoredPaneNode = { type: "dashboard", id: "pane-9" };
		expect(migrateStoredPaneNode(node, null)).toEqual(node);
	});
});
