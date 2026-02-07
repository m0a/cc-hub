import { useState } from 'react';

interface ImageViewerProps {
  content: string; // base64 encoded
  mimeType: string;
  fileName?: string;
  size?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function ImageViewer({
  content,
  mimeType,
  fileName,
  size,
}: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const dataUrl = `data:${mimeType};base64,${content}`;

  const handleZoomIn = () => setScale(s => Math.min(s * 1.5, 5));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.5, 0.1));
  const handleZoomReset = () => setScale(1);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800">
        <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {fileName && (
          <span className="text-sm text-gray-300 truncate flex-1">{fileName}</span>
        )}
        <span className="text-xs text-gray-500">
          {naturalSize && `${naturalSize.width}×${naturalSize.height}`}
          {size && ` • ${formatFileSize(size)}`}
        </span>
      </div>

      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-800/50">
        <button
          onClick={handleZoomOut}
          className="p-1.5 hover:bg-gray-700 rounded transition-colors"
          title="縮小"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={handleZoomReset}
          className="px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 rounded transition-colors min-w-[60px]"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={handleZoomIn}
          className="p-1.5 hover:bg-gray-700 rounded transition-colors"
          title="拡大"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Image */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-950">
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
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
          }}
        >
          <img
            src={dataUrl}
            alt={fileName || 'Image'}
            onLoad={handleImageLoad}
            className="max-w-none"
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'center',
              transition: 'transform 0.1s ease-out',
            }}
          />
        </div>
      </div>
    </div>
  );
}
