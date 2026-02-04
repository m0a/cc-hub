interface HtmlViewerProps {
  content: string;
  fileName: string;
}

export function HtmlViewer({ content, fileName }: HtmlViewerProps) {
  // Create blob URL for iframe
  const blob = new Blob([content], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/50">
        <span className="text-sm text-gray-300">{fileName}</span>
        <span className="text-xs text-gray-500">HTML Preview</span>
      </div>

      {/* Content */}
      <div className="flex-1 bg-white">
        <iframe
          src={blobUrl}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title={fileName}
        />
      </div>
    </div>
  );
}
