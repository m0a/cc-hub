import type { HistorySession } from "../../../shared/types";

type TFunction = (key: string, options?: Record<string, unknown>) => string;

export type HistoryListRow =
	| { kind: "header"; key: string; label: string; count: number }
	| {
			kind: "session";
			key: string;
			session: HistorySession;
			dirName?: string;
	  };

type BucketId = "today" | "yesterday" | "week" | "earlier";

function startOfDay(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function bucketOf(modifiedMs: number, now: number): BucketId {
	if (Number.isNaN(modifiedMs)) return "earlier";
	const todayStart = startOfDay(now);
	const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
	const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
	if (modifiedMs >= todayStart) return "today";
	if (modifiedMs >= yesterdayStart) return "yesterday";
	if (modifiedMs >= weekStart) return "week";
	return "earlier";
}

const BUCKET_LABEL_KEY: Record<BucketId, string> = {
	today: "history.bucketToday",
	yesterday: "history.bucketYesterday",
	week: "history.bucketThisWeek",
	earlier: "history.bucketEarlier",
};

const BUCKET_ORDER: BucketId[] = ["today", "yesterday", "week", "earlier"];

/**
 * Turn a session list into virtualizer rows with inline date bucket headers
 * (Today / Yesterday / This week / Earlier), each header carrying its count.
 *
 * Order-independent: sessions are partitioned by bucket and emitted in the
 * canonical bucket order, so each header appears exactly once even if the input
 * isn't globally sorted (e.g. SSE search results). Within a bucket, input order
 * is preserved — callers pass modified-DESC for a newest-first feel.
 */
export function bucketizeHistory(
	items: HistorySession[],
	dirNameBySession: Map<string, string> | undefined,
	keyOf: (s: HistorySession) => string,
	t: TFunction,
	now: number,
): HistoryListRow[] {
	const grouped: Record<BucketId, HistorySession[]> = {
		today: [],
		yesterday: [],
		week: [],
		earlier: [],
	};
	for (const s of items) {
		grouped[bucketOf(new Date(s.modified).getTime(), now)].push(s);
	}

	const rows: HistoryListRow[] = [];
	for (const b of BUCKET_ORDER) {
		const bucketItems = grouped[b];
		if (bucketItems.length === 0) continue;
		rows.push({
			kind: "header",
			key: `header:${b}`,
			label: t(BUCKET_LABEL_KEY[b]),
			count: bucketItems.length,
		});
		for (const session of bucketItems) {
			const key = keyOf(session);
			rows.push({
				kind: "session",
				key,
				session,
				dirName: dirNameBySession?.get(key),
			});
		}
	}
	return rows;
}
