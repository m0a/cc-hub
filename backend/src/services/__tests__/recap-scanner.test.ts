import { describe, expect, test } from "bun:test";
import { parseRecapFromLines } from "../../utils/recap-scanner";

function jsonl(...entries: unknown[]): string[] {
	return entries.map((e) => JSON.stringify(e));
}

const userRecapTrigger = {
	type: "user",
	message: {
		content: [
			{ type: "text", text: "<command-name>/recap</command-name>" },
		],
	},
};

describe("parseRecapFromLines", () => {
	test("empty input → null", () => {
		expect(parseRecapFromLines([])).toBeNull();
	});

	test("away_summary is picked up and the config hint is stripped", () => {
		const lines = jsonl({
			type: "system",
			subtype: "away_summary",
			content: "進捗まとめ: PR2 を実装中。 (disable recaps in /config)",
			timestamp: "2026-05-30T10:00:00Z",
		});
		const recap = parseRecapFromLines(lines);
		expect(recap).toEqual({
			content: "進捗まとめ: PR2 を実装中。",
			timestamp: "2026-05-30T10:00:00Z",
		});
	});

	test("local_command recap requires a preceding /recap user trigger", () => {
		const withTrigger = jsonl(userRecapTrigger, {
			type: "system",
			subtype: "local_command",
			content: "<local-command-stdout>手動 recap 本文</local-command-stdout>",
			timestamp: "2026-05-30T11:00:00Z",
		});
		expect(parseRecapFromLines(withTrigger)).toEqual({
			content: "手動 recap 本文",
			timestamp: "2026-05-30T11:00:00Z",
		});

		// Same local_command WITHOUT the preceding /recap trigger is ignored.
		const withoutTrigger = jsonl({
			type: "system",
			subtype: "local_command",
			content: "<local-command-stdout>別コマンドの出力</local-command-stdout>",
			timestamp: "2026-05-30T11:00:00Z",
		});
		expect(parseRecapFromLines(withoutTrigger)).toBeNull();
	});

	test("local_command API Error output is skipped", () => {
		const lines = jsonl(userRecapTrigger, {
			type: "system",
			subtype: "local_command",
			content: "<local-command-stdout>API Error: 529 overloaded</local-command-stdout>",
			timestamp: "2026-05-30T11:00:00Z",
		});
		expect(parseRecapFromLines(lines)).toBeNull();
	});

	test("most recent recap wins when both sources are present", () => {
		const lines = jsonl(
			{
				type: "system",
				subtype: "away_summary",
				content: "古い自動 recap",
				timestamp: "2026-05-30T09:00:00Z",
			},
			userRecapTrigger,
			{
				type: "system",
				subtype: "local_command",
				content: "<local-command-stdout>新しい手動 recap</local-command-stdout>",
				timestamp: "2026-05-30T12:00:00Z",
			},
		);
		expect(parseRecapFromLines(lines)?.content).toBe("新しい手動 recap");
	});

	test("a later away_summary overrides an earlier one", () => {
		const lines = jsonl(
			{
				type: "system",
				subtype: "away_summary",
				content: "1回目",
				timestamp: "2026-05-30T09:00:00Z",
			},
			{
				type: "system",
				subtype: "away_summary",
				content: "2回目",
				timestamp: "2026-05-30T10:00:00Z",
			},
		);
		expect(parseRecapFromLines(lines)?.content).toBe("2回目");
	});

	test("an away_summary between /recap and its local_command clears the trigger", () => {
		const lines = jsonl(
			userRecapTrigger,
			{
				type: "system",
				subtype: "away_summary",
				content: "自動まとめ",
				timestamp: "2026-05-30T10:00:00Z",
			},
			{
				type: "system",
				subtype: "local_command",
				content: "<local-command-stdout>trigger を奪われた出力</local-command-stdout>",
				timestamp: "2026-05-30T11:00:00Z",
			},
		);
		// The away_summary consumes the pending trigger, so the local_command is
		// NOT treated as a recap; the away_summary itself is the latest recap.
		expect(parseRecapFromLines(lines)?.content).toBe("自動まとめ");
	});

	test("a non-/recap user entry clears a pending trigger", () => {
		const lines = jsonl(
			userRecapTrigger,
			{ type: "user", message: { content: "ふつうの発言" } },
			{
				type: "system",
				subtype: "local_command",
				content: "<local-command-stdout>これは recap ではない</local-command-stdout>",
				timestamp: "2026-05-30T11:00:00Z",
			},
		);
		expect(parseRecapFromLines(lines)).toBeNull();
	});

	test("invalid JSON lines are skipped without throwing", () => {
		const lines = [
			"not json",
			"",
			JSON.stringify({
				type: "system",
				subtype: "away_summary",
				content: "壊れた行のあとの recap",
				timestamp: "2026-05-30T10:00:00Z",
			}),
		];
		expect(parseRecapFromLines(lines)?.content).toBe("壊れた行のあとの recap");
	});

	test("empty away_summary content does not produce a recap", () => {
		const lines = jsonl({
			type: "system",
			subtype: "away_summary",
			content: " (disable recaps in /config)",
			timestamp: "2026-05-30T10:00:00Z",
		});
		expect(parseRecapFromLines(lines)).toBeNull();
	});
});
