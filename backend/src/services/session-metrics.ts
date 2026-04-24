import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createInterface } from 'node:readline';
import type { SessionMetrics } from '../../../shared/types';

const CONTEXT_MAX_DEFAULT = 200_000;

function pathToProjectDir(workingDir: string): string {
  const dirName = workingDir.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', dirName);
}

async function getProcessTreeRSS(pid: number): Promise<number> {
  const queue: number[] = [pid];
  const visited = new Set<number>();
  let totalBytes = 0;
  while (queue.length > 0) {
    const p = queue.shift();
    if (p === undefined || visited.has(p)) continue;
    visited.add(p);
    try {
      const status = await Bun.file(`/proc/${p}/status`).text();
      const m = status.match(/VmRSS:\s+(\d+)\s+kB/);
      if (m?.[1]) totalBytes += Number.parseInt(m[1], 10) * 1024;
      const childrenText = await Bun.file(`/proc/${p}/task/${p}/children`).text();
      const childPids = childrenText.trim().split(/\s+/).filter(Boolean).map(Number);
      for (const c of childPids) if (!visited.has(c)) queue.push(c);
    } catch {
      // Process may have exited
    }
  }
  return totalBytes;
}

interface JsonlCacheEntry {
  mtimeMs: number;
  size: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  contextTokens: number;
}

const jsonlCache = new Map<string, JsonlCacheEntry>();

async function readJsonlUsage(filePath: string): Promise<{
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  contextTokens: number;
} | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    const cached = jsonlCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached;
    }

    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let contextTokens = 0;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const usage = obj?.message?.usage;
        if (usage && typeof usage === 'object') {
          const inTok = Number(usage.input_tokens) || 0;
          const createTok = Number(usage.cache_creation_input_tokens) || 0;
          const readTok = Number(usage.cache_read_input_tokens) || 0;
          const outTok = Number(usage.output_tokens) || 0;
          totalOutputTokens += outTok;
          totalCacheReadTokens += readTok;
          // Last assistant message's effective context = in + cache_creation + cache_read
          contextTokens = inTok + createTok + readTok;
        }
      } catch {
        // Skip malformed lines
      }
    }

    const entry: JsonlCacheEntry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      totalOutputTokens,
      totalCacheReadTokens,
      contextTokens,
    };
    jsonlCache.set(filePath, entry);
    return entry;
  } catch {
    return null;
  }
}

export interface MetricsInput {
  ccSessionId?: string;
  workingDir?: string;
  pids?: (number | undefined)[];
  contextMaxTokens?: number;
}

export async function computeSessionMetrics(input: MetricsInput): Promise<SessionMetrics | undefined> {
  const { ccSessionId, workingDir, pids, contextMaxTokens = CONTEXT_MAX_DEFAULT } = input;
  const metrics: SessionMetrics = {};

  if (ccSessionId && workingDir) {
    const projectDir = pathToProjectDir(workingDir);
    const filePath = path.join(projectDir, `${ccSessionId}.jsonl`);
    const usage = await readJsonlUsage(filePath);
    if (usage) {
      metrics.contextTokens = usage.contextTokens;
      metrics.contextMaxTokens = contextMaxTokens;
      metrics.contextPercent = contextMaxTokens > 0
        ? Math.min(100, Math.round((usage.contextTokens / contextMaxTokens) * 1000) / 10)
        : undefined;
      metrics.totalOutputTokens = usage.totalOutputTokens;
      metrics.totalCacheReadTokens = usage.totalCacheReadTokens;
    }
  }

  if (pids && pids.length > 0) {
    const validPids = pids.filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
    if (validPids.length > 0) {
      let total = 0;
      for (const pid of validPids) {
        total += await getProcessTreeRSS(pid);
      }
      metrics.memoryRssBytes = total;
    }
  }

  if (Object.keys(metrics).length === 0) return undefined;
  return metrics;
}
