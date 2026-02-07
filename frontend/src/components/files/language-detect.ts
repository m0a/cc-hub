// Language map for syntax highlighting
export const LANGUAGE_MAP: Record<string, string> = {
  // Web
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.vue': 'html',
  '.svelte': 'html',
  // Config
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.env': 'ini',
  '.conf': 'nginx',
  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  // Scripting
  '.py': 'python',
  '.rb': 'ruby',
  '.pl': 'perl',
  '.php': 'php',
  '.lua': 'lua',
  '.r': 'r',
  // Systems
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.cs': 'csharp',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.m': 'objectivec',
  '.mm': 'objectivec',
  // Data/Query
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  // Markup
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.xml': 'xml',
  '.svg': 'xml',
  '.plist': 'xml',
  '.xhtml': 'xml',
  // DevOps
  '.dockerfile': 'dockerfile',
  '.nginx': 'nginx',
  '.tf': 'hcl',
  // Other
  '.diff': 'diff',
  '.patch': 'diff',
  '.makefile': 'makefile',
  '.cmake': 'cmake',
  '.gradle': 'groovy',
  '.groovy': 'groovy',
  '.scala': 'scala',
  '.hs': 'haskell',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.clj': 'clojure',
  '.lisp': 'lisp',
  '.el': 'lisp',
  '.vim': 'vim',
  '.proto': 'protobuf',
};

// Filename-based language detection
const FILENAME_MAP: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  'cmakelists.txt': 'cmake',
  'gemfile': 'ruby',
  'rakefile': 'ruby',
  'vagrantfile': 'ruby',
  '.gitignore': 'ini',
  '.dockerignore': 'ini',
  '.editorconfig': 'ini',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  '.babelrc': 'json',
  'tsconfig.json': 'json',
  'package.json': 'json',
  'composer.json': 'json',
  'cargo.toml': 'ini',
  'go.mod': 'go',
  'go.sum': 'plaintext',
};

export function getLanguageFromPath(path: string): string {
  const fileName = path.split('/').pop()?.toLowerCase() || '';

  // Check filename first
  if (FILENAME_MAP[fileName]) {
    return FILENAME_MAP[fileName];
  }

  // Then check extension
  const ext = fileName.match(/\.[^.]+$/)?.[0];
  return ext ? (LANGUAGE_MAP[ext] || 'plaintext') : 'plaintext';
}
