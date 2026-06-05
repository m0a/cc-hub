/** biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: legacy click-on-div UI; keyboard navigation provided via main shortcuts */
import {
	ChevronLeft,
	ChevronRight,
	FileText,
	Minus,
	Plus,
	WrapText,
} from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import "highlight.js/styles/github-dark.css";
import { useLineSelection } from "../../hooks/useLineSelection";
import { usePinchZoom } from "../../hooks/usePinchZoom";
import {
	MAX_FONTSIZE,
	MIN_FONTSIZE,
	useViewerSettings,
} from "../../hooks/useViewerSettings";
import { highlightCode } from "../../utils/highlight";
import { getLanguageFromPath } from "./language-detect";
import { PromptComposer } from "./PromptComposer";

interface DiffViewerProps {
	oldContent?: string;
	newContent?: string;
	fileName?: string;
	filePath?: string;
	toolName?: "Write" | "Edit" | "git";
	unifiedDiff?: string;
	onCopyPrompt?: (text: string) => void;
}

interface DiffLine {
	type: "add" | "remove" | "context" | "hunk";
	content: string;
	oldLineNum?: number;
	newLineNum?: number;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	const result: DiffLine[] = [];

	const lcs = computeLCS(oldLines, newLines);

	let oldIdx = 0;
	let newIdx = 0;
	let lcsIdx = 0;

	while (oldIdx < oldLines.length || newIdx < newLines.length) {
		if (
			lcsIdx < lcs.length &&
			oldIdx < oldLines.length &&
			oldLines[oldIdx] === lcs[lcsIdx]
		) {
			if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
				result.push({
					type: "context",
					content: oldLines[oldIdx],
					oldLineNum: oldIdx + 1,
					newLineNum: newIdx + 1,
				});
				oldIdx++;
				newIdx++;
				lcsIdx++;
			} else {
				result.push({
					type: "add",
					content: newLines[newIdx],
					newLineNum: newIdx + 1,
				});
				newIdx++;
			}
		} else if (
			lcsIdx < lcs.length &&
			newIdx < newLines.length &&
			newLines[newIdx] === lcs[lcsIdx]
		) {
			result.push({
				type: "remove",
				content: oldLines[oldIdx],
				oldLineNum: oldIdx + 1,
			});
			oldIdx++;
		} else if (oldIdx < oldLines.length && newIdx < newLines.length) {
			result.push({
				type: "remove",
				content: oldLines[oldIdx],
				oldLineNum: oldIdx + 1,
			});
			result.push({
				type: "add",
				content: newLines[newIdx],
				newLineNum: newIdx + 1,
			});
			oldIdx++;
			newIdx++;
		} else if (oldIdx < oldLines.length) {
			result.push({
				type: "remove",
				content: oldLines[oldIdx],
				oldLineNum: oldIdx + 1,
			});
			oldIdx++;
		} else if (newIdx < newLines.length) {
			result.push({
				type: "add",
				content: newLines[newIdx],
				newLineNum: newIdx + 1,
			});
			newIdx++;
		}
	}

	return result;
}

function computeLCS(a: string[], b: string[]): string[] {
	const m = a.length;
	const n = b.length;

	const dp: number[][] = Array(m + 1)
		.fill(null)
		.map(() => Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	const lcs: string[] = [];
	let i = m,
		j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			lcs.unshift(a[i - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}

	return lcs;
}

function parseUnifiedDiff(diff: string): DiffLine[] {
	const lines = diff.split("\n");
	const result: DiffLine[] = [];
	let oldLineNum = 0;
	let newLineNum = 0;

	for (const line of lines) {
		if (
			line.startsWith("---") ||
			line.startsWith("+++") ||
			line.startsWith("diff ") ||
			line.startsWith("index ")
		) {
			continue;
		}

		if (line.startsWith("@@")) {
			const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (match) {
				oldLineNum = parseInt(match[1], 10);
				newLineNum = parseInt(match[2], 10);
			}
			result.push({
				type: "hunk",
				content: line,
				oldLineNum: undefined,
				newLineNum: undefined,
			});
			continue;
		}

		if (line.startsWith("\\")) continue;

		if (line.startsWith("+")) {
			result.push({
				type: "add",
				content: line.slice(1),
				newLineNum: newLineNum++,
			});
		} else if (line.startsWith("-")) {
			result.push({
				type: "remove",
				content: line.slice(1),
				oldLineNum: oldLineNum++,
			});
		} else if (line.startsWith(" ")) {
			result.push({
				type: "context",
				content: line.slice(1),
				oldLineNum: oldLineNum++,
				newLineNum: newLineNum++,
			});
		}
	}

	return result;
}

export function DiffViewer({
	oldContent,
	newContent,
	fileName,
	filePath,
	toolName = "Edit",
	unifiedDiff,
	onCopyPrompt,
}: DiffViewerProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const {
		wordWrap,
		toggleWordWrap,
		fontSize,
		setFontSize,
		commitFontSize,
		resetFontSize,
	} = useViewerSettings(fileName);
	const { selection, handleLineClick, isLineSelected, clearSelection } =
		useLineSelection();

	usePinchZoom({
		ref: scrollContainerRef,
		value: fontSize,
		min: MIN_FONTSIZE,
		max: MAX_FONTSIZE,
		onChange: setFontSize,
		onCommit: commitFontSize,
	});

	const scrollRight = useCallback(() => {
		if (scrollContainerRef.current) {
			scrollContainerRef.current.scrollLeft += 200;
		}
	}, []);

	const scrollLeft = useCallback(() => {
		if (scrollContainerRef.current) {
			scrollContainerRef.current.scrollLeft -= 200;
		}
	}, []);

	const language = useMemo(() => {
		if (!fileName) return "plaintext";
		return getLanguageFromPath(fileName);
	}, [fileName]);

	const diffLines = useMemo(() => {
		if (unifiedDiff) {
			return parseUnifiedDiff(unifiedDiff);
		}

		if (toolName === "Write") {
			const lines = (newContent || "").split("\n");
			return lines.map(
				(content, i): DiffLine => ({
					type: "add",
					content,
					newLineNum: i + 1,
				}),
			);
		}

		return computeDiff(oldContent || "", newContent || "");
	}, [oldContent, newContent, toolName, unifiedDiff]);

	// Build highlighted line map from diff lines
	const highlightedMap = useMemo(() => {
		if (language === "plaintext") return null;

		// Reconstruct new-side (context + add) and old-side (context + remove)
		const newSide: { idx: number; content: string }[] = [];
		const oldSide: { idx: number; content: string }[] = [];

		for (let i = 0; i < diffLines.length; i++) {
			const line = diffLines[i];
			if (line.type === "hunk") continue;
			if (line.type === "add" || line.type === "context") {
				newSide.push({ idx: i, content: line.content });
			}
			if (line.type === "remove" || line.type === "context") {
				oldSide.push({ idx: i, content: line.content });
			}
		}

		const highlightedNew = highlightCode(
			newSide.map((l) => l.content).join("\n"),
			language,
		);
		const highlightedOld = highlightCode(
			oldSide.map((l) => l.content).join("\n"),
			language,
		);

		const result = new Map<number, string>();

		// Map new-side (context + add lines)
		for (let i = 0; i < newSide.length; i++) {
			result.set(newSide[i].idx, highlightedNew[i] || "");
		}

		// Map old-side (remove lines only; context already mapped from new-side)
		for (let i = 0; i < oldSide.length; i++) {
			if (!result.has(oldSide[i].idx)) {
				result.set(oldSide[i].idx, highlightedOld[i] || "");
			}
		}

		return result;
	}, [diffLines, language]);

	const stats = useMemo(() => {
		const added = diffLines.filter((l) => l.type === "add").length;
		const removed = diffLines.filter((l) => l.type === "remove").length;
		return { added, removed };
	}, [diffLines]);

	const lineHeight = `${fontSize * 1.5}px`;
	const gutterFontSize = `${Math.max(10, fontSize - 2)}px`;

	return (
		<div className="flex flex-col h-full bg-th-bg text-th-text font-mono text-sm">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-th-border bg-th-surface">
				<FileText className="w-4 h-4 text-yellow-400 shrink-0" />
				{fileName && (
					<span className="text-sm text-th-text-secondary truncate flex-1">
						{fileName}
					</span>
				)}
				{toolName !== "git" && (
					<span
						className={`text-xs px-1.5 py-0.5 rounded ${
							toolName === "Write"
								? "bg-green-900 text-green-300"
								: "bg-yellow-900 text-yellow-300"
						}`}
					>
						{toolName === "Write" ? "新規作成" : "編集"}
					</span>
				)}
			</div>

			{/* Stats */}
			<div className="flex items-center gap-4 px-3 py-1.5 border-b border-th-border bg-th-surface/50 text-xs">
				<span className="text-green-400 flex items-center gap-0.5">
					<Plus className="w-3 h-3" />
					{stats.added} 追加
				</span>
				<span className="text-red-400 flex items-center gap-0.5">
					<Minus className="w-3 h-3" />
					{stats.removed} 削除
				</span>
				<div className="flex items-center gap-1 ml-auto">
					{/* Scroll buttons */}
					{!wordWrap && (
						<>
							<button
								type="button"
								onClick={scrollLeft}
								className="p-1 rounded text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover transition-colors"
								title="左へスクロール"
							>
								<ChevronLeft className="w-4 h-4" />
							</button>
							<button
								type="button"
								onClick={scrollRight}
								className="p-1 rounded text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover transition-colors"
								title="右へスクロール"
							>
								<ChevronRight className="w-4 h-4" />
							</button>
						</>
					)}
					{/* Font size reset */}
					<button
						type="button"
						onClick={resetFontSize}
						className="px-1.5 py-0.5 rounded text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover transition-colors"
						title="フォントサイズをリセット (ピンチでズーム)"
					>
						{fontSize}px
					</button>
					{/* Word wrap toggle */}
					<button
						type="button"
						onClick={toggleWordWrap}
						className={`p-1 rounded transition-colors ${wordWrap ? "bg-blue-600 text-th-text" : "text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover"}`}
						title={wordWrap ? "折り返しOFF" : "折り返しON"}
					>
						<WrapText className="w-4 h-4" />
					</button>
				</div>
			</div>

			{/* Diff content */}
			<div ref={scrollContainerRef} className="flex-1 overflow-auto">
				<div className={`min-h-full ${wordWrap ? "" : "min-w-fit"}`}>
					{diffLines.map((line, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: diff line position is the natural key
							key={i}
							className={`flex min-w-full ${
								line.type === "add"
									? "bg-green-900/30"
									: line.type === "remove"
										? "bg-red-900/30"
										: line.type === "hunk"
											? "bg-blue-900/20"
											: ""
							}`}
						>
							{/* Line numbers - hidden when word wrap is enabled */}
							{!wordWrap &&
								(() => {
									const lineNum =
										line.type === "hunk"
											? null
											: line.newLineNum || line.oldLineNum || null;
									return (
										<div
											className={`shrink-0 text-th-text-muted text-right select-none border-r border-th-border bg-th-surface/50 px-1 min-w-[2rem] ${
												onCopyPrompt && lineNum
													? "cursor-pointer hover:text-th-text hover:bg-blue-900/30"
													: ""
											} ${lineNum && isLineSelected(lineNum) ? "bg-blue-800/40 text-blue-300" : ""}`}
											style={{ fontSize: gutterFontSize, lineHeight }}
											onClick={
												onCopyPrompt && lineNum
													? () => handleLineClick(lineNum)
													: undefined
											}
										>
											{line.type === "hunk"
												? "..."
												: toolName === "Write"
													? line.newLineNum
													: line.newLineNum || line.oldLineNum || ""}
										</div>
									);
								})()}

							{/* Indicator */}
							<div
								className={`w-4 shrink-0 text-center ${
									line.type === "add"
										? "text-green-400 bg-green-900/50"
										: line.type === "remove"
											? "text-red-400 bg-red-900/50"
											: "text-th-text-muted"
								}`}
								style={{ fontSize: gutterFontSize, lineHeight }}
							>
								{line.type === "add" ? "+" : line.type === "remove" ? "-" : ""}
							</div>

							{/* Content */}
							<pre
								className={`flex-1 px-2 ${wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
								style={{ fontSize: `${fontSize}px`, lineHeight }}
							>
								{highlightedMap?.has(i) ? (
									<span
										// biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js output already escaped
										dangerouslySetInnerHTML={{
											__html: highlightedMap.get(i) || "&nbsp;",
										}}
									/>
								) : (
									line.content || " "
								)}
							</pre>
						</div>
					))}
				</div>
			</div>

			{/* Prompt Composer */}
			{selection &&
				onCopyPrompt &&
				(() => {
					// Extract selected lines from diff (context + add lines with newLineNum in range)
					const selectedLines = diffLines
						.filter((l) => {
							const num = l.newLineNum || l.oldLineNum;
							return (
								num &&
								num >= selection.start &&
								num <= selection.end &&
								l.type !== "hunk"
							);
						})
						.map(
							(l) =>
								(l.type === "add" ? "+" : l.type === "remove" ? "-" : " ") +
								l.content,
						);

					return (
						<PromptComposer
							filePath={filePath || fileName || "unknown"}
							startLine={selection.start}
							endLine={selection.end}
							selectedCode={selectedLines.join("\n")}
							language={language}
							onSubmit={(text) => {
								onCopyPrompt(text);
								clearSelection();
							}}
							onClose={clearSelection}
						/>
					);
				})()}
		</div>
	);
}
