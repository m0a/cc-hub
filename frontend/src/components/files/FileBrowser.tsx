/** biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: legacy click-on-div UI; keyboard navigation provided via main shortcuts */
import {
	ChevronRight,
	File,
	FileCode,
	FileText,
	Folder,
	FolderOpen,
	Image,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileInfo } from "../../../../shared/types";
import { authFetch } from "../../services/api";
import { toHomeShortPath } from "../../utils/path";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface FileBrowserProps {
	files: FileInfo[];
	currentPath: string;
	sessionWorkingDir: string;
	isLoading: boolean;
	onSelectFile: (file: FileInfo) => void;
	showHidden?: boolean;
	/** Path of the file currently shown in the viewer (highlighted in the tree). */
	selectedPath?: string;
}

// File type icons
function FileIcon({
	file,
	isExpanded,
}: {
	file: FileInfo;
	isExpanded?: boolean;
}) {
	if (file.type === "directory") {
		return isExpanded ? (
			<FolderOpen className="w-5 h-5 text-yellow-400" />
		) : (
			<Folder className="w-5 h-5 text-yellow-400" />
		);
	}

	// File type detection
	const ext = file.extension?.toLowerCase();

	// Code files
	if (
		[".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".scss"].includes(
			ext || "",
		)
	) {
		return <FileCode className="w-5 h-5 text-blue-400" />;
	}

	// Image files
	if (
		[".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"].includes(
			ext || "",
		)
	) {
		return <Image className="w-5 h-5 text-green-400" />;
	}

	// Markdown/text
	if ([".md", ".txt", ".yaml", ".yml", ".toml"].includes(ext || "")) {
		return <FileText className="w-5 h-5 text-th-text-secondary" />;
	}

	// Default file icon
	return <File className="w-5 h-5 text-th-text-muted" />;
}

function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

// Chevron icon for expand/collapse
function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
	return (
		<ChevronRight
			className={`w-4 h-4 text-th-text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
		/>
	);
}

interface TreeItemProps {
	file: FileInfo;
	depth: number;
	expandedDirs: Set<string>;
	dirContents: Map<string, FileInfo[]>;
	loadingDirs: Set<string>;
	onToggleDir: (path: string) => void;
	onSelectFile: (file: FileInfo) => void;
	showHidden: boolean;
	selectedPath?: string;
}

function TreeItem({
	file,
	depth,
	expandedDirs,
	dirContents,
	loadingDirs,
	onToggleDir,
	onSelectFile,
	showHidden,
	selectedPath,
}: TreeItemProps) {
	const isDirectory = file.type === "directory";
	const isExpanded = expandedDirs.has(file.path);
	const isLoading = loadingDirs.has(file.path);
	const children = dirContents.get(file.path) || [];
	const visibleChildren = showHidden
		? children
		: children.filter((f) => !f.isHidden);
	const isSelected = !isDirectory && selectedPath === file.path;

	const handleClick = () => {
		if (isDirectory) {
			onToggleDir(file.path);
		} else {
			onSelectFile(file);
		}
	};

	return (
		<>
			<div
				onClick={handleClick}
				className={`flex items-center gap-2 py-2.5 px-2 cursor-pointer transition-colors ${
					isSelected
						? "bg-blue-500/15 text-blue-200 border-l-2 border-blue-400"
						: "border-l-2 border-transparent hover:bg-th-surface active:bg-th-surface-hover"
				}`}
				style={{ paddingLeft: `${depth * 20 + 8}px` }}
			>
				{/* Chevron for directories */}
				<div className="w-5 h-5 flex items-center justify-center shrink-0">
					{isDirectory &&
						(isLoading ? (
							<div className="w-4 h-4 border border-gray-500 border-t-transparent rounded-full animate-spin" />
						) : (
							<ChevronIcon isExpanded={isExpanded} />
						))}
				</div>

				{/* Icon */}
				<FileIcon file={file} isExpanded={isExpanded} />

				{/* Name and size */}
				<div className="flex-1 min-w-0 flex items-center gap-2">
					<span className="text-base truncate">{file.name}</span>
					{!isDirectory && (
						<span className="text-sm text-th-text-muted shrink-0">
							{formatFileSize(file.size)}
						</span>
					)}
				</div>
			</div>

			{/* Children (if expanded) */}
			{isDirectory && isExpanded && visibleChildren.length > 0 && (
				<div>
					{visibleChildren.map((child) => (
						<TreeItem
							key={child.path}
							file={child}
							depth={depth + 1}
							expandedDirs={expandedDirs}
							dirContents={dirContents}
							loadingDirs={loadingDirs}
							onToggleDir={onToggleDir}
							onSelectFile={onSelectFile}
							showHidden={showHidden}
							selectedPath={selectedPath}
						/>
					))}
				</div>
			)}
		</>
	);
}

export function FileBrowser({
	files,
	currentPath,
	sessionWorkingDir,
	isLoading,
	onSelectFile,
	showHidden = false,
	selectedPath,
}: FileBrowserProps) {
	const { t } = useTranslation();
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
	const [dirContents, setDirContents] = useState<Map<string, FileInfo[]>>(
		new Map(),
	);
	const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

	// Filter hidden files if needed
	const visibleFiles = showHidden ? files : files.filter((f) => !f.isHidden);

	// Load directory contents
	const loadDirContents = useCallback(
		async (path: string) => {
			setLoadingDirs((prev) => new Set(prev).add(path));

			try {
				const params = new URLSearchParams({
					path,
					sessionWorkingDir,
				});
				const response = await authFetch(
					`${API_BASE}/api/files/list?${params}`,
				);

				if (response.ok) {
					const data = await response.json();
					setDirContents((prev) => new Map(prev).set(path, data.files));
				}
			} catch (err) {
				console.error("Failed to load directory:", err);
			} finally {
				setLoadingDirs((prev) => {
					const next = new Set(prev);
					next.delete(path);
					return next;
				});
			}
		},
		[sessionWorkingDir],
	);

	// Toggle directory expand/collapse
	const handleToggleDir = useCallback(
		async (path: string) => {
			if (expandedDirs.has(path)) {
				// Collapse
				setExpandedDirs((prev) => {
					const next = new Set(prev);
					next.delete(path);
					return next;
				});
			} else {
				// Expand
				setExpandedDirs((prev) => new Set(prev).add(path));

				// Load contents if not already loaded
				if (!dirContents.has(path)) {
					await loadDirContents(path);
				}
			}
		},
		[expandedDirs, dirContents, loadDirContents],
	);

	// Get short path for display
	const shortPath = toHomeShortPath(currentPath);

	// Show the loading placeholder only on the initial directory load (when no
	// files have arrived yet). Once we have a tree, keep it mounted so reading
	// a file's contents doesn't unmount the list and reset the user's scroll
	// position.
	const showLoadingPlaceholder = isLoading && visibleFiles.length === 0;

	return (
		<div className="flex flex-col h-full bg-th-bg text-th-text">
			{/* File tree */}
			<div className="flex-1 overflow-y-auto">
				{showLoadingPlaceholder ? (
					<div className="flex items-center justify-center h-32">
						<div className="text-th-text-muted">{t("common.loading")}</div>
					</div>
				) : visibleFiles.length === 0 ? (
					<div className="flex items-center justify-center h-32">
						<div className="text-th-text-muted">{t("files.noFiles")}</div>
					</div>
				) : (
					<div className="py-1">
						{visibleFiles.map((file) => (
							<TreeItem
								key={file.path}
								file={file}
								depth={0}
								expandedDirs={expandedDirs}
								dirContents={dirContents}
								loadingDirs={loadingDirs}
								onToggleDir={handleToggleDir}
								onSelectFile={onSelectFile}
								showHidden={showHidden}
								selectedPath={selectedPath}
							/>
						))}
					</div>
				)}
			</div>

			{/* Path bar - at bottom */}
			<div className="px-3 py-2 border-t border-th-border bg-th-surface">
				<div
					className="text-sm text-th-text-secondary truncate font-mono"
					title={currentPath}
				>
					{shortPath}
				</div>
			</div>
		</div>
	);
}
