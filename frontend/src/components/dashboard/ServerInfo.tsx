import { useEffect, useState } from 'react';
import { HardDrive, Users, Activity } from 'lucide-react';

interface ServerInfoProps {
  diskUsage?: { total: number; used: number; available: number; mountpoint: string };
  connectedClients?: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1e3) return `${(bytesPerSec / 1e3).toFixed(1)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

export function ServerInfo({ diskUsage, connectedClients }: ServerInfoProps) {
  const [throughput, setThroughput] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setThroughput((window as any).__cchub_ws_bytes_per_sec || 0);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const diskPercent = diskUsage ? Math.round((diskUsage.used / diskUsage.total) * 100) : 0;
  const diskColor = diskPercent > 90 ? 'text-red-400' : diskPercent > 75 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-zinc-300">Server</h3>

      {/* Throughput */}
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-zinc-500">Throughput</div>
          <div className="text-[14px] text-zinc-200 font-mono">{formatSpeed(throughput)}</div>
        </div>
      </div>

      {/* Disk */}
      {diskUsage && (
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-purple-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-zinc-500">Disk</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${diskPercent > 90 ? 'bg-red-500' : diskPercent > 75 ? 'bg-amber-500' : 'bg-purple-500'}`}
                  style={{ width: `${diskPercent}%` }}
                />
              </div>
              <span className={`text-[12px] font-mono ${diskColor}`}>
                {formatBytes(diskUsage.available)} free
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Connected clients */}
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-teal-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-zinc-500">Clients</div>
          <div className="text-[14px] text-zinc-200 font-mono">{connectedClients ?? 0}</div>
        </div>
      </div>
    </div>
  );
}
