import { describe, expect, test } from "bun:test";
import { formatModelName, formatUsd } from "./format";

describe("formatUsd", () => {
	test("normal amounts show cents", () => {
		expect(formatUsd(12.3456)).toBe("$12.35");
		expect(formatUsd(0.42)).toBe("$0.42");
	});

	test("sub-cent amounts keep enough precision to stay non-zero", () => {
		// Rounding these to "$0.00" would read as free when they are not.
		expect(formatUsd(0.0042)).toBe("$0.0042");
		expect(formatUsd(0.00001)).toBe("$0.0000");
	});

	test("exact zero stays $0.00", () => {
		expect(formatUsd(0)).toBe("$0.00");
	});

	test("negative balances keep the sign outside the symbol", () => {
		expect(formatUsd(-3.5)).toBe("-$3.50");
	});
});

describe("formatModelName", () => {
	test("new-style Claude ids with minor version", () => {
		expect(formatModelName("claude-opus-4-8-20250815")).toBe("Opus 4.8");
		expect(formatModelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
	});

	test("new-style Claude ids without date", () => {
		expect(formatModelName("claude-fable-5")).toBe("Fable 5");
		expect(formatModelName("claude-sonnet-5")).toBe("Sonnet 5");
	});

	test("major-only version", () => {
		expect(formatModelName("claude-sonnet-4-20250514")).toBe("Sonnet 4");
	});

	test("legacy version-first ids", () => {
		expect(formatModelName("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
		expect(formatModelName("claude-3-opus-20240229")).toBe("Opus 3");
	});

	test("non-Claude ids pass through unchanged", () => {
		expect(formatModelName("gpt-5.6-sol")).toBe("gpt-5.6-sol");
		expect(formatModelName("gpt-5.4-mini")).toBe("gpt-5.4-mini");
	});

	test("unparseable Claude ids fall back to the raw id", () => {
		expect(formatModelName("claude-2.1")).toBe("claude-2.1");
	});
});
