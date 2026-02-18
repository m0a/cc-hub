import type { LimitsInfo } from '../../../../shared/types';

interface LimitWarningProps {
  limits: LimitsInfo | null;
}

function ProgressBar({
  percentage,
  label,
  sublabel,
  resetTime,
  isStale,
}: {
  percentage: number;
  label: string;
  sublabel: string;
  resetTime?: string;
  isStale?: boolean;
}) {
  const getBarColor = (pct: number) => {
    if (isStale) return 'bg-gray-500';
    if (pct >= 100) return 'bg-red-500';
    if (pct >= 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatResetTime = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    if (diff <= 0) return 'reset soon';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-0.5">
        <span className={isStale ? 'text-th-text-muted' : 'text-th-text-secondary'}>
          {label}
          {isStale && <span className="ml-1 text-yellow-600">(古い)</span>}
        </span>
        <span className={isStale ? 'text-th-text-muted' : 'text-th-text-secondary'}>
          {sublabel}
          {resetTime && (
            <span className="ml-1 text-blue-400">({formatResetTime(resetTime)})</span>
          )}
        </span>
      </div>
      <div className="h-2 bg-th-surface-hover rounded-full overflow-hidden">
        <div
          className={`h-full ${getBarColor(percentage)} transition-all duration-300`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </div>
  );
}

export function LimitWarning({ limits }: LimitWarningProps) {
  if (!limits) {
    return (
      <div className="p-3 bg-th-surface rounded-lg">
        <div className="text-th-text-muted text-xs">Limit data unavailable</div>
      </div>
    );
  }

  const planLabel = limits.plan.replace('_', ' ').toUpperCase();

  return (
    <div className="p-3 bg-th-surface rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-th-text">Usage Limits</span>
        <span className="text-xs px-2 py-0.5 bg-purple-600 rounded">{planLabel}</span>
      </div>

      <ProgressBar
        label="5h Cycle"
        percentage={limits.cycle5h.percentage}
        sublabel={`${limits.cycle5h.used}/${limits.cycle5h.limit.min}-${limits.cycle5h.limit.max}`}
        resetTime={limits.cycle5h.resetTime}
      />

      <ProgressBar
        label="Weekly Opus"
        percentage={limits.weeklyOpus.percentage}
        sublabel={`${limits.weeklyOpus.used.toFixed(1)}h/${limits.weeklyOpus.limit.min}-${limits.weeklyOpus.limit.max}h`}
        isStale={limits.weeklyOpus.isStale}
      />

      <ProgressBar
        label="Weekly Sonnet"
        percentage={limits.weeklySonnet.percentage}
        sublabel={`${limits.weeklySonnet.used.toFixed(1)}h/${limits.weeklySonnet.limit.min}-${limits.weeklySonnet.limit.max}h`}
        isStale={limits.weeklySonnet.isStale}
      />
    </div>
  );
}
