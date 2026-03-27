import { cpus, freemem, totalmem, loadavg } from 'node:os';
import { readFileSync } from 'node:fs';
import type { SystemMetrics, SystemMetricsSnapshot } from '../../../shared/types';

function getSwapInfo(): { usedMB: number; totalMB: number } {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf-8');
    const swapTotal = meminfo.match(/SwapTotal:\s+(\d+)/)?.[1];
    const swapFree = meminfo.match(/SwapFree:\s+(\d+)/)?.[1];
    if (swapTotal && swapFree) {
      const totalMB = Math.round(Number(swapTotal) / 1024);
      const usedMB = totalMB - Math.round(Number(swapFree) / 1024);
      return { usedMB, totalMB };
    }
  } catch { /* /proc/meminfo not available (non-Linux) */ }
  return { usedMB: 0, totalMB: 0 };
}

const MAX_HISTORY = 60;
const MIN_INTERVAL_MS = 3000; // Minimum 3s between snapshots

export class SystemMetricsService {
  private history: SystemMetricsSnapshot[] = [];
  private lastCpuInfo: ReturnType<typeof cpus> | null = null;
  private lastSnapshotTime = 0;

  getMetrics(): SystemMetrics {
    const now = Date.now();
    // Only take a new snapshot if enough time has passed
    if (now - this.lastSnapshotTime >= MIN_INTERVAL_MS) {
      const snapshot = this.takeSnapshot();
      this.history.push(snapshot);
      if (this.history.length > MAX_HISTORY) {
        this.history.shift();
      }
      this.lastSnapshotTime = now;
    }

    const current = this.history.length > 0
      ? this.history[this.history.length - 1]
      : this.takeSnapshot();

    const la = loadavg();

    return {
      current,
      history: [...this.history],
      loadAvg: [la[0], la[1], la[2]],
      cpuCount: cpus().length,
    };
  }

  private takeSnapshot(): SystemMetricsSnapshot {
    const currentCpuInfo = cpus();
    let cpuPercent = 0;

    if (this.lastCpuInfo && this.lastCpuInfo.length === currentCpuInfo.length) {
      let totalIdle = 0;
      let totalTick = 0;
      for (let i = 0; i < currentCpuInfo.length; i++) {
        const prev = this.lastCpuInfo[i].times;
        const curr = currentCpuInfo[i].times;
        const idle = curr.idle - prev.idle;
        const total =
          (curr.user - prev.user) +
          (curr.nice - prev.nice) +
          (curr.sys - prev.sys) +
          (curr.irq - prev.irq) +
          idle;
        totalIdle += idle;
        totalTick += total;
      }
      cpuPercent = totalTick > 0
        ? Math.round(((totalTick - totalIdle) / totalTick) * 1000) / 10
        : 0;
    }

    this.lastCpuInfo = currentCpuInfo;

    const total = totalmem();
    const free = freemem();
    const usedMB = Math.round((total - free) / 1024 / 1024);
    const totalMB = Math.round(total / 1024 / 1024);
    const usedPercent = Math.round(((total - free) / total) * 1000) / 10;
    const swap = getSwapInfo();

    return {
      timestamp: Date.now(),
      cpuPercent,
      memUsedPercent: usedPercent,
      memUsedMB: usedMB,
      memTotalMB: totalMB,
      swapUsedMB: swap.usedMB,
      swapTotalMB: swap.totalMB,
    };
  }
}
