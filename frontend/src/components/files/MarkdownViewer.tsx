import { useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

const FONTSIZE_STORAGE_KEY = 'cchub-fontsize';
const DEFAULT_FONTSIZE = 14;
const MIN_FONTSIZE = 8;
const MAX_FONTSIZE = 32;

function getFontSizeSetting(): number {
  try {
    const stored = localStorage.getItem(FONTSIZE_STORAGE_KEY);
    if (stored) {
      const size = parseInt(stored, 10);
      if (!isNaN(size) && size >= MIN_FONTSIZE && size <= MAX_FONTSIZE) {
        return size;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_FONTSIZE;
}

function setFontSizeSetting(size: number) {
  try {
    localStorage.setItem(FONTSIZE_STORAGE_KEY, String(size));
  } catch {
    // ignore
  }
}

function getTouchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

interface MarkdownViewerProps {
  content: string;
  fileName?: string;
  truncated?: boolean;
}

export function MarkdownViewer({
  content,
  truncated = false,
}: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSource, setShowSource] = useState(false);
  const [fontSize, setFontSize] = useState(() => getFontSizeSetting());

  // Pinch zoom state
  const pinchStateRef = useRef<{
    initialDistance: number;
    initialFontSize: number;
  } | null>(null);

  // Reset font size to default
  const resetFontSize = useCallback(() => {
    setFontSize(DEFAULT_FONTSIZE);
    setFontSizeSetting(DEFAULT_FONTSIZE);
  }, []);

  // Pinch zoom handlers
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinchStateRef.current = {
          initialDistance: getTouchDistance(e.touches),
          initialFontSize: fontSize,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStateRef.current) {
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches);
        const scale = currentDistance / pinchStateRef.current.initialDistance;
        const newSize = Math.round(pinchStateRef.current.initialFontSize * scale);
        const clampedSize = Math.max(MIN_FONTSIZE, Math.min(MAX_FONTSIZE, newSize));
        setFontSize(clampedSize);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (pinchStateRef.current && e.touches.length < 2) {
        setFontSizeSetting(fontSize);
        pinchStateRef.current = null;
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [fontSize]);

  // Source view (plain markdown)
  if (showSource) {
    return (
      <div className="relative flex flex-col h-full bg-gray-900 text-white font-mono text-sm">
        {truncated && (
          <div className="px-3 py-1.5 bg-yellow-900/50 text-yellow-300 text-xs border-b border-yellow-800">
            ファイルが大きすぎるため一部のみ表示しています
          </div>
        )}

        <div ref={containerRef} className="flex-1 overflow-auto touch-pan-y select-text" style={{ WebkitUserSelect: 'text', userSelect: 'text' }}>
          <pre
            className="whitespace-pre-wrap break-all p-3"
            style={{ fontSize: `${fontSize}px`, lineHeight: `${fontSize * 1.5}px` }}
          >
            {content}
          </pre>
        </div>

        {/* Controls */}
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-gray-800/90 rounded-lg p-1 backdrop-blur-sm">
          <button
            onClick={resetFontSize}
            className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="フォントサイズをリセット"
          >
            {fontSize}px
          </button>
          <button
            onClick={() => setShowSource(false)}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            title="プレビュー表示"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Preview (rendered markdown)
  return (
    <div className="relative flex flex-col h-full bg-gray-900 text-white">
      {truncated && (
        <div className="px-3 py-1.5 bg-yellow-900/50 text-yellow-300 text-xs border-b border-yellow-800">
          ファイルが大きすぎるため一部のみ表示しています
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 overflow-auto touch-pan-y p-4 markdown-content select-text"
        style={{ fontSize: `${fontSize}px`, WebkitUserSelect: 'text', userSelect: 'text' }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: ({ children }) => (
              <pre className="bg-gray-800 p-3 rounded-lg overflow-x-auto my-3 text-sm">
                {children}
              </pre>
            ),
            code: ({ children, className }) => {
              const match = /language-(\w+)/.exec(className || '');
              const lang = match?.[1];
              const isBlock = Boolean(className);

              if (isBlock && lang && hljs.getLanguage(lang)) {
                const highlighted = hljs.highlight(String(children).replace(/\n$/, ''), { language: lang });
                return (
                  <code
                    className={`hljs language-${lang}`}
                    dangerouslySetInnerHTML={{ __html: highlighted.value }}
                  />
                );
              }

              return isBlock ? (
                <code className="text-green-300">{children}</code>
              ) : (
                <code className="bg-gray-700 px-1.5 py-0.5 rounded text-blue-300 text-sm">{children}</code>
              );
            },
            p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
            ul: ({ children }) => <ul className="list-disc ml-5 my-3 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal ml-5 my-3 space-y-1">{children}</ol>,
            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
            h1: ({ children }) => <h1 className="text-2xl font-bold my-4 pb-2 border-b border-gray-700">{children}</h1>,
            h2: ({ children }) => <h2 className="text-xl font-bold my-4 pb-1 border-b border-gray-700">{children}</h2>,
            h3: ({ children }) => <h3 className="text-lg font-bold my-3">{children}</h3>,
            h4: ({ children }) => <h4 className="text-base font-bold my-2">{children}</h4>,
            h5: ({ children }) => <h5 className="text-sm font-bold my-2">{children}</h5>,
            h6: ({ children }) => <h6 className="text-sm font-bold my-2 text-gray-400">{children}</h6>,
            strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            a: ({ href, children }) => (
              <a href={href} className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-gray-600 pl-4 my-3 text-gray-300 italic">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="my-6 border-gray-700" />,
            table: ({ children }) => (
              <div className="overflow-x-auto my-4">
                <table className="min-w-full border border-gray-600 rounded">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-gray-800">{children}</thead>,
            th: ({ children }) => (
              <th className="border border-gray-600 px-3 py-2 text-left font-semibold">{children}</th>
            ),
            td: ({ children }) => (
              <td className="border border-gray-600 px-3 py-2">{children}</td>
            ),
            img: ({ src, alt }) => (
              <img
                src={src}
                alt={alt || 'Image'}
                className="max-w-full h-auto rounded my-3"
                loading="lazy"
              />
            ),
            input: ({ type, checked, disabled }) => {
              if (type === 'checkbox') {
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

      {/* Controls */}
      <div className="absolute top-2 right-2 flex items-center gap-1 bg-gray-800/90 rounded-lg p-1 backdrop-blur-sm">
        <button
          onClick={resetFontSize}
          className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          title="フォントサイズをリセット"
        >
          {fontSize}px
        </button>
        <button
          onClick={() => setShowSource(true)}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          title="ソース表示"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
