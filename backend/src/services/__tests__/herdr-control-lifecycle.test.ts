import { afterEach, describe, expect, test } from "bun:test";
import { HerdrControlSession, herdrControlSessions } from "../herdr-control";

afterEach(() => {
	for (const session of herdrControlSessions.values()) session.destroy();
	herdrControlSessions.clear();
});

describe("HerdrControlSession lifecycle", () => {
	test("notifies every subscriber before a deleted session is destroyed", () => {
		const session = new HerdrControlSession("same-name");
		herdrControlSessions.set("same-name", session);
		const reasons: string[] = [];

		let unsubscribeFirst = () => {};
		unsubscribeFirst = session.onExit((reason) => {
			reasons.push(`first:${reason}`);
			unsubscribeFirst();
		});
		session.onExit((reason) => reasons.push(`second:${reason}`));

		session.terminate("workspace closed");

		expect(reasons).toEqual([
			"first:workspace closed",
			"second:workspace closed",
		]);
		expect(session.isDestroyed).toBe(true);
		expect(herdrControlSessions.has("same-name")).toBe(false);
	});

	test("an old delayed cleanup cannot remove a same-name replacement", () => {
		const oldSession = new HerdrControlSession("same-name");
		const replacement = new HerdrControlSession("same-name");
		herdrControlSessions.set("same-name", replacement);

		oldSession.destroy();

		expect(herdrControlSessions.get("same-name")).toBe(replacement);
		expect(replacement.isDestroyed).toBe(false);
	});
});
