import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { useLineSelection } from '../../hooks/useLineSelection';
import { PromptComposer } from './PromptComposer';

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
      if (!Number.isNaN(size) && size >= MIN_FONTSIZE && size <= MAX_FONTSIZE) {
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

// Split highlighted HTML into lines, handling unclosed span tags
function splitHighlightedHtml(html: string): string[] {
  const rawLines = html.split('\n');
  const result: string[] = [];
  let openTags: string[] = [];

  for (const rawLine of rawLines) {
    const line = openTags.join('') + rawLine;
    const tags: string[] = [];
    const tagRe = /<(\/?)span([^>]*)>/g;
    let m: RegExpExecArray | null = tagRe.exec(line);
    while (m !== null) {
      if (m[1] === '/') {
        if (tags.length > 0) tags.pop();
      } else {
        tags.push(m[0]);
      }
      m = tagRe.exec(line);
    }
    result.push(line + '</span>'.repeat(tags.length));
    openTags = tags;
  }

  return result;
}

interface CodeViewerProps {
  content: string;
  language?: string;
  fileName?: string;
  filePath?: string;
  showLineNumbers?: boolean;
  truncated?: boolean;
  onCopyPrompt?: (text: string) => void;
  onTogglePreview?: () => void;
  hasPreview?: boolean;
}

export function CodeViewer({
  content,
  language = 'plaintext',
  fileName,
  filePath,
  showLineNumbers = true,
  truncated = false,
  onCopyPrompt,
  onTogglePreview,
  hasPreview = false,
}: CodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [wordWrap, setWordWrap] = useState(() => getWordWrapSetting(fileName || ''));
  const [fontSize, setFontSize] = useState(() => getFontSizeSetting());
  const { selection, handleLineClick, isLineSelected, clearSelection } = useLineSelection();

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

  // Highlight and split into per-line HTML
  const highlightedLines = useMemo(() => {
    const rawLines = content.split('\n');
    if (language === 'plaintext' || !hljs.getLanguage(language)) {
      return rawLines.map(l => ({ text: l, html: null }));
    }
    try {
      const result = hljs.highlight(content, { language, ignoreIllegals: true });
      const htmlLines = splitHighlightedHtml(result.value);
      return rawLines.map((text, i) => ({ text, html: htmlLines[i] ?? null }));
    } catch {
      return rawLines.map(l => ({ text: l, html: null }));
    }
  }, [content, language]);


  return (
    <div className="relative flex flex-col h-full bg-th-bg text-th-text font-mono text-sm">
      {/* Truncation warning */}
      {truncated && (
        <div className="px-3 py-1.5 bg-yellow-900/50 text-yellow-300 text-xs border-b border-yellow-800">
          ファイルが大きすぎるため一部のみ表示しています
        </div>
      )}

      {/* Code content */}
      <div ref={containerRef} className="flex-1 overflow-auto touch-pan-y">
        <div className={`min-h-full ${wordWrap ? '' : 'min-w-fit'}`}>
          {highlightedLines.map((line, i) => {
            const lineNum = i + 1;
            const selected = isLineSelected(lineNum);
            return (
              <div
                key={i}
                className={`flex ${selected ? 'bg-blue-900/30' : ''} ${onCopyPrompt ? 'cursor-pointer' : ''}`}
                onClick={onCopyPrompt ? () => handleLineClick(lineNum) : undefined}
              >
                {/* Line number */}
                {showLineNumbers && (
                  <div
                    className={`shrink-0 select-none text-right border-r border-th-border sticky left-0 px-1.5 ${
                      selected ? 'bg-blue-800/40 text-blue-300' : 'bg-th-surface/50 text-th-text-muted'
                    }`}
                    style={{ fontSize: `${Math.max(10, fontSize - 2)}px`, lineHeight: `${fontSize * 1.5}px`, minWidth: '2.5rem' }}
                  >
                    {lineNum}
                  </div>
                )}

                {/* Code line */}
                <pre
                  className={`flex-1 m-0 px-2 ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}
                  style={{ fontSize: `${fontSize}px`, lineHeight: `${fontSize * 1.5}px` }}
                >
                  {line.html ? (
                    <code dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }} />
                  ) : (
                    <code>{line.text || ' '}</code>
                  )}
                </pre>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating controls - top right */}
      <div className="absolute top-2 right-2 flex items-center gap-1 bg-th-surface/90 rounded-lg p-1 backdrop-blur-sm">
        {hasPreview && onTogglePreview && (
          <button
            onClick={onTogglePreview}
            className="px-1.5 py-0.5 text-xs text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover rounded transition-colors"
            title="Preview"
          >
            Preview
          </button>
        )}
        <button
          onClick={resetFontSize}
          className="px-1.5 py-0.5 text-xs text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover rounded transition-colors"
          title="フォントサイズをリセット (ピンチでズーム)"
        >
          {fontSize}px
        </button>
        <button
          onClick={toggleWordWrap}
          className={`p-1 rounded transition-colors ${wordWrap ? 'bg-blue-600 text-th-text' : 'text-th-text-secondary hover:text-th-text hover:bg-th-surface-hover'}`}
          title={wordWrap ? '折り返しOFF' : '折り返しON'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10m-10 6h16M17 9l3 3-3 3" />
          </svg>
        </button>
      </div>

      {/* Prompt Composer */}
      {selection && onCopyPrompt && (
        <PromptComposer
          filePath={filePath || fileName || 'unknown'}
          startLine={selection.start}
          endLine={selection.end}
          selectedCode={highlightedLines.slice(selection.start - 1, selection.end).map(l => l.text).join('\n')}
          language={language}
          onSubmit={(text) => {
            onCopyPrompt(text);
            clearSelection();
          }}
          onClose={clearSelection}
        />
      )}
    </div>
  );
}
