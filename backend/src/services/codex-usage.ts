import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CodexUsageLimits, UsageCycleInfo } from '../../../shared/types';

interface RateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number; // unix epoch seconds
}

interface RateLimitsPayload {
  limit_id?: string;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  plan_type?: string;
}

interface TokenCountEvent {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    rate_limits?: RateLimitsPayload | null;
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatDuration(diffMs: number): string {
  if (diffMs <= 0) return 'soon';
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}d ${hours}h${minutes}m`;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

function statusFromUtilization(utilization: number): UsageCycleInfo['status'] {
  if (utilization >= 100) return 'exceeded';
  if (utilization >= 75) return 'warning';
  return 'safe';
}

function buildCycleInfo(window: RateLimitWindow | null | undefined, now: number): UsageCycleInfo | undefined {
  if (!window) return undefined;
  const utilization = numberOrUndefined(window.used_percent);
  const resetsAtSec = numberOrUndefined(window.resets_at);
  if (utilization === undefined || resetsAtSec === undefined) return undefined;
  const resetsAt = new Date(resetsAtSec * 1000).toISOString();
  const timeRemaining = formatDuration(resetsAtSec * 1000 - now);
  return {
    utilization,
    resetsAt,
    timeRemaining,
    status: statusFromUtilization(utilization),
    statusMessage: '',
  };
}

function classifyWindow(minutes: number | undefined): 'fiveHour' | 'sevenDay' | undefined {
  if (minutes === undefined) return undefined;
  // Free plan: only 7d (10080). Paid plans may include 5h (300).
  // Allow some tolerance — anything under 24h treated as the short window.
  if (minutes <= 60 * 24) return 'fiveHour';
  return 'sevenDay';
}

function findLatestRateLimitsInText(text: string): { event: TokenCountEvent; rateLimits: RateLimitsPayload } | undefined {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line || !line.includes('"rate_limits"')) continue;
    let event: TokenCountEvent;
    try {
      event = JSON.parse(line) as TokenCountEvent;
    } catch {
      continue;
    }
    if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue;
    const rateLimits = event.payload?.rate_limits;
    if (rateLimits) return { event, rateLimits };
  }
  return undefined;
}

function readLatestRateLimits(rolloutPath: string): { event: TokenCountEvent; rateLimits: RateLimitsPayload } | undefined {
  try {
    const stat = statSync(rolloutPath);
    const maxTailBytes = 4 * 1024 * 1024;
    if (stat.size <= maxTailBytes) {
      return findLatestRateLimitsInText(readFileSync(rolloutPath, 'utf8'));
    }
    const fd = openSync(rolloutPath, 'r');
    try {
      const bytesToRead = Math.min(stat.size, maxTailBytes);
      const buffer = Buffer.alloc(bytesToRead);
      readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
      return findLatestRateLimitsInText(buffer.toString('utf8'));
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

interface RolloutCandidate {
  path: string;
  mtimeMs: number;
}

function findRolloutCandidates(sessionsDir: string, limit: number): RolloutCandidate[] {
  if (!existsSync(sessionsDir)) return [];
  const candidates: RolloutCandidate[] = [];

  // Layout: sessionsDir/YYYY/MM/DD/rollout-*.jsonl
  const years = readdirSync(sessionsDir).filter(name => /^\d{4}$/.test(name)).sort().reverse();
  outer: for (const year of years) {
    const yearDir = join(sessionsDir, year);
    let months: string[] = [];
    try { months = readdirSync(yearDir).filter(name => /^\d{2}$/.test(name)).sort().reverse(); } catch { continue; }
    for (const month of months) {
      const monthDir = join(yearDir, month);
      let days: string[] = [];
      try { days = readdirSync(monthDir).filter(name => /^\d{2}$/.test(name)).sort().reverse(); } catch { continue; }
      for (const day of days) {
        const dayDir = join(monthDir, day);
        let files: string[] = [];
        try { files = readdirSync(dayDir).filter(name => name.startsWith('rollout-') && name.endsWith('.jsonl')); } catch { continue; }
        for (const file of files) {
          const fullPath = join(dayDir, file);
          try {
            const stat = statSync(fullPath);
            candidates.push({ path: fullPath, mtimeMs: stat.mtimeMs });
          } catch { /* skip unreadable */ }
        }
        // Once we have enough candidates from the most recent days, stop walking older days.
        if (candidates.length >= limit * 2) break outer;
      }
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.slice(0, limit);
}

export class CodexUsageService {
  private sessionsDir: string;
  private cache: { data: CodexUsageLimits | null; timestamp: number } | null = null;
  private static readonly CACHE_TTL_MS = 30_000;
  // How many recent rollouts to scan when looking for the latest rate_limits event.
  private static readonly ROLLOUT_SCAN_LIMIT = 8;

  constructor(sessionsDir = join(homedir(), '.codex', 'sessions')) {
    this.sessionsDir = sessionsDir;
  }

  async getUsageLimits(): Promise<CodexUsageLimits | null> {
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < CodexUsageService.CACHE_TTL_MS) {
      return this.cache.data;
    }

    const result = this.computeUsageLimits(now);
    this.cache = { data: result, timestamp: now };
    return result;
  }

  /** Exposed for tests. */
  computeUsageLimits(now: number = Date.now()): CodexUsageLimits | null {
    const candidates = findRolloutCandidates(this.sessionsDir, CodexUsageService.ROLLOUT_SCAN_LIMIT);
    for (const candidate of candidates) {
      const found = readLatestRateLimits(candidate.path);
      if (!found) continue;
      const { event, rateLimits } = found;

      const result: CodexUsageLimits = {
        planType: rateLimits.plan_type,
        capturedAt: event.timestamp,
      };

      const cycles: Array<{ minutes: number | undefined; window: RateLimitWindow | null | undefined }> = [
        { minutes: rateLimits.primary?.window_minutes, window: rateLimits.primary },
        { minutes: rateLimits.secondary?.window_minutes, window: rateLimits.secondary },
      ];
      for (const { minutes, window } of cycles) {
        const slot = classifyWindow(minutes);
        if (!slot) continue;
        const info = buildCycleInfo(window, now);
        if (info && !result[slot]) result[slot] = info;
      }

      if (result.fiveHour || result.sevenDay) return result;
    }
    return null;
  }
}
