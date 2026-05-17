import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

type HookEventStatus = {
  stop: boolean;
  preToolUse: boolean;
  userPromptSubmit: boolean;
  askUserQuestion: boolean;
};

type HookEntry = { matcher?: string; hooks?: Array<{ command?: string }> };

type HookProviderStatus = {
  configured: boolean;
  events: HookEventStatus;
  missing: Array<keyof HookEventStatus>;
};

type HookStatus = HookProviderStatus & {
  providers: {
    claude: HookProviderStatus;
    codex: HookProviderStatus;
  };
};

const DEFAULT_EVENTS: HookEventStatus = {
  stop: false,
  preToolUse: false,
  userPromptSubmit: false,
  askUserQuestion: false,
};

function cloneDefaultEvents(): HookEventStatus {
  return { ...DEFAULT_EVENTS };
}

function finalizeHookStatus(events: HookEventStatus): HookProviderStatus {
  const missing = Object.entries(events)
    .filter(([, ok]) => !ok)
    .map(([key]) => key as keyof HookEventStatus);
  return {
    configured: missing.length === 0,
    events,
    missing,
  };
}

function matcherMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  return actual === expected || actual.includes(expected);
}

function hasCchubNotify(entries: HookEntry[] | undefined, matcher?: string): boolean {
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    if (matcher !== undefined && !matcherMatches(entry.matcher, matcher)) continue;
    for (const hook of entry.hooks || []) {
      if (hook.command?.includes('cchub notify')) return true;
    }
  }
  return false;
}

export function parseHookJson(content: string): HookEventStatus | null {
  try {
    const settings = JSON.parse(content);
    const hooks = (settings.hooks || {}) as Record<string, HookEntry[]>;

    return {
      stop: hasCchubNotify(hooks.Stop),
      preToolUse: hasCchubNotify(hooks.PreToolUse),
      userPromptSubmit: hasCchubNotify(hooks.UserPromptSubmit),
      askUserQuestion: hasCchubNotify(hooks.PostToolUse, 'AskUserQuestion'),
    };
  } catch {
    return null;
  }
}

function unquoteTomlString(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseHookToml(content: string): HookEventStatus | null {
  const events = cloneDefaultEvents();
  let currentEvent: keyof HookEventStatus | null = null;
  let currentMatcher: string | null = null;
  let inHookItems = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[\[hooks\.(Stop|PreToolUse|UserPromptSubmit|PostToolUse)(?:\.hooks)?\]\]$/);
    if (sectionMatch) {
      currentEvent = sectionMatch[1] === 'Stop'
        ? 'stop'
        : sectionMatch[1] === 'PreToolUse'
          ? 'preToolUse'
          : sectionMatch[1] === 'UserPromptSubmit'
            ? 'userPromptSubmit'
            : 'askUserQuestion';
      inHookItems = line.includes('.hooks]]');
      if (!inHookItems) {
        currentMatcher = null;
      }
      continue;
    }

    if (currentEvent === null) continue;

    const matcherMatch = line.match(/^matcher\s*=\s*(.+)$/);
    if (matcherMatch) {
      currentMatcher = unquoteTomlString(matcherMatch[1]);
      continue;
    }

    if (!inHookItems && !line.startsWith('command')) continue;
    if (!line.includes('command') || !line.includes('cchub notify')) continue;

    if (currentEvent === 'askUserQuestion') {
      if (matcherMatches(currentMatcher ?? undefined, 'AskUserQuestion')) {
        events.askUserQuestion = true;
      }
      continue;
    }

    events[currentEvent] = true;
  }

  return events;
}

async function readHookFile(path: string): Promise<HookEventStatus | null> {
  try {
    const content = await readFile(path, 'utf-8');
    if (path.endsWith('.json')) {
      return parseHookJson(content);
    }
    if (path.endsWith('.toml')) {
      return parseHookToml(content);
    }
    return null;
  } catch {
    return null;
  }
}

async function getProviderStatus(paths: string[]): Promise<HookProviderStatus> {
  const aggregated = cloneDefaultEvents();

  for (const path of paths) {
    const events = await readHookFile(path);
    if (!events) continue;
    aggregated.stop ||= events.stop;
    aggregated.preToolUse ||= events.preToolUse;
    aggregated.userPromptSubmit ||= events.userPromptSubmit;
    aggregated.askUserQuestion ||= events.askUserQuestion;
  }

  return finalizeHookStatus(aggregated);
}

export async function getHookStatus(): Promise<HookStatus> {
  const cwd = process.cwd();
  const claude = await getProviderStatus([
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'hooks.json'),
    join(homedir(), '.claude', 'settings.json'),
    join(homedir(), '.claude', 'hooks.json'),
  ]);
  const codex = await getProviderStatus([
    join(cwd, '.codex', 'config.toml'),
    join(cwd, '.codex', 'hooks.json'),
    join(homedir(), '.codex', 'config.toml'),
    join(homedir(), '.codex', 'hooks.json'),
  ]);

  const events = {
    stop: claude.events.stop || codex.events.stop,
    preToolUse: claude.events.preToolUse || codex.events.preToolUse,
    userPromptSubmit: claude.events.userPromptSubmit || codex.events.userPromptSubmit,
    askUserQuestion: claude.events.askUserQuestion || codex.events.askUserQuestion,
  };

  const missing = Object.entries(events)
    .filter(([, ok]) => !ok)
    .map(([key]) => key as keyof HookEventStatus);

  return {
    configured: claude.configured || codex.configured,
    events,
    missing,
    providers: { claude, codex },
  };
}
