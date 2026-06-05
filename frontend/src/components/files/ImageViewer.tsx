import { Image, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface ImageViewerProps {
	content: string; // base64 encoded (fallback for small images)
	mimeType: string;
	fileName?: string;
	size?: number;
	/** Optional direct URL for streaming large images (avoids base64 truncation) */
	srcUrl?: string;
}

function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function ImageViewer({
	content,
	mimeType,
	fileName,
	size,
	srcUrl,
}: ImageViewerProps) {
	const { t } = useTranslation();
	const [scale, setScale] = useState(1);
	const [naturalSize, setNaturalSize] = useState<{
		width: number;
		height: number;
	} | null>(null);

	const dataUrl = srcUrl || `data:${mimeType};base64,${content}`;

	const handleZoomIn = () => setScale((s) => Math.min(s * 1.5, 5));
	const handleZoomOut = () => setScale((s) => Math.max(s / 1.5, 0.1));
	const handleZoomReset = () => setScale(1);

	const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
		const img = e.currentTarget;
		setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
	};

	return (
		<div className="flex flex-col h-full bg-th-bg text-th-text">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-th-border bg-th-surface">
				<Image className="w-4 h-4 text-green-400 shrink-0" />
				{fileName && (
					<span className="text-sm text-th-text-secondary truncate flex-1">
						{fileName}
					</span>
				)}
				<span className="text-xs text-th-text-muted">
					{naturalSize && `${naturalSize.width}×${naturalSize.height}`}
					{size && ` • ${formatFileSize(size)}`}
				</span>
			</div>

			{/* Zoom controls */}
			<div className="flex items-center justify-center gap-2 px-3 py-1.5 border-b border-th-border bg-th-surface/50">
				<button
					type="button"
					onClick={handleZoomOut}
					className="p-1.5 hover:bg-th-surface-hover rounded transition-colors"
					title={t("files.zoomOut")}
				>
					<ZoomOut className="w-4 h-4" />
				</button>
				<button
					type="button"
					onClick={handleZoomReset}
					className="px-2 py-1 text-xs text-th-text-secondary hover:bg-th-surface-hover rounded transition-colors min-w-[60px]"
				>
					{Math.round(scale * 100)}%
				</button>
				<button
					type="button"
					onClick={handleZoomIn}
					className="p-1.5 hover:bg-th-surface-hover rounded transition-colors"
					title={t("files.zoomIn")}
				>
					<ZoomIn className="w-4 h-4" />
				</button>
			</div>

			{/* Image */}
			<div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-th-bg">
				<div
					className="flex items-center justify-center"
					style={{
						// Checkered background for transparency
						backgroundImage: `
              linear-gradient(45deg, #374151 25%, transparent 25%),
              linear-gradient(-45deg, #374151 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #374151 75%),
              linear-gradient(-45deg, transparent 75%, #374151 75%)
            `,
						backgroundSize: "20px 20px",
						backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
					}}
				>
					<img
						src={dataUrl}
						alt={fileName || "Image"}
						onLoad={handleImageLoad}
						className="max-w-none"
						style={{
							transform: `scale(${scale})`,
							transformOrigin: "center",
							transition: "transform 0.1s ease-out",
						}}
					/>
				</div>
			</div>
		</div>
	);
}
