const LOG_ENDPOINT = '/api/logs';

type LogLevel = 'log' | 'warn' | 'error' | 'info';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  stack?: string;
}

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
};

function sendLog(entry: LogEntry) {
  fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).catch(() => {
    // Ignore send errors
  });
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack}`;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

function createLogger(level: LogLevel) {
  return (...args: unknown[]) => {
    originalConsole[level](...args);

    const message = formatArgs(args);
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    if (args[0] instanceof Error) {
      entry.stack = (args[0] as Error).stack;
    }

    sendLog(entry);
  };
}

export function initRemoteLogger() {
  console.log = createLogger('log');
  console.warn = createLogger('warn');
  console.error = createLogger('error');
  console.info = createLogger('info');

  // Catch unhandled errors
  window.onerror = (message, source, lineno, colno, error) => {
    sendLog({
      level: 'error',
      message: `Unhandled: ${message} at ${source}:${lineno}:${colno}`,
      timestamp: new Date().toISOString(),
      stack: error?.stack,
    });
  };

  // Catch unhandled promise rejections
  window.onunhandledrejection = (event) => {
    sendLog({
      level: 'error',
      message: `Unhandled Promise: ${event.reason}`,
      timestamp: new Date().toISOString(),
      stack: event.reason?.stack,
    });
  };

  originalConsole.log('Remote logger initialized');
}
