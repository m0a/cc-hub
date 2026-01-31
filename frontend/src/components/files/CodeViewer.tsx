import { useEffect, useRef, useState, useCallback } from 'react';
import hljs from 'highlight.js'; // 全言語サポート
import 'highlight.js/styles/github-dark.css';

const WORDWRAP_STORAGE_KEY = 'cchub-wordwrap';
const FONTSIZE_STORAGE_KEY = 'cchub-fontsize';
const DEFAULT_FONTSIZE = 14;
const MIN_FONTSIZE = 8;
const MAX_FONTSIZE = 32;

function getWordWrapSetting(fileName: string): boolean {
  try {
    const stored = localStorage.getItem(WORDWRAP_STORAGE_KEY);
    if (stored) {
      const settings = JSON.parse(stored);
      return settings[fileName] ?? true; // デフォルトはtrue
    }
  } catch {
    // ignore
  }
  return true; // デフォルトはtrue
}

function setWordWrapSetting(fileName: string, value: boolean) {
  try {
    const stored = localStorage.getItem(WORDWRAP_STORAGE_KEY);
    const settings = stored ? JSON.parse(stored) : {};
    settings[fileName] = value;
    localStorage.setItem(WORDWRAP_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

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

// Calculate distance between two touch points
function getTouchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

interface CodeViewerProps {
  content: string;
  language?: string;
  fileName?: string;
  showLineNumbers?: boolean;
  truncated?: boolean;
}

export function CodeViewer({
  content,
  language = 'plaintext',
  fileName,
  showLineNumbers = true,
  truncated = false,
}: CodeViewerProps) {
  const codeRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [wordWrap, setWordWrap] = useState(() => getWordWrapSetting(fileName || ''));
  const [fontSize, setFontSize] = useState(() => getFontSizeSetting());

  // Pinch zoom state
  const pinchStateRef = useRef<{
    initialDistance: number;
    initialFontSize: number;
  } | null>(null);

  const toggleWordWrap = useCallback(() => {
    const newValue = !wordWrap;
    setWordWrap(newValue);
    if (fileName) {
      setWordWrapSetting(fileName, newValue);
    }
  }, [wordWrap, fileName]);

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
        // Prevent default zoom behavior
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
        // Save the final font size
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

  useEffect(() => {
    if (codeRef.current) {
      // Reset previous highlighting
      codeRef.current.removeAttribute('data-highlighted');
      codeRef.current.className = `language-${language}`;

      // Apply highlighting
      try {
        if (language !== 'plaintext' && hljs.getLanguage(language)) {
          hljs.highlightElement(codeRef.current);
        }
      } catch (err) {
        console.warn('Highlight error:', err);
      }
    }
  }, [content, language]);

  const lines = content.split('\n');

  return (
    <div className="relative flex flex-col h-full bg-gray-900 text-white font-mono text-sm">
      {/* Truncation warning */}
      {truncated && (
        <div className="px-3 py-1.5 bg-yellow-900/50 text-yellow-300 text-xs border-b border-yellow-800">
          ファイルが大きすぎるため一部のみ表示しています
        </div>
      )}

      {/* Code content */}
      <div ref={containerRef} className="flex-1 overflow-auto touch-pan-y">
        <div className="flex min-h-full">
          {/* Line numbers - hidden when word wrap is enabled */}
          {showLineNumbers && !wordWrap && (
            <div
              className="flex-shrink-0 select-none text-right bg-gray-800/50 border-r border-gray-700 text-gray-500 sticky left-0"
              style={{ fontSize: `${Math.max(10, fontSize - 2)}px`, lineHeight: `${fontSize * 1.5}px` }}
            >
              {lines.map((_, i) => (
                <div key={i} className="px-1.5">
                  {i + 1}
                </div>
              ))}
            </div>
          )}

          {/* Code */}
          <pre
            className={`flex-1 m-0 ${wordWrap ? 'whitespace-pre-wrap break-all' : 'overflow-x-auto'}`}
            style={{ fontSize: `${fontSize}px`, lineHeight: `${fontSize * 1.5}px` }}
          >
            <code ref={codeRef} className={`language-${language}`}>
              {content}
            </code>
          </pre>
        </div>
      </div>

      {/* Floating controls - top right */}
      <div className="absolute top-2 right-2 flex items-center gap-1 bg-gray-800/90 rounded-lg p-1 backdrop-blur-sm">
        <button
          onClick={resetFontSize}
          className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          title="フォントサイズをリセット (ピンチでズーム)"
        >
          {fontSize}px
        </button>
        <button
          onClick={toggleWordWrap}
          className={`p-1 rounded transition-colors ${wordWrap ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
          title={wordWrap ? '折り返しOFF' : '折り返しON'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10m-10 6h16M17 9l3 3-3 3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
