import type { FileChange, FileContent } from "../../../../shared/types";
import type { SelectedGitDiff, ViewMode } from "../../hooks/useViewHistory";
import { CodeViewer } from "./CodeViewer";
import { DiffViewer } from "./DiffViewer";
import {
	getFileName,
	isHtmlFile,
	isImageFile,
	isMarkdownFile,
	isMediaFile,
	isVideoFile,
} from "./file-types";
import { HtmlViewer } from "./HtmlViewer";
import { ImageViewer } from "./ImageViewer";
import { getLanguageFromPath } from "./language-detect";
import { MarkdownViewer } from "./MarkdownViewer";

interface FileContentViewProps {
	viewMode: ViewMode;
	selectedFile: FileContent | null;
	selectedChange: FileChange | null;
	selectedGitDiff: SelectedGitDiff | null;
	previewMode: boolean;
	/** Same-origin blob: URL for image/media, fetched with auth. */
	rawBlobUrl: string | null;
	scrollRatio: number;
	onScrollRatioChange: (ratio: number) => void;
	onCopyPrompt?: (text: string) => void;
	/** Switch a markdown/html source view into preview mode. */
	onEnablePreview: () => void;
	sessionWorkingDir: string;
}

function MediaContent({
	file,
	rawBlobUrl,
}: {
	file: FileContent;
	rawBlobUrl: string | null;
}) {
	return (
		<div className="flex flex-col h-full bg-th-bg">
			<div className="flex-1 flex items-center justify-center overflow-hidden p-2">
				{isVideoFile(file.path) ? (
					// biome-ignore lint/a11y/useMediaCaption: arbitrary user files; no caption track available
					<video
						controls
						playsInline
						preload="metadata"
						className="w-full h-full object-contain rounded"
						src={rawBlobUrl ?? undefined}
					/>
				) : (
					// biome-ignore lint/a11y/useMediaCaption: arbitrary user files; no caption track available
					<audio
						controls
						preload="metadata"
						className="w-full max-w-md"
						src={rawBlobUrl ?? undefined}
					/>
				)}
			</div>
			<div className="px-3 py-1.5 text-xs text-th-text-muted text-center border-t border-th-border">
				{getFileName(file.path)} •{" "}
				{file.size ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ""}
			</div>
		</div>
	);
}

/**
 * The single source of truth for rendering file/diff content. Both the
 * wide (two-pane) and mobile (single-pane) layouts of FileViewer render this,
 * eliminating the previously duplicated image/media/markdown/html/code/diff
 * switch.
 */
export function FileContentView({
	viewMode,
	selectedFile,
	selectedChange,
	selectedGitDiff,
	previewMode,
	rawBlobUrl,
	scrollRatio,
	onScrollRatioChange,
	onCopyPrompt,
	onEnablePreview,
	sessionWorkingDir,
}: FileContentViewProps) {
	if (viewMode === "file" && selectedFile) {
		const path = selectedFile.path;

		if (isImageFile(path)) {
			return (
				<ImageViewer
					content={selectedFile.content}
					mimeType={selectedFile.mimeType}
					fileName={getFileName(path)}
					size={selectedFile.size}
					srcUrl={rawBlobUrl ?? undefined}
				/>
			);
		}

		if (isMediaFile(path)) {
			return <MediaContent file={selectedFile} rawBlobUrl={rawBlobUrl} />;
		}

		if (previewMode && isMarkdownFile(path)) {
			return (
				<MarkdownViewer
					content={selectedFile.content}
					truncated={selectedFile.truncated}
					initialScrollRatio={scrollRatio}
					onScrollRatioChange={onScrollRatioChange}
					filePath={path}
					sessionWorkingDir={sessionWorkingDir}
				/>
			);
		}

		if (previewMode && isHtmlFile(path)) {
			return (
				<HtmlViewer content={selectedFile.content} fileName={getFileName(path)} />
			);
		}

		return (
			<CodeViewer
				onCopyPrompt={onCopyPrompt}
				content={selectedFile.content}
				language={getLanguageFromPath(path)}
				fileName={getFileName(path)}
				filePath={path}
				truncated={selectedFile.truncated}
				showLineNumbers={true}
				hasPreview={isMarkdownFile(path) || isHtmlFile(path)}
				onTogglePreview={onEnablePreview}
				initialScrollRatio={scrollRatio}
				onScrollRatioChange={onScrollRatioChange}
			/>
		);
	}

	if (viewMode === "diff" && selectedChange) {
		return (
			<DiffViewer
				onCopyPrompt={onCopyPrompt}
				oldContent={selectedChange.oldContent}
				newContent={selectedChange.newContent}
				fileName={getFileName(selectedChange.path)}
				toolName={selectedChange.toolName}
			/>
		);
	}

	if (viewMode === "diff" && selectedGitDiff) {
		return (
			<DiffViewer
				onCopyPrompt={onCopyPrompt}
				unifiedDiff={selectedGitDiff.diff}
				fileName={getFileName(selectedGitDiff.path)}
				toolName="git"
			/>
		);
	}

	return null;
}
