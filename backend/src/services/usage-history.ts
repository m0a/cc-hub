import { readFile, writeFile } from 'node:fs/promises';
import type { UsageSnapshot } from '../../../shared/types';

const HISTORY_FILE = '/tmp/cchub-usage-history.json';
const THROTTLE_MS = 30 * 1000; // 30 seconds
const MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000; // 8 days

export class UsageHistoryService {
  private lastRecordTime = 0;

  async getHistory(): Promise<UsageSnapshot[]> {
    try {
      const content = await readFile(HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      // Handle both array format and legacy {snapshots: [...]} format
      if (Array.isArray(parsed)) {
        return parsed.filter((s: unknown) => s && typeof s === 'object' && 'timestamp' in (s as Record<string, unknown>));
      }
      return [];
    } catch {
      return [];
    }
  }

  async recordSnapshot(fiveHour: { utilization: number; resetsAt: string }, sevenDay: { utilization: number; resetsAt: string }): Promise<void> {
    const now = Date.now();
    if (now - this.lastRecordTime < THROTTLE_MS) {
      return;
    }
    this.lastRecordTime = now;

    const snapshots = await this.getHistory();

    const snapshot: UsageSnapshot = {
      timestamp: new Date(now).toISOString(),
      fiveHour: { utilization: fiveHour.utilization, resetsAt: fiveHour.resetsAt },
      sevenDay: { utilization: sevenDay.utilization, resetsAt: sevenDay.resetsAt },
    };

    snapshots.push(snapshot);

    // Prune old snapshots (older than 8 days)
    const cutoff = now - MAX_AGE_MS;
    const pruned = snapshots.filter(s => new Date(s.timestamp).getTime() > cutoff);

    try {
      await writeFile(HISTORY_FILE, JSON.stringify(pruned));
    } catch (err) {
      console.error('Failed to write usage history:', err);
    }
  }
}
