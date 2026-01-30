import { useEffect, useRef, useState, useCallback } from 'react';
import hljs from 'highlight.js'; // 全言語サポート
import 'highlight.js/styles/github-dark.css';

const WORDWRAP_STORAGE_KEY = 'cchub-wordwrap';

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
  const [wordWrap, setWordWrap] = useState(() => getWordWrapSetting(fileName || ''));

  const toggleWordWrap = useCallback(() => {
    const newValue = !wordWrap;
    setWordWrap(newValue);
    if (fileName) {
      setWordWrapSetting(fileName, newValue);
    }
  }, [wordWrap, fileName]);

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
    <div className="flex flex-col h-full bg-gray-900 text-white font-mono text-sm">
      {/* File name header */}
      {fileName && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800">
          <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="text-sm text-gray-300 truncate flex-1">{fileName}</span>
          <span className="text-xs text-gray-500">{language}</span>
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
      )}

      {/* Truncation warning */}
      {truncated && (
        <div className="px-3 py-1.5 bg-yellow-900/50 text-yellow-300 text-xs border-b border-yellow-800">
          ファイルが大きすぎるため一部のみ表示しています
        </div>
      )}

      {/* Code content */}
      <div className="flex-1 overflow-auto">
        <div className="flex min-h-full">
          {/* Line numbers - hidden when word wrap is enabled */}
          {showLineNumbers && !wordWrap && (
            <div className="flex-shrink-0 select-none text-right py-3 bg-gray-800/50 border-r border-gray-700 text-gray-500 sticky left-0">
              {lines.map((_, i) => (
                <div key={i} className="px-1.5 leading-6 text-xs">
                  {i + 1}
                </div>
              ))}
            </div>
          )}

          {/* Code */}
          <pre className={`flex-1 p-3 m-0 ${wordWrap ? 'whitespace-pre-wrap break-all' : 'overflow-x-auto'}`}>
            <code ref={codeRef} className={`language-${language}`} style={{ lineHeight: '1.5rem' }}>
              {content}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
