type TFunction = (key: string, options?: Record<string, unknown>) => string;

export function formatRelativeTime(
	isoDate: string,
	t: TFunction,
	locale: string,
): string {
	const ts = Date.parse(isoDate);
	if (Number.isNaN(ts)) return "";
	const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (diffSec < 5) return t("time.now");
	if (diffSec < 60) return t("time.secondsAgo", { count: diffSec });
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return t("time.minutesAgo", { count: diffMin });
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return t("time.hoursAgo", { count: diffHr });
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 7) return t("time.daysAgo", { count: diffDay });
	const dateLocale = locale === "ja" ? "ja-JP" : "en-US";
	return new Date(ts).toLocaleDateString(dateLocale);
}

/**
 * Compress a model id into a short display name.
 * Claude ids ("claude-opus-4-8-20250815", "claude-3-5-sonnet-20241022") become
 * "Opus 4.8" / "Sonnet 3.5"; anything else (e.g. Codex "gpt-5.6-sol") is
 * returned unchanged.
 */
/** Compact token count: 1234 → "1.2K", 5_600_000 → "5.6M". */
export function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000_000) {
		return `${(tokens / 1_000_000_000).toFixed(1)}B`;
	}
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}K`;
	}
	return tokens.toString();
}

export function formatModelName(modelId: string): string {
	if (!modelId.startsWith("claude-")) return modelId;
	const tokens = modelId
		.slice("claude-".length)
		.split("-")
		.filter((tok) => !/^\d{8}$/.test(tok)); // drop the release-date suffix
	const family = tokens.find((tok) => /^[a-z]/i.test(tok));
	if (!family) return modelId;
	const version = tokens.filter((tok) => /^\d+$/.test(tok)).join(".");
	const name = family.charAt(0).toUpperCase() + family.slice(1);
	return version ? `${name} ${version}` : name;
}

/**
 * Format a duration in minutes into a localized "Xm" / "Xh Ym" / "Xh" string.
 * Returns null for zero/undefined so callers can omit the field entirely.
 */
export function formatDuration(
	minutes: number | undefined,
	t: TFunction,
): string | null {
	if (!minutes || minutes <= 0) return null;
	if (minutes < 60) return t("time.minutes", { count: minutes });
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return mins > 0
		? t("time.hoursMinutes", { hours, minutes: mins })
		: t("time.hours", { count: hours });
}
