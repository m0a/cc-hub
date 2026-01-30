import { useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import 'highlight.js/styles/github-dark.css';

// Import only commonly used languages
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';

// Register languages
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('python', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);

// Aliases
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('yml', yaml);

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
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="text-sm text-gray-300 truncate">{fileName}</span>
          <span className="text-xs text-gray-500 ml-auto">{language}</span>
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
          {/* Line numbers */}
          {showLineNumbers && (
            <div className="flex-shrink-0 select-none text-right pr-4 py-3 bg-gray-800/50 border-r border-gray-700 text-gray-500 sticky left-0">
              {lines.map((_, i) => (
                <div key={i} className="px-2 leading-6">
                  {i + 1}
                </div>
              ))}
            </div>
          )}

          {/* Code */}
          <pre className="flex-1 p-3 overflow-x-auto m-0">
            <code ref={codeRef} className={`language-${language}`} style={{ lineHeight: '1.5rem' }}>
              {content}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
