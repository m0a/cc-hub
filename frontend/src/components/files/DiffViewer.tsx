import { useMemo, useState, useRef, useCallback } from 'react';

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

interface DiffViewerProps {
  oldContent?: string;
  newContent?: string;
  fileName?: string;
  toolName: 'Write' | 'Edit';
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  // Simple diff algorithm using LCS (Longest Common Subsequence)
  const lcs = computeLCS(oldLines, newLines);

  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
      if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
        // Context line (unchanged)
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
        // Added line
        result.push({
          type: 'add',
          content: newLines[newIdx],
          newLineNum: newIdx + 1,
        });
        newIdx++;
      }
    } else if (lcsIdx < lcs.length && newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
      // Removed line
      result.push({
        type: 'remove',
        content: oldLines[oldIdx],
        oldLineNum: oldIdx + 1,
      });
      oldIdx++;
    } else if (oldIdx < oldLines.length && newIdx < newLines.length) {
      // Both lines are different - show as remove then add
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
      // Only old lines left - all removed
      result.push({
        type: 'remove',
        content: oldLines[oldIdx],
        oldLineNum: oldIdx + 1,
      });
      oldIdx++;
    } else if (newIdx < newLines.length) {
      // Only new lines left - all added
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

  // Create DP table
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

  // Backtrack to find LCS
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

export function DiffViewer({
  oldContent,
  newContent,
  fileName,
  toolName,
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

  const diffLines = useMemo(() => {
    if (toolName === 'Write') {
      // For Write, show all lines as added
      const lines = (newContent || '').split('\n');
      return lines.map((content, i): DiffLine => ({
        type: 'add',
        content,
        newLineNum: i + 1,
      }));
    }

    // For Edit, compute diff
    return computeDiff(oldContent || '', newContent || '');
  }, [oldContent, newContent, toolName]);

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
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          toolName === 'Write' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
        }`}>
          {toolName === 'Write' ? '新規作成' : '編集'}
        </span>
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
        <div className="min-h-full">
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={`flex ${
                line.type === 'add' ? 'bg-green-900/30' :
                line.type === 'remove' ? 'bg-red-900/30' :
                ''
              }`}
            >
              {/* Line numbers - hidden when word wrap is enabled */}
              {!wordWrap && (
                <div className="shrink-0 text-gray-500 text-right select-none border-r border-gray-700 bg-gray-800/50 text-xs leading-6 px-1 min-w-[2rem]">
                  {toolName === 'Write' ? line.newLineNum : (line.newLineNum || line.oldLineNum || '')}
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
                {line.content || ' '}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
