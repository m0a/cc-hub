import { describe, expect, test } from "bun:test";
import { resolveSessionPeer } from "./sessionPeer";

describe("resolveSessionPeer", () => {
	// Same workspace label on both hosts — the collision this resolver exists for.
	const merged = [
		{ id: "cchub", peerId: undefined }, // local, first in display order
		{ id: "cchub", peerId: "mac" },
		{ id: "only-mac", peerId: "mac" },
	];

	test("no sid returns undefined", () => {
		expect(resolveSessionPeer(null, null, [], merged)).toBeUndefined();
	});

	test("intent wins over open sessions and merged order", () => {
		expect(
			resolveSessionPeer(
				"cchub",
				{ id: "cchub", peerId: "mac" },
				[{ id: "cchub", peerId: undefined }],
				merged,
			),
		).toBe("mac");
	});

	test("intent for a different session is ignored", () => {
		expect(
			resolveSessionPeer("cchub", { id: "other", peerId: "mac" }, [], merged),
		).toBeUndefined();
	});

	test("open session entry pins local explicitly when peerId is unset", () => {
		expect(
			resolveSessionPeer("cchub", null, [{ id: "cchub" }], merged),
		).toBe("local");
	});

	test("open session entry carries its remote peer", () => {
		expect(
			resolveSessionPeer("cchub", null, [{ id: "cchub", peerId: "mac" }], merged),
		).toBe("mac");
	});

	test("falls back to the merged list (first match) when no intent is known", () => {
		expect(resolveSessionPeer("only-mac", null, [], merged)).toBe("mac");
		// Collision without intent keeps the historical local-first behavior.
		expect(resolveSessionPeer("cchub", null, [], merged)).toBeUndefined();
	});
});
