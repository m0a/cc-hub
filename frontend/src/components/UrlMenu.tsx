import { memo } from 'react';

interface UrlMenuProps {
  urls: string[];
  urlPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onCopy: (url: string) => void;
  onOpen: (url: string) => void;
  onClose: () => void;
}

export const UrlMenu = memo(function UrlMenu({
  urls,
  urlPage,
  pageSize,
  onPageChange,
  onCopy,
  onOpen,
  onClose,
}: UrlMenuProps) {
  const totalPages = Math.ceil(urls.length / pageSize);
  const startIdx = urlPage * pageSize;
  const pageUrls = urls.slice(startIdx, startIdx + pageSize);

  return (
    <div className="absolute inset-0 z-40 bg-[var(--color-overlay)] flex items-center justify-center p-4">
      <div className="bg-th-surface rounded-lg w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-th-border">
          <span className="text-th-text font-medium">
            URL一覧 {urls.length > 0 && `(${startIdx + 1}-${Math.min(startIdx + pageSize, urls.length)}/${urls.length})`}
          </span>
          <button
            onClick={onClose}
            className="text-th-text-muted hover:text-th-text text-xl px-2"
          >
            ×
          </button>
        </div>
        <div className="p-2">
          {urls.length === 0 ? (
            <p className="text-th-text-muted text-center py-4">URLが見つかりません</p>
          ) : (
            pageUrls.map((url, index) => (
              <div key={startIdx + index} className="flex items-center gap-2 p-2 hover:bg-th-surface-hover rounded">
                <span className="flex-1 text-th-text text-sm truncate">{url}</span>
                <button
                  onClick={() => onCopy(url)}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs shrink-0"
                >
                  コピー
                </button>
                <button
                  onClick={() => onOpen(url)}
                  className="px-2 py-1 bg-th-surface-active hover:bg-th-surface-hover rounded text-th-text text-xs shrink-0"
                >
                  開く
                </button>
              </div>
            ))
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 p-3 border-t border-th-border">
            <button
              onClick={() => onPageChange(Math.max(0, urlPage - 1))}
              disabled={urlPage === 0}
              className={`px-3 py-1 rounded ${urlPage === 0 ? 'bg-th-surface-hover text-th-text-muted' : 'bg-th-surface-active text-th-text hover:bg-th-surface-hover'}`}
            >
              ← 前
            </button>
            <span className="text-th-text-secondary text-sm">{urlPage + 1} / {totalPages}</span>
            <button
              onClick={() => onPageChange(Math.min(totalPages - 1, urlPage + 1))}
              disabled={urlPage >= totalPages - 1}
              className={`px-3 py-1 rounded ${urlPage >= totalPages - 1 ? 'bg-th-surface-hover text-th-text-muted' : 'bg-th-surface-active text-th-text hover:bg-th-surface-hover'}`}
            >
              次 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
