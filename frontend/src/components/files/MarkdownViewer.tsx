/** biome-ignore-all lint/correctness/useExhaustiveDependencies: depends on refs and setters that React guarantees stable; adding them would cause unintended re-runs */
import hljs from "highlight.js";
import { useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";

const FONTSIZE_STORAGE_KEY = "cchub-fontsize";
const DEFAULT_FONTSIZE = 14;
const MIN_FONTSIZE = 8;
const MAX_FONTSIZE = 32;

function getFontSizeSetting(): number {
	try {
		const stored = localStorage.getItem(FONTSIZE_STORAGE_KEY);
		if (stored) {
			const size = parseInt(stored, 10);
			if (!Number.isNaN(size) && size >= MIN_FONTSIZE && size <= MAX_FONTSIZE) {
				return size;
			}
		}
	} catch {
		// ignore
	}
	return DEFAULT_FONTSIZE;
}

function getTouchDistance(touches: TouchList): number {
	if (touches.length < 2) return 0;
	const dx = touches[0].clientX - touches[1].clientX;
	const dy = touches[0].clientY - touches[1].clientY;
	return Math.sqrt(dx * dx + dy * dy);
}

interface MarkdownViewerProps {
	content: string;
	truncated?: boolean;
	initialScrollRatio?: number;
	onScrollRatioChange?: (ratio: number) => void;
	filePath?: string;
	sessionWorkingDir?: string;
}

function resolveImageSrc(
	src: string,
	filePath?: string,
	sessionWorkingDir?: string,
): string {
	if (!src) return src;
	// Absolute URL or data/blob — pass through
	if (/^(https?:\/\/|data:|blob:|\/\/)/.test(src)) return src;
	if (!filePath || !sessionWorkingDir) return src;

	let absPath: string;
	if (src.startsWith("/")) {
		absPath = src;
	} else {
		const dir = filePath.replace(/\/[^/]*$/, "");
		const parts = dir.split("/");
		for (const segment of src.split("/")) {
			if (segment === "..") parts.pop();
			else if (segment !== "." && segment !== "") parts.push(segment);
		}
		absPath = parts.join("/");
	}
	return `/api/files/raw?path=${encodeURIComponent(absPath)}&sessionWorkingDir=${encodeURIComponent(sessionWorkingDir)}`;
}

export function MarkdownViewer({
	content,
	truncated = false,
	initialScrollRatio = 0,
	onScrollRatioChange,
	filePath,
	sessionWorkingDir,
}: MarkdownViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const fontSizeRef = useRef(getFontSizeSetting());

	// Pinch zoom state
	const pinchStateRef = useRef<{
		initialDistance: number;
		initialFontSize: number;
	} | null>(null);

	// Pinch zoom handlers
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleTouchStart = (e: TouchEvent) => {
			if (e.touches.length === 2) {
				e.preventDefault();
				pinchStateRef.current = {
					initialDistance: getTouchDistance(e.touches),
					initialFontSize: fontSizeRef.current,
				};
			}
		};

		const handleTouchMove = (e: TouchEvent) => {
			if (e.touches.length === 2 && pinchStateRef.current) {
				e.preventDefault();
				const currentDistance = getTouchDistance(e.touches);
				const scale = currentDistance / pinchStateRef.current.initialDistance;
				const newSize = Math.round(
					pinchStateRef.current.initialFontSize * scale,
				);
				const clampedSize = Math.max(
					MIN_FONTSIZE,
					Math.min(MAX_FONTSIZE, newSize),
				);
				fontSizeRef.current = clampedSize;
				if (container) {
					container.style.fontSize = `${clampedSize}px`;
				}
			}
		};

		const handleTouchEnd = (e: TouchEvent) => {
			if (pinchStateRef.current && e.touches.length < 2) {
				try {
					localStorage.setItem(
						FONTSIZE_STORAGE_KEY,
						String(fontSizeRef.current),
					);
				} catch {
					/* ignore */
				}
				pinchStateRef.current = null;
			}
		};

		container.addEventListener("touchstart", handleTouchStart, {
			passive: false,
		});
		container.addEventListener("touchmove", handleTouchMove, {
			passive: false,
		});
		container.addEventListener("touchend", handleTouchEnd);

		return () => {
			container.removeEventListener("touchstart", handleTouchStart);
			container.removeEventListener("touchmove", handleTouchMove);
			container.removeEventListener("touchend", handleTouchEnd);
		};
	}, []);

	// Restore scroll position from ratio on mount
	useEffect(() => {
		if (initialScrollRatio > 0 && containerRef.current) {
			const el = containerRef.current;
			requestAnimationFrame(() => {
				el.scrollTop = initialScrollRatio * (el.scrollHeight - el.clientHeight);
			});
		}
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Track scroll ratio for parent
	const onScrollRatioChangeRef = useRef(onScrollRatioChange);
	onScrollRatioChangeRef.current = onScrollRatioChange;
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const handleScroll = () => {
			const maxScroll = el.scrollHeight - el.clientHeight;
			const ratio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
			onScrollRatioChangeRef.current?.(ratio);
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => el.removeEventListener("scroll", handleScroll);
	}, []);

	// Reset font size to default
	const resetFontSize = useCallback(() => {
		fontSizeRef.current = DEFAULT_FONTSIZE;
		try {
			localStorage.setItem(FONTSIZE_STORAGE_KEY, String(DEFAULT_FONTSIZE));
		} catch {
			/* ignore */
		}
		if (containerRef.current) {
			containerRef.current.style.fontSize = `${DEFAULT_FONTSIZE}px`;
		}
	}, []);

	return (
		<div className="relative flex flex-col h-full bg-th-bg text-th-text">
			{truncated && (
				<div className="px-3 py-1.5 bg-yellow-900/50 text-yellow-300 text-xs border-b border-yellow-800">
					ファイルが大きすぎるため一部のみ表示しています
				</div>
			)}

			<div
				ref={containerRef}
				className="flex-1 overflow-auto touch-pan-y p-4 markdown-content select-text"
				style={{
					fontSize: `${fontSizeRef.current}px`,
					WebkitUserSelect: "text",
					userSelect: "text",
				}}
			>
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					components={{
						pre: ({ children }) => (
							<pre className="bg-th-surface p-3 rounded-md overflow-x-auto my-3 text-sm">
								{children}
							</pre>
						),
						code: ({ children, className }) => {
							const match = /language-(\w+)/.exec(className || "");
							const lang = match?.[1];
							const isBlock = Boolean(className);

							if (isBlock && lang && hljs.getLanguage(lang)) {
								const highlighted = hljs.highlight(
									String(children).replace(/\n$/, ""),
									{ language: lang },
								);
								return (
									<code
										className={`hljs language-${lang}`}
										// biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js produces escaped HTML
										dangerouslySetInnerHTML={{ __html: highlighted.value }}
									/>
								);
							}

							return isBlock ? (
								<code className="text-green-300">{children}</code>
							) : (
								<code className="bg-th-surface-hover px-1.5 py-0.5 rounded text-blue-300 text-sm">
									{children}
								</code>
							);
						},
						p: ({ children }) => (
							<p className="my-3 leading-relaxed">{children}</p>
						),
						ul: ({ children }) => (
							<ul className="list-disc ml-5 my-3 space-y-1">{children}</ul>
						),
						ol: ({ children }) => (
							<ol className="list-decimal ml-5 my-3 space-y-1">{children}</ol>
						),
						li: ({ children }) => (
							<li className="leading-relaxed">{children}</li>
						),
						h1: ({ children }) => (
							<h1 className="text-2xl font-bold my-4 pb-2 border-b border-th-border">
								{children}
							</h1>
						),
						h2: ({ children }) => (
							<h2 className="text-xl font-bold my-4 pb-1 border-b border-th-border">
								{children}
							</h2>
						),
						h3: ({ children }) => (
							<h3 className="text-lg font-bold my-3">{children}</h3>
						),
						h4: ({ children }) => (
							<h4 className="text-base font-bold my-2">{children}</h4>
						),
						h5: ({ children }) => (
							<h5 className="text-sm font-bold my-2">{children}</h5>
						),
						h6: ({ children }) => (
							<h6 className="text-sm font-bold my-2 text-th-text-secondary">
								{children}
							</h6>
						),
						strong: ({ children }) => (
							<strong className="font-bold text-th-text">{children}</strong>
						),
						em: ({ children }) => <em className="italic">{children}</em>,
						a: ({ href, children }) => (
							<a
								href={href}
								className="text-blue-400 hover:text-blue-300 underline"
								target="_blank"
								rel="noopener noreferrer"
							>
								{children}
							</a>
						),
						blockquote: ({ children }) => (
							<blockquote className="border-l-4 border-th-border pl-4 my-3 text-th-text-secondary italic">
								{children}
							</blockquote>
						),
						hr: () => <hr className="my-6 border-th-border" />,
						table: ({ children }) => (
							<div className="overflow-x-auto my-4">
								<table className="min-w-full border border-th-border rounded">
									{children}
								</table>
							</div>
						),
						thead: ({ children }) => (
							<thead className="bg-th-surface">{children}</thead>
						),
						th: ({ children }) => (
							<th className="border border-th-border px-3 py-2 text-left font-semibold">
								{children}
							</th>
						),
						td: ({ children }) => (
							<td className="border border-th-border px-3 py-2">{children}</td>
						),
						img: ({ src, alt }) => (
							<img
								src={resolveImageSrc(
									typeof src === "string" ? src : "",
									filePath,
									sessionWorkingDir,
								)}
								alt={alt || "Image"}
								className="max-w-full h-auto rounded my-3"
								loading="lazy"
							/>
						),
						input: ({ type, checked, disabled }) => {
							if (type === "checkbox") {
								return (
									<input
										type="checkbox"
										checked={checked}
										disabled={disabled}
										className="mr-2 accent-blue-500"
										readOnly
									/>
								);
							}
							return null;
						},
					}}
				>
					{content}
				</ReactMarkdown>
			</div>

			{/* Controls - font size only */}
			<div className="absolute top-2 right-2 flex items-center gap-1 bg-th-surface/90 rounded-md p-1 backdrop-blur-sm">
				<button
					type="button"
					onClick={resetFontSize}
					className="px-1.5 py-0.5 text-xs text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover rounded transition-colors"
					title="フォントサイズをリセット (ピンチでズーム)"
				>
					{fontSizeRef.current}px
				</button>
			</div>
		</div>
	);
}
