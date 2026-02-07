import { useMemo, useState, useRef, useCallback } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { getLanguageFromPath } from './language-detect';

const WORDWRAP_STORAGE_KEY = 'cchub-wordwrap';

function getWordWrapSetting(fileName: string): boolean {
  try {
    const stored = localStorage.getItem(WORDWRAP_STORAGE_KEY);
    if (stored) {
      const settings = JSON.parse(stored);
      return settings[fileName] ?? true;
    }
  } catch {
    // ignore
  }
  return true;
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

interface DiffViewerProps {
  oldContent?: string;
  newContent?: string;
  fileName?: string;
  toolName?: 'Write' | 'Edit' | 'git';
  unifiedDiff?: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

// Split highlighted HTML into lines, properly handling unclosed span tags
function splitHighlightedHtml(html: string): string[] {
  const rawLines = html.split('\n');
  const result: string[] = [];
  let openTags: string[] = [];

  for (const rawLine of rawLines) {
    const line = openTags.join('') + rawLine;

    // Track open/close span tags
    const tags: string[] = [];
    const tagRe = /<(\/?)span([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(line)) !== null) {
      if (m[1] === '/') {
        if (tags.length > 0) tags.pop();
      } else {
        tags.push(m[0]);
      }
    }

    // Close unclosed tags at end of line
    result.push(line + '</span>'.repeat(tags.length));
    openTags = tags;
  }

  return result;
}

function highlightCode(content: string, language: string): string[] {
  if (!language || language === 'plaintext') {
    return content.split('\n');
  }
  try {
    if (!hljs.getLanguage(language)) {
      return content.split('\n');
    }
    const result = hljs.highlight(content, { language, ignoreIllegals: true });
    return splitHighlightedHtml(result.value);
  } catch {
    return content.split('\n');
  }
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  const lcs = computeLCS(oldLines, newLines);

  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
      if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
        result.push({
          type: 'context',
          content: oldLines[oldIdx],
          oldLineNum: oldIdx + 1,
          newLineNum: newIdx + 1,
        });
        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else {
        result.push({
          type: 'add',
          content: newLines[newIdx],
          newLineNum: newIdx + 1,
        });
        newIdx++;
      }
    } else if (lcsIdx < lcs.length && newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
      result.push({
        type: 'remove',
        content: oldLines[oldIdx],
        oldLineNum: oldIdx + 1,
      });
      oldIdx++;
    } else if (oldIdx < oldLines.length && newIdx < newLines.length) {
      result.push({
        type: 'remove',
        content: oldLines[oldIdx],
        oldLineNum: oldIdx + 1,
      });
      result.push({
        type: 'add',
        content: newLines[newIdx],
        newLineNum: newIdx + 1,
      });
      oldIdx++;
      newIdx++;
    } else if (oldIdx < oldLines.length) {
      result.push({
        type: 'remove',
        content: oldLines[oldIdx],
        oldLineNum: oldIdx + 1,
      });
      oldIdx++;
    } else if (newIdx < newLines.length) {
      result.push({
        type: 'add',
        content: newLines[newIdx],
        newLineNum: newIdx + 1,
      });
      newIdx++;
    }
  }

  return result;
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n');
  const result: DiffLine[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.startsWith('index ')) {
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      result.push({ type: 'hunk', content: line, oldLineNum: undefined, newLineNum: undefined });
      continue;
    }

    if (line.startsWith('\\')) continue;

    if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), newLineNum: newLineNum++ });
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', content: line.slice(1), oldLineNum: oldLineNum++ });
    } else if (line.startsWith(' ')) {
      result.push({ type: 'context', content: line.slice(1), oldLineNum: oldLineNum++, newLineNum: newLineNum++ });
    }
  }

  return result;
}

export function DiffViewer({
  oldContent,
  newContent,
  fileName,
  toolName = 'Edit',
  unifiedDiff,
}: DiffViewerProps) {
  const [wordWrap, setWordWrap] = useState(() => getWordWrapSetting(fileName || ''));
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const toggleWordWrap = useCallback(() => {
    const newValue = !wordWrap;
    setWordWrap(newValue);
    if (fileName) {
      setWordWrapSetting(fileName, newValue);
    }
  }, [wordWrap, fileName]);

  const scrollRight = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft += 200;
    }
  }, []);

  const scrollLeft = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft -= 200;
    }
  }, []);

  const language = useMemo(() => {
    if (!fileName) return 'plaintext';
    return getLanguageFromPath(fileName);
  }, [fileName]);

  const diffLines = useMemo(() => {
    if (unifiedDiff) {
      return parseUnifiedDiff(unifiedDiff);
    }

    if (toolName === 'Write') {
      const lines = (newContent || '').split('\n');
      return lines.map((content, i): DiffLine => ({
        type: 'add',
        content,
        newLineNum: i + 1,
      }));
    }

    return computeDiff(oldContent || '', newContent || '');
  }, [oldContent, newContent, toolName, unifiedDiff]);

  // Build highlighted line map from diff lines
  const highlightedMap = useMemo(() => {
    if (language === 'plaintext') return null;

    // Reconstruct new-side (context + add) and old-side (context + remove)
    const newSide: { idx: number; content: string }[] = [];
    const oldSide: { idx: number; content: string }[] = [];

    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      if (line.type === 'hunk') continue;
      if (line.type === 'add' || line.type === 'context') {
        newSide.push({ idx: i, content: line.content });
      }
      if (line.type === 'remove' || line.type === 'context') {
        oldSide.push({ idx: i, content: line.content });
      }
    }

    const highlightedNew = highlightCode(newSide.map(l => l.content).join('\n'), language);
    const highlightedOld = highlightCode(oldSide.map(l => l.content).join('\n'), language);

    const result = new Map<number, string>();

    // Map new-side (context + add lines)
    for (let i = 0; i < newSide.length; i++) {
      result.set(newSide[i].idx, highlightedNew[i] || '');
    }

    // Map old-side (remove lines only; context already mapped from new-side)
    for (let i = 0; i < oldSide.length; i++) {
      if (!result.has(oldSide[i].idx)) {
        result.set(oldSide[i].idx, highlightedOld[i] || '');
      }
    }

    return result;
  }, [diffLines, language]);

  const stats = useMemo(() => {
    const added = diffLines.filter(l => l.type === 'add').length;
    const removed = diffLines.filter(l => l.type === 'remove').length;
    return { added, removed };
  }, [diffLines]);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white font-mono text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800">
        <svg className="w-4 h-4 text-yellow-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {fileName && (
          <span className="text-sm text-gray-300 truncate flex-1">{fileName}</span>
        )}
        {toolName !== 'git' && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            toolName === 'Write' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
          }`}>
            {toolName === 'Write' ? '新規作成' : '編集'}
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-b border-gray-700 bg-gray-800/50 text-xs">
        <span className="text-green-400">+{stats.added} 追加</span>
        <span className="text-red-400">-{stats.removed} 削除</span>
        <div className="flex items-center gap-1 ml-auto">
          {/* Scroll buttons */}
          {!wordWrap && (
            <>
              <button
                onClick={scrollLeft}
                className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                title="左へスクロール"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={scrollRight}
                className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                title="右へスクロール"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
          {/* Word wrap toggle */}
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

      {/* Diff content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div className={`min-h-full ${wordWrap ? '' : 'min-w-fit'}`}>
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={`flex min-w-full ${
                line.type === 'add' ? 'bg-green-900/30' :
                line.type === 'remove' ? 'bg-red-900/30' :
                line.type === 'hunk' ? 'bg-blue-900/20' :
                ''
              }`}
            >
              {/* Line numbers - hidden when word wrap is enabled */}
              {!wordWrap && (
                <div className="shrink-0 text-gray-500 text-right select-none border-r border-gray-700 bg-gray-800/50 text-xs leading-6 px-1 min-w-[2rem]">
                  {line.type === 'hunk' ? '...' : (toolName === 'Write' ? line.newLineNum : (line.newLineNum || line.oldLineNum || ''))}
                </div>
              )}

              {/* Indicator */}
              <div className={`w-4 shrink-0 text-center leading-6 text-xs ${
                line.type === 'add' ? 'text-green-400 bg-green-900/50' :
                line.type === 'remove' ? 'text-red-400 bg-red-900/50' :
                'text-gray-600'
              }`}>
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ''}
              </div>

              {/* Content */}
              <pre className={`flex-1 px-2 leading-6 ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
                {highlightedMap?.has(i) ? (
                  <span dangerouslySetInnerHTML={{ __html: highlightedMap.get(i) || '&nbsp;' }} />
                ) : (
                  line.content || ' '
                )}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
